const SENSITIVE_DATA_KEYS = new Set([
  "username",
  "sessionFile",
  "proxyUrl",
  "accessToken",
  "apiKey",
  "password",
  "token"
]);

export function sanitizeSecretText(value: string) {
  return value
    .replace(/(\bauthorization\s*[:=]\s*)[^\s,;]+(?:\s+[^\s,;]+)?/gi, "$1***")
    .replace(/(access_token=)[^&=#\s]+/gi, "$1***")
    .replace(/(api[_-]?key[=:]\s*)[^\s,;]+/gi, "$1***")
    .replace(/(password[=:]\s*)[^\s,;]+/gi, "$1***")
    .replace(/(\btoken[=:]\s*)[^\s,;]+/gi, "$1***")
    .replace(/(\b(?:sessionid|csrftoken|ds_user_id|mid|ig_did)[=:]\s*)[^\s,;]+/gi, "$1***")
    .replace(/\bvk1\.a\.[A-Za-z0-9._-]{12,}/g, "[redacted-vk-token]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, "[redacted-google-api-key]")
    .replace(/\b(socks5h?|https?):\/\/([^:@/\s]+):([^@/\s]+)@/gi, "$1://[redacted]@");
}

export function sanitizeSmokeData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeSmokeData(item));
  if (!value || typeof value !== "object") return typeof value === "string" ? sanitizeSecretText(value) : value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    sanitized[key] = shouldRedactKey(key) ? "[redacted]" : sanitizeSmokeData(rawValue);
  }
  return sanitized;
}

export type SmokeFailurePlatform = "instagram" | "vk" | "youtube";

export type SmokeFailureDiagnosis = {
  code: string;
  summary: string;
  action: string;
};

export function diagnoseSmokeFailure(platform: SmokeFailurePlatform, rawMessage: string): SmokeFailureDiagnosis {
  const message = sanitizeSecretText(rawMessage);
  const normalized = message.toLowerCase();

  if (platform === "vk" && normalized.includes("access_token was given to another ip address")) {
    return {
      code: "vk_oauth_ip_bound",
      summary: "VK OAuth token is bound to another IP address.",
      action: "Run npm.cmd run vk:refresh-token on the same machine/IP as the worker. VK groups.search requires a user access token."
    };
  }

  if (platform === "instagram" && (
    normalized.includes("sslcertverificationerror")
    || normalized.includes("certificate verify failed")
  )) {
    return {
      code: "instagram_ssl_certificate",
      summary: "Instagram HTTPS certificate validation failed in the local Python environment.",
      action: "Use a working Instagram proxy or install/export the local trusted root CA for Python; do not disable SSL verification."
    };
  }

  return {
    code: "social_smoke_failed",
    summary: "Live social smoke check failed.",
    action: "Read the platform message and credential preflight, then retry after fixing the external access issue."
  };
}

function shouldRedactKey(key: string) {
  const normalized = key.replace(/[_-]/g, "").toLowerCase();
  return SENSITIVE_DATA_KEYS.has(key) || normalized.includes("token") || normalized.includes("password");
}
