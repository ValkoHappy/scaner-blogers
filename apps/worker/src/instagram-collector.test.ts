import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildInstagramCollectorArgs,
  buildInstagramCollectorEnv,
  parseInstagramCollectorStdoutLine,
  runInstagramCollector,
  resolveInstagramCollectorAppRoot,
  resolveInstagramPythonBin
} from "./instagram-collector";

const faceMassage = "\u043c\u0430\u0441\u0441\u0430\u0436 \u043b\u0438\u0446\u0430";
const faceMassageTag = "\u043c\u0430\u0441\u0441\u0430\u0436\u043b\u0438\u0446\u0430";

describe("instagram collector runner", () => {
  it("builds stable CLI args for the Python collector", () => {
    expect(buildInstagramCollectorArgs({
      configPath: "collectors/instagram/config.example.json",
      keywords: [faceMassage, "face yoga"],
      hashtags: [faceMassageTag],
      countries: ["RU", "KZ"],
      excludedProfileIds: ["123", "456"],
      requireGeoMatch: true,
      minFollowers: 20_000,
      maxFollowers: 60_000,
      maxProfiles: 50,
      maxProfileChecks: 25,
      maxTagsPerKeyword: 8,
      maxMediasPerTag: 5,
      recentMediaPerProfile: 0,
      profileDelayMinSec: 0,
      profileDelayMaxSec: 1,
      mediaDelayMinSec: 0,
      mediaDelayMaxSec: 1,
      useHashtagSearch: false,
      useDerivedHashtags: false,
      includeKeywordReelsSearch: false,
      includeUserSearch: false,
      includeAccountSerpSearch: false,
      includeTypeaheadSearch: false,
      maxUserSearchResultsPerKeyword: 12
    })).toEqual([
      "--config", "collectors/instagram/config.example.json",
      "--keyword", faceMassage,
      "--keyword", "face yoga",
      "--hashtag", faceMassageTag,
      "--country", "RU",
      "--country", "KZ",
      "--exclude-profile-id", "123",
      "--exclude-profile-id", "456",
      "--require-geo-match",
      "--min-followers", "20000",
      "--max-followers", "60000",
      "--max-profiles", "50",
      "--max-profile-checks", "25",
      "--max-tags-per-keyword", "8",
      "--max-medias-per-tag", "5",
      "--recent-media-per-profile", "0",
      "--profile-delay-min-sec", "0",
      "--profile-delay-max-sec", "1",
      "--media-delay-min-sec", "0",
      "--media-delay-max-sec", "1",
      "--no-hashtag-search",
      "--no-derived-hashtags",
      "--no-keyword-reels-search",
      "--no-user-search",
      "--no-account-serp-search",
      "--no-typeahead-search",
      "--max-user-search-results", "12"
    ]);
  });

  it("passes login-check mode to the Python collector", () => {
    expect(buildInstagramCollectorArgs({
      loginCheck: true,
      configPath: "collectors/instagram/config.example.json"
    })).toEqual([
      "--config", "collectors/instagram/config.example.json",
      "--login-check"
    ]);
  });

  it("parses candidate JSONL rows from stdout", () => {
    const row = parseInstagramCollectorStdoutLine(JSON.stringify({
      platform: "instagram",
      platformProfileId: "123",
      username: "faceyoga_pro",
      displayName: "Face Yoga Pro",
      profileUrl: "https://www.instagram.com/faceyoga_pro/",
      followers: 34_000,
      bio: "face yoga",
      contacts: { emails: [], phones: [], urls: [] },
      sourceKeyword: "face yoga",
      sourceTag: "faceyoga",
      matchedBy: "hashtag_reels",
      lastPosts: [],
      metrics: { avgLikes: 0, avgComments: 0, avgViews: 0, postsChecked: 0 },
      reason: "found by #faceyoga",
      raw: {},
      collectedAt: "2026-05-28T09:00:00.000Z"
    }));

    expect(row?.username).toBe("faceyoga_pro");
  });

  it("ignores empty stdout lines", () => {
    expect(parseInstagramCollectorStdoutLine("")).toBeNull();
    expect(parseInstagramCollectorStdoutLine("   ")).toBeNull();
  });

  it("resolves the app root from the worker package directory", () => {
    expect(resolveInstagramCollectorAppRoot(join(process.cwd(), "apps", "worker"))).toBe(process.cwd());
  });

  it("prefers the local Instagram virtualenv when it exists", () => {
    const temp = mkdtempSync(join(tmpdir(), "collector-python-"));
    try {
      const dir = join(temp, ".venv-instagram", "Scripts");
      mkdirSync(dir, { recursive: true });
      const executable = join(dir, "python.exe");
      writeFileSync(executable, "");
      expect(resolveInstagramPythonBin("python", temp)).toBe(executable);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });

  it("forces UTF-8 for the Python collector process", () => {
    const env = buildInstagramCollectorEnv({ keywords: [faceMassage], maxProfiles: 1 }, process.cwd(), {});
    expect(env.PYTHONIOENCODING).toBe("utf-8");
    expect(env.PYTHONUTF8).toBe("1");
  });

  it("strips shell quotes from Instagram session file env values", () => {
    const env = buildInstagramCollectorEnv(
      { loginCheck: true },
      process.cwd(),
      { INSTAGRAM_SESSION_FILE: "\".instagram/session.json\"" }
    );
    expect(env.INSTAGRAM_SESSION_FILE).toBe(".instagram/session.json");
  });

  it("uses per-account Instagram credentials and session file from collector input", () => {
    const env = buildInstagramCollectorEnv(
      {
        loginCheck: true,
        username: "pool_user",
        password: "pool_password",
        sessionFile: ".instagram/pool-user.session.json"
      },
      process.cwd(),
      {
        INSTAGRAM_USERNAME: "env_user",
        INSTAGRAM_PASSWORD: "env_password",
        INSTAGRAM_SESSION_FILE: ".instagram/env.session.json"
      }
    );
    expect(env.INSTAGRAM_USERNAME).toBe("pool_user");
    expect(env.INSTAGRAM_PASSWORD).toBe("pool_password");
    expect(env.INSTAGRAM_SESSION_FILE).toBe(".instagram/pool-user.session.json");
  });

  it("passes a per-account Instagram sessionid without requiring a password", () => {
    const env = buildInstagramCollectorEnv(
      {
        loginCheck: true,
        username: "session_user",
        sessionId: "instagram_sessionid_placeholder",
        sessionFile: ".instagram/session-user.session.json"
      },
      process.cwd(),
      { INSTAGRAM_PASSWORD: "instagram_password_placeholder" }
    );
    expect(env.INSTAGRAM_USERNAME).toBe("session_user");
    expect(env.INSTAGRAM_SESSIONID).toBe("instagram_sessionid_placeholder");
  });

  it("passes full Instagram session settings as base64 env", () => {
    const sessionSettings = JSON.stringify({
      uuids: { phone_id: "phone-id-placeholder" },
      authorization_data: { ds_user_id: "123" }
    });
    const env = buildInstagramCollectorEnv(
      {
        loginCheck: true,
        username: "session_user",
        sessionSettings,
        sessionFile: ".instagram/session-user.session.json"
      },
      process.cwd()
    );
    expect(env.INSTAGRAM_SESSION_SETTINGS_B64).toBe(Buffer.from(sessionSettings, "utf8").toString("base64"));
  });

  it("ignores accidentally concatenated env lines in Instagram session file values", () => {
    const env = buildInstagramCollectorEnv(
      { loginCheck: true },
      process.cwd(),
      { INSTAGRAM_SESSION_FILE: "\".instagram/session.json\"\rVK_ACCESS_TOKEN=secret" }
    );
    expect(env.INSTAGRAM_SESSION_FILE).toBe(".instagram/session.json");
  });

  it("does not inherit unsafe Python encoding from the host process", () => {
    const previousIoEncoding = process.env.PYTHONIOENCODING;
    const previousPythonUtf8 = process.env.PYTHONUTF8;
    process.env.PYTHONIOENCODING = "cp1251";
    process.env.PYTHONUTF8 = "0";
    try {
      const env = buildInstagramCollectorEnv({ keywords: [faceMassage], maxProfiles: 1 }, process.cwd());
      expect(env.PYTHONIOENCODING).toBe("utf-8");
      expect(env.PYTHONUTF8).toBe("1");
    } finally {
      if (previousIoEncoding === undefined) delete process.env.PYTHONIOENCODING;
      else process.env.PYTHONIOENCODING = previousIoEncoding;
      if (previousPythonUtf8 === undefined) delete process.env.PYTHONUTF8;
      else process.env.PYTHONUTF8 = previousPythonUtf8;
    }
  });

  it("allows explicit Python encoding override for targeted debugging", () => {
    const env = buildInstagramCollectorEnv(
      { keywords: [faceMassage], maxProfiles: 1 },
      process.cwd(),
      { PYTHONIOENCODING: "utf-8:replace", PYTHONUTF8: "1" }
    );
    expect(env.PYTHONIOENCODING).toBe("utf-8:replace");
    expect(env.PYTHONUTF8).toBe("1");
  });

  it("keeps valid candidates and records warnings when collector JSONL streams are malformed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "instagram-collector-"));
    const scriptPath = join(dir, "collector-fixture.mjs");
    writeFileSync(scriptPath, [
      "console.log('not-json');",
      "console.error('{bad-event-json');",
      `console.log(${JSON.stringify(JSON.stringify(collectorCandidate("instagram", "ig-1")))});`
    ].join("\n"), "utf8");

    try {
      const result = await runInstagramCollector(
        { timeoutMs: 5_000 },
        { pythonBin: process.execPath, scriptPath, cwd: process.cwd() }
      );

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.platformProfileId).toBe("ig-1");
      expect(result.events.map((row) => row.event.code)).toEqual(expect.arrayContaining([
        "collector_stdout_parse_failed",
        "collector_stderr_parse_failed"
      ]));
      expect(result.events).toContainEqual(expect.objectContaining({
        event: expect.objectContaining({ data: expect.objectContaining({ collector: "instagram" }) })
      }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns the updated session settings written by the collector", async () => {
    const dir = mkdtempSync(join(tmpdir(), "instagram-session-"));
    const scriptPath = join(dir, "collector-fixture.mjs");
    const sessionFile = join(dir, "session.json");
    writeFileSync(scriptPath, "process.exit(0);", "utf8");
    writeFileSync(sessionFile, JSON.stringify({ uuids: { device_id: "android-test" }, authorization_data: { ds_user_id: "42" } }), "utf8");

    try {
      const result = await runInstagramCollector(
        { sessionFile, timeoutMs: 5_000 },
        { pythonBin: process.execPath, scriptPath, cwd: process.cwd() }
      );
      expect(JSON.parse(result.sessionSettings ?? "{}")).toMatchObject({
        uuids: { device_id: "android-test" },
        authorization_data: { ds_user_id: "42" }
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function collectorCandidate(platform: "instagram", profileId: string) {
  return {
    platform,
    platformProfileId: profileId,
    username: "faceyoga_pro",
    displayName: "Face Yoga Pro",
    profileUrl: "https://www.instagram.com/faceyoga_pro/",
    followers: 34_000,
    bio: "face yoga",
    contacts: { emails: [], phones: [], urls: [] },
    sourceKeyword: "face yoga",
    sourceTag: "faceyoga",
    matchedBy: "hashtag_reels",
    lastPosts: [],
    metrics: { avgLikes: 0, avgComments: 0, avgViews: 0, postsChecked: 0 },
    reason: "found by #faceyoga",
    raw: {},
    collectedAt: "2026-05-28T09:00:00.000Z"
  };
}
