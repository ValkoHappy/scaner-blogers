import { sanitizeSocialDiagnosticText } from "@scaner-blogers/core";

const SENSITIVE_EVENT_KEYS = new Set([
  "accessToken",
  "apiKey",
  "password",
  "proxyUrl",
  "sessionFile",
  "token"
]);

export type ClientEventLog = {
  id: string;
  level: string;
  message: string;
  createdAt: Date;
  data: unknown;
};

export function sanitizeEventForClient<T extends ClientEventLog>(event: T): T {
  return {
    ...event,
    message: sanitizeSocialDiagnosticText(event.message),
    data: sanitizeEventData(event.data)
  };
}

function sanitizeEventData(value: unknown): unknown {
  if (typeof value === "string") return sanitizeSocialDiagnosticText(value);
  if (Array.isArray(value)) return value.map(sanitizeEventData);
  if (!value || typeof value !== "object") return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    sanitized[key] = shouldRedactKey(key) ? "[redacted]" : sanitizeEventData(rawValue);
  }
  return sanitized;
}

function shouldRedactKey(key: string) {
  const normalized = key.replace(/[_-]/g, "").toLowerCase();
  return SENSITIVE_EVENT_KEYS.has(key)
    || normalized.includes("token")
    || normalized.includes("password")
    || normalized.includes("apikey")
    || normalized.includes("proxyurl")
    || normalized.includes("sessionfile");
}
