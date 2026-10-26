import { describe, expect, it } from "vitest";
import { instagramScanModeValue, instagramScanPreset } from "./instagram-scan-presets";

describe("instagram scan presets", () => {
  it("uses a safer quick collection as the default admin run mode", () => {
    expect(instagramScanModeValue(null)).toBe("quick");
    expect(instagramScanPreset(null)).toMatchObject({
      maxProfiles: 5,
      config: {
        scanMode: "quick",
        includeKeywordReelsSearch: false,
        includeUserSearch: true,
        includeAccountSerpSearch: false,
        includeTypeaheadSearch: false,
        maxTagsPerKeyword: 1,
        maxMediasPerTag: 12,
        maxProfileChecks: 12,
        profileDelayMinSec: 45,
        profileDelayMaxSec: 120,
        mediaDelayMinSec: 30,
        mediaDelayMaxSec: 90,
        timeoutMs: 3_600_000
      }
    });
  });

  it("keeps continuous bounded but slower for broad Instagram discovery", () => {
    expect(instagramScanPreset("continuous")).toMatchObject({
      maxProfiles: 75,
      config: {
        scanMode: "continuous",
        maxTagsPerKeyword: 3,
        maxMediasPerTag: 80,
        maxProfileChecks: 150,
        profileDelayMinSec: 90,
        profileDelayMaxSec: 240,
        mediaDelayMinSec: 60,
        mediaDelayMaxSec: 180,
        timeoutMs: 43_200_000
      }
    });
  });
});
