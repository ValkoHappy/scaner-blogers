import { scoreSocialCandidate, type SocialCandidateRow, type SocialPlatform as CoreSocialPlatform } from "@scaner-blogers/core";
import { createHash } from "node:crypto";
import { Prisma } from "./generated/prisma/client";
import { SocialPlatform } from "./generated/prisma/enums";
import { sanitizeEventData, sanitizeEventMessage } from "./event-sanitize.js";
import { jsonSocialPlatformList, jsonStringList, stringList } from "./list-json.js";
import { prisma as defaultPrisma } from "./prisma.js";

type DbClient = typeof defaultPrisma;

export interface UpsertSearchKeywordInput {
  value: string;
  topic?: string;
  platforms?: CoreSocialPlatform[];
  countries?: string[];
  minFollowers?: number;
  maxFollowers?: number;
  instagramMinFollowers?: number;
  instagramMaxFollowers?: number;
  vkMinFollowers?: number;
  vkMaxFollowers?: number;
  youtubeMinFollowers?: number;
  youtubeMaxFollowers?: number;
  hashtags?: string[];
  notes?: string;
}

export interface QueueCollectionJobInput {
  keywordId?: string;
  platform: CoreSocialPlatform;
  minFollowers?: number;
  maxFollowers?: number;
  countries?: string[];
  hashtags?: string[];
  requestDelayMs?: number;
  maxProfiles?: number;
  config?: unknown;
  retryOfJobId?: string;
  retryRequestedFrom?: "admin" | "api" | "system";
}

export interface SaveSocialCandidateOptions {
  keywordId?: string;
  collectionRunId?: string;
  minFollowers?: number;
  maxFollowers?: number;
}

export class SocialCandidateFollowerRangeError extends Error {
  constructor(
    readonly followers: number,
    readonly minFollowers: number,
    readonly maxFollowers: number
  ) {
    super(`social-candidate-out-of-follower-range:${followers}:${minFollowers}-${maxFollowers}`);
    this.name = "SocialCandidateFollowerRangeError";
  }
}

export interface UpsertSocialPlatformAccountStatusInput {
  platform: CoreSocialPlatform;
  username?: string | null;
  label?: string;
  status: "UNKNOWN" | "RUNNING" | "OK" | "BLOCKED" | "FAILED" | "MISSING_CREDENTIALS";
  blockedUntil?: Date | null;
  lastError?: string | null;
  metadata?: unknown;
}

export function normalizeKeywordValue(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
}

export function toDbSocialPlatform(platform: CoreSocialPlatform) {
  switch (platform) {
    case "instagram":
      return SocialPlatform.INSTAGRAM;
    case "vk":
      return SocialPlatform.VK;
    case "youtube":
      return SocialPlatform.YOUTUBE;
  }
}

export function socialPlatformAccountKey(platform: CoreSocialPlatform, username?: string | null) {
  const dbPlatform = toDbSocialPlatform(platform);
  const normalizedUsername = username?.trim().toLocaleLowerCase("en-US") || "env";
  return `${dbPlatform}:${normalizedUsername}`;
}

export async function upsertSearchKeyword(input: UpsertSearchKeywordInput, db: DbClient = defaultPrisma) {
  const normalizedValue = normalizeKeywordValue(input.value);
  const platforms = input.platforms?.map(toDbSocialPlatform) ?? [SocialPlatform.INSTAGRAM, SocialPlatform.VK];

  return db.searchKeyword.upsert({
    where: { normalizedValue },
    create: {
      value: input.value.trim(),
      normalizedValue,
      topic: input.topic,
      platforms: jsonSocialPlatformList(platforms, [SocialPlatform.INSTAGRAM, SocialPlatform.VK]),
      countries: jsonStringList(input.countries, ["RU", "KZ"]),
      minFollowers: input.minFollowers ?? 20_000,
      maxFollowers: input.maxFollowers ?? 60_000,
      instagramMinFollowers: input.instagramMinFollowers,
      instagramMaxFollowers: input.instagramMaxFollowers,
      vkMinFollowers: input.vkMinFollowers,
      vkMaxFollowers: input.vkMaxFollowers,
      youtubeMinFollowers: input.youtubeMinFollowers,
      youtubeMaxFollowers: input.youtubeMaxFollowers,
      hashtags: jsonStringList(input.hashtags, []),
      notes: input.notes
    },
    update: {
      value: input.value.trim(),
      topic: input.topic,
      platforms: jsonSocialPlatformList(platforms),
      countries: jsonStringList(input.countries),
      minFollowers: input.minFollowers,
      maxFollowers: input.maxFollowers,
      instagramMinFollowers: input.instagramMinFollowers,
      instagramMaxFollowers: input.instagramMaxFollowers,
      vkMinFollowers: input.vkMinFollowers,
      vkMaxFollowers: input.vkMaxFollowers,
      youtubeMinFollowers: input.youtubeMinFollowers,
      youtubeMaxFollowers: input.youtubeMaxFollowers,
      hashtags: jsonStringList(input.hashtags),
      notes: input.notes
    }
  });
}

