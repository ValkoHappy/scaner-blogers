import { describe, expect, it } from "vitest";
import { backoffDelayMs, isGoogleBlockedError, markGoogleBlocked, shouldProbeGoogle } from "./google-health";

describe("google health helpers", () => {
  it("detects blocked errors", () => {
    expect(isGoogleBlockedError(new Error("blocked:SearchService/SearchCreatives:429"))).toBe(true);
    expect(isGoogleBlockedError(new Error("rpc:SearchService/SearchCreatives:500"))).toBe(false);
  });

  it("uses progressive backoff with bounded jitter", () => {
    expect(backoffDelayMs(1, 0)).toBe(990_000);
    expect(backoffDelayMs(1, 1)).toBe(1_170_000);
    expect(backoffDelayMs(10, 0)).toBe(47_520_000);
  });

  it("probes only after cooldown and interval", () => {
    const now = new Date("2026-05-26T00:00:00.000Z");
    expect(shouldProbeGoogle({ status: "BLOCKED", blockedUntil: new Date("2026-05-26T00:01:00.000Z"), lastProbeAt: null }, 60_000, now)).toBe(false);
    expect(shouldProbeGoogle({ status: "BLOCKED", blockedUntil: new Date("2026-05-25T23:59:00.000Z"), lastProbeAt: null }, 60_000, now)).toBe(true);
    expect(shouldProbeGoogle({ status: "BLOCKED", blockedUntil: new Date("2026-05-25T23:59:00.000Z"), lastProbeAt: new Date("2026-05-25T23:59:30.000Z") }, 60_000, now)).toBe(true);
    expect(shouldProbeGoogle({ status: "OK", blockedUntil: null, lastProbeAt: null }, 60_000, now)).toBe(false);
  });

  it("redacts secrets in blocked Google health errors", async () => {
    const vkToken = "vk1.a." + "z".repeat(85);
    const updates: unknown[] = [];
    const db = {
      googleHealth: {
        upsert: async () => ({ id: "default", consecutiveBlocks: 0 }),
        update: async (input: unknown) => {
          updates.push(input);
          return input;
        }
      }
    };

    await markGoogleBlocked(
      new Error(`blocked: access_token=${vkToken} via socks5://user:pass@1.2.3.4:9000`),
      db as never,
      new Date("2026-05-26T00:00:00.000Z")
    );

    expect(updates[0]).toMatchObject({
      data: {
        lastError: expect.stringContaining("access_token=***")
      }
    });
    expect(JSON.stringify(updates[0])).toContain("socks5://[redacted]@1.2.3.4:9000");
    expect(JSON.stringify(updates[0])).not.toContain(vkToken);
    expect(JSON.stringify(updates[0])).not.toContain("user:pass");
  });
});
