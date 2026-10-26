export type SocialCredentialPlatform = "INSTAGRAM" | "VK" | "YOUTUBE";
export type SocialCredentialStatus = "READY" | "WEAK" | "MISSING";

export interface SocialCredentialReadiness {
  platform: SocialCredentialPlatform;
  status: SocialCredentialStatus;
  ready: boolean;
  source: string;
  missing: string[];
  notes: string[];
}

export type SocialCredentialEnv = Record<string, string | undefined>;

export function buildSocialCredentialReadiness(env: SocialCredentialEnv = {}): SocialCredentialReadiness[] {
  const instagramMissing = [
    env.INSTAGRAM_USERNAME ? null : "INSTAGRAM_USERNAME",
    env.INSTAGRAM_PASSWORD ? null : "INSTAGRAM_PASSWORD"
  ].filter((item): item is string => Boolean(item));
  const vkSource = env.VK_ACCESS_TOKEN
    ? "VK_ACCESS_TOKEN"
    : "none";
  const unsupportedVkSource = env.VK_SERVICE_TOKEN
    ? "VK_SERVICE_TOKEN"
    : env.VK_SERVER_TOKEN
    ? "VK_SERVER_TOKEN"
    : null;
  const youtubeMissing = env.YOUTUBE_API_KEY ? [] : ["YOUTUBE_API_KEY"];

  return [
    {
      platform: "INSTAGRAM",
      status: instagramMissing.length ? "MISSING" : "READY",
      ready: instagramMissing.length === 0,
      source: env.INSTAGRAM_PROXY_URL ? "env+proxy" : "env",
      missing: instagramMissing,
      notes: env.INSTAGRAM_PROXY_URL ? ["proxy configured"] : ["proxy optional"]
    },
    {
      platform: "VK",
      status: vkSource === "none" ? "MISSING" : "READY",
      ready: vkSource !== "none",
      source: vkSource === "none" && unsupportedVkSource ? unsupportedVkSource : vkSource,
      missing: vkSource === "none" ? ["VK_ACCESS_TOKEN (user token required by groups.search)"] : [],
      notes: vkSource === "VK_ACCESS_TOKEN"
        ? ["user OAuth token configured; refresh it on the worker IP when VK binds it to an IP"]
        : unsupportedVkSource
        ? [`${unsupportedVkSource} cannot call groups.search; configure VK_ACCESS_TOKEN`]
        : ["no VK user access token configured"]
    },
    {
      platform: "YOUTUBE",
      status: youtubeMissing.length ? "MISSING" : "READY",
      ready: youtubeMissing.length === 0,
      source: env.YOUTUBE_API_KEY ? "YOUTUBE_API_KEY" : "none",
      missing: youtubeMissing,
      notes: ["official YouTube Data API"]
    }
  ];
}
