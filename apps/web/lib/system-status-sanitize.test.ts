import { describe, expect, it } from "vitest";
import { safeSocialAccountStatus, sanitizeStatusText } from "./system-status-sanitize";

describe("system status sanitization", () => {
  it("keeps operational account diagnostics without exposing account identifiers or secrets", () => {
    const account = safeSocialAccountStatus({
      platform: "INSTAGRAM",
      accountKey: "INSTAGRAM:collector_account",
      username: "collector_account",
      status: "BLOCKED",
      blockedUntil: new Date("2026-05-31T12:00:00.000Z"),
      lastSuccessAt: null,
      lastErrorAt: new Date("2026-05-31T11:00:00.000Z"),
      consecutiveErrors: 2,
      lastError: "failed with access_token=vk1.a.secret password=hidden"
    });

    expect(account).toEqual({
      platform: "INSTAGRAM",
      accountKey: "INSTAGRAM:[redacted]",
      username: "[redacted]",
      status: "BLOCKED",
      blockedUntil: new Date("2026-05-31T12:00:00.000Z"),
      lastSuccessAt: null,
      lastErrorAt: new Date("2026-05-31T11:00:00.000Z"),
      consecutiveErrors: 2,
      lastError: "failed with access_token=*** password=***"
    });
  });

  it("redacts common token, password and proxy credential patterns in status text", () => {
    const vkToken = `vk1.a.${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
    const googleKey = `AI${"zaSyCVuLxIeUVqz6oTKNToroPvK5ublGWAbhQ"}`;

    expect(sanitizeStatusText(`proxy socks5://user:pass@1.2.3.4:9000 api_key=abc token=def ${vkToken} ${googleKey}`)).toBe(
      "proxy socks5://[redacted]@1.2.3.4:9000 api_key=*** token=*** [redacted-vk-token] [redacted-google-api-key]"
    );
  });

  it("redacts authorization headers and Instagram session cookies in status text", () => {
    const vkToken = `vk1.a.${"abcdefghijklmnopqrstuvwxyz0123456789"}`;

    expect(sanitizeStatusText(`Authorization: Bearer ${vkToken}; sessionid=ig-session-secret csrftoken=csrf-secret`)).toBe(
      "Authorization: ***; sessionid=*** csrftoken=***"
    );
  });
});
