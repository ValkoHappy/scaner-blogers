import { existsSync, readFileSync } from "node:fs";

export type MutableSmokeEnv = Record<string, string | undefined>;

export type VkTokenCachePayload = {
  accessToken?: string;
  access_token?: string;
  expiresAt?: string;
  expires_at?: string;
};

export function loadDotEnv(path: string, env: MutableSmokeEnv = process.env, options: { override?: boolean } = {}) {
  if (!existsSync(path)) return;
  applyDotEnvContent(readFileSync(path, "utf8"), env, options);
}

export function applyDotEnvContent(
  content: string,
  env: MutableSmokeEnv,
  options: { override?: boolean } = {}
) {
  for (const line of content.split(/\r\n|\n|\r/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator);
    let value = trimmed.slice(separator + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!value && env[key]) {
      continue;
    }
    if (options.override || !env[key]) {
      env[key] = value;
    }
  }
}

export function loadVkTokenCache(path: string, env: MutableSmokeEnv = process.env) {
  if (!existsSync(path)) return;
  try {
    applyVkTokenCache(env, JSON.parse(readFileSync(path, "utf8")) as VkTokenCachePayload);
  } catch {
    // Smoke preflight/live check will report the resulting credential state.
  }
}

export function applyVkTokenCache(
  env: MutableSmokeEnv,
  payload: VkTokenCachePayload,
  now = new Date()
) {
  const expiresAt = payload.expiresAt || payload.expires_at;
  if (expiresAt && new Date(expiresAt).getTime() <= now.getTime() + 5 * 60_000) return;
  const token = payload.accessToken || payload.access_token;
  if (token) env.VK_ACCESS_TOKEN = token;
}
