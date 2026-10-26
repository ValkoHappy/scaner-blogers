import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildYouTubeCollectorArgs,
  buildYouTubeCollectorEnv,
  parseYouTubeCollectorStdoutLine,
  runYouTubeCollector,
  resolveYouTubeCollectorAppRoot
} from "./youtube-collector";

const faceMassage = "\u043c\u0430\u0441\u0441\u0430\u0436 \u043b\u0438\u0446\u0430";

describe("youtube collector runner", () => {
  it("builds stable CLI args for the Python YouTube collector", () => {
    expect(buildYouTubeCollectorArgs({
      loginCheck: true,
      keywords: [faceMassage],
      countries: ["RU", "KZ"],
      excludedProfileIds: ["channel:UC1"],
      requireGeoMatch: true,
      minFollowers: 20_000,
      maxFollowers: 60_000,
      maxChannels: 50,
      maxChannelChecks: 100,
      searchResultsPerQuery: 25,
      recentVideosPerChannel: 10,
      requestDelayMinSec: 0.2,
      requestDelayMaxSec: 0.8,
      useDerivedQueries: false,
      includeChannelSearch: false,
      includeShortsSearch: false,
      includeVideoSearch: true,
      useWebFallback: true,
      maxSearchQueriesPerKeyword: 6,
      relevanceLanguage: "ru"
    })).toEqual([
      "--login-check",
      "--keyword", faceMassage,
      "--country", "RU",
      "--country", "KZ",
      "--exclude-profile-id", "channel:UC1",
      "--require-geo-match",
      "--min-followers", "20000",
      "--max-followers", "60000",
      "--max-channels", "50",
      "--max-channel-checks", "100",
      "--search-results-per-query", "25",
      "--recent-videos-per-channel", "10",
      "--request-delay-min-sec", "0.2",
      "--request-delay-max-sec", "0.8",
      "--no-derived-queries",
      "--no-channel-search",
      "--no-shorts-search",
      "--use-web-fallback",
      "--max-search-queries-per-keyword", "6",
      "--relevance-language", "ru"
    ]);
  });

  it("parses candidate JSONL rows from stdout", () => {
    const row = parseYouTubeCollectorStdoutLine(JSON.stringify({
      platform: "youtube",
      platformProfileId: "channel:UC1",
      username: "@facestudio",
      displayName: "Face Studio",
      profileUrl: "https://www.youtube.com/channel/UC1",
      followers: 34_000,
      bio: "face yoga",
      contacts: { emails: [], phones: [], urls: [] },
      sourceKeyword: faceMassage,
      sourceTag: faceMassage,
      matchedBy: "youtube_channel_search",
      lastPosts: [],
      metrics: { avgLikes: 0, avgComments: 0, avgViews: 0, postsChecked: 0 },
      reason: "found by YouTube search",
      raw: {},
      collectedAt: "2026-05-29T09:00:00.000Z"
    }));

    expect(row?.platform).toBe("youtube");
    expect(row?.platformProfileId).toBe("channel:UC1");
  });

  it("resolves the app root from the worker package directory", () => {
    expect(resolveYouTubeCollectorAppRoot(join(process.cwd(), "apps", "worker"))).toBe(process.cwd());
  });

  it("wires UTF-8 process settings without leaking API keys", () => {
    const env = buildYouTubeCollectorEnv({ YOUTUBE_API_KEY: "secret" } as NodeJS.ProcessEnv);
    expect(env["YOUTUBE_API_KEY"]).toBe("secret");
    expect(env.PYTHONIOENCODING).toBe("utf-8");
    expect(env.PYTHONUTF8).toBe("1");
  });

  it("keeps valid candidates and records warnings when collector JSONL streams are malformed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "youtube-collector-"));
    const scriptPath = join(dir, "collector-fixture.mjs");
    writeFileSync(scriptPath, [
      "console.log('{bad-json');",
      "console.error('{bad-event-json');",
      `console.log(${JSON.stringify(JSON.stringify(collectorCandidate("youtube", "channel:UC1")))});`
    ].join("\n"), "utf8");

    try {
      const result = await runYouTubeCollector(
        { timeoutMs: 5_000 },
        { pythonBin: process.execPath, scriptPath, cwd: process.cwd() }
      );

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.platformProfileId).toBe("channel:UC1");
      expect(result.events.map((row) => row.event.code)).toEqual(expect.arrayContaining([
        "collector_stdout_parse_failed",
        "collector_stderr_parse_failed"
      ]));
      expect(result.events).toContainEqual(expect.objectContaining({
        event: expect.objectContaining({ data: expect.objectContaining({ collector: "youtube" }) })
      }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function collectorCandidate(platform: "youtube", profileId: string) {
  return {
    platform,
    platformProfileId: profileId,
    username: "@facestudio",
    displayName: "Face Studio",
    profileUrl: "https://www.youtube.com/channel/UC1",
    followers: 34_000,
    bio: "face yoga",
    contacts: { emails: [], phones: [], urls: [] },
    sourceKeyword: faceMassage,
    sourceTag: faceMassage,
    matchedBy: "youtube_channel_search",
    lastPosts: [],
    metrics: { avgLikes: 0, avgComments: 0, avgViews: 0, postsChecked: 0 },
    reason: "found by YouTube search",
    raw: {},
    collectedAt: "2026-05-29T09:00:00.000Z"
  };
}
