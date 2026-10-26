import { describe, expect, it } from "vitest";
import { estimateYouTubeQuotaUnits, youtubeScanModeValue, youtubeScanPreset } from "./youtube-scan-presets";

describe("youtube scan presets", () => {
  it("uses deep collection as the default admin run mode", () => {
    expect(youtubeScanModeValue(null)).toBe("deep");
    expect(youtubeScanPreset(null)).toMatchObject({
      maxProfiles: 500,
      config: {
        scanMode: "deep",
        includeChannelSearch: true,
        includeShortsSearch: true,
        includeVideoSearch: true,
        maxSearchQueriesPerKeyword: 8,
        searchResultsPerQuery: 25,
        maxChannelChecks: 1_000,
        recentVideosPerChannel: 10,
        timeoutMs: 3_600_000
      }
    });
  });

  it("keeps a long-running high-volume mode for broad YouTube discovery", () => {
    expect(youtubeScanPreset("continuous")).toMatchObject({
      maxProfiles: 2_000,
      config: {
        scanMode: "continuous",
        includeChannelSearch: true,
        includeShortsSearch: true,
        includeVideoSearch: true,
        searchResultsPerQuery: 50,
        maxChannelChecks: 5_000,
        recentVideosPerChannel: 15,
        timeoutMs: 14_400_000
      }
    });
  });

  it("estimates YouTube API quota before a run is queued", () => {
    expect(estimateYouTubeQuotaUnits(youtubeScanPreset("quick"), {
      keywordCount: 1,
      countryCount: 2
    })).toMatchObject({
      searchCalls: 24,
      channelDetailCalls: 150,
      recentVideoSearchCalls: 150,
      videoDetailCalls: 150,
      totalUnits: 17_700
    });
  });
});