export async function upsertSocialPlatformAccountStatus(
  input: UpsertSocialPlatformAccountStatusInput,
  db: DbClient = defaultPrisma
) {
  const now = new Date();
  const platform = toDbSocialPlatform(input.platform);
  const accountKey = socialPlatformAccountKey(input.platform, input.username);
  const isHealthy = input.status === "OK";
  const hasError = input.status === "BLOCKED" || input.status === "FAILED" || input.status === "MISSING_CREDENTIALS";
  const lastError = input.lastError ? sanitizeEventMessage(input.lastError) : input.lastError;
  const metadata = jsonOrUndefined(sanitizeEventData(input.metadata));

  return db.socialPlatformAccount.upsert({
    where: { accountKey },
    create: {
      platform,
      accountKey,
      label: input.label,
      username: input.username?.trim() || null,
      status: input.status,
      blockedUntil: input.blockedUntil ?? null,
      lastSuccessAt: isHealthy ? now : undefined,
      lastErrorAt: hasError ? now : undefined,
      lastError,
      consecutiveErrors: hasError ? 1 : 0,
      metadata
    },
    update: {
      label: input.label,
      username: input.username?.trim() || null,
      status: input.status,
      blockedUntil: input.blockedUntil ?? null,
      lastSuccessAt: isHealthy ? now : undefined,
      lastErrorAt: hasError ? now : undefined,
      lastError,
      consecutiveErrors: isHealthy ? 0 : hasError ? { increment: 1 } : undefined,
      metadata
    }
  });
}

export async function queueCollectionJob(input: QueueCollectionJobInput, db: DbClient = defaultPrisma) {
  const platform = toDbSocialPlatform(input.platform);
  const configHash = input.retryOfJobId ? undefined : collectionJobConfigHash(input);
  if (!input.retryOfJobId) {
    const activeJob = await db.collectionJob.findFirst({
      where: {
        keywordId: input.keywordId,
        platform,
        configHash,
        status: { in: ["QUEUED", "RUNNING"] }
      },
      orderBy: { createdAt: "desc" }
    });
    if (activeJob) {
      await recordCollectionEvent({
        collectionJobId: activeJob.id,
        level: "info",
        message: "collection-queue-deduped",
        data: {
          code: "collection_queue_deduped",
          platform,
          keywordId: input.keywordId,
          activeStatus: activeJob.status,
          configHash
        }
      }, db);
      return activeJob;
    }
  }

  const job = await db.collectionJob.create({
    data: {
      keywordId: input.keywordId,
      platform,
      configHash,
      minFollowers: input.minFollowers ?? 20_000,
      maxFollowers: input.maxFollowers ?? 60_000,
      countries: jsonStringList(input.countries, ["RU", "KZ"]),
      hashtags: jsonStringList(input.hashtags, []),
      requestDelayMs: input.requestDelayMs,
      maxProfiles: input.maxProfiles,
      config: jsonOrUndefined(input.config),
      retryOfJobId: input.retryOfJobId
    }
  });
  await recordCollectionEvent({
    collectionJobId: job.id,
    level: "info",
    message: "collection-queued",
    data: {
      code: "collection_queued",
      platform,
      retryOfJobId: input.retryOfJobId
    }
  }, db);
  if (input.retryOfJobId) {
    await recordCollectionEvent({
      collectionJobId: input.retryOfJobId,
      level: "info",
      message: "collection-retry-requested",
      data: {
        code: "collection_retry_requested",
        requestedFrom: input.retryRequestedFrom ?? "system",
        platform,
        retryJobId: job.id
      }
    }, db);
  }
  return job;
}

