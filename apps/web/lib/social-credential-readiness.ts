import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildSocialCredentialReadiness as buildCoreSocialCredentialReadiness,
  type SocialCredentialReadiness,
  type SocialCredentialStatus
} from "@scaner-blogers/core";

export type { SocialCredentialReadiness, SocialCredentialStatus };

const CACHED_VK_OAUTH_SENTINEL = "vk-cache-present";

export function buildSocialCredentialReadiness(env: NodeJS.ProcessEnv = process.env) {
  const readinessEnv = { ...env };
  if (!readinessEnv.VK_ACCESS_TOKEN && hasFreshVkTokenCache(env)) {
    readinessEnv.VK_ACCESS_TOKEN = CACHED_VK_OAUTH_SENTINEL;
  }
  return buildCoreSocialCredentialReadiness(readinessEnv).map((item) => {
    if (item.platform !== "VK" || readinessEnv.VK_ACCESS_TOKEN !== CACHED_VK_OAUTH_SENTINEL) return item;
    return {
      ...item,
      source: "VK_TOKEN_FILE",
      status: "READY" as const,
      notes: ["cached user OAuth token can expire or be IP-bound; refresh it on the worker IP"]
    };
  });
}

function hasFreshVkTokenCache(env: NodeJS.ProcessEnv) {
  const tokenPath = env.VK_TOKEN_FILE || resolve(process.cwd(), ".vk", "token.json");
  if (!existsSync(tokenPath)) return false;
  try {
    const payload = JSON.parse(readFileSync(tokenPath, "utf8")) as {
      accessToken?: string;
      access_token?: string;
      expiresAt?: string;
      expires_at?: string;
    };
    if (!payload.accessToken && !payload.access_token) return false;
    const expiresAt = payload.expiresAt || payload.expires_at;
    if (!expiresAt) return true;
    return new Date(expiresAt).getTime() > Date.now() + 5 * 60_000;
  } catch {
    return false;
  }
}
