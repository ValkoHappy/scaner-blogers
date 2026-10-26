import { describe, expect, it } from "vitest";
import { cleanVkAppId, inspectVkOAuthRedirectUri, resolveVkOAuthClientId, resolveVkOAuthRedirectUri } from "./vk-oauth-config";

describe("vk oauth config", () => {
  it("prefers DB vkAppId over env fallback", () => {
    expect(resolveVkOAuthClientId({
      settingsVkAppId: "54643820",
      envVkAppId: "54614536"
    })).toEqual({
      activeClientId: "54643820",
      source: "db",
      settingsClientId: "54643820",
      envClientId: "54614536",
      mismatch: true
    });
  });

  it("uses env vkAppId when DB value is empty", () => {
    expect(resolveVkOAuthClientId({
      settingsVkAppId: "",
      envVkAppId: "54614536"
    })).toEqual({
      activeClientId: "54614536",
      source: "env",
      settingsClientId: "",
      envClientId: "54614536",
      mismatch: false
    });
  });

  it("derives the same deterministic callback when env override is absent", () => {
    expect(resolveVkOAuthRedirectUri("http://127.0.0.1:3200/")).toBe("http://127.0.0.1:3200/api/vk/oauth/callback");
  });

  it("keeps explicit redirect uri overrides untouched", () => {
    expect(resolveVkOAuthRedirectUri("http://127.0.0.1:3200", "https://example.test/api/vk/oauth/callback")).toBe(
      "https://example.test/api/vk/oauth/callback"
    );
  });

  it("marks derived localhost callback as not ready for VK ID", () => {
    expect(inspectVkOAuthRedirectUri("http://127.0.0.1:3200/")).toEqual({
      redirectUri: "http://127.0.0.1:3200/api/vk/oauth/callback",
      source: "derived",
      isLocal: true,
      isHttps: false,
      isReady: false
    });
  });

  it("accepts explicit public https callback", () => {
    expect(inspectVkOAuthRedirectUri("http://127.0.0.1:3200", "https://scaner.example/api/vk/oauth/callback")).toEqual({
      redirectUri: "https://scaner.example/api/vk/oauth/callback",
      source: "env",
      isLocal: false,
      isHttps: true,
      isReady: true
    });
  });

  it("cleans invalid vk app ids", () => {
    expect(cleanVkAppId("abc")).toBe("");
    expect(cleanVkAppId(" 54643820 ")).toBe("54643820");
  });
});
