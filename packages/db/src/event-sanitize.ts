import { sanitizeSocialDiagnosticText } from "@scaner-blogers/core";

export function sanitizeEventMessage(value: string) {
  return sanitizeSocialDiagnosticText(value);
}

export function sanitizeEventData(value: unknown): unknown {
  if (typeof value === "string") return sanitizeSocialDiagnosticText(value);
  if (Array.isArray(value)) return value.map(sanitizeEventData);
  if (!value || typeof value !== "object") return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    sanitized[key] = shouldRedactEventKey(key) ? "[redacted]" : sanitizeEventData(rawValue);
  }
  return sanitized;
}

function shouldRedactEventKey(key: string) {
  if (/^(preferredToken|tokenConfigured)$/i.test(key)) return false;
  return /(password|passwd|secret|token|accessToken|access_token|apiKey|api_key|authorization|cookie|session|proxyUrl|proxy_url)/i.test(key);
}
