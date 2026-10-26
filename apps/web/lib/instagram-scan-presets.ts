export type InstagramScanMode = "quick" | "deep" | "continuous";

export interface InstagramScanPreset {
  maxProfiles: number;
  config: Record<string, number | boolean | string>;
}

export const DEFAULT_INSTAGRAM_SCAN_MODE: InstagramScanMode = "quick";

export const INSTAGRAM_SCAN_PRESETS: Record<InstagramScanMode, InstagramScanPreset> = {
  quick: {
    maxProfiles: 5,
    config: {
      scanMode: "quick",
      useHashtagSearch: false,
      useDerivedHashtags: true,
      includeKeywordReelsSearch: false,
      includeUserSearch: true,
      includeAccountSerpSearch: false,
      includeTypeaheadSearch: false,
      maxTagsPerKeyword: 1,
      maxUserSearchResultsPerKeyword: 2,
      maxMediasPerTag: 12,
      maxProfileChecks: 12,
      recentMediaPerProfile: 0,
      profileDelayMinSec: 45,
      profileDelayMaxSec: 120,
      mediaDelayMinSec: 30,
      mediaDelayMaxSec: 90,
      timeoutMs: 3_600_000
    }
  },
  deep: {
    maxProfiles: 25,
    config: {
      scanMode: "deep",
      useHashtagSearch: false,
      useDerivedHashtags: true,
      includeKeywordReelsSearch: true,
      includeUserSearch: true,
      includeAccountSerpSearch: true,
      includeTypeaheadSearch: true,
      maxTagsPerKeyword: 2,
      maxUserSearchResultsPerKeyword: 3,
      maxMediasPerTag: 35,
      maxProfileChecks: 50,
      recentMediaPerProfile: 0,
      profileDelayMinSec: 60,
      profileDelayMaxSec: 150,
      mediaDelayMinSec: 45,
      mediaDelayMaxSec: 120,
      timeoutMs: 14_400_000
    }
  },
  continuous: {
    maxProfiles: 75,
    config: {
      scanMode: "continuous",
      useHashtagSearch: false,
      useDerivedHashtags: true,
      includeKeywordReelsSearch: true,
      includeUserSearch: true,
      includeAccountSerpSearch: true,
      includeTypeaheadSearch: true,
      maxTagsPerKeyword: 3,
      maxUserSearchResultsPerKeyword: 5,
      maxMediasPerTag: 80,
      maxProfileChecks: 150,
      recentMediaPerProfile: 0,
      profileDelayMinSec: 90,
      profileDelayMaxSec: 240,
      mediaDelayMinSec: 60,
      mediaDelayMaxSec: 180,
      timeoutMs: 43_200_000
    }
  }
};

export function instagramScanModeValue(value: FormDataEntryValue | null): InstagramScanMode {
  return value === "quick" || value === "deep" || value === "continuous" ? value : DEFAULT_INSTAGRAM_SCAN_MODE;
}

export function instagramScanPreset(value: FormDataEntryValue | null): InstagramScanPreset {
  return INSTAGRAM_SCAN_PRESETS[instagramScanModeValue(value)];
}
