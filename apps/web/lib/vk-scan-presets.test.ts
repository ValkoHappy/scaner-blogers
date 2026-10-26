import { describe, expect, it } from "vitest";
import { vkScanModeValue, vkScanPreset } from "./vk-scan-presets";

describe("vk scan presets", () => {
  it("uses deep collection as the default admin run mode", () => {
    expect(vkScanModeValue(null)).toBe("deep");
    expect(vkScanPreset(null)).toMatchObject({
      maxProfiles: 500,
      config: {
        scanMode: "deep",
        useDerivedQueries: true,
        maxSearchQueriesPerKeyword: 8,
        searchCountPerKeyword: 500,
        maxGroupChecks: 1_000,
        wallPostsPerGroup: 20,
        timeoutMs: 3_600_000
      }
    });
  });

  it("keeps a long-running high-volume mode for broad VK discovery", () => {
    expect(vkScanPreset("continuous")).toMatchObject({
      maxProfiles: 2_000,
      config: {
        scanMode: "continuous",
        useDerivedQueries: true,
        maxSearchQueriesPerKeyword: 12,
        searchCountPerKeyword: 1_000,
        maxGroupChecks: 5_000,
        wallPostsPerGroup: 30,
        timeoutMs: 14_400_000
      }
    });
  });
});
