import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildVkCollectorArgs,
  buildVkCollectorEnv,
  parseVkCollectorStdoutLine,
  runVkCollector,
  resolveVkCollectorAppRoot
} from "./vk-collector";

const faceMassage = "\u043c\u0430\u0441\u0441\u0430\u0436 \u043b\u0438\u0446\u0430";

describe("vk collector runner", () => {
  it("builds stable CLI args for the Python VK collector", () => {
    expect(buildVkCollectorArgs({
      loginCheck: true,
      keywords: [faceMassage],
      countries: ["RU", "KZ"],
      excludedProfileIds: ["group:1"],
      requireGeoMatch: true,
      minFollowers: 20_000,
      maxFollowers: 60_000,
      maxGroups: 50,
      maxGroupChecks: 100,
      searchCountPerKeyword: 200,
      wallPostsPerGroup: 15,
      requestDelayMinSec: 0.5,
      requestDelayMaxSec: 1.5,
      useDerivedQueries: false,
      maxSearchQueriesPerKeyword: 6,
      apiVersion: "5.199"
    })).toEqual([
      "--login-check",
      "--keyword", faceMassage,
      "--country", "RU",
      "--country", "KZ",
      "--exclude-profile-id", "group:1",
      "--require-geo-match",
      "--min-followers", "20000",
      "--max-followers", "60000",
      "--max-groups", "50",
      "--max-group-checks", "100",
      "--search-count-per-keyword", "200",
      "--wall-posts-per-group", "15",
      "--request-delay-min-sec", "0.5",
      "--request-delay-max-sec", "1.5",
      "--no-derived-queries",
      "--max-search-queries-per-keyword", "6",
      "--api-version", "5.199"
    ]);
  });

  it("parses candidate JSONL rows from stdout", () => {
    const row = parseVkCollectorStdoutLine(JSON.stringify({
      platform: "vk",
      platformProfileId: "group:123",
      username: "faceclub",
      displayName: "Face Club",
      profileUrl: "https://vk.com/faceclub",
      followers: 34_000,
      bio: "face yoga",
      contacts: { emails: [], phones: [], urls: [] },
      sourceKeyword: faceMassage,
      sourceTag: faceMassage,
      matchedBy: "vk_groups_search",
      lastPosts: [],
      metrics: { avgLikes: 0, avgComments: 0, avgViews: 0, postsChecked: 0 },
      reason: "found by VK search",
      raw: {},
      collectedAt: "2026-05-29T09:00:00.000Z"
    }));

    expect(row?.platform).toBe("vk");
    expect(row?.platformProfileId).toBe("group:123");
  });

  it("resolves the app root from the worker package directory", () => {
    expect(resolveVkCollectorAppRoot(join(process.cwd(), "apps", "worker"))).toBe(process.cwd());
  });

  it("uses the installed vk-api package and UTF-8 process settings", () => {
    const env = buildVkCollectorEnv(process.cwd(), {});
    expect("VK_API_REPO_PATH" in env ? env.VK_API_REPO_PATH : undefined).toBeUndefined();
    expect(env.PYTHONIOENCODING).toBe("utf-8");
    expect(env.PYTHONUTF8).toBe("1");
  });

  it("keeps valid candidates and records warnings when collector JSONL streams are malformed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vk-collector-"));
    const scriptPath = join(dir, "collector-fixture.mjs");
    writeFileSync(scriptPath, [
      "console.log('{bad-json');",
      "console.error('{bad-event-json');",
      `console.log(${JSON.stringify(JSON.stringify(collectorCandidate("vk", "group:1")))});`
    ].join("\n"), "utf8");

    try {
      const result = await runVkCollector(
        { timeoutMs: 5_000 },
        { pythonBin: process.execPath, scriptPath, cwd: process.cwd() }
      );

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.platformProfileId).toBe("group:1");
      expect(result.events.map((row) => row.event.code)).toEqual(expect.arrayContaining([
        "collector_stdout_parse_failed",
        "collector_stderr_parse_failed"
      ]));
      expect(result.events).toContainEqual(expect.objectContaining({
        event: expect.objectContaining({ data: expect.objectContaining({ collector: "vk" }) })
      }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function collectorCandidate(platform: "vk", profileId: string) {
  return {
    platform,
    platformProfileId: profileId,
    username: "faceclub",
    displayName: "Face Club",
    profileUrl: "https://vk.com/faceclub",
    followers: 34_000,
    bio: "face yoga",
    contacts: { emails: [], phones: [], urls: [] },
    sourceKeyword: faceMassage,
    sourceTag: faceMassage,
    matchedBy: "vk_groups_search",
    lastPosts: [],
    metrics: { avgLikes: 0, avgComments: 0, avgViews: 0, postsChecked: 0 },
    reason: "found by VK search",
    raw: {},
    collectedAt: "2026-05-29T09:00:00.000Z"
  };
}
