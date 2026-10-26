import { describe, expect, it } from "vitest";
import type { SocialCandidateRow } from "./social";
import { scoreSocialCandidate } from "./social-score";

const baseCandidate: SocialCandidateRow = {
  platform: "instagram",
  platformProfileId: "123",
  username: "face_pro",
  displayName: "Face Pro",
  profileUrl: "https://example.test/face_pro",
  followers: 34_000,
  bio: "Массаж лица, фейсфитнес и домашний уход",
  externalUrl: "https://example.test",
  contacts: { emails: ["hello@example.test"], phones: [], urls: ["https://example.test"] },
  sourceKeyword: "массаж лица",
  sourceTag: "массажлица",
  matchedBy: "hashtag_reels",
  lastPosts: [
    { id: "1", url: "https://example.test/reel/1", takenAt: "2026-05-28T10:00:00.000Z", viewCount: 12_000 }
  ],
  metrics: { avgLikes: 900, avgComments: 45, avgViews: 12_000, postsChecked: 5 },
  geoGuess: "RU",
  reason: "matched by #массажлица",
  raw: {},
  collectedAt: "2026-05-29T12:00:00.000Z"
};

describe("scoreSocialCandidate", () => {
  it("rewards relevant candidates with contacts, activity and follower fit", () => {
    const result = scoreSocialCandidate(baseCandidate, { minFollowers: 20_000, maxFollowers: 60_000 });

    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.signals).toEqual(expect.arrayContaining([
      "followers_in_range",
      "has_contacts",
      "has_recent_posts",
      "has_activity",
      "bio_keyword_match",
      "has_source_tag"
    ]));
  });

  it("keeps weak candidates low even when they were found by search", () => {
    const result = scoreSocialCandidate({
      ...baseCandidate,
      followers: 300_000,
      bio: "",
      externalUrl: undefined,
      contacts: { emails: [], phones: [], urls: [] },
      lastPosts: [],
      metrics: { avgLikes: 0, avgComments: 0, avgViews: 0, postsChecked: 0 },
      sourceTag: undefined,
      geoGuess: null
    }, { minFollowers: 20_000, maxFollowers: 60_000 });

    expect(result.score).toBeLessThan(35);
    expect(result.signals).toContain("followers_out_of_range");
    expect(result.signals).toContain("missing_contacts");
  });
});
