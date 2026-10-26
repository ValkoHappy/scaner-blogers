type SocialAccountStatusInput = {
  platform: string;
  accountKey: string;
  username: string | null;
  status: string;
  blockedUntil: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  consecutiveErrors: number;
  lastError: string | null;
};

export function safeSocialAccountStatus(account: SocialAccountStatusInput) {
  return {
    platform: account.platform,
    accountKey: redactAccountKey(account.accountKey),
    username: account.username ? "[redacted]" : null,
    status: account.status,
    blockedUntil: account.blockedUntil,
    lastSuccessAt: account.lastSuccessAt,
    lastErrorAt: account.lastErrorAt,
    consecutiveErrors: account.consecutiveErrors,
    lastError: account.lastError ? sanitizeStatusText(account.lastError) : null
  };
}

export function sanitizeStatusText(value: string) {
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

function redactAccountKey(value: string) {
  const separator = value.indexOf(":");
  if (separator < 0) return "[redacted]";
  return `${value.slice(0, separator)}:[redacted]`;
}
