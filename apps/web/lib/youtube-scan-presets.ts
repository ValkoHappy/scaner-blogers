export type YouTubeScanMode = "quick" | "deep" | "continuous";

export interface YouTubeScanPreset {
  maxProfiles: number;
  config: Record<string, number | boolean | string>;
}

export interface YouTubeQuotaEstimate {
  searchCalls: number;
  channelDetailCalls: number;
  recentVideoSearchCalls: number;
  videoDetailCalls: number;
  totalUnits: number;
}

export interface YouTubeQuotaEstimateInput {
  keywordCount?: number;
  countryCount?: number;
}

export const DEFAULT_YOUTUBE_SCAN_MODE: YouTubeScanMode = "deep";

export const YOUTUBE_SCAN_PRESETS: Record<YouTubeScanMode, YouTubeScanPreset> = {
  quick: {
    maxProfiles: 100,
    config: {
      scanMode: "quick",
      useDerivedQueries: true,
      includeChannelSearch: true,
      includeShortsSearch: true,
      includeVideoSearch: true,
      maxSearchQueriesPerKeyword: 4,
      searchResultsPerQuery: 10,
      maxChannelChecks: 150,
      recentVideosPerChannel: 5,
      requestDelayMinSec: 0.1,
      requestDelayMaxSec: 0.5,
      relevanceLanguage: "ru",
      timeoutMs: 900_000
    }
  },
  deep: {
    maxProfiles: 500,
    config: {
      scanMode: "deep",
      useDerivedQueries: true,
      includeChannelSearch: true,
      includeShortsSearch: true,
      includeVideoSearch: true,
      maxSearchQueriesPerKeyword: 8,
      searchResultsPerQuery: 25,
      maxChannelChecks: 1_000,
      recentVideosPerChannel: 10,
      requestDelayMinSec: 0.15,
      requestDelayMaxSec: 0.8,
      relevanceLanguage: "ru",
      timeoutMs: 3_600_000
    }
  },
  continuous: {
    maxProfiles: 2_000,
    config: {
      scanMode: "continuous",
      useDerivedQueries: true,
      includeChannelSearch: true,
      includeShortsSearch: true,
      includeVideoSearch: true,
      maxSearchQueriesPerKeyword: 12,
      searchResultsPerQuery: 50,
      maxChannelChecks: 5_000,
      recentVideosPerChannel: 15,
      requestDelayMinSec: 0.25,
      requestDelayMaxSec: 1.25,
      relevanceLanguage: "ru",
      timeoutMs: 14_400_000
    }
  }
};

export function youtubeScanModeValue(value: FormDataEntryValue | null): YouTubeScanMode {
  return value === "quick" || value === "deep" || value === "continuous" ? value : DEFAULT_YOUTUBE_SCAN_MODE;
}

export function youtubeScanPreset(value: FormDataEntryValue | null): YouTubeScanPreset {
  return YOUTUBE_SCAN_PRESETS[youtubeScanModeValue(value)];
}

export function estimateYouTubeQuotaUnits(
  preset: YouTubeScanPreset,
  input: YouTubeQuotaEstimateInput = {}
): YouTubeQuotaEstimate {
  const config = preset.config;
  const keywordCount = positiveInt(input.keywordCount, 1);
  const countryCount = positiveInt(input.countryCount, 1);
  const queryCount = positiveInt(config.maxSearchQueriesPerKeyword, 1);
  const enabledSearchModes = [
    config.includeChannelSearch !== false,
    config.includeShortsSearch !== false,
    config.includeVideoSearch !== false
  ].filter(Boolean).length;
  const maxChannelChecks = positiveInt(config.maxChannelChecks, preset.maxProfiles);
  const recentVideosPerChannel = positiveInt(config.recentVideosPerChannel, 0);

  const searchCalls = keywordCount * countryCount * queryCount * Math.max(1, enabledSearchModes);
  const channelDetailCalls = maxChannelChecks;
  const recentVideoSearchCalls = recentVideosPerChannel > 0 ? maxChannelChecks : 0;
  const videoDetailCalls = recentVideosPerChannel > 0 ? maxChannelChecks : 0;

  return {
    searchCalls,
    channelDetailCalls,
    recentVideoSearchCalls,
    videoDetailCalls,
    totalUnits:
      searchCalls * 100
      + channelDetailCalls
      + recentVideoSearchCalls * 100
      + videoDetailCalls
  };
}

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.max(0, Math.round(parsed));
}
