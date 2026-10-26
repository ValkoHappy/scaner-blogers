import { describe, expect, it } from "vitest";
import { sanitizeEventData } from "./event-sanitize";

describe("database event sanitization", () => {
  it("preserves safe credential diagnostics while redacting secret values", () => {
    const vkToken = "vk1.a." + "z".repeat(85);

    const sanitized = sanitizeEventData({
      tokenConfigured: true,
      preferredToken: "VK_TOKEN_FILE",
      accessToken: vkToken,
      authorization: `Bearer ${vkToken}`,
      proxyUrl: "socks5://user:pass@1.2.3.4:9000"
    });

    expect(sanitized).toEqual({
      tokenConfigured: true,
      preferredToken: "VK_TOKEN_FILE",
      accessToken: "[redacted]",
      authorization: "[redacted]",
      proxyUrl: "[redacted]"
    });
    expect(JSON.stringify(sanitized)).not.toContain(vkToken);
    expect(JSON.stringify(sanitized)).not.toContain("user:pass");
  });
});
