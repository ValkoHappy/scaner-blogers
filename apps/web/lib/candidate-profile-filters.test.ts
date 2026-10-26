import { describe, expect, it } from "vitest";
import { buildCandidateProfileWhere, textContains } from "./candidate-profile-filters";

describe("candidate profile filters", () => {
  it("builds case-insensitive search filters for all text fields", () => {
    expect(buildCandidateProfileWhere({ q: "MiXeDCase" })).toMatchObject({
      OR: [
        { username: { contains: "MiXeDCase" } },
        { displayName: { contains: "MiXeDCase" } },
        { bio: { contains: "MiXeDCase" } },
        { sourceKeyword: { contains: "MiXeDCase" } },
        { sourceTag: { contains: "MiXeDCase" } }
      ]
    });
  });

  it("keeps follower, score, status, platform and exported filters intact", () => {
    expect(buildCandidateProfileWhere({
      q: "creator",
      status: "PRIORITY",
      platform: "INSTAGRAM",
      matchedBy: "keyword",
      minFollowers: 1000,
      maxFollowers: 5000,
      minScore: 70,
      exported: "NO"
    })).toMatchObject({
      platform: "INSTAGRAM",
      matchedBy: "keyword",
      qualityScore: { gte: 70 },
      followers: { gte: 1000, lte: 5000 },
      candidate: { is: { status: "PRIORITY", exportedAt: null } }
    });
  });

  it("exposes a reusable case-insensitive contains helper", () => {
    expect(textContains("Тест")).toEqual({
      contains: "Тест"
    });
  });
});
