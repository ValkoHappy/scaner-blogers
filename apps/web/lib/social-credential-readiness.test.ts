import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSocialCredentialReadiness } from "./social-credential-readiness";

describe("social credential readiness", () => {
  it("marks all platforms ready when stable credentials are configured", () => {
    const readiness = buildSocialCredentialReadiness({
      INSTAGRAM_USERNAME: "user",
      INSTAGRAM_PASSWORD: "test_account_password",
      VK_ACCESS_TOKEN: "generate-vk-access-token",
      YOUTUBE_API_KEY: "your_google_api_key"
    } as unknown as NodeJS.ProcessEnv);

    expect(readiness.map((item) => [item.platform, item.status, item.source])).toEqual([
      ["INSTAGRAM", "READY", "env"],
      ["VK", "READY", "VK_ACCESS_TOKEN"],
      ["YOUTUBE", "READY", "YOUTUBE_API_KEY"]
    ]);
    expect(readiness.every((item) => item.ready)).toBe(true);
  });

  it("accepts the user access token required by groups.search", () => {
    const readiness = buildSocialCredentialReadiness({
      INSTAGRAM_USERNAME: "user",
      INSTAGRAM_PASSWORD: "test_account_password",
      VK_ACCESS_TOKEN: "generate-vk-access-token",
      YOUTUBE_API_KEY: "your_google_api_key"
    } as unknown as NodeJS.ProcessEnv);

    expect(readiness.find((item) => item.platform === "VK")).toMatchObject({
      status: "READY",
      ready: true,
      source: "VK_ACCESS_TOKEN",
      missing: []
    });
  });

  it("marks VK ready when a fresh cached user token is available", () => {
    const dir = mkdtempSync(join(tmpdir(), "vk-token-readiness-"));
    const tokenFile = join(dir, "token.json");
    writeFileSync(tokenFile, JSON.stringify({
      accessToken: `vk1.a.${"abcdefghijklmnopqrstuvwxyz0123456789"}`,
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString()
    }), "utf8");

    try {
      const readiness = buildSocialCredentialReadiness({
        INSTAGRAM_USERNAME: "user",
        INSTAGRAM_PASSWORD: "test_account_password",
        VK_TOKEN_FILE: tokenFile,
        YOUTUBE_API_KEY: "your_google_api_key"
      } as unknown as NodeJS.ProcessEnv);

      expect(readiness.find((item) => item.platform === "VK")).toMatchObject({
        status: "READY",
        ready: true,
        source: "VK_TOKEN_FILE",
        missing: []
      });
      expect(JSON.stringify(readiness)).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects service tokens because groups.search requires user authorization", () => {
    const readiness = buildSocialCredentialReadiness({
      VK_SERVICE_TOKEN: "vk_service_token_placeholder",
      VK_TOKEN_FILE: join(tmpdir(), "scaner-blogers-no-vk-cache-for-service-token-test.json")
    } as unknown as NodeJS.ProcessEnv);

    expect(readiness.find((item) => item.platform === "VK")).toMatchObject({
      status: "MISSING",
      ready: false,
      source: "VK_SERVICE_TOKEN",
      missing: ["VK_ACCESS_TOKEN (user token required by groups.search)"]
    });
  });

  it("lists missing env names without exposing secret values", () => {
    const readiness = buildSocialCredentialReadiness({
      VK_TOKEN_FILE: join(tmpdir(), "scaner-blogers-missing-vk-token.json")
    } as unknown as NodeJS.ProcessEnv);

    expect(readiness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        platform: "INSTAGRAM",
        status: "MISSING",
        missing: ["INSTAGRAM_USERNAME", "INSTAGRAM_PASSWORD"]
      }),
      expect.objectContaining({
        platform: "VK",
        status: "MISSING",
        source: "none"
      }),
      expect.objectContaining({
        platform: "YOUTUBE",
        status: "MISSING",
        missing: ["YOUTUBE_API_KEY"]
      })
    ]));
    expect(JSON.stringify(readiness)).not.toContain("password");
  });
});
