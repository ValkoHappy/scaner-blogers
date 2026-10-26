import { describe, expect, it } from "vitest";
import { sanitizeEventForClient } from "./event-sanitize";

describe("event log sanitization", () => {
  it("redacts secret-like text recursively before events are returned to the admin UI", () => {
    const vkToken = `vk1.a.${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
    const googleKey = `AI${"zaSyCVuLxIeUVqz6oTKNToroPvK5ublGWAbhQ"}`;

    const event = sanitizeEventForClient({
      id: "event-1",
      level: "error",
      message: `failed access_token=${vkToken} via socks5://user:pass@1.2.3.4:9000`,
      createdAt: new Date("2026-05-31T12:00:00.000Z"),
      data: {
        code: "collector_failed",
        nested: {
          message: `api_key=${googleKey}`,
          token: vkToken,
          proxyUrl: "socks5://user:pass@1.2.3.4:9000"
        },
        list: [`password=secret ${vkToken}`]
      }
    });

    expect(event).toEqual({
      id: "event-1",
      level: "error",
      message: "failed access_token=*** via socks5://[redacted]@1.2.3.4:9000",
      createdAt: new Date("2026-05-31T12:00:00.000Z"),
      data: {
        code: "collector_failed",
        nested: {
          message: "api_key=***",
          token: "[redacted]",
          proxyUrl: "[redacted]"
        },
        list: ["password=*** [redacted-vk-token]"]
      }
    });
  });
});
