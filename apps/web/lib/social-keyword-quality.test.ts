import { describe, expect, it } from "vitest";
import { buildSocialKeywordQuality } from "./social-keyword-quality";

describe("social keyword quality analytics", () => {
  it("merges candidate quality and collection throughput by keyword and platform", () => {
    expect(buildSocialKeywordQuality({
      keywords: new Map([
        ["kw-face", "массаж лица"],
        ["kw-yoga", "face yoga"]
      ]),
      profileGroups: [{
        keywordId: "kw-face",
        platform: "INSTAGRAM",
        _count: { _all: 4 },
        _avg: { qualityScore: 78, followers: 41_500 }
      }, {
        keywordId: "kw-yoga",
        platform: "YOUTUBE",
        _count: { _all: 2 },
        _avg: { qualityScore: 55.5, followers: 26_000 }
      }],
      jobGroups: [{
        keywordId: "kw-face",
        platform: "INSTAGRAM",
        _count: { _all: 3 },
        _sum: { candidatesFound: 4, profilesChecked: 80 }
      }, {
        keywordId: "kw-yoga",
        platform: "YOUTUBE",
        _count: { _all: 1 },
        _sum: { candidatesFound: 2, profilesChecked: 10 }
      }]
    })).toEqual([{
      keywordId: "kw-face",
      keyword: "массаж лица",
      platform: "INSTAGRAM",
      candidates: 4,
      jobs: 3,
      profilesChecked: 80,
      acceptanceRate: 5,
      avgQualityScore: 78,
      avgFollowers: 41500
    }, {
      keywordId: "kw-yoga",
      keyword: "face yoga",
      platform: "YOUTUBE",
      candidates: 2,
      jobs: 1,
      profilesChecked: 10,
      acceptanceRate: 20,
      avgQualityScore: 56,
      avgFollowers: 26000
    }]);
  });

  it("sorts strongest keyword/platform pairs first", () => {
    const rows = buildSocialKeywordQuality({
      keywords: new Map([["a", "a"], ["b", "b"]]),
      profileGroups: [{
        keywordId: "a",
        platform: "VK",
        _count: { _all: 10 },
        _avg: { qualityScore: 40, followers: 10_000 }
      }, {
        keywordId: "b",
        platform: "INSTAGRAM",
        _count: { _all: 1 },
        _avg: { qualityScore: 90, followers: 20_000 }
      }],
      jobGroups: []
    });

    expect(rows.map((row) => row.keywordId)).toEqual(["b", "a"]);
  });
});
