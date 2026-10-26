export interface ResolveVkOAuthClientIdInput {
  settingsVkAppId?: string | null;
  envVkAppId?: string | null;
}

export interface ResolveVkOAuthClientIdResult {
  activeClientId: string;
  source: "db" | "env" | "missing";
  settingsClientId: string;
  envClientId: string;
  mismatch: boolean;
}

export interface VkOAuthRedirectUriStatus {
  redirectUri: string;
  source: "env" | "derived";
  isLocal: boolean;
  isHttps: boolean;
  isReady: boolean;
}

export function cleanVkAppId(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed && /^\d+$/.test(trimmed) ? trimmed : "";
}

export function resolveVkOAuthClientId(input: ResolveVkOAuthClientIdInput): ResolveVkOAuthClientIdResult {
  const settingsClientId = cleanVkAppId(input.settingsVkAppId);
  const envClientId = cleanVkAppId(input.envVkAppId);
  const activeClientId = settingsClientId || envClientId;
  return {
    activeClientId,
    source: settingsClientId ? "db" : envClientId ? "env" : "missing",
    settingsClientId,
    envClientId,
    mismatch: Boolean(settingsClientId && envClientId && settingsClientId !== envClientId)
  };
}

export function resolveVkOAuthRedirectUri(origin: string, envRedirectUri?: string | null) {
  const normalizedOrigin = origin.replace(/\/$/, "");
  const redirectUri = envRedirectUri?.trim();
  return redirectUri || `${normalizedOrigin}/api/vk/oauth/callback`;
}

export function inspectVkOAuthRedirectUri(origin: string, envRedirectUri?: string | null): VkOAuthRedirectUriStatus {
  const redirectUri = resolveVkOAuthRedirectUri(origin, envRedirectUri);
  let parsed: URL | null = null;
  try {
    parsed = new URL(redirectUri);
  } catch {}
  const hostname = parsed?.hostname?.toLowerCase() || "";
  const isLocal = Boolean(hostname && (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local")
  ));
  const isHttps = parsed?.protocol === "https:";
  return {
    redirectUri,
    source: envRedirectUri?.trim() ? "env" : "derived",
    isLocal,
    isHttps,
    isReady: Boolean(parsed && isHttps && !isLocal)
  };
}
