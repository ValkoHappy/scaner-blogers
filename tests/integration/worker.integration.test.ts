import { beforeEach, describe, expect, it } from "vitest";
import type { ParsedSearchCreative, SocialCandidateRow, SocialPlatform } from "@scaner-blogers/core";
import { prisma, queueAdvertiserScan, queueCollectionJob, saveSocialCandidateProfile, upsertAdvertiser, upsertSearchKeyword, upsertSocialPlatformAccountStatus } from "@scaner-blogers/db";
import { runAdvertiserScan } from "../../apps/worker/src/scanner";
import { processNextSocialCollectionJob } from "../../apps/worker/src/social-collection-worker";
import { demoNormalizedCreative } from "../../scripts/seed-demo-data";
import { clearTestDatabase } from "./test-db";

function fakeClient(mode: "success" | "failed" | "blocked", calls: Array<{ geoId?: number }> = []) {
  const listCreative: ParsedSearchCreative = {
    advertiserId: "AR14577439029227159553",
    creativeId: "CR06346342443637538817",
    previewUrl: "https://displayads-formats.googleusercontent.com/ads/preview/content.js?creativeId=1",
    format: "VIDEO",
    firstShownAt: new Date("2025-03-07T00:00:00.000Z"),
    lastShownAt: new Date("2026-05-22T00:00:00.000Z"),
    raw: { fixture: "list" }
  };

  return {
    async searchCreatives(input: { geoId?: number }) {
      calls.push({ geoId: input.geoId });
      if (mode === "failed") throw new Error("network failed");
      if (mode === "blocked") throw new Error("blocked:SearchCreatives:429");
      return { creatives: [listCreative], raw: {}, nextPageToken: undefined };
    },
    async collectCreative() {
      return demoNormalizedCreative();
    }
  };
}

