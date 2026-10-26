import { describe, expect, it } from "vitest";
import { platformFollowerRange } from "./platform-follower-ranges";

const keyword = {
  minFollowers: 20_000,
  maxFollowers: 60_000,
  instagramMinFollowers: 20_000,
  instagramMaxFollowers: 60_000,
  vkMinFollowers: 5_000,
  vkMaxFollowers: 100_000,
  youtubeMinFollowers: 10_000,
  youtubeMaxFollowers: 150_000
};

describe("platformFollowerRange", () => {
  it("uses platform-specific follower ranges when they exist", () => {
    expect(platformFollowerRange(keyword, "vk")).toEqual({ minFollowers: 5_000, maxFollowers: 100_000 });
    expect(platformFollowerRange(keyword, "youtube")).toEqual({ minFollowers: 10_000, maxFollowers: 150_000 });
  });

  it("falls back to the common keyword range for missing platform values", () => {
    expect(platformFollowerRange({
      ...keyword,
      vkMinFollowers: null,
      vkMaxFollowers: null
    }, "vk")).toEqual({ minFollowers: 20_000, maxFollowers: 60_000 });
  });
});
