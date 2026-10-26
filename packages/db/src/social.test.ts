import { describe, expect, it } from "vitest";
import {
  normalizeKeywordValue,
  recordCollectionEvent,
  saveSocialCandidateProfile,
  SocialCandidateFollowerRangeError,
  socialPlatformAccountKey,
  toDbSocialPlatform,
  upsertSocialPlatformAccountStatus
} from "./social";

describe("social db helpers", () => {
  it("normalizes keyword text for dedupe", () => {
    expect(normalizeKeywordValue("  Массаж   Лица  ")).toBe("массаж лица");
  });

  it("maps API platform names to database enum names", () => {
    expect(toDbSocialPlatform("instagram")).toBe("INSTAGRAM");
    expect(toDbSocialPlatform("vk")).toBe("VK");
    expect(toDbSocialPlatform("youtube")).toBe("YOUTUBE");
  });

  it("builds stable platform account keys without storing passwords", () => {
    expect(socialPlatformAccountKey("instagram", " FaceYoga_Admin ")).toBe("INSTAGRAM:faceyoga_admin");
    expect(socialPlatformAccountKey("instagram", null)).toBe("INSTAGRAM:env");
  });

  it("redacts secrets before collection events are stored", async () => {
    const writes: unknown[] = [];
    const db = {
      collectionEvent: {
        create: async (input: unknown) => {
          writes.push(input);
          return input;
        }
      }
    };
    const vkToken = "vk1.a." + "x".repeat(85);

    await recordCollectionEvent({
      collectionJobId: "job-1",
      level: "error",
      message: `failed with access_token=${vkToken} proxy socks5://user:pass@1.2.3.4:9000`,
      data: {
        code: "dirty",
        token: vkToken,
        nested: {
          proxyUrl: "socks5://user:pass@1.2.3.4:9000",
          note: `api_key=${"AIza" + "SyCVuLxIeUVqz6oTKNToroPvK5ublGWAbhQ"}`
        }
      }
    }, db as never);

    const stored = writes[0] as {
      data: {
        message: string;
        data: {
          token: string;
          nested: { proxyUrl: string; note: string };
        };
      };
    };
    expect(stored.data.message).toContain("access_token=***");
    expect(stored.data.message).toContain("socks5://[redacted]@1.2.3.4:9000");
    expect(stored.data.data.token).toBe("[redacted]");
    expect(stored.data.data.nested.proxyUrl).toBe("[redacted]");
    expect(stored.data.data.nested.note).toContain("api_key=***");
    expect(JSON.stringify(stored)).not.toContain(vkToken);
    expect(JSON.stringify(stored)).not.toContain("user:pass");
  });

  it("redacts secrets before platform account status diagnostics are stored", async () => {
    const writes: unknown[] = [];
    const db = {
      socialPlatformAccount: {
        upsert: async (input: unknown) => {
          writes.push(input);
          return input;
        }
      }
    };
    const vkToken = "vk1.a." + "y".repeat(85);

    await upsertSocialPlatformAccountStatus({
      platform: "vk",
      username: "main",
      status: "FAILED",
      lastError: `request failed access_token=${vkToken} proxy socks5://user:pass@5.6.7.8:9000`,
      metadata: {
        accessToken: vkToken,
        proxyUrl: "socks5://user:pass@5.6.7.8:9000",
        nested: {
          authorization: `Bearer ${vkToken}`,
          note: `api_key=${"AIza" + "SyCVuLxIeUVqz6oTKNToroPvK5ublGWAbhQ"}`
        }
      }
    }, db as never);

    const stored = writes[0] as {
      create: {
        lastError: string;
        metadata: {
          accessToken: string;
          proxyUrl: string;
          nested: { authorization: string; note: string };
        };
      };
      update: {
        lastError: string;
        metadata: {
          accessToken: string;
          proxyUrl: string;
          nested: { authorization: string; note: string };
        };
      };
    };

    for (const branch of [stored.create, stored.update]) {
      expect(branch.lastError).toContain("access_token=***");
      expect(branch.lastError).toContain("socks5://[redacted]@5.6.7.8:9000");
      expect(branch.metadata.accessToken).toBe("[redacted]");
      expect(branch.metadata.proxyUrl).toBe("[redacted]");
      expect(branch.metadata.nested.authorization).toBe("[redacted]");
      expect(branch.metadata.nested.note).toContain("api_key=***");
    }
    expect(JSON.stringify(stored)).not.toContain(vkToken);
    expect(JSON.stringify(stored)).not.toContain("user:pass");
  });

  it("redacts secrets before candidate raw snapshots are stored", async () => {
    const candidateProfileWrites: unknown[] = [];
    const rawSnapshotWrites: unknown[] = [];
    const db = {
      $transaction: async (callback: (tx: unknown) => unknown) => callback({
        candidateProfile: {
          findUnique: async () => null,
          findMany: async () => [],
          create: async (input: unknown) => {
            candidateProfileWrites.push(input);
            return { id: "profile-1" };
          }
        },
        candidate: {
          create: async () => ({ id: "candidate-1" })
        },
        rawSocialSnapshot: {
          create: async (input: unknown) => {
            rawSnapshotWrites.push(input);
            return input;
          }
        }
      })
    };
    const vkToken = "vk1.a." + "r".repeat(85);

    await saveSocialCandidateProfile({
      platform: "instagram",
      platformProfileId: "ig-1",
      username: "face_massage",
      displayName: "Face Massage",
      profileUrl: "https://instagram.com/face_massage",
      followers: 32_000,
      bio: "face massage",
      externalUrl: "",
      contacts: { emails: [], phones: [], urls: [] },
      sourceKeyword: "массаж лица",
      sourceTag: "#массажлица",
      matchedBy: "hashtag",
      geoGuess: "RU",
      reason: "matched by hashtag",
      collectedAt: "2026-05-31T12:00:00.000Z",
      metrics: {
        avgLikes: 10,
        avgComments: 1,
        avgViews: 100,
        postsChecked: 1,
        debug: `api_key=${"AIza" + "SyCVuLxIeUVqz6oTKNToroPvK5ublGWAbhQ"}`
      } as never,
      lastPosts: [
        {
          id: "post-1",
          url: `https://example.test/reel?access_token=${vkToken}`,
          caption: "massage"
        }
      ] as never,
      raw: {
        accessToken: vkToken,
        proxyUrl: "socks5://user:pass@9.8.7.6:9000",
        nested: {
          authorization: `Bearer ${vkToken}`
        }
      }
    }, { collectionRunId: "run-1" }, db as never);

    const profileWrite = candidateProfileWrites[0] as {
      data: {
        metrics: { debug: string };
        lastPosts: Array<{ url: string }>;
        raw: { accessToken: string; proxyUrl: string; nested: { authorization: string } };
      };
    };
    const snapshotWrite = rawSnapshotWrites[0] as {
      data: {
        payload: { accessToken: string; proxyUrl: string; nested: { authorization: string } };
      };
    };

    expect(profileWrite.data.metrics.debug).toContain("api_key=***");
    expect(profileWrite.data.lastPosts[0]?.url).toContain("access_token=***");
    expect(profileWrite.data.raw.accessToken).toBe("[redacted]");
    expect(profileWrite.data.raw.proxyUrl).toBe("[redacted]");
    expect(profileWrite.data.raw.nested.authorization).toBe("[redacted]");
    expect(snapshotWrite.data.payload.accessToken).toBe("[redacted]");
    expect(snapshotWrite.data.payload.proxyUrl).toBe("[redacted]");
    expect(snapshotWrite.data.payload.nested.authorization).toBe("[redacted]");
    expect(JSON.stringify({ profileWrite, snapshotWrite })).not.toContain(vkToken);
    expect(JSON.stringify({ profileWrite, snapshotWrite })).not.toContain("user:pass");
  });

  it("refuses to save social candidates outside the configured follower range", async () => {
    const db = {
      $transaction: async () => {
        throw new Error("transaction should not run");
      }
    };

    await expect(saveSocialCandidateProfile({
      platform: "youtube",
      platformProfileId: "yt-low",
      username: "tiny_channel",
      displayName: "Tiny Channel",
      profileUrl: "https://youtube.com/@tiny_channel",
      followers: 999,
      bio: "face care",
      externalUrl: "",
      contacts: { emails: [], phones: [], urls: [] },
      sourceKeyword: "face care",
      sourceTag: "face care",
      matchedBy: "channel_search",
      geoGuess: null,
      reason: "matched by keyword",
      collectedAt: "2026-05-31T12:00:00.000Z",
      metrics: {
        avgLikes: 0,
        avgComments: 0,
        avgViews: 0,
        postsChecked: 0
      },
      lastPosts: [],
      raw: {}
    }, { minFollowers: 1_000, maxFollowers: 60_000 }, db as never)).rejects.toBeInstanceOf(SocialCandidateFollowerRangeError);
  });
});
