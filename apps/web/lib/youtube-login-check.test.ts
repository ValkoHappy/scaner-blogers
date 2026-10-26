import { describe, expect, it, vi } from "vitest";
import { runYouTubeAccountLoginCheck, youtubeLoginCheckOutcome } from "./youtube-login-check";

describe("youtube login check", () => {
  it("maps an official API success to OK", () => {
    expect(youtubeLoginCheckOutcome({ ok: true, status: 200, message: "YouTube API key check succeeded" })).toEqual({
      ok: true,
      code: "youtube_api_key_check_ok",
      message: "YouTube API key check succeeded",
      accountStatus: "OK",
      blockedUntil: null
    });
  });

  it("checks and updates the exact YouTube key selected in settings", async () => {
    const updates: unknown[] = [];
    const db = {
      socialPlatformAccount: {
        findFirst: async () => ({
          accountKey: "YOUTUBE:primary",
          metadata: { enabled: true, apiKey: "AIza-saved-key" }
        }),
        update: async (input: unknown) => {
          updates.push(input);
          return input;
        }
      }
    };
    let requestedUrl = "";
    const request = vi.fn(async (input: URL | RequestInfo) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });

    const result = await runYouTubeAccountLoginCheck({
      accountKey: "YOUTUBE:primary",
      db: db as never,
      request
    });

    expect(result.ok).toBe(true);
    expect(request).toHaveBeenCalledOnce();
    expect(requestedUrl).toContain("key=AIza-saved-key");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      where: { accountKey: "YOUTUBE:primary" },
      data: {
        status: "OK",
        lastError: null,
        metadata: {
          enabled: true,
          apiKey: "AIza-saved-key",
          loginCheck: true
        }
      }
    });
  });
});