export function collectionJobConfigHash(input: QueueCollectionJobInput) {
  const payload = {
    platform: input.platform,
    keywordId: input.keywordId ?? null,
    minFollowers: input.minFollowers ?? 20_000,
    maxFollowers: input.maxFollowers ?? 60_000,
    countries: normalizeStringList(input.countries ?? ["RU", "KZ"]),
    hashtags: normalizeStringList(input.hashtags ?? []),
    requestDelayMs: input.requestDelayMs ?? null,
    maxProfiles: input.maxProfiles ?? null,
    config: input.config ?? null
  };

  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export async function recordCollectionEvent(
  input: {
    collectionJobId?: string;
    collectionRunId?: string;
    level: "debug" | "info" | "warn" | "error";
    message: string;
    data?: unknown;
  },
  db: DbClient = defaultPrisma
) {
  return db.collectionEvent.create({
    data: {
      collectionJobId: input.collectionJobId,
      collectionRunId: input.collectionRunId,
      level: input.level,
      message: sanitizeEventMessage(input.message),
      data: jsonOrUndefined(sanitizeEventData(input.data))
    }
  });
}

export async function saveSocialCandidateProfile(
  row: SocialCandidateRow,
  options: SaveSocialCandidateOptions = {},
  db: DbClient = defaultPrisma
) {
  assertCandidateFollowerRange(row, options);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await saveSocialCandidateProfileOnce(row, options, db);
    } catch (error) {
      if (attempt < 4 && isRetryableSocialProfileRace(error)) continue;
      throw error;
    }
  }
  throw new Error("save-social-profile:retry-exhausted");
}

function assertCandidateFollowerRange(row: SocialCandidateRow, options: SaveSocialCandidateOptions) {
  const minFollowers = options.minFollowers;
  const maxFollowers = options.maxFollowers;
  if (typeof minFollowers !== "number" || typeof maxFollowers !== "number") return;
  if (!Number.isFinite(minFollowers) || !Number.isFinite(maxFollowers)) return;
  if (row.followers >= minFollowers && row.followers <= maxFollowers) return;
  throw new SocialCandidateFollowerRangeError(row.followers, minFollowers, maxFollowers);
}

async function saveSocialCandidateProfileOnce(
  row: SocialCandidateRow,
  options: SaveSocialCandidateOptions = {},
  db: DbClient = defaultPrisma
) {
  const platform = toDbSocialPlatform(row.platform);
  const collectedAt = new Date(row.collectedAt);
  const quality = scoreSocialCandidate(row, options);
  const sanitizedMetrics = jsonOrUndefined(sanitizeEventData(row.metrics));
  const sanitizedLastPosts = jsonOrUndefined(sanitizeEventData(row.lastPosts));
  const sanitizedRaw = jsonOrUndefined(sanitizeEventData(row.raw));
  const sanitizedRawPayload = jsonValue(sanitizeEventData(row.raw));

  return db.$transaction(async (tx) => {
    const existingProfile = await tx.candidateProfile.findUnique({
      where: {
        platform_platformProfileId: {
          platform,
          platformProfileId: row.platformProfileId
        }
      },
      select: { candidateId: true }
    });
    const matchingCandidateId = existingProfile ? null : await findCandidateIdByContactMatch(tx, row.contacts);

    const candidate = existingProfile
      ? await updateCandidateAggregate(tx, existingProfile.candidateId, row, collectedAt)
      : matchingCandidateId
      ? await updateCandidateAggregate(tx, matchingCandidateId, row, collectedAt)
      : await tx.candidate.create({
        data: {
          displayName: row.displayName || row.username,
          topics: jsonStringList(row.sourceKeyword ? [row.sourceKeyword] : [], []),
          countries: jsonStringList(row.geoGuess ? [row.geoGuess] : [], []),
          contacts: jsonOrUndefined(row.contacts),
          firstFoundAt: collectedAt,
          lastFoundAt: collectedAt
        }
      });

    const profile = existingProfile
      ? await tx.candidateProfile.update({
        where: {
          platform_platformProfileId: {
            platform,
            platformProfileId: row.platformProfileId
          }
        },
        data: {
          keywordId: options.keywordId,
          collectionRunId: options.collectionRunId,
          username: row.username,
          displayName: row.displayName,
          profileUrl: row.profileUrl,
          followers: row.followers,
          bio: row.bio,
          externalUrl: row.externalUrl,
          contacts: jsonOrUndefined(row.contacts),
          sourceKeyword: row.sourceKeyword,
          sourceTag: row.sourceTag,
          matchedBy: row.matchedBy,
          geoGuess: row.geoGuess,
          reason: row.reason,
          qualityScore: quality.score,
          qualitySignals: jsonOrUndefined(quality.signals),
          metrics: sanitizedMetrics,
          lastPosts: sanitizedLastPosts,
          raw: sanitizedRaw,
          lastCollectedAt: collectedAt
        }
      })
      : await tx.candidateProfile.create({
        data: {
        candidateId: candidate.id,
        keywordId: options.keywordId,
        collectionRunId: options.collectionRunId,
        platform,
        platformProfileId: row.platformProfileId,
        username: row.username,
        displayName: row.displayName,
        profileUrl: row.profileUrl,
        followers: row.followers,
        bio: row.bio,
        externalUrl: row.externalUrl,
        contacts: jsonOrUndefined(row.contacts),
        sourceKeyword: row.sourceKeyword,
        sourceTag: row.sourceTag,
        matchedBy: row.matchedBy,
        geoGuess: row.geoGuess,
        reason: row.reason,
        qualityScore: quality.score,
        qualitySignals: jsonOrUndefined(quality.signals),
        metrics: sanitizedMetrics,
        lastPosts: sanitizedLastPosts,
        raw: sanitizedRaw,
        firstFoundAt: collectedAt,
        lastCollectedAt: collectedAt
        }
      });

    if (options.collectionRunId) {
      await tx.rawSocialSnapshot.create({
        data: {
          candidateProfileId: profile.id,
          collectionRunId: options.collectionRunId,
          platform,
          kind: "candidate_profile",
          url: row.profileUrl,
          payload: sanitizedRawPayload
        }
      });
    }

    return profile;
  });
}