describe("worker lifecycle integration", () => {
  beforeEach(async () => {
    await clearTestDatabase();
    for (let index = 1; index <= 4; index += 1) {
      await upsertSocialPlatformAccountStatus({
        platform: "instagram",
        username: `integration-instagram-${index}`,
        label: `Integration Instagram ${index}`,
        status: "OK",
        metadata: {
          username: `integration-instagram-${index}`,
          sessionId: "test-session-id"
        }
      });
    }
  });

  it("marks job success and updates counters", async () => {
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553", selectedCountries: ["GB"] });
    const job = await queueAdvertiserScan(advertiser.id, ["GB"]);

    await runAdvertiserScan({
      scanJobId: job.id,
      advertiserDbId: advertiser.id,
      googleAdvertiserId: advertiser.googleAdvertiserId,
      countryCodes: ["GB"],
      dateRange: { start: "20260516", end: "20260523" },
      requestDelayMs: 0
    }, fakeClient("success") as never);

    const updatedJob = await prisma.scanJob.findUniqueOrThrow({ where: { id: job.id } });
    const updatedAdvertiser = await prisma.advertiser.findUniqueOrThrow({ where: { id: advertiser.id } });
    expect(updatedJob.status).toBe("SUCCESS");
    expect(updatedJob.pagesFetched).toBe(1);
    expect(updatedJob.detailsFetched).toBe(1);
    expect(updatedJob.previewsFetched).toBe(1);
    expect(updatedAdvertiser.totalCreatives).toBe(1);
    expect(updatedAdvertiser.activeCreatives).toBe(1);
  });

  it("scans the advertiser without a geo filter when countries are not selected", async () => {
    const calls: Array<{ geoId?: number }> = [];
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553", selectedCountries: [] });
    const job = await queueAdvertiserScan(advertiser.id, []);

    await runAdvertiserScan({
      scanJobId: job.id,
      advertiserDbId: advertiser.id,
      googleAdvertiserId: advertiser.googleAdvertiserId,
      countryCodes: [],
      dateRange: { start: "20250524", end: "20260524" },
      requestDelayMs: 0
    }, fakeClient("success", calls) as never);

    expect(calls).toEqual([{ geoId: undefined }]);
    const updatedJob = await prisma.scanJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe("SUCCESS");
    expect(updatedJob.countries).toEqual([]);
  });

  it("marks ordinary failures as FAILED and records an event", async () => {
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553", selectedCountries: ["GB"] });
    const job = await queueAdvertiserScan(advertiser.id, ["GB"]);

    await expect(runAdvertiserScan({
      scanJobId: job.id,
      advertiserDbId: advertiser.id,
      googleAdvertiserId: advertiser.googleAdvertiserId,
      countryCodes: ["GB"],
      dateRange: { start: "20260516", end: "20260523" },
      requestDelayMs: 0
    }, fakeClient("failed") as never)).rejects.toThrow("network failed");

    const updatedJob = await prisma.scanJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe("FAILED");
    expect(await prisma.scanEvent.count({ where: { scanJobId: job.id, level: "error" } })).toBe(1);
  });

  it("redacts secrets in advertiser scan failure state fields", async () => {
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553", selectedCountries: ["GB"] });
    const job = await queueAdvertiserScan(advertiser.id, ["GB"]);
    const vkToken = "vk1.a." + "q".repeat(85);
    const dirtyMessage = `network failed access_token=${vkToken} proxy socks5://user:pass@1.2.3.4:9000`;

    await expect(runAdvertiserScan({
      scanJobId: job.id,
      advertiserDbId: advertiser.id,
      googleAdvertiserId: advertiser.googleAdvertiserId,
      countryCodes: ["GB"],
      dateRange: { start: "20260516", end: "20260523" },
      requestDelayMs: 0
    }, {
      async searchCreatives() {
        throw new Error(dirtyMessage);
      },
      async collectCreative() {
        return demoNormalizedCreative();
      }
    } as never)).rejects.toThrow("network failed");

    const updatedJob = await prisma.scanJob.findUniqueOrThrow({ where: { id: job.id } });
    const scan = await prisma.scan.findFirstOrThrow({ where: { scanJobId: job.id } });
    const failureEvent = await prisma.scanEvent.findFirstOrThrow({ where: { scanJobId: job.id, level: "error" } });

    for (const value of [updatedJob.errorMessage, scan.errorMessage, failureEvent.message, JSON.stringify(failureEvent.data)]) {
      expect(value).toContain("access_token=***");
      expect(value).toContain("socks5://[redacted]@1.2.3.4:9000");
      expect(value).not.toContain(vkToken);
      expect(value).not.toContain("user:pass");
    }
  });

  it("marks blocked failures as BLOCKED", async () => {
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553", selectedCountries: ["GB"] });
    const job = await queueAdvertiserScan(advertiser.id, ["GB"]);

    await expect(runAdvertiserScan({
      scanJobId: job.id,
      advertiserDbId: advertiser.id,
      googleAdvertiserId: advertiser.googleAdvertiserId,
      countryCodes: ["GB"],
      dateRange: { start: "20260516", end: "20260523" },
      requestDelayMs: 0
    }, fakeClient("blocked") as never)).rejects.toThrow("blocked:");

    const updatedJob = await prisma.scanJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe("BLOCKED");
    expect(updatedJob.blockedReason).toBe("blocked:SearchCreatives:429");
  });

  it("processes a YouTube collection job, saves candidates and passes known channels as exclusions", async () => {
    const collectedAt = "2026-05-29T12:00:00.000Z";
    await saveSocialCandidateProfile({
      platform: "youtube",
      platformProfileId: "channel:UC_EXISTING",
      username: "@existing",
      displayName: "Existing Channel",
      profileUrl: "https://www.youtube.com/channel/UC_EXISTING",
      followers: 25_000,
      bio: "existing",
      contacts: { emails: [], phones: [], urls: [] },
      sourceKeyword: "массаж лица",
      sourceTag: "массаж лица",
      matchedBy: "youtube_channel_search",
      lastPosts: [],
      metrics: { avgLikes: 0, avgComments: 0, avgViews: 0, postsChecked: 0 },
      reason: "existing",
      raw: { fixture: "existing" },
      collectedAt
    });

    const keyword = await upsertSearchKeyword({
      value: "массаж лица",
      platforms: ["youtube"],
      countries: ["RU", "KZ"],
      minFollowers: 20_000,
      maxFollowers: 60_000
    });
    const job = await queueCollectionJob({
      keywordId: keyword.id,
      platform: "youtube",
      minFollowers: 20_000,
      maxFollowers: 60_000,
      countries: ["RU", "KZ"],
      maxProfiles: 100,
      config: {
        includeChannelSearch: true,
        includeShortsSearch: true,
        includeVideoSearch: true,
        maxChannelChecks: 100,
        searchResultsPerQuery: 10,
        recentVideosPerChannel: 3
      }
    });

    const youtubeInputs: unknown[] = [];
    const processed = await processNextSocialCollectionJob(
      prisma,
      async () => ({ candidates: [], events: [], exitCode: 0 }),
      async () => ({ candidates: [], events: [], exitCode: 0 }),
      async (input) => {
        youtubeInputs.push(input);
        return {
          exitCode: 0,
          events: [{
            event: {
              level: "info",
              code: "youtube_search_finished",
              message: "YouTube search.list finished",
              data: { query: "массаж лица", type: "video", regionCode: "RU", videoDuration: "short", itemsFound: 4 }
            },
            collectedAt
          }, {
            event: {
              level: "info",
              code: "youtube_collector_finished",
              message: "YouTube collector finished",
              data: { emitted: 1, profileChecks: 7, uniqueChannelsSeen: 8 }
            },
            collectedAt
          }],
          candidates: [{
            platform: "youtube",
            platformProfileId: "channel:UC_NEW",
            username: "@newface",
            displayName: "New Face Coach",
            profileUrl: "https://www.youtube.com/channel/UC_NEW",
            followers: 34_000,
            bio: "фейсфитнес и массаж лица",
            contacts: { emails: ["hello@example.com"], phones: [], urls: ["https://example.com"] },
            sourceKeyword: "массаж лица",
            sourceTag: "массаж лица",
            matchedBy: "youtube_shorts_search",
            lastPosts: [{
              id: "short1",
              code: "short1",
              url: "https://www.youtube.com/watch?v=short1",
              takenAt: collectedAt,
              caption: "short",
              likeCount: 10,
              commentCount: 2,
              viewCount: 1000,
              productType: "youtube_video"
            }],
            metrics: { avgLikes: 10, avgComments: 2, avgViews: 1000, postsChecked: 1 },
            geoGuess: "RU",
            reason: "найдено в YouTube через поиск Shorts",
            raw: { fixture: "youtube" },
            collectedAt
          }]
        };
      }
    );

    expect(processed).toBe(true);
    expect(youtubeInputs).toHaveLength(1);
    expect(youtubeInputs[0]).toMatchObject({
      keywords: ["массаж лица"],
      excludedProfileIds: ["channel:UC_EXISTING"],
      includeChannelSearch: true,
      includeShortsSearch: true,
      includeVideoSearch: true,
      maxChannelChecks: 100
    });

    const updatedJob = await prisma.collectionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe("SUCCESS");
    expect(updatedJob.candidatesFound).toBe(1);
    expect(updatedJob.profilesChecked).toBe(7);

    const profile = await prisma.candidateProfile.findUniqueOrThrow({
      where: { platform_platformProfileId: { platform: "YOUTUBE", platformProfileId: "channel:UC_NEW" } },
      include: { candidate: true, rawSnapshots: true }
    });
    expect(profile.keywordId).toBe(keyword.id);
    expect(profile.platform).toBe("YOUTUBE");
    expect(profile.matchedBy).toBe("youtube_shorts_search");
    expect(profile.candidate.status).toBe("NEW");
    expect(profile.qualityScore).toBeGreaterThan(0);
    expect(profile.qualitySignals).toEqual(expect.arrayContaining(["has_contacts", "has_activity"]));
    expect(profile.rawSnapshots).toHaveLength(1);
    expect(await prisma.socialPlatformAccount.findUnique({ where: { accountKey: "YOUTUBE:api-key" } })).toMatchObject({
      status: "OK"
    });

    const searchHistory = await prisma.collectionSearchHistory.findUniqueOrThrow({
      where: {
        platform_query_queryType_regionCode: {
          platform: "YOUTUBE",
          query: "массаж лица",
          queryType: "video:short",
          regionCode: "RU"
        }
      }
    });
    expect(searchHistory.searches).toBe(1);
    expect(searchHistory.lastItemsFound).toBe(4);

    const events = await prisma.collectionEvent.findMany({
      where: { collectionJobId: job.id },
      orderBy: { createdAt: "asc" }
    });
    expect(events.map((event) => event.message)).toEqual(expect.arrayContaining([
      "social_collector_started",
      "social_collector_result_received",
      "YouTube search.list finished",
      "YouTube collector finished",
      "social_candidates_saved",
      "social_collection_completed"
    ]));
    expect(events.find((event) => event.message === "social_collector_started")?.data).toMatchObject({
      code: "social_collector_started",
      platform: "YOUTUBE",
      collector: "youtube",
      input: {
        keywords: ["массаж лица"],
        excludedProfileIds: 1,
        includeShortsSearch: true,
        includeVideoSearch: true
      }
    });
    expect(events.find((event) => event.message === "social_candidates_saved")?.data).toMatchObject({
      code: "social_candidates_saved",
      candidatesReceived: 1,
      duplicateRowsInCollectorOutput: 0,
      savedProfiles: 1,
      affectedCandidates: 1,
      profilesChecked: 7
    });
  });

  it("marks YouTube quota errors as BLOCKED instead of ordinary failures", async () => {
    const keyword = await upsertSearchKeyword({ value: "фейсфитнес", platforms: ["youtube"] });
    const job = await queueCollectionJob({
      keywordId: keyword.id,
      platform: "youtube",
      config: { maxChannelChecks: 10 }
    });

    await processNextSocialCollectionJob(
      prisma,
      async () => ({ candidates: [], events: [], exitCode: 0 }),
      async () => ({ candidates: [], events: [], exitCode: 0 }),
      async () => {
        throw new Error("youtube-collector:youtube_quota_exceeded:quotaExceeded");
      }
    );

    const updatedJob = await prisma.collectionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe("BLOCKED");
    expect(updatedJob.blockedReason).toContain("youtube_quota_exceeded");
    const account = await prisma.socialPlatformAccount.findUniqueOrThrow({ where: { accountKey: "YOUTUBE:api-key" } });
    expect(account.status).toBe("BLOCKED");
    expect(account.blockedUntil).toBeTruthy();
  });

  it("redacts secrets before persisting social search history errors", async () => {
    const keyword = await upsertSearchKeyword({ value: "face yoga", platforms: ["youtube"] });
    const job = await queueCollectionJob({
      keywordId: keyword.id,
      platform: "youtube",
      config: { includeVideoSearch: true, searchResultsPerQuery: 5 }
    });
    const vkToken = `vk1.a.${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
    const dirtyMessage = `YouTube search failed Authorization: Bearer ${vkToken} via http://user:pass@1.2.3.4:8080`;

    await processNextSocialCollectionJob(
      prisma,
      async () => ({ candidates: [], events: [], exitCode: 0 }),
      async () => ({ candidates: [], events: [], exitCode: 0 }),
      async () => ({
        candidates: [],
        exitCode: 0,
        events: [{
          event: {
            level: "error",
            code: "youtube_search_finished",
            message: dirtyMessage,
            data: { query: "face yoga", type: "video", regionCode: "RU", videoDuration: "short", itemsFound: 0 }
          },
          collectedAt: "2026-05-29T13:00:00.000Z"
        }, {
          event: {
            level: "info",
            code: "youtube_collector_finished",
            message: "YouTube collector finished",
            data: { emitted: 0, profileChecks: 0 }
          },
          collectedAt: "2026-05-29T13:00:01.000Z"
        }]
      })
    );

    const updatedJob = await prisma.collectionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe("SUCCESS");
    const searchHistory = await prisma.collectionSearchHistory.findUniqueOrThrow({
      where: {
        platform_query_queryType_regionCode: {
          platform: "YOUTUBE",
          query: "face yoga",
          queryType: "video:short",
          regionCode: "RU"
        }
      }
    });
    expect(searchHistory.lastError).toContain("Authorization: ***");
    expect(searchHistory.lastError).toContain("http://[redacted]@1.2.3.4:8080");
    expect(searchHistory.lastError).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(searchHistory.lastError).not.toContain("user:pass");
  });

  it("marks VK IP-bound token errors as BLOCKED instead of ordinary failures", async () => {
    const keyword = await upsertSearchKeyword({ value: "С„РµР№СЃС„РёС‚РЅРµСЃ", platforms: ["vk"] });
    const job = await queueCollectionJob({
      keywordId: keyword.id,
      platform: "vk",
      config: { maxGroupChecks: 10 }
    });

    await processNextSocialCollectionJob(
      prisma,
      async () => ({ candidates: [], events: [], exitCode: 0 }),
      async () => {
        const vkToken = `vk1.a.${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
        throw new Error(`vk-collector:vk_api_request_failed:[5] User authorization failed: access_token=${vkToken} was given to another ip address via socks5://user:pass@1.2.3.4:9000`);
      },
      async () => ({ candidates: [], events: [], exitCode: 0 })
    );

    const updatedJob = await prisma.collectionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe("BLOCKED");
    expect(updatedJob.blockedReason).toContain("another ip address");
    expect(updatedJob.errorMessage).toContain("access_token=***");
    expect(updatedJob.errorMessage).toContain("socks5://[redacted]@1.2.3.4:9000");
    expect(updatedJob.errorMessage).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(updatedJob.errorMessage).not.toContain("user:pass");
    const failureEvent = await prisma.collectionEvent.findFirstOrThrow({
      where: { collectionJobId: job.id, level: "error" }
    });
    expect(failureEvent.message).toContain("access_token=***");
    expect(failureEvent.message).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(failureEvent.data).toMatchObject({
      code: "social_collector_blocked",
      platform: "VK",
      status: "BLOCKED",
      blocked: true,
      canceled: false,
      reasonCode: "SOCIAL_COLLECTOR_BLOCKED",
      errorClass: "social_collector_blocked"
    });
    expect((failureEvent.data as { durationMs?: unknown }).durationMs).toEqual(expect.any(Number));
    const account = await prisma.socialPlatformAccount.findUniqueOrThrow({ where: { accountKey: "VK:api-token" } });
    expect(account.status).toBe("BLOCKED");
    expect(account.blockedUntil).toBeTruthy();
    expect(account.lastError).toContain("access_token=***");
    expect(account.lastError).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("persists collector stream parse warnings without dropping valid candidates", async () => {
    const keyword = await upsertSearchKeyword({
      value: "parser warnings",
      platforms: ["instagram"],
      hashtags: ["parserwarnings"],
      minFollowers: 1_000,
      maxFollowers: 100_000
    });
    const job = await queueCollectionJob({
      keywordId: keyword.id,
      platform: "instagram",
      minFollowers: 1_000,
      maxFollowers: 100_000,
      hashtags: ["parserwarnings"],
      maxProfiles: 10
    });

    await processNextSocialCollectionJob(
      prisma,
      async () => ({
        exitCode: 0,
        events: [{
          event: {
            level: "warn",
            code: "collector_stdout_parse_failed",
            message: "instagram collector emitted invalid candidate JSONL row",
            data: { collector: "instagram", lineLength: 9, error: "Unexpected token" }
          },
          collectedAt: "2026-05-29T15:00:00.000Z"
        }, {
          event: {
            level: "warn",
            code: "collector_stderr_parse_failed",
            message: "instagram collector emitted invalid event JSONL row",
            data: { collector: "instagram", lineLength: 15, error: "Unexpected end of JSON input" }
          },
          collectedAt: "2026-05-29T15:00:01.000Z"
        }, {
          event: {
            level: "info",
            code: "instagram_collector_finished",
            message: "Instagram collector finished",
            data: { emitted: 1, profileChecks: 3 }
          },
          collectedAt: "2026-05-29T15:00:02.000Z"
        }],
        candidates: [socialCandidate("instagram", "parser-warning-profile", "parser_warning", 22_000, "parser-warning")]
      }),
      async () => ({ candidates: [], events: [], exitCode: 0 }),
      async () => ({ candidates: [], events: [], exitCode: 0 })
    );

    const updatedJob = await prisma.collectionJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { runs: true }
    });
    expect(updatedJob.status).toBe("SUCCESS");
    expect(updatedJob.candidatesFound).toBe(1);
    expect(updatedJob.profilesChecked).toBe(3);
    expect(updatedJob.runs[0]?.status).toBe("SUCCESS");

    const warningEvents = (await prisma.collectionEvent.findMany({
      where: {
        collectionJobId: job.id,
        level: "warn"
      },
      orderBy: { createdAt: "asc" }
    })).filter((event) =>
      [
        "collector_stdout_parse_failed",
        "collector_stderr_parse_failed"
      ].includes(eventCode(event.data))
    );
    expect(warningEvents).toHaveLength(2);
    expect(warningEvents.map((event) => event.message)).toEqual([
      "instagram collector emitted invalid candidate JSONL row",
      "instagram collector emitted invalid event JSONL row"
    ]);
    expect(warningEvents.every((event) => event.collectionRunId === updatedJob.runs[0]?.id)).toBe(true);
    expect(await prisma.candidateProfile.count({
      where: { platform: "INSTAGRAM", platformProfileId: "parser-warning-profile" }
    })).toBe(1);
  });

  it("deduplicates active social collection jobs with identical config", async () => {
    const keyword = await upsertSearchKeyword({
      value: "массаж лица",
      platforms: ["instagram"],
      hashtags: ["массажлица"]
    });
    const input = {
      keywordId: keyword.id,
      platform: "instagram" as const,
      minFollowers: 20_000,
      maxFollowers: 60_000,
      countries: ["RU", "KZ"],
      hashtags: ["массажлица"],
      maxProfiles: 100,
      config: {
        mode: "deep",
        includeHashtagReels: true,
        includeAccountSearch: true,
        limits: { reelsPerHashtag: 100, accountsPerKeyword: 100 }
      }
    };

    const first = await queueCollectionJob(input);
    const second = await queueCollectionJob({
      ...input,
      config: {
        includeAccountSearch: true,
        includeHashtagReels: true,
        limits: { accountsPerKeyword: 100, reelsPerHashtag: 100 },
        mode: "deep"
      }
    });

    expect(second.id).toBe(first.id);
    expect(await prisma.collectionJob.count()).toBe(1);
  });

  it("saves one candidate/profile when the same social profile is stored concurrently", async () => {
    const row = socialCandidate("instagram", "race-profile", "race_handle", 34_000, "race");

    await Promise.all(Array.from({ length: 8 }, () => saveSocialCandidateProfile(row)));

    expect(await prisma.candidateProfile.count({
      where: { platform: "INSTAGRAM", platformProfileId: "race-profile" }
    })).toBe(1);
    expect(await prisma.candidate.count()).toBe(1);
  });

  it("links profiles from different platforms to one candidate when contacts match", async () => {
    const instagram = {
      ...socialCandidate("instagram", "ig-same-expert", "same_expert", 32_000, "same-expert"),
      contacts: { emails: ["same@example.test"], phones: ["+7 999 111-22-33"], urls: ["https://same.example.test"] },
      sourceKeyword: "массаж лица",
      geoGuess: "RU"
    };
    const youtube = {
      ...socialCandidate("youtube", "channel:same-expert", "@sameexpert", 42_000, "same-expert"),
      contacts: { emails: ["SAME@example.test", "youtube@example.test"], phones: [], urls: ["https://youtube.example.test"] },
      sourceKeyword: "face yoga",
      geoGuess: "KZ"
    };

    const first = await saveSocialCandidateProfile(instagram);
    const second = await saveSocialCandidateProfile(youtube);
    const candidate = await prisma.candidate.findUniqueOrThrow({ where: { id: first.candidateId } });

    expect(second.candidateId).toBe(first.candidateId);
    expect(await prisma.candidate.count()).toBe(1);
    expect(await prisma.candidateProfile.count()).toBe(2);
    expect(candidate.topics).toEqual(expect.arrayContaining(["массаж лица", "face yoga"]));
    expect(candidate.countries).toEqual(expect.arrayContaining(["RU", "KZ"]));
    expect(candidate.contacts).toMatchObject({
      emails: expect.arrayContaining(["same@example.test", "youtube@example.test"]),
      phones: ["+7 999 111-22-33"],
      urls: expect.arrayContaining(["https://same.example.test", "https://youtube.example.test"])
    });
  });

  it("does not claim a queued social job when the same platform is already running", async () => {
    const keyword = await upsertSearchKeyword({
      value: "lane guard",
      platforms: ["instagram", "vk"],
      minFollowers: 1_000,
      maxFollowers: 100_000
    });
    const runningInstagramJob = await queueCollectionJob({
      keywordId: keyword.id,
      platform: "instagram",
      minFollowers: 1_000,
      maxFollowers: 100_000,
      config: { batch: "already-running" }
    });
    await queueCollectionJob({
      keywordId: keyword.id,
      platform: "instagram",
      minFollowers: 1_000,
      maxFollowers: 100_000,
      config: { batch: "queued-same-platform" }
    });
    const vkJob = await queueCollectionJob({
      keywordId: keyword.id,
      platform: "vk",
      minFollowers: 1_000,
      maxFollowers: 100_000,
      config: { batch: "queued-other-platform" }
    });
    await prisma.collectionJob.update({
      where: { id: runningInstagramJob.id },
      data: { status: "RUNNING", startedAt: new Date() }
    });

    await processNextSocialCollectionJob(
      prisma,
      async () => {
        throw new Error("instagram should not be claimed while platform lane is busy");
      },
      async () => ({
        candidates: [socialCandidate("vk", "lane-vk", "lane_vk", 20_000, "lane")],
        events: [],
        exitCode: 0
      }),
      async () => ({ candidates: [], events: [], exitCode: 0 })
    );

    const updatedVkJob = await prisma.collectionJob.findUniqueOrThrow({ where: { id: vkJob.id } });
    expect(updatedVkJob.status).toBe("SUCCESS");
    expect(await prisma.collectionJob.count({
      where: { platform: "INSTAGRAM", status: "QUEUED" }
    })).toBe(1);
  });

  it("can process another queued YouTube job when its platform lane limit allows it", async () => {
    const previous = process.env.SOCIAL_PLATFORM_CONCURRENCY_YOUTUBE;
    process.env.SOCIAL_PLATFORM_CONCURRENCY_YOUTUBE = "2";
    const keyword = await upsertSearchKeyword({
      value: "youtube lane limit",
      platforms: ["youtube"],
      minFollowers: 1_000,
      maxFollowers: 100_000
    });
    const runningYoutubeJob = await queueCollectionJob({
      keywordId: keyword.id,
      platform: "youtube",
      minFollowers: 1_000,
      maxFollowers: 100_000,
      config: { batch: "already-running" }
    });
    const queuedYoutubeJob = await queueCollectionJob({
      keywordId: keyword.id,
      platform: "youtube",
      minFollowers: 1_000,
      maxFollowers: 100_000,
      config: { batch: "queued-second-lane" }
    });
    await prisma.collectionJob.update({
      where: { id: runningYoutubeJob.id },
      data: { status: "RUNNING", startedAt: new Date() }
    });

    try {
      await processNextSocialCollectionJob(
        prisma,
        async () => ({ candidates: [], events: [], exitCode: 0 }),
        async () => ({ candidates: [], events: [], exitCode: 0 }),
        async () => ({
          candidates: [socialCandidate("youtube", "lane-youtube-2", "lane_youtube_2", 21_000, "lane-2")],
          events: [],
          exitCode: 0
        })
      );
    } finally {
      if (previous === undefined) delete process.env.SOCIAL_PLATFORM_CONCURRENCY_YOUTUBE;
      else process.env.SOCIAL_PLATFORM_CONCURRENCY_YOUTUBE = previous;
    }

    const updated = await prisma.collectionJob.findUniqueOrThrow({ where: { id: queuedYoutubeJob.id } });
    expect(updated.status).toBe("SUCCESS");
  });

  it("defers queued social jobs while the platform account is blocked", async () => {
    const blockedUntil = new Date(Date.now() + 60 * 60 * 1000);
    const keyword = await upsertSearchKeyword({
      value: "cooldown platform",
      platforms: ["vk", "youtube"],
      minFollowers: 1_000,
      maxFollowers: 100_000
    });
    const youtubeJob = await queueCollectionJob({
      keywordId: keyword.id,
      platform: "youtube",
      minFollowers: 1_000,
      maxFollowers: 100_000,
      config: { batch: "cooldown-youtube" }
    });
    const vkJob = await queueCollectionJob({
      keywordId: keyword.id,
      platform: "vk",
      minFollowers: 1_000,
      maxFollowers: 100_000,
      config: { batch: "cooldown-vk" }
    });
    await upsertSocialPlatformAccountStatus({
      platform: "youtube",
      username: "api-key",
      status: "BLOCKED",
      blockedUntil,
      lastError: "quotaExceeded"
    });

    await processNextSocialCollectionJob(
      prisma,
      async () => ({ candidates: [], events: [], exitCode: 0 }),
      async () => ({
        candidates: [socialCandidate("vk", "cooldown-vk", "cooldown_vk", 21_000, "cooldown")],
        events: [],
        exitCode: 0
      }),
      async () => {
        throw new Error("YouTube should not run while the API key is blocked");
      }
    );

    const updatedYoutubeJob = await prisma.collectionJob.findUniqueOrThrow({ where: { id: youtubeJob.id } });
    const updatedVkJob = await prisma.collectionJob.findUniqueOrThrow({ where: { id: vkJob.id } });
    expect(updatedYoutubeJob.status).toBe("QUEUED");
    expect(updatedYoutubeJob.scheduledFor?.getTime()).toBe(blockedUntil.getTime());
    expect(updatedVkJob.status).toBe("SUCCESS");
  });

  it("cancels a running social collector cooperatively", async () => {
    const previousCancelPollMs = process.env.SOCIAL_CANCEL_POLL_MS;
    process.env.SOCIAL_CANCEL_POLL_MS = "10";
    const keyword = await upsertSearchKeyword({
      value: "cancel me",
      platforms: ["instagram"],
      hashtags: ["cancelme"],
      minFollowers: 1_000,
      maxFollowers: 100_000
    });
    const job = await queueCollectionJob({
      keywordId: keyword.id,
      platform: "instagram",
      minFollowers: 1_000,
      maxFollowers: 100_000,
      hashtags: ["cancelme"],
      config: { batch: "cancel" }
    });

    try {
      await processNextSocialCollectionJob(
        prisma,
        async (_input, options?: { abortSignal?: AbortSignal }) => {
          if (!options?.abortSignal) throw new Error("missing abort signal");
          const signal = options.abortSignal;
          await prisma.collectionJob.update({
            where: { id: job.id },
            data: { cancelRequested: true }
          });
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("collector aborted")), { once: true });
          });
          return { candidates: [], events: [], exitCode: 0 };
        },
        async () => ({ candidates: [], events: [], exitCode: 0 }),
        async () => ({ candidates: [], events: [], exitCode: 0 })
      );
    } finally {
      if (previousCancelPollMs === undefined) delete process.env.SOCIAL_CANCEL_POLL_MS;
      else process.env.SOCIAL_CANCEL_POLL_MS = previousCancelPollMs;
    }

    const updatedJob = await prisma.collectionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe("CANCELED");
    expect(updatedJob.errorMessage).toBe("collection-canceled");
  }, 10_000);

  it("stress-processes mixed social jobs without queue, dedupe or cancel conflicts", async () => {
    const keyword = await upsertSearchKeyword({
      value: "face yoga stress",
      platforms: ["instagram", "vk", "youtube"],
      countries: ["RU", "KZ"],
      minFollowers: 1_000,
      maxFollowers: 500_000,
      hashtags: ["faceyoga"]
    });
    const platforms: SocialPlatform[] = ["instagram", "vk", "youtube"];
    const queuedJobs = [];

    for (let index = 0; index < 4; index += 1) {
      for (const platform of platforms) {
        queuedJobs.push(await queueCollectionJob({
          keywordId: keyword.id,
          platform,
          minFollowers: 1_000,
          maxFollowers: 500_000,
          countries: ["RU", "KZ"],
          hashtags: ["faceyoga"],
          maxProfiles: 50,
          config: { stressBatch: index, includeShortsSearch: true, includeVideoSearch: true }
        }));
      }
    }

    await prisma.collectionJob.update({
      where: { id: queuedJobs[5].id },
      data: { cancelRequested: true }
    });

    const seenInputs: Record<SocialPlatform, unknown[]> = { instagram: [], vk: [], youtube: [] };
    const makeRunner = (platform: SocialPlatform) => async (input: unknown) => {
      seenInputs[platform].push(input);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        exitCode: 0,
        events: [{
          event: {
            level: "info" as const,
            code: `${platform}_collector_finished`,
            message: `${platform} collector finished`,
            data: { emitted: 3, profileChecks: 6, uniqueProfilesSeen: 4 }
          },
          collectedAt: "2026-05-29T15:00:00.000Z"
        }],
        candidates: [
          socialCandidate(platform, "shared-profile", "shared_handle", 30_000, "shared"),
          socialCandidate(platform, "shared-profile", "shared_handle", 31_000, "shared-refresh"),
          socialCandidate(platform, `${platform}-unique-${seenInputs[platform].length}`, "cross_platform_handle", 22_000, "unique")
        ]
      };
    };

    for (;;) {
      const processed = await Promise.all(
        Array.from({ length: 6 }, () => processNextSocialCollectionJob(
          prisma,
          makeRunner("instagram"),
          makeRunner("vk"),
          makeRunner("youtube")
        ))
      );
      if (!processed.some(Boolean)) break;
    }

    const jobsByStatus = await prisma.collectionJob.groupBy({
      by: ["status"],
      _count: { _all: true }
    });
    expect(Object.fromEntries(jobsByStatus.map((row) => [row.status, row._count._all]))).toMatchObject({
      SUCCESS: 11,
      CANCELED: 1
    });
    expect(await prisma.collectionJob.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })).toBe(0);
    expect(await prisma.collectionRun.count({ where: { status: "RUNNING" } })).toBe(0);
    expect(seenInputs.instagram.length + seenInputs.vk.length + seenInputs.youtube.length).toBe(11);

    const sharedProfiles = await prisma.candidateProfile.findMany({
      where: { platformProfileId: "shared-profile" }
    });
    expect(sharedProfiles).toHaveLength(3);
    expect(new Set(sharedProfiles.map((profile) => profile.platform)).size).toBe(3);
    expect(await prisma.candidateProfile.count()).toBe(14);
    expect(await prisma.candidate.count()).toBe(6);
    expect(await prisma.rawSocialSnapshot.count()).toBe(33);

    const canceledJob = await prisma.collectionJob.findUniqueOrThrow({
      where: { id: queuedJobs[5].id },
      include: { events: true, runs: true }
    });
    expect(canceledJob.status).toBe("CANCELED");
    expect(canceledJob.events.some((event) => event.message === "collection-canceled")).toBe(true);
    expect(canceledJob.events.some((event) => (event.data as { code?: unknown }).code === "social_collector_canceled")).toBe(true);
    expect(canceledJob.runs[0]?.status).toBe("CANCELED");

    const accounts = await prisma.socialPlatformAccount.findMany();
    expect(accounts).toHaveLength(6);
    expect(accounts.every((account) => account.status === "OK")).toBe(true);
  });
});

