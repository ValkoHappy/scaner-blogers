import { describe, expect, it } from "vitest";
import { parseCollectorEventRow, parseSocialCandidateRow, sanitizeSocialDiagnosticText, socialCandidateDedupeKey } from "./social";

const candidate = {
  platform: "instagram",
  platformProfileId: "123",
  username: "faceyoga_pro",
  displayName: "Face Yoga Pro",
  profileUrl: "https://www.instagram.com/faceyoga_pro/",
  followers: 34000,
  bio: "face yoga",
  externalUrl: "https://example.com",
  contacts: { emails: ["a@example.com"], phones: [], urls: ["https://example.com"] },
  sourceKeyword: "массаж лица",
  sourceTag: "массажлица",
  matchedBy: "hashtag_reels",
  lastPosts: [{ id: "m1", code: "ABC", url: "https://www.instagram.com/p/ABC/", likeCount: 12 }],
  metrics: { avgLikes: 12, avgComments: 1, avgViews: 1200, postsChecked: 1 },
  geoGuess: "RU",
  reason: "найден по #массажлица",
  raw: { sourceMedia: { id: "m1" } },
  collectedAt: "2026-05-28T09:00:00.000Z"
};

describe("social collector contract", () => {
  it("parses a valid Instagram candidate row", () => {
    expect(parseSocialCandidateRow(candidate)).toMatchObject({
      platform: "instagram",
      platformProfileId: "123",
      followers: 34000
    });
  });

  it("rejects unsupported platforms", () => {
    expect(() => parseSocialCandidateRow({ ...candidate, platform: "telegram" })).toThrow("Unsupported platform");
  });

  it("builds a stable dedupe key", () => {
    expect(socialCandidateDedupeKey(parseSocialCandidateRow(candidate))).toBe("instagram:123");
  });

  it("parses collector event rows", () => {
    expect(parseCollectorEventRow({ event: { level: "warn", code: "rate_limited", message: "wait" } })).toMatchObject({
      event: { level: "warn", code: "rate_limited" }
    });
  });

  it("redacts secrets from diagnostic text before it is stored or shown", () => {
    const vkToken = `vk1.a.${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
    const googleKey = `AI${"zaSyCVuLxIeUVqz6oTKNToroPvK5ublGWAbhQ"}`;

    expect(sanitizeSocialDiagnosticText(`proxy socks5://user:pass@1.2.3.4:9000 access_token=abc api_key=yt token=vk ${vkToken} ${googleKey}`)).toBe(
      "proxy socks5://[redacted]@1.2.3.4:9000 access_token=*** api_key=*** token=*** [redacted-vk-token] [redacted-google-api-key]"
    );
  });

  it("redacts authorization headers and session cookies from diagnostic text", () => {
    const vkToken = `vk1.a.${"abcdefghijklmnopqrstuvwxyz0123456789"}`;

    expect(sanitizeSocialDiagnosticText(`Authorization: Bearer ${vkToken}; sessionid=ig-session-secret csrftoken=csrf-secret`)).toBe(
      "Authorization: ***; sessionid=*** csrftoken=***"
    );
  });
});