async function updateCandidateAggregate(
  tx: Prisma.TransactionClient,
  candidateId: string,
  row: SocialCandidateRow,
  collectedAt: Date
) {
  const current = await tx.candidate.findUniqueOrThrow({
    where: { id: candidateId },
    select: { topics: true, countries: true, contacts: true }
  });
  return tx.candidate.update({
    where: { id: candidateId },
    data: {
      displayName: row.displayName || row.username,
      topics: jsonStringList(mergeTextList(stringList(current.topics), row.sourceKeyword ? [row.sourceKeyword] : []), []),
      countries: jsonStringList(mergeTextList(stringList(current.countries), row.geoGuess ? [row.geoGuess] : []), []),
      contacts: jsonOrUndefined(mergeContacts(current.contacts, row.contacts)),
      lastFoundAt: collectedAt
    }
  });
}

async function findCandidateIdByContactMatch(tx: Prisma.TransactionClient, contacts: SocialCandidateRow["contacts"]) {
  const targetKeys = contactMatchKeys(contacts);
  if (!targetKeys.size) return null;

  const recentProfiles = await tx.candidateProfile.findMany({
    where: { contacts: { not: Prisma.JsonNull } },
    select: { candidateId: true, contacts: true },
    orderBy: { lastCollectedAt: "desc" },
    take: 2_000
  });

  for (const profile of recentProfiles) {
    for (const key of contactMatchKeys(profile.contacts)) {
      if (targetKeys.has(key)) return profile.candidateId;
    }
  }
  return null;
}

function mergeTextList(existing: string[], incoming: string[]) {
  return [...new Set([...existing, ...incoming].map((item) => item.trim()).filter(Boolean))];
}

function mergeContacts(existing: unknown, incoming: SocialCandidateRow["contacts"]): SocialCandidateRow["contacts"] {
  const existingContacts = existing && typeof existing === "object"
    ? existing as { emails?: unknown; phones?: unknown; urls?: unknown }
    : {};
  return {
    emails: mergeContactList(stringItems(existingContacts.emails), incoming.emails, (value) => value.toLowerCase()),
    phones: mergeContactList(stringItems(existingContacts.phones), incoming.phones, (value) => value.replace(/\D/g, "")),
    urls: mergeContactList(stringItems(existingContacts.urls), incoming.urls, normalizeContactUrl)
  };
}

function mergeContactList(existing: string[], incoming: string[], keyFn: (value: string) => string | null) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of [...existing, ...incoming]) {
    const trimmed = item.trim();
    const key = keyFn(trimmed);
    if (!trimmed || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function contactMatchKeys(value: unknown) {
  const contacts = value && typeof value === "object" ? value as { emails?: unknown; phones?: unknown; urls?: unknown } : {};
  const keys = new Set<string>();
  for (const email of stringItems(contacts.emails)) keys.add(`email:${email.toLowerCase()}`);
  for (const phone of stringItems(contacts.phones)) {
    const normalized = phone.replace(/\D/g, "");
    if (normalized.length >= 7) keys.add(`phone:${normalized}`);
  }
  for (const url of stringItems(contacts.urls)) {
    const normalized = normalizeContactUrl(url);
    if (normalized) keys.add(`url:${normalized}`);
  }
  return keys;
}

function stringItems(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function normalizeContactUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return value.trim().replace(/\/$/, "").toLowerCase() || null;
  }
}

function isRetryableSocialProfileRace(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "P2002" || code === "P2034";
}

function jsonOrUndefined(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : jsonValue(value);
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normalizeStringList(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
