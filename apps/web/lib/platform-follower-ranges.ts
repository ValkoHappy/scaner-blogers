export type PlatformFollowerRangePlatform = "instagram" | "vk" | "youtube";

export interface PlatformFollowerRangeKeyword {
  minFollowers: number;
  maxFollowers: number;
  instagramMinFollowers?: number | null;
  instagramMaxFollowers?: number | null;
  vkMinFollowers?: number | null;
  vkMaxFollowers?: number | null;
  youtubeMinFollowers?: number | null;
  youtubeMaxFollowers?: number | null;
}

export function platformFollowerRange(
  keyword: PlatformFollowerRangeKeyword,
  platform: PlatformFollowerRangePlatform
) {
  const prefix = platform === "instagram" ? "instagram" : platform;
  const minKey = `${prefix}MinFollowers` as keyof PlatformFollowerRangeKeyword;
  const maxKey = `${prefix}MaxFollowers` as keyof PlatformFollowerRangeKeyword;

  return {
    minFollowers: positiveNumber(keyword[minKey]) ?? keyword.minFollowers,
    maxFollowers: positiveNumber(keyword[maxKey]) ?? keyword.maxFollowers
  };
}

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
