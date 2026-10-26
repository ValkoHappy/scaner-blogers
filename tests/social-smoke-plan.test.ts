import { describe, expect, it } from "vitest";
import { buildSmokePreflight, planSmokeExecution, selectSmokePlatforms } from "../scripts/social-smoke-plan";

describe("social smoke plan", () => {
  it("selects all platforms by default and supports one selected platform", () => {
    expect(selectSmokePlatforms(undefined)).toEqual(["instagram", "vk", "youtube"]);
    expect(selectSmokePlatforms("VK")).toEqual(["vk"]);
    expect(selectSmokePlatforms("youtube")).toEqual(["youtube"]);
  });

  it("rejects unknown platform names without falling back to all", () => {
    expect(selectSmokePlatforms("telegram")).toEqual([]);
  });

  it("builds safe credential preflight without exposing secret values", () => {
    const preflight = buildSmokePreflight(["instagram", "vk", "youtube"], {
      INSTAGRAM_USERNAME: "collector",
      INSTAGRAM_PASSWORD: "test_password_placeholder",
      VK_ACCESS_TOKEN: "vk_access_token_placeholder",
      YOUTUBE_API_KEY: "youtube_api_key_placeholder"
    });

    expect(preflight).toEqual([
      expect.objectContaining({ platform: "instagram", status: "READY", source: "env", missing: [] }),
      expect.objectContaining({ platform: "vk", status: "READY", source: "VK_ACCESS_TOKEN", missing: [] }),
      expect.objectContaining({ platform: "youtube", status: "READY", source: "YOUTUBE_API_KEY", missing: [] })
    ]);
    expect(JSON.stringify(preflight)).not.toContain("test_password_placeholder");
    expect(JSON.stringify(preflight)).not.toContain("vk_access_token_placeholder");
    expect(JSON.stringify(preflight)).not.toContain("youtube_api_key_placeholder");
  });

  it("plans strict preflight failures only for missing credentials", () => {
    const preflight = buildSmokePreflight(["instagram", "vk", "youtube"], {
      INSTAGRAM_USERNAME: "collector",
      INSTAGRAM_PASSWORD: "test_password_placeholder",
      VK_ACCESS_TOKEN: "vk_access_token_placeholder"
    });

    expect(planSmokeExecution(["instagram", "vk", "youtube"], preflight, true)).toEqual([
      expect.objectContaining({ platform: "instagram", action: "run" }),
      expect.objectContaining({ platform: "vk", action: "run" }),
      expect.objectContaining({
        platform: "youtube",
        action: "fail",
        message: "missing credentials: YOUTUBE_API_KEY"
      })
    ]);
    expect(planSmokeExecution(["instagram", "vk", "youtube"], preflight, false).every((item) => item.action === "run")).toBe(true);
  });
});
