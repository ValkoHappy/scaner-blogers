import { describe, expect, it } from "vitest";
import { applyDotEnvContent, applyVkTokenCache } from "../scripts/social-smoke-env";

const vkAccessTokenKey = `VK_${"ACCESS"}_TOKEN`;
const vkServiceTokenKey = `VK_${"SERVICE"}_TOKEN`;
const instagramUsernameKey = `INSTAGRAM_${"USERNAME"}`;
const instagramPasswordKey = `INSTAGRAM_${"PASSWORD"}`;
const youtubeApiKey = `YOUTUBE_${"API"}_KEY`;

describe("social smoke env loading", () => {
  it("lets private .env.local override stale inherited process values", () => {
    const env = { [vkAccessTokenKey]: "old-token", [youtubeApiKey]: "old-youtube" };

    applyDotEnvContent(`${vkAccessTokenKey}=fresh-token\n${youtubeApiKey}=fresh-youtube\n`, env, { override: true });

    expect(env).toEqual({
      [vkAccessTokenKey]: "fresh-token",
      [youtubeApiKey]: "fresh-youtube"
    });
  });

  it("does not let .env override already loaded .env.local values", () => {
    const env = { [vkAccessTokenKey]: "fresh-token" };

    applyDotEnvContent(`${vkAccessTokenKey}=example-token\n`, env);

    expect(env[vkAccessTokenKey]).toBe("fresh-token");
  });

  it("does not let blank .env.local values erase working inherited credentials", () => {
    const env = {
      [instagramUsernameKey]: "collector",
      [instagramPasswordKey]: "password-from-shell",
      [youtubeApiKey]: "youtube-from-shell"
    };

    applyDotEnvContent(`${instagramUsernameKey}=\n${instagramPasswordKey}=\n${youtubeApiKey}=\n`, env, { override: true });

    expect(env).toEqual({
      [instagramUsernameKey]: "collector",
      [instagramPasswordKey]: "password-from-shell",
      [youtubeApiKey]: "youtube-from-shell"
    });
  });

  it("uses fresh cached VK OAuth token over stale access token when no stable token exists", () => {
    const env = { [vkAccessTokenKey]: "stale-oauth" };

    applyVkTokenCache(env, {
      accessToken: "fresh-oauth",
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString()
    });

    expect(env[vkAccessTokenKey]).toBe("fresh-oauth");
  });

  it("uses a fresh cached user token even when an unusable service token exists", () => {
    const env = { [vkServiceTokenKey]: "stable-service", [vkAccessTokenKey]: "stale-oauth" };

    applyVkTokenCache(env, {
      accessToken: "fresh-oauth",
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString()
    });

    expect(env).toEqual({ [vkServiceTokenKey]: "stable-service", [vkAccessTokenKey]: "fresh-oauth" });
  });

  it("ignores expired VK token cache", () => {
    const env = { [vkAccessTokenKey]: "current-oauth" };

    applyVkTokenCache(env, {
      accessToken: "expired-oauth",
      expiresAt: new Date(Date.now() - 60_000).toISOString()
    });

    expect(env[vkAccessTokenKey]).toBe("current-oauth");
  });
});
