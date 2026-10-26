export interface VkOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  userId?: string;
}

interface VkTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  user_id?: unknown;
  error?: unknown;
  error_description?: unknown;
}

const VK_TOKEN_ENDPOINT = "https://id.vk.ru/oauth2/auth";

export async function exchangeVkAuthorizationCode(input: {
  clientId: string;
  code: string;
  codeVerifier: string;
  deviceId: string;
  redirectUri: string;
  state: string;
}, fetchImpl: typeof fetch = fetch) {
  return requestVkTokens(new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.codeVerifier,
    device_id: input.deviceId,
    redirect_uri: input.redirectUri,
    state: input.state
  }), fetchImpl);
}

export async function refreshVkOAuthToken(input: {
  clientId: string;
  refreshToken: string;
  deviceId: string;
  state: string;
}, fetchImpl: typeof fetch = fetch) {
  return requestVkTokens(new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId,
    refresh_token: input.refreshToken,
    device_id: input.deviceId,
    state: input.state
  }), fetchImpl);
}

async function requestVkTokens(body: URLSearchParams, fetchImpl: typeof fetch): Promise<VkOAuthTokens> {
  const response = await fetchImpl(VK_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store"
  });
  const payload = await response.json().catch(() => null) as VkTokenResponse | null;
  const accessToken = stringValue(payload?.access_token);
  if (!response.ok || !accessToken) {
    const code = stringValue(payload?.error) ?? `http_${response.status}`;
    const description = stringValue(payload?.error_description);
    throw new Error(`vk_oauth_token_exchange_failed:${code}${description ? `:${description}` : ""}`);
  }
  const expiresIn = numberValue(payload?.expires_in);
  return {
    accessToken,
    refreshToken: stringValue(payload?.refresh_token),
    expiresIn: expiresIn && expiresIn > 0 ? expiresIn : undefined,
    userId: stringValue(payload?.user_id)
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : undefined;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}
