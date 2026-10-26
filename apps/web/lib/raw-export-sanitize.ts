import { sanitizeSocialDiagnosticText } from "@scaner-blogers/core";

export function sanitizeRawExportSnapshot<T extends Record<string, unknown>>(snapshot: T): T {
  return sanitizeRawExportValue(snapshot) as T;
}

function sanitizeRawExportValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeSocialDiagnosticText(value);
  if (Array.isArray(value)) return value.map(sanitizeRawExportValue);
  if (value instanceof Date) return value;
  if (!value || typeof value !== "object") return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    sanitized[key] = shouldRedactRawExportKey(key) ? "[redacted]" : sanitizeRawExportValue(rawValue);
  }
  return sanitized;
}

function shouldRedactRawExportKey(key: string) {
  const normalized = key.replace(/[_-]/g, "").toLowerCase();
  if (/^(preferredtoken|tokenconfigured)$/.test(normalized)) return false;
  return normalized.includes("password")
    || normalized.includes("passwd")
    || normalized.includes("secret")
    || normalized.includes("token")
    || normalized.includes("apikey")
    || normalized.includes("authorization")
    || normalized.includes("cookie")
    || normalized.includes("session")
    || normalized.includes("proxyurl");
}