function socialCandidate(
  platform: SocialPlatform,
  profileId: string,
  username: string,
  followers: number,
  suffix: string
): SocialCandidateRow {
  const platformLabel = platform === "youtube" ? "YouTube" : platform === "vk" ? "VK" : "Instagram";
  const matchedBy = platform === "youtube"
    ? "youtube_shorts_search"
    : platform === "vk"
    ? "vk_groups_search"
    : "hashtag_reels";
  return {
    platform,
    platformProfileId: profileId,
    username,
    displayName: `${platformLabel} ${suffix}`,
    profileUrl: `https://example.test/${platform}/${profileId}`,
    followers,
    bio: `stress ${platform} profile`,
    externalUrl: `https://example.test/${platform}/${profileId}/contact`,
    contacts: { emails: [`${platform}-${suffix}@example.test`], phones: [], urls: [] },
    sourceKeyword: "face yoga stress",
    sourceTag: "faceyoga",
    matchedBy,
    lastPosts: [],
    metrics: { avgLikes: 10, avgComments: 1, avgViews: 1000, postsChecked: 1 },
    geoGuess: "RU",
    reason: `stress candidate from ${platform}`,
    raw: { platform, profileId, suffix },
    collectedAt: "2026-05-29T15:00:00.000Z"
  };
}

function eventCode(data: unknown) {
  if (data && typeof data === "object" && "code" in data) {
    const code = (data as { code?: unknown }).code;
    return typeof code === "string" ? code : "";
  }
  return "";
}
