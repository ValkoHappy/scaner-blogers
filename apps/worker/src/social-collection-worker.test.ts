import { describe, expect, it } from "vitest";
import {
  activeSocialAccountCooldown,
  activeInstagramAccountRest,
  buildInstagramCollectorInputFromJob,
  buildYouTubeCollectorInputFromJob,
  collectionJobUsesYouTubeWebFallback,
  buildVkCollectorInputFromJob,
  claimNextCollectionJob,
  filterCandidatesByFollowerRange,
  isInstagramProxyIssue,
  knownSocialProfileIds,
  instagramProfilesChecked,
  claimInstagramAccount,
  processNextSocialCollectionJob,
  selectCredentialAccount,
  selectInstagramAccount,
  socialPlatformConcurrencyLimit,
  youtubeProfilesChecked,
  vkProfilesChecked,
  selectInstagramProxy
} from "./social-collection-worker";

const faceMassage = "\u043c\u0430\u0441\u0441\u0430\u0436 \u043b\u0438\u0446\u0430";
const faceMassageTag = "\u043c\u0430\u0441\u0441\u0430\u0436\u043b\u0438\u0446\u0430";

describe("social collection worker", () => {
  it("builds Instagram collector input from a queued collection job", () => {
    expect(buildInstagramCollectorInputFromJob({
      minFollowers: 20_000,
      maxFollowers: 60_000,
      maxProfiles: 40,
      countries: ["RU", "KZ"],
      hashtags: [faceMassageTag],
      config: {
        includeUserSearch: false,
        requireGeoMatch: true,
        includeAccountSerpSearch: false,
        includeTypeaheadSearch: false,
        maxTagsPerKeyword: 8,
        maxUserSearchResultsPerKeyword: 12,
        maxProfileChecks: 25,
        maxMediasPerTag: 5,
        recentMediaPerProfile: 0,
        profileDelayMinSec: 0,
        profileDelayMaxSec: 1,
        mediaDelayMinSec: 0,
        mediaDelayMaxSec: 1,
        useHashtagSearch: false,
        useDerivedHashtags: false,
        includeKeywordReelsSearch: false,
        timeoutMs: 60_000
      },
      keyword: { value: faceMassage }
    })).toEqual({
      keywords: [faceMassage],
      hashtags: [faceMassageTag],
      countries: ["RU", "KZ"],
      requireGeoMatch: true,
      minFollowers: 20_000,
      maxFollowers: 60_000,
      maxProfiles: 40,
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
      maxUserSearchResultsPerKeyword: 12,
      timeoutMs: 60_000
    });
  });

  it("supports snake_case Instagram collector config keys", () => {
    expect(buildInstagramCollectorInputFromJob({
      minFollowers: 20_000,
      maxFollowers: 60_000,
      maxProfiles: null,
      countries: ["RU"],
      hashtags: [],
      config: {
        include_user_search: true,
        max_user_search_results_per_keyword: 7
      },
      keyword: { value: "face yoga" }
    })).toMatchObject({
      includeUserSearch: true,
      maxUserSearchResultsPerKeyword: 7
    });
  });

  it("builds VK collector input from a queued collection job", () => {
    expect(buildVkCollectorInputFromJob({
      minFollowers: 20_000,
      maxFollowers: 60_000,
      maxProfiles: 500,
      countries: ["RU", "KZ"],
      config: {
        requireGeoMatch: false,
        maxGroupChecks: 1000,
        searchCountPerKeyword: 500,
        wallPostsPerGroup: 20,
        requestDelayMinSec: 0.5,
        requestDelayMaxSec: 1.5,
        useDerivedQueries: true,
        maxSearchQueriesPerKeyword: 8,
        apiVersion: "5.199",
        timeoutMs: 3_600_000
      },
      keyword: { value: faceMassage }
    })).toEqual({
      keywords: [faceMassage],
      countries: ["RU", "KZ"],
      requireGeoMatch: false,
      minFollowers: 20_000,
      maxFollowers: 60_000,
      maxGroups: 500,
      maxGroupChecks: 1000,
      searchCountPerKeyword: 500,
      wallPostsPerGroup: 20,
      requestDelayMinSec: 0.5,
      requestDelayMaxSec: 1.5,
      useDerivedQueries: true,
      maxSearchQueriesPerKeyword: 8,
      apiVersion: "5.199",
      timeoutMs: 3_600_000
    });
  });

  it("builds YouTube collector input from a queued collection job", () => {
    expect(buildYouTubeCollectorInputFromJob({
      minFollowers: 15_000,
      maxFollowers: 80_000,
      maxProfiles: 500,
      countries: ["RU", "KZ"],
      config: {
        requireGeoMatch: false,
        maxChannelChecks: 1000,
        searchResultsPerQuery: 25,
        recentVideosPerChannel: 10,
        requestDelayMinSec: 0.2,
        requestDelayMaxSec: 0.8,
        useDerivedQueries: true,
        includeChannelSearch: true,
        includeShortsSearch: true,
        includeVideoSearch: true,
        useWebFallback: true,
        maxSearchQueriesPerKeyword: 8,
        relevanceLanguage: "ru",
        timeoutMs: 3_600_000
      },
      keyword: { value: faceMassage }
    })).toEqual({
      keywords: [faceMassage],
      countries: ["RU", "KZ"],
      requireGeoMatch: false,
      minFollowers: 15_000,
      maxFollowers: 80_000,
      maxChannels: 500,
      maxChannelChecks: 1000,
      searchResultsPerQuery: 25,
      recentVideosPerChannel: 10,
      requestDelayMinSec: 0.2,
      requestDelayMaxSec: 0.8,
      useDerivedQueries: true,
      includeChannelSearch: true,
      includeShortsSearch: true,
      includeVideoSearch: true,
      useWebFallback: true,
      maxSearchQueriesPerKeyword: 8,
      relevanceLanguage: "ru",
      timeoutMs: 3_600_000
    });
  });

  it("detects YouTube web fallback jobs from camelCase and snake_case config", () => {
    expect(collectionJobUsesYouTubeWebFallback({ useWebFallback: true })).toBe(true);
    expect(collectionJobUsesYouTubeWebFallback({ use_web_fallback: true })).toBe(true);
    expect(collectionJobUsesYouTubeWebFallback({ useWebFallback: false })).toBe(false);
    expect(collectionJobUsesYouTubeWebFallback(null)).toBe(false);
  });

  it("keeps only candidates inside the job follower range", () => {
    expect(filterCandidatesByFollowerRange([
      { id: "too-small", followers: 999 },
      { id: "min-edge", followers: 1_000 },
      { id: "middle", followers: 45_000 },
      { id: "max-edge", followers: 60_000 },
      { id: "too-large", followers: 60_001 }
    ], 1_000, 60_000).map((candidate) => candidate.id)).toEqual(["min-edge", "middle", "max-edge"]);
  });

  it("omits empty keyword values", () => {
    expect(buildInstagramCollectorInputFromJob({
      minFollowers: 20_000,
      maxFollowers: 60_000,
      maxProfiles: null,
      countries: [],
      hashtags: [],
      keyword: { value: " " }
    })).toEqual({
      keywords: [],
      hashtags: [],
      countries: [],
      requireGeoMatch: undefined,
      minFollowers: 20_000,
      maxFollowers: 60_000,
      maxProfiles: undefined,
      maxProfileChecks: undefined,
      maxTagsPerKeyword: undefined,
      maxMediasPerTag: undefined,
      recentMediaPerProfile: undefined,
      profileDelayMinSec: undefined,
      profileDelayMaxSec: undefined,
      mediaDelayMinSec: undefined,
      mediaDelayMaxSec: undefined,
      useHashtagSearch: undefined,
      useDerivedHashtags: undefined,
      includeKeywordReelsSearch: undefined,
      includeUserSearch: undefined,
      includeAccountSerpSearch: undefined,
      includeTypeaheadSearch: undefined,
      maxUserSearchResultsPerKeyword: undefined,
      timeoutMs: undefined
    });
  });

  it("detects active Instagram account cooldown windows", () => {
    const now = new Date("2026-05-28T10:00:00.000Z");
    const blockedUntil = new Date("2026-05-28T11:00:00.000Z");
    expect(activeSocialAccountCooldown({ status: "BLOCKED", blockedUntil }, now)).toBe(blockedUntil);
    expect(activeSocialAccountCooldown({ status: "BLOCKED", blockedUntil: new Date("2026-05-28T09:59:00.000Z") }, now)).toBeNull();
    expect(activeSocialAccountCooldown({ status: "OK", blockedUntil }, now)).toBeNull();
  });

  it("reads the checked profile count from the Instagram collector finish event", () => {
    expect(instagramProfilesChecked({
      candidates: [],
      exitCode: 0,
      events: [{
        event: {
          level: "info",
          code: "instagram_collector_finished",
          message: "Instagram collector finished",
          data: { emitted: 1, profileChecks: 9 }
        },
        collectedAt: "2026-05-28T09:00:00.000Z"
      }]
    })).toBe(9);
  });

  it("reads the checked group count from the VK collector finish event", () => {
    expect(vkProfilesChecked({
      candidates: [],
      exitCode: 0,
      events: [{
        event: {
          level: "info",
          code: "vk_collector_finished",
          message: "VK collector finished",
          data: { emitted: 2, profileChecks: 19 }
        },
        collectedAt: "2026-05-29T09:00:00.000Z"
      }]
    })).toBe(19);
  });

  it("reads the checked channel count from the YouTube collector finish event", () => {
    expect(youtubeProfilesChecked({
      candidates: [],
      exitCode: 0,
      events: [{
        event: {
          level: "info",
          code: "youtube_collector_finished",
          message: "YouTube collector finished",
          data: { emitted: 2, profileChecks: 21 }
        },
        collectedAt: "2026-05-29T09:00:00.000Z"
      }]
    })).toBe(21);
  });

  it("selects a healthy Instagram proxy from the database pool", async () => {
    const previousEnvProxy = process.env.INSTAGRAM_PROXY_URL;
    delete process.env.INSTAGRAM_PROXY_URL;
    const proxy = {
      id: "proxy-1",
      url: "http://user:pass@203.0.113.10:8000",
      status: "OK"
    };
    const updates: unknown[] = [];
    const db = {
      systemSettings: {
        upsert: async () => ({ proxyEnabled: true, proxyUrl: null })
      },
      proxyEndpoint: {
        findFirst: async () => proxy,
        update: async (input: unknown) => {
          updates.push(input);
          return proxy;
        }
      }
    };

    try {
      await expect(selectInstagramProxy(db as never)).resolves.toEqual({
        id: proxy.id,
        url: proxy.url,
        source: "pool"
      });
      expect(updates).toHaveLength(1);
    } finally {
      if (previousEnvProxy === undefined) delete process.env.INSTAGRAM_PROXY_URL;
      else process.env.INSTAGRAM_PROXY_URL = previousEnvProxy;
    }
  });

  it("restores an Instagram proxy after its cooldown expires", async () => {
    const previousEnvProxy = process.env.INSTAGRAM_PROXY_URL;
    delete process.env.INSTAGRAM_PROXY_URL;
    const proxy = {
      id: "proxy-expired",
      url: "http://user:pass@203.0.113.11:8000",
      status: "BLOCKED"
    };
    const updates: Array<{ data: Record<string, unknown> }> = [];
    const db = {
      systemSettings: {
        upsert: async () => ({ proxyEnabled: true, proxyUrl: null })
      },
      proxyEndpoint: {
        findFirst: async () => proxy,
        update: async (input: { data: Record<string, unknown> }) => {
          updates.push(input);
          return proxy;
        }
      }
    };

    try {
      await expect(selectInstagramProxy(db as never)).resolves.toMatchObject({
        id: proxy.id,
        source: "pool"
      });
      expect(updates[0].data).toMatchObject({
        status: "OK",
        blockedUntil: null,
        lastError: null
      });
    } finally {
      if (previousEnvProxy === undefined) delete process.env.INSTAGRAM_PROXY_URL;
      else process.env.INSTAGRAM_PROXY_URL = previousEnvProxy;
    }
  });

  it("does not blame the proxy for an Instagram login challenge", () => {
    expect(isInstagramProxyIssue("instagram-collector:challenge_required:challenge_required")).toBe(false);
    expect(isInstagramProxyIssue("instagram-collector:checkpoint:login_required")).toBe(false);
    expect(isInstagramProxyIssue("instagram-collector:proxy_blocked:another ip address")).toBe(true);
    expect(isInstagramProxyIssue("instagram-collector:ECONNRESET")).toBe(true);
  });

  it("selects a healthy Instagram account from the database pool", async () => {
    const previousUsername = process.env.INSTAGRAM_USERNAME;
    const previousPassword = process.env.INSTAGRAM_PASSWORD;
    delete process.env.INSTAGRAM_USERNAME;
    delete process.env.INSTAGRAM_PASSWORD;
    const db = {
      socialPlatformAccount: {
        findMany: async () => [
          {
            accountKey: "INSTAGRAM:busy",
            label: "Busy",
            username: "busy",
            status: "RUNNING",
            blockedUntil: null,
            metadata: { enabled: true, password: "busy-password" }
          },
          {
            accountKey: "INSTAGRAM:pool_user",
            label: "Pool user",
            username: "pool_user",
            status: "OK",
            blockedUntil: null,
            metadata: {
              enabled: true,
              sessionId: "pool-session-id",
              sessionFile: ".instagram/pool-user.session.json",
              proxyUrl: "socks5://user:pass@127.0.0.1:9000"
            }
          }
        ]
      }
    };

    try {
      await expect(selectInstagramAccount(db as never)).resolves.toEqual({
        accountKey: "INSTAGRAM:pool_user",
        username: "pool_user",
        sessionId: "pool-session-id",
        label: "Pool user",
        source: "pool",
        sessionFile: ".instagram/pool-user.session.json",
        proxyUrl: "socks5://user:pass@127.0.0.1:9000"
      });
    } finally {
      if (previousUsername === undefined) delete process.env.INSTAGRAM_USERNAME;
      else process.env.INSTAGRAM_USERNAME = previousUsername;
      if (previousPassword === undefined) delete process.env.INSTAGRAM_PASSWORD;
      else process.env.INSTAGRAM_PASSWORD = previousPassword;
    }
  });

  it("selects an Instagram account that has full session settings without a password", async () => {
    const previousUsername = process.env.INSTAGRAM_USERNAME;
    const previousPassword = process.env.INSTAGRAM_PASSWORD;
    delete process.env.INSTAGRAM_USERNAME;
    delete process.env.INSTAGRAM_PASSWORD;
    const sessionSettings = JSON.stringify({
      uuids: { phone_id: "phone-id-placeholder" },
      authorization_data: { ds_user_id: "123" }
    });
    const db = {
      socialPlatformAccount: {
        findMany: async () => [
          {
            accountKey: "INSTAGRAM:session_user",
            label: "Session user",
            username: "session_user",
            status: "OK",
            blockedUntil: null,
            metadata: {
              enabled: true,
              sessionSettings,
              sessionFile: ".instagram/session-user.session.json"
            }
          }
        ]
      }
    };

    try {
      await expect(selectInstagramAccount(db as never)).resolves.toEqual({
        accountKey: "INSTAGRAM:session_user",
        username: "session_user",
        password: undefined,
        sessionId: undefined,
        sessionSettings,
        label: "Session user",
        source: "pool",
        sessionFile: ".instagram/session-user.session.json",
        proxyUrl: undefined
      });
    } finally {
      if (previousUsername === undefined) delete process.env.INSTAGRAM_USERNAME;
      else process.env.INSTAGRAM_USERNAME = previousUsername;
      if (previousPassword === undefined) delete process.env.INSTAGRAM_PASSWORD;
      else process.env.INSTAGRAM_PASSWORD = previousPassword;
    }
  });

  it("selects an Instagram account that only has a saved session file", async () => {
    const previousUsername = process.env.INSTAGRAM_USERNAME;
    const previousPassword = process.env.INSTAGRAM_PASSWORD;
    delete process.env.INSTAGRAM_USERNAME;
    delete process.env.INSTAGRAM_PASSWORD;
    const db = {
      socialPlatformAccount: {
        findMany: async () => [
          {
            accountKey: "INSTAGRAM:file_user",
            label: "File user",
            username: "file_user",
            status: "OK",
            blockedUntil: null,
            metadata: {
              enabled: true,
              sessionFile: ".instagram/file-user.session.json"
            }
          }
        ]
      }
    };

    try {
      await expect(selectInstagramAccount(db as never)).resolves.toEqual({
        accountKey: "INSTAGRAM:file_user",
        username: "file_user",
        password: undefined,
        sessionId: undefined,
        sessionSettings: undefined,
        label: "File user",
        source: "pool",
        sessionFile: ".instagram/file-user.session.json",
        proxyUrl: undefined
      });
    } finally {
      if (previousUsername === undefined) delete process.env.INSTAGRAM_USERNAME;
      else process.env.INSTAGRAM_USERNAME = previousUsername;
      if (previousPassword === undefined) delete process.env.INSTAGRAM_PASSWORD;
      else process.env.INSTAGRAM_PASSWORD = previousPassword;
    }
  });

  it("skips Instagram accounts that keep mixed auth state in metadata", async () => {
    const previousUsername = process.env.INSTAGRAM_USERNAME;
    const previousPassword = process.env.INSTAGRAM_PASSWORD;
    delete process.env.INSTAGRAM_USERNAME;
    delete process.env.INSTAGRAM_PASSWORD;
    const db = {
      socialPlatformAccount: {
        findMany: async () => [
          {
            accountKey: "INSTAGRAM:mixed_user",
            label: "Mixed user",
            username: "mixed_user",
            status: "OK",
            blockedUntil: null,
            metadata: {
              enabled: true,
              sessionSettings: '{"uuids":{}}',
              sessionId: "browser-session",
              sessionFile: ".instagram/mixed-user.session.json"
            }
          },
          {
            accountKey: "INSTAGRAM:ready_user",
            label: "Ready user",
            username: "ready_user",
            status: "OK",
            blockedUntil: null,
            metadata: {
              enabled: true,
              sessionSettings: '{"uuids":{}}',
              sessionFile: ".instagram/ready-user.session.json"
            }
          }
        ]
      }
    };

    try {
      await expect(selectInstagramAccount(db as never)).resolves.toEqual({
        accountKey: "INSTAGRAM:ready_user",
        username: "ready_user",
        password: undefined,
        sessionId: undefined,
        sessionSettings: '{"uuids":{}}',
        label: "Ready user",
        source: "pool",
        sessionFile: ".instagram/ready-user.session.json",
        proxyUrl: undefined
      });
    } finally {
      if (previousUsername === undefined) delete process.env.INSTAGRAM_USERNAME;
      else process.env.INSTAGRAM_USERNAME = previousUsername;
      if (previousPassword === undefined) delete process.env.INSTAGRAM_PASSWORD;
      else process.env.INSTAGRAM_PASSWORD = previousPassword;
    }
  });

  it("skips Instagram accounts that are resting after a successful job", async () => {
    const previousUsername = process.env.INSTAGRAM_USERNAME;
    const previousPassword = process.env.INSTAGRAM_PASSWORD;
    delete process.env.INSTAGRAM_USERNAME;
    delete process.env.INSTAGRAM_PASSWORD;
    const db = {
      socialPlatformAccount: {
        findMany: async () => [
          {
            accountKey: "INSTAGRAM:resting",
            label: "Resting",
            username: "resting",
            status: "OK",
            blockedUntil: null,
            metadata: {
              enabled: true,
              sessionId: "resting-session-id",
              sessionFile: ".instagram/resting.session.json",
              nextAvailableAt: new Date(Date.now() + 60_000).toISOString()
            }
          },
          {
            accountKey: "INSTAGRAM:ready",
            label: "Ready",
            username: "ready",
            status: "OK",
            blockedUntil: null,
            metadata: {
              enabled: true,
              sessionId: "ready-session-id",
              sessionFile: ".instagram/ready.session.json"
            }
          }
        ]
      }
    };

    try {
      expect(activeInstagramAccountRest({
        metadata: { nextAvailableAt: new Date(Date.now() + 60_000).toISOString() }
      })).toEqual(expect.any(Date));
      await expect(selectInstagramAccount(db as never)).resolves.toMatchObject({
        accountKey: "INSTAGRAM:ready",
        username: "ready"
      });
    } finally {
      if (previousUsername === undefined) delete process.env.INSTAGRAM_USERNAME;
      else process.env.INSTAGRAM_USERNAME = previousUsername;
      if (previousPassword === undefined) delete process.env.INSTAGRAM_PASSWORD;
      else process.env.INSTAGRAM_PASSWORD = previousPassword;
    }
  });

  it("atomically claims a healthy Instagram account from the pool", async () => {
    const previousUsername = process.env.INSTAGRAM_USERNAME;
    const previousPassword = process.env.INSTAGRAM_PASSWORD;
    delete process.env.INSTAGRAM_USERNAME;
    delete process.env.INSTAGRAM_PASSWORD;
    const updates: unknown[] = [];
    const db = {
      socialPlatformAccount: {
        findMany: async () => [
          {
            accountKey: "INSTAGRAM:pool_user",
            label: "Pool user",
            username: "pool_user",
            status: "OK",
            blockedUntil: null,
            metadata: {
              enabled: true,
              sessionId: "pool-session-id",
              sessionFile: ".instagram/pool-user.session.json"
            }
          }
        ],
        updateMany: async (input: unknown) => {
          updates.push(input);
          return { count: 1 };
        }
      }
    };

    try {
      await expect(claimInstagramAccount(db as never)).resolves.toMatchObject({
        accountKey: "INSTAGRAM:pool_user",
        username: "pool_user",
        source: "pool"
      });
      expect(updates).toEqual([{
        where: {
          accountKey: "INSTAGRAM:pool_user",
          platform: "INSTAGRAM",
          status: { not: "RUNNING" },
          OR: [
            { blockedUntil: null },
            { blockedUntil: { lte: expect.any(Date) } }
          ]
        },
        data: {
          status: "RUNNING",
          lastError: null,
          lastErrorAt: null
        }
      }]);
    } finally {
      if (previousUsername === undefined) delete process.env.INSTAGRAM_USERNAME;
      else process.env.INSTAGRAM_USERNAME = previousUsername;
      if (previousPassword === undefined) delete process.env.INSTAGRAM_PASSWORD;
      else process.env.INSTAGRAM_PASSWORD = previousPassword;
    }
  });

  it("does not claim an Instagram account when another worker took it first", async () => {
    const previousUsername = process.env.INSTAGRAM_USERNAME;
    const previousPassword = process.env.INSTAGRAM_PASSWORD;
    delete process.env.INSTAGRAM_USERNAME;
    delete process.env.INSTAGRAM_PASSWORD;
    let attempts = 0;
    const db = {
      socialPlatformAccount: {
        findMany: async () => attempts++ === 0 ? [
          {
            accountKey: "INSTAGRAM:pool_user",
            label: "Pool user",
            username: "pool_user",
            status: "OK",
            blockedUntil: null,
            metadata: { enabled: true, password: "pool-password" }
          }
        ] : [],
        updateMany: async () => ({ count: 0 })
      }
    };

    try {
      await expect(claimInstagramAccount(db as never)).resolves.toBeNull();
    } finally {
      if (previousUsername === undefined) delete process.env.INSTAGRAM_USERNAME;
      else process.env.INSTAGRAM_USERNAME = previousUsername;
      if (previousPassword === undefined) delete process.env.INSTAGRAM_PASSWORD;
      else process.env.INSTAGRAM_PASSWORD = previousPassword;
    }
  });

  it("releases a claimed Instagram account when a collection job is canceled", async () => {
    const accountUpdates: unknown[] = [];
    const accountUpserts: unknown[] = [];
    const jobUpdates: unknown[] = [];
    const runUpdates: unknown[] = [];
    const job = {
      id: "job-canceled",
      platform: "INSTAGRAM",
      keywordId: "keyword-1",
      minFollowers: 20_000,
      maxFollowers: 60_000,
      maxProfiles: 5,
      countries: ["RU"],
      hashtags: [],
      config: {},
      keyword: { value: "face yoga" }
    };
    const tx = {
      collectionJob: {
        groupBy: async () => [],
        findMany: async () => [{ id: job.id, platform: job.platform, scheduledFor: new Date(Date.now() - 1000) }],
        updateMany: async () => ({ count: 1 }),
        findUnique: async () => job
      }
    };
    const db = {
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      socialPlatformAccount: {
        findUnique: async () => ({ metadata: { enabled: true, password: "secret" }, consecutiveErrors: 2 }),
        findMany: async () => [
          {
            accountKey: "INSTAGRAM:test_user",
            label: "Test user",
            username: "test_user",
            status: "OK",
            blockedUntil: null,
            metadata: { enabled: true, sessionId: "test-session-id", sessionFile: ".instagram/test.session.json" }
          }
        ],
        updateMany: async (input: unknown) => {
          accountUpdates.push(input);
          return { count: 1 };
        },
        upsert: async (input: unknown) => {
          accountUpserts.push(input);
          return {};
        }
      },
      collectionRun: {
        create: async () => ({ id: "run-canceled" }),
        update: async (input: unknown) => {
          runUpdates.push(input);
          return {};
        }
      },
      collectionJob: {
        groupBy: async () => [],
        findMany: async () => [{ id: "job-canceled", platform: "INSTAGRAM", scheduledFor: new Date(Date.now() - 1000) }],
        findUnique: async () => ({
          id: "job-canceled",
          platform: "INSTAGRAM",
          cancelRequested: false,
          keyword: { value: "face yoga" },
          minFollowers: 1,
          maxFollowers: 100,
          countries: [],
          hashtags: [],
          config: null
        }),
        update: async (input: unknown) => {
          jobUpdates.push(input);
          return {};
        },
        updateMany: async () => ({ count: 1 })
      },
      collectionEvent: {
        create: async () => ({})
      },
      candidateProfile: {
        findMany: async () => []
      },
      systemSettings: {
        upsert: async () => ({ proxyEnabled: false, proxyUrl: null })
      },
      proxyEndpoint: {
        findFirst: async () => null
      }
    };

    await expect(processNextSocialCollectionJob(
      db as never,
      async () => {
        throw new Error("collection-canceled");
      }
    )).resolves.toBe(true);

    expect(accountUpdates).toEqual([expect.objectContaining({
      data: expect.objectContaining({ status: "RUNNING" })
    })]);
    expect(runUpdates).toEqual([expect.objectContaining({
      data: expect.objectContaining({ status: "CANCELED" })
    })]);
    expect(jobUpdates).toEqual([expect.objectContaining({
      data: expect.objectContaining({ status: "CANCELED" })
    })]);
    expect(accountUpserts).toEqual([
      expect.objectContaining({
        where: { accountKey: "INSTAGRAM:test_user" },
        update: expect.objectContaining({ status: "RUNNING" })
      }),
      expect.objectContaining({
        where: { accountKey: "INSTAGRAM:test_user" },
        update: expect.objectContaining({
          status: "OK",
          consecutiveErrors: 0
        })
      })
    ]);
  });

  it("fails over to another Instagram account after a collector timeout", async () => {
    const accounts = [
      {
        accountKey: "INSTAGRAM:first_user",
        label: "First user",
        username: "first_user",
        status: "OK",
        blockedUntil: null as Date | null,
        lastSuccessAt: null as Date | null,
        updatedAt: new Date("2026-05-28T10:00:00.000Z"),
        metadata: { enabled: true, sessionId: "first-session-id", sessionFile: ".instagram/first.session.json" },
        consecutiveErrors: 0
      },
      {
        accountKey: "INSTAGRAM:second_user",
        label: "Second user",
        username: "second_user",
        status: "OK",
        blockedUntil: null as Date | null,
        lastSuccessAt: null as Date | null,
        updatedAt: new Date("2026-05-28T10:01:00.000Z"),
        metadata: { enabled: true, sessionId: "second-session-id", sessionFile: ".instagram/second.session.json" },
        consecutiveErrors: 0
      }
    ];
    const job = {
      id: "job-timeout-failover",
      platform: "INSTAGRAM",
      keywordId: "keyword-1",
      minFollowers: 20_000,
      maxFollowers: 60_000,
      maxProfiles: 5,
      countries: ["RU"],
      hashtags: [],
      config: {},
      keyword: { value: "face yoga" }
    };
    const tx = {
      collectionJob: {
        groupBy: async () => [],
        findMany: async () => [{ id: job.id, platform: job.platform, scheduledFor: new Date(Date.now() - 1000) }],
        updateMany: async () => ({ count: 1 }),
        findUnique: async () => job
      }
    };
    const jobUpdates: unknown[] = [];
    const accountUpserts: unknown[] = [];
    const events: unknown[] = [];
    const collectorUsernames: string[] = [];
    const db = {
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      socialPlatformAccount: {
        findMany: async () => accounts.map((account) => ({ ...account })),
        updateMany: async (input: { where: { accountKey: string }; data: { status: string } }) => {
          const account = accounts.find((item) => item.accountKey === input.where.accountKey);
          if (!account || account.status === "RUNNING" || (account.blockedUntil && account.blockedUntil > new Date())) {
            return { count: 0 };
          }
          account.status = input.data.status;
          return { count: 1 };
        },
        findUnique: async (input: { where: { accountKey: string } }) => {
          const account = accounts.find((item) => item.accountKey === input.where.accountKey);
          return account ? { metadata: account.metadata, consecutiveErrors: account.consecutiveErrors } : null;
        },
        upsert: async (input: { where: { accountKey: string }; update: Record<string, unknown> }) => {
          accountUpserts.push(input);
          const account = accounts.find((item) => item.accountKey === input.where.accountKey);
          if (account) {
            if (typeof input.update.status === "string") account.status = input.update.status;
            if ("blockedUntil" in input.update) account.blockedUntil = input.update.blockedUntil as Date | null;
            if (typeof input.update.consecutiveErrors === "number") account.consecutiveErrors = input.update.consecutiveErrors;
            account.updatedAt = new Date();
          }
          return {};
        }
      },
      collectionRun: {
        create: async () => ({ id: "run-timeout-failover" }),
        update: async () => ({})
      },
      collectionJob: {
        groupBy: async () => [],
        findMany: async () => [{ id: job.id, platform: job.platform, scheduledFor: new Date(Date.now() - 1000) }],
        findUnique: async () => ({
          ...job,
          cancelRequested: false
        }),
        update: async (input: unknown) => {
          jobUpdates.push(input);
          return {};
        },
        updateMany: async () => ({ count: 1 })
      },
      collectionEvent: {
        create: async (input: unknown) => {
          events.push(input);
          return {};
        }
      },
      collectionSearchHistory: {
        upsert: async () => ({})
      },
      candidateProfile: {
        findMany: async () => []
      },
      systemSettings: {
        upsert: async () => ({ proxyEnabled: false, proxyUrl: null })
      },
      proxyEndpoint: {
        findFirst: async () => null,
        updateMany: async () => ({ count: 0 })
      }
    };

    await expect(processNextSocialCollectionJob(
      db as never,
      async (input) => {
        collectorUsernames.push(input.username ?? "");
        if (input.username === "first_user") throw new Error("Timeout 60000ms exceeded");
        return { candidates: [], events: [], exitCode: 0 };
      }
    )).resolves.toBe(true);

    expect(collectorUsernames).toEqual(["first_user", "second_user"]);
    expect(accounts[0].status).toBe("FAILED");
    expect(accounts[0].blockedUntil).toBeNull();
    expect(accounts[1].status).toBe("OK");
    expect(jobUpdates).toContainEqual(expect.objectContaining({
      data: expect.objectContaining({ status: "SUCCESS" })
    }));
    expect(accountUpserts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        where: { accountKey: "INSTAGRAM:first_user" },
        update: expect.objectContaining({ status: "FAILED" })
      }),
      expect.objectContaining({
        where: { accountKey: "INSTAGRAM:second_user" },
        update: expect.objectContaining({ status: "OK" })
      })
    ]));
    expect(events).toContainEqual(expect.objectContaining({
      data: expect.objectContaining({
        message: "instagram_account_failover"
      })
    }));
  });

  it("falls back to the env Instagram account when the pool has no healthy credentials", async () => {
    const previousUsername = process.env.INSTAGRAM_USERNAME;
    const previousPassword = process.env.INSTAGRAM_PASSWORD;
    const previousSessionId = process.env.INSTAGRAM_SESSIONID;
    const previousSessionFile = process.env.INSTAGRAM_SESSION_FILE;
    process.env.INSTAGRAM_USERNAME = "env_user";
    process.env.INSTAGRAM_SESSIONID = "env-session-id";
    delete process.env.INSTAGRAM_PASSWORD;
    process.env.INSTAGRAM_SESSION_FILE = ".instagram/env.session.json";
    const db = {
      socialPlatformAccount: {
        findMany: async () => [
          {
            accountKey: "INSTAGRAM:blocked",
            label: "Blocked",
            username: "blocked",
            status: "BLOCKED",
            blockedUntil: new Date(Date.now() + 60_000),
            metadata: { enabled: true, sessionId: "blocked-session-id", sessionFile: ".instagram/blocked.session.json" }
          }
        ]
      }
    };

    try {
      await expect(selectInstagramAccount(db as never)).resolves.toEqual({
        accountKey: "INSTAGRAM:env_user",
        username: "env_user",
        sessionId: "env-session-id",
        label: "Instagram env account",
        source: "env",
        sessionFile: ".instagram/env.session.json",
        proxyUrl: undefined
      });
    } finally {
      if (previousUsername === undefined) delete process.env.INSTAGRAM_USERNAME;
      else process.env.INSTAGRAM_USERNAME = previousUsername;
      if (previousPassword === undefined) delete process.env.INSTAGRAM_PASSWORD;
      else process.env.INSTAGRAM_PASSWORD = previousPassword;
      if (previousSessionId === undefined) delete process.env.INSTAGRAM_SESSIONID;
      else process.env.INSTAGRAM_SESSIONID = previousSessionId;
      if (previousSessionFile === undefined) delete process.env.INSTAGRAM_SESSION_FILE;
      else process.env.INSTAGRAM_SESSION_FILE = previousSessionFile;
    }
  });

  it("skips expired VK pool tokens and selects the next fresh access", async () => {
    const db = {
      socialPlatformAccount: {
        findMany: async () => [
          {
            accountKey: "VK:expired",
            label: "Expired VK",
            username: "expired",
            status: "OK",
            blockedUntil: null,
            metadata: {
              enabled: true,
              token: "expired-token",
              tokenType: "access",
              expiresAt: new Date(Date.now() - 60_000).toISOString()
            }
          },
          {
            accountKey: "VK:fresh",
            label: "Fresh VK",
            username: "fresh",
            status: "OK",
            blockedUntil: null,
            metadata: {
              enabled: true,
              token: "vk_access_token_placeholder",
              tokenType: "access",
              expiresAt: new Date(Date.now() + 60 * 60_000).toISOString()
            }
          }
        ]
      }
    };

    await expect(selectCredentialAccount(db as never, "VK")).resolves.toEqual({
      accountKey: "VK:fresh",
      platform: "VK",
      username: "fresh",
      label: "Fresh VK",
      source: "pool",
      env: { VK_ACCESS_TOKEN: "vk_access_token_placeholder", VK_SERVICE_TOKEN: "", VK_SERVER_TOKEN: "" }
    });
  });

  it("does not use the Instagram proxy pool when proxies are disabled", async () => {
    const previousEnvProxy = process.env.INSTAGRAM_PROXY_URL;
    delete process.env.INSTAGRAM_PROXY_URL;
    const db = {
      systemSettings: {
        upsert: async () => ({ proxyEnabled: false, proxyUrl: null })
      },
      proxyEndpoint: {
        findFirst: async () => {
          throw new Error("pool should not be queried");
        }
      }
    };

    try {
      await expect(selectInstagramProxy(db as never, "http://account-proxy.local:8000")).resolves.toBeNull();
    } finally {
      if (previousEnvProxy === undefined) delete process.env.INSTAGRAM_PROXY_URL;
      else process.env.INSTAGRAM_PROXY_URL = previousEnvProxy;
    }
  });

  it("loads only the newest known profile ids for collector fast-skip", async () => {
    const rows = [
      { platformProfileId: "profile-new" },
      { platformProfileId: "profile-old" }
    ];
    const db = {
      candidateProfile: {
        findMany: async (input: unknown) => {
          expect(input).toEqual({
            where: { platform: "INSTAGRAM" },
            orderBy: { lastCollectedAt: "desc" },
            take: 2,
            select: { platformProfileId: true }
          });
          return rows;
        }
      }
    };

    await expect(knownSocialProfileIds(db as never, "INSTAGRAM", 2)).resolves.toEqual(["profile-new", "profile-old"]);
  });

  it("uses SOCIAL_KNOWN_PROFILE_SKIP_LIMIT as the default fast-skip limit", async () => {
    const previousLimit = process.env.SOCIAL_KNOWN_PROFILE_SKIP_LIMIT;
    process.env.SOCIAL_KNOWN_PROFILE_SKIP_LIMIT = "3";
    const db = {
      candidateProfile: {
        findMany: async (input: unknown) => {
          expect(input).toMatchObject({ take: 3 });
          return [];
        }
      }
    };

    try {
      await expect(knownSocialProfileIds(db as never, "VK")).resolves.toEqual([]);
    } finally {
      if (previousLimit === undefined) delete process.env.SOCIAL_KNOWN_PROFILE_SKIP_LIMIT;
      else process.env.SOCIAL_KNOWN_PROFILE_SKIP_LIMIT = previousLimit;
    }
  });

  it("reads per-platform social lane concurrency from env", () => {
    const previous = process.env.SOCIAL_PLATFORM_CONCURRENCY_YOUTUBE;
    process.env.SOCIAL_PLATFORM_CONCURRENCY_YOUTUBE = "2";

    try {
      expect(socialPlatformConcurrencyLimit("INSTAGRAM")).toBe(1);
      expect(socialPlatformConcurrencyLimit("YOUTUBE")).toBe(2);
    } finally {
      if (previous === undefined) delete process.env.SOCIAL_PLATFORM_CONCURRENCY_YOUTUBE;
      else process.env.SOCIAL_PLATFORM_CONCURRENCY_YOUTUBE = previous;
    }
  });

  it("retries claiming a social job after a serializable transaction conflict", async () => {
    let attempts = 0;
    const isolationLevels: unknown[] = [];
    const job = { id: "job-1", platform: "YOUTUBE", keyword: { value: "face yoga" } };
    const tx = {
      collectionJob: {
        groupBy: async () => [],
        findMany: async () => [{ id: job.id, platform: job.platform, scheduledFor: new Date(Date.now() - 1000) }],
        updateMany: async () => ({ count: 1 }),
        findUnique: async () => job
      }
    };
    const db = {
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>, options?: { isolationLevel?: unknown }) => {
        attempts += 1;
        isolationLevels.push(options?.isolationLevel);
        if (attempts === 1) {
          const error = new Error("write conflict") as Error & { code: string };
          error.code = "P2034";
          throw error;
        }
        return callback(tx);
      }
    };

    await expect(claimNextCollectionJob(db as never)).resolves.toEqual(job);
    expect(attempts).toBe(2);
    expect(isolationLevels).toEqual(["Serializable", "Serializable"]);
  });
  it("skips password-only Instagram accounts because worker requires a prepared session", async () => {
    const previousUsername = process.env.INSTAGRAM_USERNAME;
    const previousPassword = process.env.INSTAGRAM_PASSWORD;
    const previousSessionFile = process.env.INSTAGRAM_SESSION_FILE;
    delete process.env.INSTAGRAM_USERNAME;
    delete process.env.INSTAGRAM_PASSWORD;
    delete process.env.INSTAGRAM_SESSION_FILE;
    const db = {
      socialPlatformAccount: {
        findMany: async () => [
          {
            accountKey: "INSTAGRAM:legacy",
            label: "Legacy",
            username: "legacy",
            status: "OK",
            blockedUntil: null,
            metadata: {
              enabled: true,
              username: "legacy",
              password: "secret",
              sessionFile: ".instagram/legacy.json"
            }
          },
          {
            accountKey: "INSTAGRAM:helper",
            label: "Helper",
            username: "helper",
            status: "OK",
            blockedUntil: null,
            metadata: {
              enabled: true,
              username: "helper",
              sessionSettings: '{"authorization_data":{"ds_user_id":"1"}}',
              sessionFile: ".instagram/helper.json"
            }
          }
        ]
      }
    };

    try {
      await expect(selectInstagramAccount(db as never)).resolves.toMatchObject({
        accountKey: "INSTAGRAM:helper",
        username: "helper"
      });
    } finally {
      if (previousUsername === undefined) delete process.env.INSTAGRAM_USERNAME;
      else process.env.INSTAGRAM_USERNAME = previousUsername;
      if (previousPassword === undefined) delete process.env.INSTAGRAM_PASSWORD;
      else process.env.INSTAGRAM_PASSWORD = previousPassword;
      if (previousSessionFile === undefined) delete process.env.INSTAGRAM_SESSION_FILE;
      else process.env.INSTAGRAM_SESSION_FILE = previousSessionFile;
    }
  });

});
