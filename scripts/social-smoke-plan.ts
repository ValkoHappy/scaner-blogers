import { buildSocialCredentialReadiness, type SocialCredentialReadiness } from "@scaner-blogers/core";

export type SmokePlatform = "instagram" | "vk" | "youtube";

export type SmokePreflight = {
  platform: SmokePlatform;
  status: SocialCredentialReadiness["status"];
  ready: boolean;
  source: string;
  missing: string[];
  notes: string[];
};

export type SmokeExecutionStep = {
  platform: SmokePlatform;
  action: "run" | "fail";
  preflight?: SmokePreflight;
  message?: string;
};

export function selectSmokePlatforms(value: string | undefined) {
  const requested = (value ?? "all").toLowerCase();
  if (requested === "all") return ["instagram", "vk", "youtube"] satisfies SmokePlatform[];
  return isSmokePlatform(requested) ? [requested] : [];
}

export function buildSmokePreflight(platforms: SmokePlatform[], env: Record<string, string | undefined>): SmokePreflight[] {
  const readinessByPlatform = new Map(
    buildSocialCredentialReadiness(env).map((item) => [item.platform.toLowerCase(), item])
  );
  return platforms.map((platform) => {
    const item = readinessByPlatform.get(platform);
    if (!item) {
      return {
        platform,
        status: "MISSING",
        ready: false,
        source: "none",
        missing: ["platform readiness unavailable"],
        notes: []
      };
    }
    return {
      platform,
      status: item.status,
      ready: item.ready,
      source: item.source,
      missing: item.missing,
      notes: item.notes
    };
  });
}

export function planSmokeExecution(
  platforms: SmokePlatform[],
  preflight: SmokePreflight[],
  strictPreflight: boolean
): SmokeExecutionStep[] {
  return platforms.map((platform) => {
    const platformPreflight = preflight.find((item) => item.platform === platform);
    if (strictPreflight && platformPreflight?.status === "MISSING") {
      return {
        platform,
        action: "fail",
        preflight: platformPreflight,
        message: `missing credentials: ${platformPreflight.missing.join(", ")}`
      };
    }
    return {
      platform,
      action: "run",
      preflight: platformPreflight
    };
  });
}

export function isSmokePlatform(value: string): value is SmokePlatform {
  return value === "instagram" || value === "vk" || value === "youtube";
}
