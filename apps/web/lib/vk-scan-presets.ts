export type VkScanMode = "quick" | "deep" | "continuous";

export interface VkScanPreset {
  maxProfiles: number;
  config: Record<string, number | boolean | string>;
}

export const DEFAULT_VK_SCAN_MODE: VkScanMode = "deep";

export const VK_SCAN_PRESETS: Record<VkScanMode, VkScanPreset> = {
  quick: {
    maxProfiles: 100,
    config: {
      scanMode: "quick",
      useDerivedQueries: true,
      maxSearchQueriesPerKeyword: 5,
      searchCountPerKeyword: 100,
      maxGroupChecks: 200,
      wallPostsPerGroup: 10,
      requestDelayMinSec: 0.35,
      requestDelayMaxSec: 1.25,
      timeoutMs: 900_000
    }
  },
  deep: {
    maxProfiles: 500,
    config: {
      scanMode: "deep",
      useDerivedQueries: true,
      maxSearchQueriesPerKeyword: 8,
      searchCountPerKeyword: 500,
      maxGroupChecks: 1_000,
      wallPostsPerGroup: 20,
      requestDelayMinSec: 0.5,
      requestDelayMaxSec: 1.5,
      timeoutMs: 3_600_000
    }
  },
  continuous: {
    maxProfiles: 2_000,
    config: {
      scanMode: "continuous",
      useDerivedQueries: true,
      maxSearchQueriesPerKeyword: 12,
      searchCountPerKeyword: 1_000,
      maxGroupChecks: 5_000,
      wallPostsPerGroup: 30,
      requestDelayMinSec: 0.75,
      requestDelayMaxSec: 2.25,
      timeoutMs: 14_400_000
    }
  }
};

export function vkScanModeValue(value: FormDataEntryValue | null): VkScanMode {
  return value === "quick" || value === "deep" || value === "continuous" ? value : DEFAULT_VK_SCAN_MODE;
}

export function vkScanPreset(value: FormDataEntryValue | null): VkScanPreset {
  return VK_SCAN_PRESETS[vkScanModeValue(value)];
}
