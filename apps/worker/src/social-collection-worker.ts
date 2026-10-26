import {
  prisma as defaultPrisma,
  recordCollectionEvent,
  saveSocialCandidateProfile,
  socialPlatformAccountKey,
  stringList,
  upsertSocialPlatformAccountStatus
} from "@scaner-blogers/db";
import { isInstagramPreparedAuthSource, normalizeInstagramStoredCredentials, refreshVkOAuthToken, resolveInstagramAuthSource, sanitizeSocialDiagnosticText, type CollectorEventRow } from "@scaner-blogers/core";
import { randomUUID } from "node:crypto";
import { runInstagramCollector, type InstagramCollectorInput, type InstagramCollectorRunResult } from "./instagram-collector.js";
import { runVkCollector, type VkCollectorInput, type VkCollectorRunResult } from "./vk-collector.js";
import { runYouTubeCollector, type YouTubeCollectorInput, type YouTubeCollectorRunResult } from "./youtube-collector.js";

type DbClient = typeof defaultPrisma;
interface CollectorRunControl {
  abortSignal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  onEvent?: (event: CollectorEventRow) => void | Promise<void>;
}
type CancellableSocialCollectionRunner = (input: InstagramCollectorInput, control?: CollectorRunControl) => Promise<InstagramCollectorRunResult>;
type VkCollectionRunner = (input: VkCollectorInput, control?: CollectorRunControl) => Promise<VkCollectorRunResult>;
type YouTubeCollectionRunner = (input: YouTubeCollectorInput, control?: CollectorRunControl) => Promise<YouTubeCollectorRunResult>;
type ClaimedCollectionJob = NonNullable<Awaited<ReturnType<typeof claimNextCollectionJob>>>;
export const DEFAULT_KNOWN_SOCIAL_PROFILE_SKIP_LIMIT = 5_000;

interface SelectedProxy {
  id?: string;
  url: string;
  source: "env" | "settings" | "pool" | "account";
}

interface SelectedInstagramAccount {
  accountKey: string;
  username: string;
  label: string;
  source: "env" | "pool";
  password?: string;
  sessionId?: string;
  sessionSettings?: string;
  sessionFile?: string;
  proxyUrl?: string;
}

interface SelectedCredentialAccount {
  accountKey: string;
  platform: "VK" | "YOUTUBE";
  username: string;
  label: string;
  source: "env" | "pool";
  env: NodeJS.ProcessEnv;
}

interface CollectionJobForInstagramInput {
  minFollowers: number;
  maxFollowers: number;
  maxProfiles?: number | null;
  countries: unknown;
  hashtags: unknown;
  config?: unknown;
  keyword?: { value: string } | null;
}

interface CollectionJobForVkInput {
  minFollowers: number;
  maxFollowers: number;
  maxProfiles?: number | null;
  countries: unknown;
  config?: unknown;
  keyword?: { value: string } | null;
}

interface CollectionJobForYouTubeInput {
  minFollowers: number;
  maxFollowers: number;
  maxProfiles?: number | null;
  countries: unknown;
  config?: unknown;
  keyword?: { value: string } | null;
}

interface SocialAccountCooldownInput {
  status: string;
  blockedUntil?: Date | null;
}

export function buildInstagramCollectorInputFromJob(job: CollectionJobForInstagramInput): InstagramCollectorInput {
  const keyword = job.keyword?.value.trim();
  const config = collectionJobConfigObject(job.config);
  return {
    keywords: keyword ? [keyword] : [],
    hashtags: stringList(job.hashtags),
    countries: stringList(job.countries),
    requireGeoMatch: booleanConfigValue(config, "requireGeoMatch", "require_geo_match"),
    minFollowers: job.minFollowers,
    maxFollowers: job.maxFollowers,
    maxProfiles: job.maxProfiles ?? undefined,
    maxProfileChecks: numberConfigValue(config, "maxProfileChecks", "maxProfileChecksPerRun", "max_profile_checks", "max_profile_checks_per_run"),
    maxTagsPerKeyword: numberConfigValue(config, "maxTagsPerKeyword", "max_tags_per_keyword"),
    maxMediasPerTag: numberConfigValue(config, "maxMediasPerTag", "max_medias_per_tag"),
    recentMediaPerProfile: nonNegativeNumberConfigValue(config, "recentMediaPerProfile", "recent_media_per_profile"),
    profileDelayMinSec: nonNegativeNumberConfigValue(config, "profileDelayMinSec", "profile_delay_min_sec"),
    profileDelayMaxSec: nonNegativeNumberConfigValue(config, "profileDelayMaxSec", "profile_delay_max_sec"),
    mediaDelayMinSec: nonNegativeNumberConfigValue(config, "mediaDelayMinSec", "media_delay_min_sec"),
    mediaDelayMaxSec: nonNegativeNumberConfigValue(config, "mediaDelayMaxSec", "media_delay_max_sec"),
    useHashtagSearch: booleanConfigValue(config, "useHashtagSearch", "use_hashtag_search"),
    useDerivedHashtags: booleanConfigValue(config, "useDerivedHashtags", "use_derived_hashtags"),
    includeKeywordReelsSearch: booleanConfigValue(config, "includeKeywordReelsSearch", "include_keyword_reels_search"),
    includeUserSearch: booleanConfigValue(config, "includeUserSearch", "include_user_search"),
    includeAccountSerpSearch: booleanConfigValue(config, "includeAccountSerpSearch", "include_account_serp_search"),
    includeTypeaheadSearch: booleanConfigValue(config, "includeTypeaheadSearch", "include_typeahead_search"),
    maxUserSearchResultsPerKeyword: numberConfigValue(config, "maxUserSearchResultsPerKeyword", "max_user_search_results_per_keyword"),
    timeoutMs: numberConfigValue(config, "timeoutMs", "timeout_ms")
  };
}

export function buildVkCollectorInputFromJob(job: CollectionJobForVkInput): VkCollectorInput {
  const keyword = job.keyword?.value.trim();
  const config = collectionJobConfigObject(job.config);
  return {
    keywords: keyword ? [keyword] : [],
    countries: stringList(job.countries),
    requireGeoMatch: booleanConfigValue(config, "requireGeoMatch", "require_geo_match"),
    minFollowers: job.minFollowers,
    maxFollowers: job.maxFollowers,
    maxGroups: job.maxProfiles ?? numberConfigValue(config, "maxGroups", "max_groups"),
    maxGroupChecks: numberConfigValue(config, "maxGroupChecks", "max_group_checks"),
    searchCountPerKeyword: numberConfigValue(config, "searchCountPerKeyword", "search_count_per_keyword"),
    wallPostsPerGroup: nonNegativeNumberConfigValue(config, "wallPostsPerGroup", "wall_posts_per_group"),
    requestDelayMinSec: nonNegativeNumberConfigValue(config, "requestDelayMinSec", "request_delay_min_sec"),
    requestDelayMaxSec: nonNegativeNumberConfigValue(config, "requestDelayMaxSec", "request_delay_max_sec"),
    useDerivedQueries: booleanConfigValue(config, "useDerivedQueries", "use_derived_queries"),
    maxSearchQueriesPerKeyword: numberConfigValue(config, "maxSearchQueriesPerKeyword", "max_search_queries_per_keyword"),
    apiVersion: stringConfigValue(config, "apiVersion", "api_version"),
    timeoutMs: numberConfigValue(config, "timeoutMs", "timeout_ms")
  };
}

export function buildYouTubeCollectorInputFromJob(job: CollectionJobForYouTubeInput): YouTubeCollectorInput {
  const keyword = job.keyword?.value.trim();
  const config = collectionJobConfigObject(job.config);
  return {
    keywords: keyword ? [keyword] : [],
    countries: stringList(job.countries),
    requireGeoMatch: booleanConfigValue(config, "requireGeoMatch", "require_geo_match"),
    minFollowers: job.minFollowers,
    maxFollowers: job.maxFollowers,
    maxChannels: job.maxProfiles ?? numberConfigValue(config, "maxChannels", "max_channels"),
    maxChannelChecks: numberConfigValue(config, "maxChannelChecks", "max_channel_checks"),
    searchResultsPerQuery: numberConfigValue(config, "searchResultsPerQuery", "search_results_per_query"),
    recentVideosPerChannel: nonNegativeNumberConfigValue(config, "recentVideosPerChannel", "recent_videos_per_channel"),
    requestDelayMinSec: nonNegativeNumberConfigValue(config, "requestDelayMinSec", "request_delay_min_sec"),
    requestDelayMaxSec: nonNegativeNumberConfigValue(config, "requestDelayMaxSec", "request_delay_max_sec"),
    useDerivedQueries: booleanConfigValue(config, "useDerivedQueries", "use_derived_queries"),
    includeChannelSearch: booleanConfigValue(config, "includeChannelSearch", "include_channel_search"),
    includeShortsSearch: booleanConfigValue(config, "includeShortsSearch", "include_shorts_search"),
    includeVideoSearch: booleanConfigValue(config, "includeVideoSearch", "include_video_search"),
    useWebFallback: booleanConfigValue(config, "useWebFallback", "use_web_fallback"),
    maxSearchQueriesPerKeyword: numberConfigValue(config, "maxSearchQueriesPerKeyword", "max_search_queries_per_keyword"),
    relevanceLanguage: stringConfigValue(config, "relevanceLanguage", "relevance_language"),
    timeoutMs: numberConfigValue(config, "timeoutMs", "timeout_ms")
  };
}

function collectionJobConfigObject(config: unknown) {
  return config && typeof config === "object" && !Array.isArray(config) ? config as Record<string, unknown> : {};
}

export function collectionJobUsesYouTubeWebFallback(config: unknown) {
  const object = collectionJobConfigObject(config);
  return booleanConfigValue(object, "useWebFallback", "use_web_fallback") === true;
}

function booleanConfigValue(config: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function numberConfigValue(config: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return undefined;
}

function nonNegativeNumberConfigValue(config: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

function stringConfigValue(config: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function activeSocialAccountCooldown(account: SocialAccountCooldownInput | null, now = new Date()) {
  if (!account || account.status !== "BLOCKED" || !account.blockedUntil) return null;
  return account.blockedUntil > now ? account.blockedUntil : null;
}

export function activeInstagramAccountRest(account: { metadata?: unknown } | null, now = new Date()) {
  const restUntil = parseMetadataDate(instagramAccountMetadata(account?.metadata).nextAvailableAt);
  return restUntil && restUntil > now ? restUntil : null;
}

export function filterCandidatesByFollowerRange<T extends { followers: number }>(
  candidates: T[],
  minFollowers: number,
  maxFollowers: number
) {
  return candidates.filter((candidate) => candidate.followers >= minFollowers && candidate.followers <= maxFollowers);
}

export async function processNextSocialCollectionJob(
  db: DbClient = defaultPrisma,
  runCollector: CancellableSocialCollectionRunner = runInstagramCollector,
  runVk: VkCollectionRunner = runVkCollector,
  runYouTube: YouTubeCollectionRunner = runYouTubeCollector
) {
  await deferJobsForActiveCooldowns(db);

  const job = await claimNextCollectionJob(db);
  if (!job) return false;

  const run = await db.collectionRun.create({
    data: {
      collectionJobId: job.id,
      platform: job.platform,
      status: "RUNNING"
    }
  });

  let selectedProxy: SelectedProxy | null = null;
  let selectedInstagramAccount: SelectedInstagramAccount | null = null;
  let selectedVkAccount: SelectedCredentialAccount | null = null;
  let selectedYouTubeAccount: SelectedCredentialAccount | null = null;
  const runStartedAt = Date.now();

  try {
    if (job.platform !== "INSTAGRAM" && job.platform !== "VK" && job.platform !== "YOUTUBE") {
      throw new Error(`unsupported-social-platform:${job.platform}`);
    }
    await assertCollectionJobNotCanceled(db, job.id);

    const result = await runCollectorWithCancel(db, job.id, async (control) => job.platform === "INSTAGRAM"
      ? runInstagramJob(db, job, run.id, runCollector, control, (proxy) => {
        selectedProxy = proxy;
      }, (account) => {
        selectedInstagramAccount = account;
      })
      : job.platform === "VK"
      ? runVkJob(db, job, run.id, runVk, control, (account) => {
        selectedVkAccount = account;
      })
      : runYouTubeJob(db, job, run.id, runYouTube, control, (account) => {
        selectedYouTubeAccount = account;
      }));
    await assertCollectionJobNotCanceled(db, job.id);

    await recordCollectionEvent({
      collectionJobId: job.id,
      collectionRunId: run.id,
      level: "info",
      message: "social_collector_result_received",
      data: {
        code: "social_collector_result_received",
        platform: job.platform,
        durationMs: Date.now() - runStartedAt,
        candidatesReceived: result.candidates.length,
        collectorEventsReceived: result.events.length,
        exitCode: result.exitCode
      }
    }, db);

    for (const event of "eventsPersistedLive" in result && result.eventsPersistedLive ? [] : result.events) {
      await recordCollectionEvent({
        collectionJobId: job.id,
        collectionRunId: run.id,
        level: event.event.level,
        message: event.event.message,
        data: { code: event.event.code, ...event.event.data }
      }, db);
    }
    await recordCollectionSearchHistory(db, job, run.id, result.events);

    const candidatesInFollowerRange = filterCandidatesByFollowerRange(result.candidates, job.minFollowers, job.maxFollowers);
    const savedProfileIds = new Set<string>();
    const savedCandidateIds = new Set<string>();
    const uniqueInputProfileIds = new Set(result.candidates.map((candidate) => `${candidate.platform}:${candidate.platformProfileId}`));
    const uniqueEligibleProfileIds = new Set(candidatesInFollowerRange.map((candidate) => `${candidate.platform}:${candidate.platformProfileId}`));
    for (const candidate of candidatesInFollowerRange) {
      const saved = await saveSocialCandidateProfile(candidate, {
        keywordId: job.keywordId ?? undefined,
        collectionRunId: run.id,
        minFollowers: job.minFollowers,
        maxFollowers: job.maxFollowers
      }, db);
      savedProfileIds.add(saved.id);
      savedCandidateIds.add(saved.candidateId);
    }

    const profilesChecked = collectorProfilesChecked(result, finishEventCodeForPlatform(job.platform))
      ?? result.candidates.length;
    const durationMs = Date.now() - runStartedAt;

    await recordCollectionEvent({
      collectionJobId: job.id,
      collectionRunId: run.id,
      level: "info",
      message: "social_candidates_saved",
      data: {
        code: "social_candidates_saved",
        platform: job.platform,
        candidatesReceived: result.candidates.length,
        candidatesInFollowerRange: candidatesInFollowerRange.length,
        filteredOutByFollowerRange: result.candidates.length - candidatesInFollowerRange.length,
        uniqueInputProfiles: uniqueInputProfileIds.size,
        uniqueEligibleProfiles: uniqueEligibleProfileIds.size,
        duplicateRowsInCollectorOutput: result.candidates.length - uniqueInputProfileIds.size,
        savedProfiles: savedProfileIds.size,
        affectedCandidates: savedCandidateIds.size,
        profilesChecked,
        durationMs
      }
    }, db);

    await db.collectionRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        candidatesFound: candidatesInFollowerRange.length,
        profilesChecked
      }
    });

    await db.collectionJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        candidatesFound: candidatesInFollowerRange.length,
        profilesChecked
      }
    });

    await recordCollectionEvent({
      collectionJobId: job.id,
      collectionRunId: run.id,
      level: "info",
      message: "social_collection_completed",
      data: {
        code: "social_collection_completed",
        platform: job.platform,
        status: "SUCCESS",
        candidatesFound: candidatesInFollowerRange.length,
        candidatesReceived: result.candidates.length,
        filteredOutByFollowerRange: result.candidates.length - candidatesInFollowerRange.length,
        profilesChecked,
        durationMs
      }
    }, db);

    if (job.platform === "INSTAGRAM") {
      await recordInstagramAccountStatus(db, {
        status: "OK",
        metadata: {
          jobId: job.id,
          runId: run.id,
          candidatesFound: candidatesInFollowerRange.length,
          sessionSettings: "sessionSettings" in result ? result.sessionSettings : undefined
        }
      }, selectedInstagramAccount);
    } else if (job.platform === "VK") {
      await recordVkAccountStatus(db, {
        status: "OK",
        metadata: { jobId: job.id, runId: run.id, candidatesFound: candidatesInFollowerRange.length }
      }, selectedVkAccount);
    } else {
      await recordYouTubeAccountStatus(db, {
        status: "OK",
        metadata: {
          jobId: job.id,
          runId: run.id,
          candidatesFound: candidatesInFollowerRange.length,
          source: collectionJobUsesYouTubeWebFallback(job.config) ? "web-fallback" : "api-key"
        }
      }, selectedYouTubeAccount);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const safeMessage = sanitizeSocialDiagnosticText(message);
    const canceled = message === "collection-canceled";
    const noInstagramAccount = job.platform === "INSTAGRAM" && /instagram-collector:no_available_instagram_account/i.test(message);
    const blocked = isSocialCollectorBlockedError(message);
    if (noInstagramAccount) {
      const retryAt = new Date(Date.now() + readInstagramNoAccountRetryDelayMs());
      await recordCollectionEvent({
        collectionJobId: job.id,
        collectionRunId: run.id,
        level: "warn",
        message: "instagram_no_available_account",
        data: {
          code: "instagram_no_available_account",
          platform: job.platform,
          retryAt: retryAt.toISOString(),
          durationMs: Date.now() - runStartedAt
        }
      }, db);
      await db.collectionRun.update({
        where: { id: run.id },
        data: {
          status: "CANCELED",
          finishedAt: new Date(),
          errorMessage: safeMessage
        }
      });
      await db.collectionJob.update({
        where: { id: job.id },
        data: {
          status: "QUEUED",
          scheduledFor: retryAt,
          startedAt: null,
          finishedAt: null,
          errorMessage: safeMessage,
          blockedReason: null
        }
      });
      return true;
    }
    const status = canceled ? "CANCELED" : blocked ? "BLOCKED" : "FAILED";
    const accountStatus = instagramAccountStatusFromError(message, blocked);
    const durationMs = Date.now() - runStartedAt;
    const errorClass = canceled
      ? "social_collector_canceled"
      : blocked
      ? "social_collector_blocked"
      : "social_collector_failed";
    const proxyForDiagnostics = selectedProxy as SelectedProxy | null;
    await recordCollectionEvent({
      collectionJobId: job.id,
      collectionRunId: run.id,
      level: "error",
      message: safeMessage,
        data: {
          code: errorClass,
          platform: job.platform,
          status,
          blocked,
          canceled,
          reasonCode: canceled ? "SOCIAL_COLLECTOR_CANCELED" : blocked ? "SOCIAL_COLLECTOR_BLOCKED" : "SOCIAL_COLLECTOR_FAILED",
          errorClass,
          durationMs,
          proxySource: proxyForDiagnostics?.source ?? undefined,
          proxyId: proxyForDiagnostics?.id ?? undefined
        }
      }, db);
    await db.collectionRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        errorMessage: safeMessage,
        blockedReason: blocked ? safeMessage : undefined
      }
    });
    await db.collectionJob.update({
      where: { id: job.id },
      data: {
        status,
        finishedAt: new Date(),
        errorMessage: safeMessage,
        blockedReason: blocked ? safeMessage : undefined
      }
    });
    if (canceled && job.platform === "INSTAGRAM") {
      await recordInstagramAccountStatus(db, {
        status: "OK",
        metadata: { jobId: job.id, runId: run.id, canceled: true }
      }, selectedInstagramAccount);
    } else if (canceled && job.platform === "VK") {
      await recordVkAccountStatus(db, {
        status: "OK",
        metadata: { jobId: job.id, runId: run.id, canceled: true }
      }, selectedVkAccount);
    } else if (canceled && job.platform === "YOUTUBE") {
      await recordYouTubeAccountStatus(db, {
        status: "OK",
        metadata: { jobId: job.id, runId: run.id, canceled: true }
      }, selectedYouTubeAccount);
    } else if (job.platform === "INSTAGRAM") {
      await recordInstagramAccountStatus(db, {
        status: accountStatus,
        lastError: safeMessage,
        blockedUntil: accountStatus === "BLOCKED" ? instagramBlockedUntil(message) : null,
        metadata: { jobId: job.id, runId: run.id, blocked }
      }, selectedInstagramAccount);
      await markInstagramProxyIssue(db, selectedProxy, message, safeMessage, blocked);
    } else if (job.platform === "VK") {
      await recordVkAccountStatus(db, {
        status: /missing_token|vk_missing_token/i.test(message)
          ? "MISSING_CREDENTIALS"
          : blocked
          ? "BLOCKED"
          : "FAILED",
        lastError: safeMessage,
        blockedUntil: blocked ? socialBlockedUntil(message) : null,
        metadata: { jobId: job.id, runId: run.id }
      }, selectedVkAccount);
    } else if (job.platform === "YOUTUBE") {
      await recordYouTubeAccountStatus(db, {
        status: /missing_api_key|youtube_missing_api_key|api_key_rejected/i.test(message)
          ? "MISSING_CREDENTIALS"
          : blocked
          ? "BLOCKED"
          : "FAILED",
        lastError: safeMessage,
        blockedUntil: blocked ? socialBlockedUntil(message) : null,
        metadata: { jobId: job.id, runId: run.id }
      }, selectedYouTubeAccount);
    }
  }

  return true;
}

async function runInstagramJob(
  db: DbClient,
  job: ClaimedCollectionJob,
  runId: string,
  runCollector: CancellableSocialCollectionRunner,
  control: CollectorRunControl,
  onProxySelected: (proxy: SelectedProxy | null) => void,
  onAccountSelected: (account: SelectedInstagramAccount | null) => void
) {
  const baseInput = buildInstagramCollectorInputFromJob(job);
  baseInput.excludedProfileIds = await knownSocialProfileIds(db, "INSTAGRAM");
  if (!baseInput.keywords?.length && !baseInput.hashtags?.length) {
    throw new Error("instagram-collector:empty-input");
  }
  const maxAttempts = readInstagramAccountFailoverAttempts();
  let lastFailoverError: unknown = null;
  const attemptedAccountKeys = new Set<string>();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const selectedAccount = await claimInstagramAccount(db, attemptedAccountKeys);
    if (!selectedAccount) {
      if (lastFailoverError) throw lastFailoverError;
      onAccountSelected(null);
      throw new Error("instagram-collector:no_available_instagram_account");
    }
    attemptedAccountKeys.add(selectedAccount.accountKey);
    onAccountSelected(selectedAccount);

    const input = { ...baseInput };
    input.username = selectedAccount.username;
    input.password = selectedAccount.password;
    input.sessionId = selectedAccount.sessionId;
    input.sessionSettings = selectedAccount.sessionSettings;
    input.sessionFile = selectedAccount.sessionFile;
    await recordCollectorStartEvent(db, job, runId, "instagram", {
      keywords: input.keywords,
      hashtags: input.hashtags,
      countries: input.countries,
      minFollowers: input.minFollowers,
      maxFollowers: input.maxFollowers,
      maxProfiles: input.maxProfiles,
      maxProfileChecks: input.maxProfileChecks,
      excludedProfileIds: input.excludedProfileIds?.length ?? 0,
      useHashtagSearch: input.useHashtagSearch,
      includeKeywordReelsSearch: input.includeKeywordReelsSearch,
      includeUserSearch: input.includeUserSearch,
      includeAccountSerpSearch: input.includeAccountSerpSearch,
      includeTypeaheadSearch: input.includeTypeaheadSearch,
      accountSource: selectedAccount.source,
      accountKey: selectedAccount.accountKey,
      accountAttempt: attempt
    });
    const selectedProxy = await selectInstagramProxy(db, selectedAccount.proxyUrl);
    onProxySelected(selectedProxy);
    if (selectedProxy) {
      input.proxyUrl = selectedProxy.url;
      await recordCollectionEvent({
        collectionJobId: job.id,
        collectionRunId: runId,
        level: "info",
        message: `instagram_proxy_selected:${selectedProxy.source}`,
        data: { proxyId: selectedProxy.id, source: selectedProxy.source, accountAttempt: attempt }
      }, db);
    }

    await recordInstagramAccountStatus(db, {
      status: "RUNNING",
      metadata: { jobId: job.id, runId, proxySource: selectedProxy?.source ?? "none", accountAttempt: attempt }
    }, selectedAccount);

    try {
      const streamEvents = runCollector === runInstagramCollector;
      const result = await runCollector(input, streamEvents ? {
        ...control,
        onEvent: async (event) => {
          await recordCollectionEvent({
          collectionJobId: job.id,
          collectionRunId: runId,
          level: event.event.level,
          message: event.event.message,
          data: { code: event.event.code, ...event.event.data }
          }, db);
        }
      } : control);
      return streamEvents ? { ...result, eventsPersistedLive: true } : result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "collection-canceled" || !isInstagramAccountFailoverError(message)) throw error;

      lastFailoverError = error;
      const blocked = isSocialCollectorBlockedError(message);
      const accountStatus = instagramAccountStatusFromError(message, blocked);
      const safeMessage = sanitizeSocialDiagnosticText(message);
      await recordInstagramAccountStatus(db, {
        status: accountStatus,
        lastError: safeMessage,
        blockedUntil: accountStatus === "BLOCKED" ? instagramBlockedUntil(message) : null,
        metadata: { jobId: job.id, runId, blocked, failover: attempt < maxAttempts, accountAttempt: attempt }
      }, selectedAccount);
      await markInstagramProxyIssue(db, selectedProxy, message, safeMessage, blocked);
      await recordCollectionEvent({
        collectionJobId: job.id,
        collectionRunId: runId,
        level: attempt < maxAttempts ? "warn" : "error",
        message: "instagram_account_failover",
        data: {
          code: "instagram_account_failover",
          accountKey: selectedAccount.accountKey,
          accountSource: selectedAccount.source,
          accountAttempt: attempt,
          maxAttempts,
          nextAccount: attempt < maxAttempts,
          status: accountStatus,
          blocked
        }
      }, db);
      if (attempt >= maxAttempts) throw error;
    }
  }

  if (lastFailoverError) throw lastFailoverError;
  throw new Error("instagram-collector:no_available_instagram_account");
}

async function runVkJob(
  db: DbClient,
  job: ClaimedCollectionJob,
  runId: string,
  runVk: VkCollectionRunner,
  control: CollectorRunControl,
  onAccountSelected: (account: SelectedCredentialAccount | null) => void
) {
  const input = buildVkCollectorInputFromJob(job);
  input.excludedProfileIds = await knownSocialProfileIds(db, "VK");
  if (!input.keywords?.length) throw new Error("vk-collector:empty-input");
  const selectedAccount = await claimCredentialAccount(db, "VK");
  onAccountSelected(selectedAccount);
  await recordCollectorStartEvent(db, job, runId, "vk", {
    keywords: input.keywords,
    countries: input.countries,
    minFollowers: input.minFollowers,
    maxFollowers: input.maxFollowers,
    maxGroups: input.maxGroups,
    maxGroupChecks: input.maxGroupChecks,
    searchCountPerKeyword: input.searchCountPerKeyword,
    wallPostsPerGroup: input.wallPostsPerGroup,
    excludedProfileIds: input.excludedProfileIds?.length ?? 0,
    useDerivedQueries: input.useDerivedQueries,
    accountSource: selectedAccount?.source ?? "collector-env",
    accountKey: selectedAccount?.accountKey
  });
  await recordVkAccountStatus(db, {
    status: "RUNNING",
    metadata: { jobId: job.id, runId }
  }, selectedAccount);

  try {
    return await runVk(input, { ...control, env: selectedAccount?.env });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!selectedAccount || selectedAccount.source !== "pool" || !/another ip address/i.test(message)) {
      throw error;
    }

    const stored = await db.socialPlatformAccount.findUnique({
      where: { accountKey: selectedAccount.accountKey },
      select: { metadata: true }
    });
    const refreshed = stored
      ? await refreshStoredVkAccount(db, selectedAccount.accountKey, jsonRecord(stored.metadata), new Date())
      : null;
    const refreshedEnv = refreshed ? envForVkCredential(refreshed) : null;
    if (!refreshedEnv) throw error;

    selectedAccount.env = refreshedEnv;
    await recordCollectionEvent({
      collectionJobId: job.id,
      collectionRunId: runId,
      level: "info",
      message: "vk-token-refreshed-after-ip-change",
      data: {
        code: "vk_token_refreshed_after_ip_change",
        accountKey: selectedAccount.accountKey
      }
    }, db);
    return runVk(input, { ...control, env: refreshedEnv });
  }
}

async function runYouTubeJob(
  db: DbClient,
  job: ClaimedCollectionJob,
  runId: string,
  runYouTube: YouTubeCollectionRunner,
  control: CollectorRunControl,
  onAccountSelected: (account: SelectedCredentialAccount | null) => void
) {
  const input = buildYouTubeCollectorInputFromJob(job);
  input.excludedProfileIds = await knownSocialProfileIds(db, "YOUTUBE");
  if (!input.keywords?.length) throw new Error("youtube-collector:empty-input");
  const selectedAccount = input.useWebFallback ? null : await claimCredentialAccount(db, "YOUTUBE");
  onAccountSelected(selectedAccount);
  await recordCollectorStartEvent(db, job, runId, "youtube", {
    keywords: input.keywords,
    countries: input.countries,
    minFollowers: input.minFollowers,
    maxFollowers: input.maxFollowers,
    maxChannels: input.maxChannels,
    maxChannelChecks: input.maxChannelChecks,
    searchResultsPerQuery: input.searchResultsPerQuery,
    recentVideosPerChannel: input.recentVideosPerChannel,
    excludedProfileIds: input.excludedProfileIds?.length ?? 0,
    includeChannelSearch: input.includeChannelSearch,
    includeShortsSearch: input.includeShortsSearch,
    includeVideoSearch: input.includeVideoSearch,
    useWebFallback: input.useWebFallback,
    useDerivedQueries: input.useDerivedQueries,
    accountSource: selectedAccount?.source ?? (input.useWebFallback ? "web-fallback" : "collector-env"),
    accountKey: selectedAccount?.accountKey
  });
  if (!input.useWebFallback) {
    await recordYouTubeAccountStatus(db, {
      status: "RUNNING",
      metadata: { jobId: job.id, runId }
    }, selectedAccount);
  }
  return runYouTube(input, { ...control, env: selectedAccount?.env });
}

async function runCollectorWithCancel<T>(
  db: DbClient,
  jobId: string,
  run: (control: CollectorRunControl) => Promise<T>
) {
  const abortController = new AbortController();
  let cancellationSeen = false;
  const pollMs = readSocialCancelPollMs();
  const poll = setInterval(() => {
    void db.collectionJob.findUnique({
      where: { id: jobId },
      select: { cancelRequested: true }
    }).then((job) => {
      if (job?.cancelRequested) {
        cancellationSeen = true;
        abortController.abort();
      }
    }).catch(() => {
      // The collector result path will record the real failure if the database is unavailable.
    });
  }, pollMs);

  try {
    return await run({ abortSignal: abortController.signal });
  } catch (error) {
    if (cancellationSeen || await collectionJobCancelRequested(db, jobId)) {
      throw new Error("collection-canceled");
    }
    throw error;
  } finally {
    clearInterval(poll);
  }
}

async function recordCollectorStartEvent(
  db: DbClient,
  job: ClaimedCollectionJob,
  runId: string,
  collector: "instagram" | "vk" | "youtube",
  inputSummary: Record<string, unknown>
) {
  await recordCollectionEvent({
    collectionJobId: job.id,
    collectionRunId: runId,
    level: "info",
    message: "social_collector_started",
    data: {
      code: "social_collector_started",
      platform: job.platform,
      collector,
      keywordId: job.keywordId,
      keyword: job.keyword?.value,
      job: {
        minFollowers: job.minFollowers,
        maxFollowers: job.maxFollowers,
        maxProfiles: job.maxProfiles,
        countries: stringList(job.countries),
        hashtags: stringList(job.hashtags),
        configHash: job.configHash
      },
      input: inputSummary
    }
  }, db);
}

export function instagramProfilesChecked(result: InstagramCollectorRunResult) {
  return collectorProfilesChecked(result, "instagram_collector_finished");
}

export function vkProfilesChecked(result: VkCollectorRunResult) {
  return collectorProfilesChecked(result, "vk_collector_finished");
}

export function youtubeProfilesChecked(result: YouTubeCollectorRunResult) {
  return collectorProfilesChecked(result, "youtube_collector_finished");
}

function finishEventCodeForPlatform(platform: "INSTAGRAM" | "VK" | "YOUTUBE") {
  if (platform === "INSTAGRAM") return "instagram_collector_finished";
  if (platform === "VK") return "vk_collector_finished";
  return "youtube_collector_finished";
}

function collectorProfilesChecked(result: { events: { event: { code: string; data?: Record<string, unknown> } }[] }, eventCode: string) {
  const finished = [...result.events].reverse().find((row) => row.event.code === eventCode);
  const value = finished?.event.data?.profileChecks;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

async function recordCollectionSearchHistory(
  db: DbClient,
  job: ClaimedCollectionJob,
  runId: string,
  events: { event: { code: string; level: string; message: string; data?: Record<string, unknown> }; collectedAt?: string }[]
) {
  for (const event of events) {
    const row = collectionSearchHistoryRow(job.platform, event);
    if (!row) continue;
    const searchedAt = event.collectedAt ? new Date(event.collectedAt) : new Date();
    const lastError = row.lastError ? sanitizeSocialDiagnosticText(row.lastError) : row.lastError;
    await db.collectionSearchHistory.upsert({
      where: {
        platform_query_queryType_regionCode: {
          platform: job.platform,
          query: row.query,
          queryType: row.queryType,
          regionCode: row.regionCode
        }
      },
      create: {
        keywordId: job.keywordId,
        collectionJobId: job.id,
        collectionRunId: runId,
        platform: job.platform,
        query: row.query,
        queryType: row.queryType,
        regionCode: row.regionCode,
        searches: 1,
        lastItemsFound: row.itemsFound,
        lastProfilesChecked: row.profilesChecked,
        lastError,
        firstSearchedAt: searchedAt,
        lastSearchedAt: searchedAt
      },
      update: {
        keywordId: job.keywordId,
        collectionJobId: job.id,
        collectionRunId: runId,
        searches: { increment: 1 },
        lastItemsFound: row.itemsFound,
        lastProfilesChecked: row.profilesChecked,
        lastError,
        lastSearchedAt: searchedAt
      }
    });
  }
}

function collectionSearchHistoryRow(platform: "INSTAGRAM" | "VK" | "YOUTUBE", event: { event: { code: string; level: string; message: string; data?: Record<string, unknown> } }) {
  const data = event.event.data ?? {};
  if (platform === "YOUTUBE" && event.event.code === "youtube_search_finished") {
    const query = stringData(data.query);
    if (!query) return null;
    const resultType = stringData(data.type) || "unknown";
    const videoDuration = stringData(data.videoDuration) || "any";
    return {
      query,
      queryType: `${resultType}:${videoDuration}`,
      regionCode: stringData(data.regionCode) || "GLOBAL",
      itemsFound: numberData(data.itemsFound),
      profilesChecked: undefined,
      lastError: event.event.level === "error" ? event.event.message : undefined
    };
  }
  if (platform === "VK" && event.event.code === "vk_groups_search_finished") {
    const query = stringData(data.keyword);
    if (!query) return null;
    return {
      query,
      queryType: "groups.search",
      regionCode: "GLOBAL",
      itemsFound: numberData(data.groupsFound),
      profilesChecked: undefined,
      lastError: event.event.level === "error" ? event.event.message : undefined
    };
  }
  if (platform === "INSTAGRAM" && event.event.code === "tag_scan_finished") {
    const tag = stringData(data.tag);
    if (!tag) return null;
    return {
      query: tag,
      queryType: "hashtag",
      regionCode: "GLOBAL",
      itemsFound: numberData(data.mediaFetched),
      profilesChecked: numberData(data.profilesChecked),
      lastError: undefined
    };
  }
  if (platform === "INSTAGRAM" && event.event.code === "keyword_reels_finished") {
    const query = stringData(data.query);
    if (!query) return null;
    return {
      query,
      queryType: "keyword_reels",
      regionCode: "GLOBAL",
      itemsFound: numberData(data.mediaFetched),
      profilesChecked: numberData(data.profilesChecked),
      lastError: undefined
    };
  }
  if (platform === "INSTAGRAM" && event.event.code === "user_search_finished") {
    const query = stringData(data.keyword);
    if (!query) return null;
    return {
      query,
      queryType: stringData(data.layer) || "user_search",
      regionCode: "GLOBAL",
      itemsFound: undefined,
      profilesChecked: numberData(data.profilesChecked),
      lastError: undefined
    };
  }
  return null;
}

function stringData(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberData(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}

export async function claimNextCollectionJob(db: DbClient) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const runningByPlatform = await tx.collectionJob.groupBy({
          by: ["platform"],
          where: { status: "RUNNING" },
          _count: { _all: true }
        });
        const runningCounts = new Map(runningByPlatform.map((row) => [row.platform, row._count._all]));
        const now = new Date();
        const queuedJobs = await tx.collectionJob.findMany({
          where: {
            status: "QUEUED"
          },
          select: { id: true, platform: true, scheduledFor: true },
          orderBy: { createdAt: "asc" },
          take: 50
        });
        const queued = queuedJobs.find((job) =>
          job.scheduledFor <= now &&
          (runningCounts.get(job.platform) ?? 0) < socialPlatformConcurrencyLimit(job.platform)
        );

        if (!queued) return null;

        const claimed = await tx.collectionJob.updateMany({
          where: { id: queued.id, status: "QUEUED" },
          data: { status: "RUNNING", startedAt: new Date() }
        });

        if (claimed.count !== 1) return null;

        return tx.collectionJob.findUnique({
          where: { id: queued.id },
          include: { keyword: true }
        });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (attempt < 4 && isRetryableCollectionClaimConflict(error)) continue;
      throw error;
    }
  }
  return null;
}

export function socialPlatformConcurrencyLimit(platform: "INSTAGRAM" | "VK" | "YOUTUBE") {
  const envKey = `SOCIAL_PLATFORM_CONCURRENCY_${platform}`;
  const value = Number(process.env[envKey]);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(10, Math.max(1, Math.round(value)));
}

function isRetryableCollectionClaimConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

function isRetryableUniqueClaimConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function selectInstagramAccount(db: DbClient, excludeAccountKeys = new Set<string>()): Promise<SelectedInstagramAccount | null> {
  const now = new Date();
  const envAccountKey = instagramAccountKey();
  const accounts = await db.socialPlatformAccount.findMany({
    where: { platform: "INSTAGRAM" },
    orderBy: [
      { lastSuccessAt: "asc" },
      { updatedAt: "asc" }
    ],
    select: {
      accountKey: true,
      label: true,
      username: true,
      status: true,
      blockedUntil: true,
      metadata: true
    }
  });

  for (const account of accounts) {
    if (excludeAccountKeys.has(account.accountKey)) continue;
    const metadata = instagramAccountMetadata(account.metadata);
    if (account.accountKey === envAccountKey && !metadata.password && !metadata.sessionId && !metadata.sessionSettings && !metadata.sessionFile) continue;
    if (metadata.enabled === false) continue;
    if (account.status === "RUNNING") continue;
    if (account.status === "MISSING_CREDENTIALS") continue;
    if (activeSocialAccountCooldown(account, now)) continue;
    if (activeInstagramAccountRest(account, now)) continue;
    const username = stringMetadataValue(metadata.username) ?? account.username ?? "";
    const auth = resolveInstagramAuthSource(metadata);
    if (!username || !isInstagramPreparedAuthSource(auth.authSource)) continue;
    return {
      accountKey: account.accountKey,
      username,
      password: auth.metadata.password,
      sessionId: auth.metadata.sessionId,
      sessionSettings: auth.metadata.sessionSettings,
      label: account.label ?? username,
      source: "pool",
      sessionFile: auth.metadata.sessionFile,
      proxyUrl: stringMetadataValue(metadata.proxyUrl)
    };
  }

  const envUsername = process.env.INSTAGRAM_USERNAME || "";
  const envPassword = process.env.INSTAGRAM_PASSWORD || "";
  const envSessionId = process.env.INSTAGRAM_SESSIONID || "";
  const envSessionSettings = process.env.INSTAGRAM_SESSION_SETTINGS
    || decodeBase64Env(process.env.INSTAGRAM_SESSION_SETTINGS_B64);
  const envSessionFile = process.env.INSTAGRAM_SESSION_FILE || "";
  const envAuth = resolveInstagramAuthSource({
    username: envUsername,
    password: envPassword,
    sessionId: envSessionId,
    sessionSettings: envSessionSettings,
    sessionFile: envSessionFile
  });
  if (!envUsername || !isInstagramPreparedAuthSource(envAuth.authSource)) return null;
  if (excludeAccountKeys.has(envAccountKey)) return null;
  const envAccount = accounts.find((account) => account.accountKey === envAccountKey);
  if (envAccount?.status === "RUNNING") return null;
  if (envAccount?.status === "MISSING_CREDENTIALS") return null;
  if (activeSocialAccountCooldown(envAccount ?? null, now)) return null;
  if (activeInstagramAccountRest(envAccount ?? null, now)) return null;
  return {
    accountKey: envAccountKey,
    username: envUsername,
    password: envAuth.metadata.password,
    sessionId: envAuth.metadata.sessionId,
    sessionSettings: envAuth.metadata.sessionSettings,
    label: "Instagram env account",
    source: "env",
    sessionFile: envAuth.metadata.sessionFile,
    proxyUrl: process.env.INSTAGRAM_PROXY_URL || undefined
  };
}

export async function claimInstagramAccount(db: DbClient, excludeAccountKeys = new Set<string>()): Promise<SelectedInstagramAccount | null> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const selected = await selectInstagramAccount(db, excludeAccountKeys);
    if (!selected) return null;

    if (selected.source === "pool") {
      const claimed = await db.socialPlatformAccount.updateMany({
        where: instagramAccountClaimWhere(selected.accountKey),
        data: {
          status: "RUNNING",
          lastError: null,
          lastErrorAt: null
        }
      });
      if (claimed.count === 1) return selected;
      continue;
    }

    if (await claimEnvInstagramAccount(db, selected)) return selected;
  }
  return null;
}

function instagramAccountClaimWhere(accountKey: string) {
  return {
    accountKey,
    platform: "INSTAGRAM" as const,
    status: { not: "RUNNING" },
    OR: [
      { blockedUntil: null },
      { blockedUntil: { lte: new Date() } }
    ]
  };
}

async function claimEnvInstagramAccount(db: DbClient, account: SelectedInstagramAccount) {
  const normalizedAccount = normalizeInstagramStoredCredentials({
    username: account.username,
    password: account.password,
    sessionId: account.sessionId,
    sessionSettings: account.sessionSettings,
    sessionFile: account.sessionFile
  });
  const claimed = await db.socialPlatformAccount.updateMany({
    where: instagramAccountClaimWhere(account.accountKey),
    data: {
      status: "RUNNING",
      username: account.username,
      label: account.label,
      lastError: null,
      lastErrorAt: null,
      metadata: compactRecord({
        ...normalizedAccount.metadata,
        authSource: normalizedAccount.authSource,
        proxyUrl: account.proxyUrl
      }) as never
    }
  });
  if (claimed.count === 1) return true;

  const existing = await db.socialPlatformAccount.findUnique({
    where: { accountKey: account.accountKey },
    select: { status: true, blockedUntil: true }
  });
  if (existing) return false;

  try {
    await db.socialPlatformAccount.create({
      data: {
        platform: "INSTAGRAM",
        accountKey: account.accountKey,
        username: account.username,
        label: account.label,
        status: "RUNNING",
        lastError: null,
        blockedUntil: null,
        metadata: compactRecord({
          ...normalizedAccount.metadata,
          authSource: normalizedAccount.authSource,
          proxyUrl: account.proxyUrl
        }) as never
      }
    });
    return true;
  } catch (error) {
    if (isRetryableUniqueClaimConflict(error)) return false;
    throw error;
  }
}

async function nextInstagramBlockedUntil(db: DbClient) {
  const accounts = await db.socialPlatformAccount.findMany({
    where: { platform: "INSTAGRAM", status: "BLOCKED", blockedUntil: { gt: new Date() } },
    orderBy: { blockedUntil: "asc" },
    select: { blockedUntil: true }
  });
  return accounts[0]?.blockedUntil ?? null;
}

export async function selectCredentialAccount(
  db: DbClient,
  platform: "VK" | "YOUTUBE"
): Promise<SelectedCredentialAccount | null> {
  const now = new Date();
  const accounts = await db.socialPlatformAccount.findMany({
    where: { platform },
    orderBy: [
      { lastSuccessAt: "asc" },
      { updatedAt: "asc" }
    ],
    select: {
      accountKey: true,
      label: true,
      username: true,
      status: true,
      blockedUntil: true,
      metadata: true
    }
  });

  for (const account of accounts) {
    let metadata = jsonRecord(account.metadata);
    if (metadata.enabled === false) continue;
    if (account.status === "RUNNING") continue;
    if (activeSocialAccountCooldown(account, now)) continue;
    if (platform === "VK" && !freshVkAccountToken(metadata, now)) {
      const refreshed = await refreshStoredVkAccount(db, account.accountKey, metadata, now);
      if (!refreshed) continue;
      metadata = refreshed;
    }
    const env = platform === "VK"
      ? envForVkCredential(metadata)
      : envForYouTubeCredential(metadata);
    if (!env) continue;
    return {
      accountKey: account.accountKey,
      platform,
      username: account.username ?? "",
      label: account.label ?? platform,
      source: "pool",
      env
    };
  }

  const envAccount = selectedEnvCredentialAccount(accounts, platform, now);
  return envAccount;
}

async function claimCredentialAccount(
  db: DbClient,
  platform: "VK" | "YOUTUBE"
): Promise<SelectedCredentialAccount | null> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const selected = await selectCredentialAccount(db, platform);
    if (!selected) return null;
    const claimed = await db.socialPlatformAccount.updateMany({
      where: credentialAccountClaimWhere(selected.accountKey, platform),
      data: {
        status: "RUNNING",
        lastError: null,
        lastErrorAt: null,
        ...(selected.source === "env" ? {
          username: selected.username,
          label: selected.label,
          metadata: envCredentialMetadata(selected) as never
        } : {})
      }
    });
    if (claimed.count === 1) return selected;

    const existing = await db.socialPlatformAccount.findUnique({
      where: { accountKey: selected.accountKey },
      select: { id: true }
    });
    if (existing) continue;

    try {
      await db.socialPlatformAccount.create({
        data: {
          platform,
          accountKey: selected.accountKey,
          username: selected.username,
          label: selected.label,
          status: "RUNNING",
          lastError: null,
          blockedUntil: null,
          metadata: envCredentialMetadata(selected) as never
        }
      });
      return selected;
    } catch (error) {
      if (isRetryableUniqueClaimConflict(error)) continue;
      throw error;
    }
  }
  return null;
}

function credentialAccountClaimWhere(accountKey: string, platform: "VK" | "YOUTUBE") {
  return {
    accountKey,
    platform,
    status: { not: "RUNNING" },
    OR: [
      { blockedUntil: null },
      { blockedUntil: { lte: new Date() } }
    ]
  };
}

function selectedEnvCredentialAccount(
  accounts: Array<{ accountKey: string; status: string; blockedUntil: Date | null }>,
  platform: "VK" | "YOUTUBE",
  now: Date
): SelectedCredentialAccount | null {
  const accountKey = platform === "VK"
    ? socialPlatformAccountKey("vk", "api-token")
    : socialPlatformAccountKey("youtube", "api-key");
  const account = accounts.find((item) => item.accountKey === accountKey);
  if (account?.status === "RUNNING") return null;
  if (activeSocialAccountCooldown(account ?? null, now)) return null;

  if (platform === "VK") {
    const env = envForVkCredential({
      token: process.env.VK_ACCESS_TOKEN,
      tokenType: "access"
    });
    if (!env) return null;
    return { accountKey, platform, username: "api-token", label: "VK API token", source: "env", env };
  }

  const env = envForYouTubeCredential({ apiKey: process.env.YOUTUBE_API_KEY });
  if (!env) return null;
  return { accountKey, platform, username: "api-key", label: "YouTube Data API key", source: "env", env };
}

function envForVkCredential(metadata: Record<string, unknown>): NodeJS.ProcessEnv | null {
  const token = stringMetadataValue(metadata.token);
  if (!token) return null;
  const tokenType = stringMetadataValue(metadata.tokenType) ?? "access";
  if (tokenType !== "access") return null;
  return { VK_ACCESS_TOKEN: token, VK_SERVICE_TOKEN: "", VK_SERVER_TOKEN: "" };
}

function freshVkAccountToken(metadata: Record<string, unknown>, now: Date) {
  const expiresAt = stringMetadataValue(metadata.expiresAt) ?? stringMetadataValue(metadata.expires_at);
  if (!expiresAt) return true;
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) return true;
  return timestamp > now.getTime() + 5 * 60_000;
}

async function refreshStoredVkAccount(
  db: DbClient,
  accountKey: string,
  metadata: Record<string, unknown>,
  now: Date
) {
  const refreshToken = stringMetadataValue(metadata.refreshToken);
  const clientId = stringMetadataValue(metadata.clientId);
  const deviceId = stringMetadataValue(metadata.deviceId);
  if (!refreshToken || !clientId || !deviceId) return null;
  try {
    const tokens = await refreshVkOAuthToken({
      clientId,
      deviceId,
      refreshToken,
      state: randomUUID()
    });
    const nextMetadata = compactRecord({
      ...metadata,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? refreshToken,
      expiresAt: tokens.expiresIn ? new Date(now.getTime() + tokens.expiresIn * 1000).toISOString() : undefined
    });
    await db.socialPlatformAccount.update({
      where: { accountKey },
      data: { metadata: nextMetadata as never, blockedUntil: null, lastError: null }
    });
    return nextMetadata;
  } catch (error) {
    await db.socialPlatformAccount.update({
      where: { accountKey },
      data: {
        status: "FAILED",
        blockedUntil: new Date(now.getTime() + 60 * 60 * 1000),
        lastErrorAt: now,
        lastError: sanitizeSocialDiagnosticText(error instanceof Error ? error.message : String(error))
      }
    });
    return null;
  }
}

function envForYouTubeCredential(metadata: Record<string, unknown>): NodeJS.ProcessEnv | null {
  const apiKey = stringMetadataValue(metadata.apiKey);
  return apiKey ? { YOUTUBE_API_KEY: apiKey } : null;
}

function envCredentialMetadata(account: SelectedCredentialAccount) {
  if (account.platform === "VK") {
    return compactRecord({
      enabled: true,
      tokenSource: account.source
    });
  }
  return compactRecord({
    enabled: true,
    apiKeySource: account.source
  });
}

async function deferJobsForActiveCooldowns(db: DbClient) {
  const instagramAvailable = await selectInstagramAccount(db);
  if (!instagramAvailable) {
    const instagramBlockedUntil = await nextInstagramBlockedUntil(db);
    if (instagramBlockedUntil) {
      await db.collectionJob.updateMany({
        where: {
          platform: "INSTAGRAM",
          status: "QUEUED",
          scheduledFor: { lt: instagramBlockedUntil }
        },
        data: { scheduledFor: instagramBlockedUntil }
      });
      return true;
    }
  }

  let deferred = false;
  const accounts = await db.socialPlatformAccount.findMany({
    where: {
      accountKey: {
        in: [
          socialPlatformAccountKey("vk", "api-token"),
          socialPlatformAccountKey("youtube", "api-key")
        ]
      }
    },
    select: { platform: true, status: true, blockedUntil: true }
  });

  for (const account of accounts) {
    const blockedUntil = activeSocialAccountCooldown(account);
    if (!blockedUntil) continue;
    if (account.platform === "YOUTUBE") {
      const queuedJobs = await db.collectionJob.findMany({
        where: {
          platform: account.platform,
          status: "QUEUED",
          scheduledFor: { lt: blockedUntil }
        },
        select: { id: true, config: true }
      });
      const apiJobs = queuedJobs.filter((job) => !collectionJobUsesYouTubeWebFallback(job.config));
      if (!apiJobs.length) continue;
      await db.collectionJob.updateMany({
        where: { id: { in: apiJobs.map((job) => job.id) } },
        data: { scheduledFor: blockedUntil }
      });
      deferred = true;
      continue;
    }
    await db.collectionJob.updateMany({
      where: {
        platform: account.platform,
        status: "QUEUED",
        scheduledFor: { lt: blockedUntil }
      },
      data: { scheduledFor: blockedUntil }
    });
    deferred = true;
  }
  return deferred;
}

async function assertCollectionJobNotCanceled(db: DbClient, jobId: string) {
  if (await collectionJobCancelRequested(db, jobId)) throw new Error("collection-canceled");
}

async function collectionJobCancelRequested(db: DbClient, jobId: string) {
  const job = await db.collectionJob.findUnique({
    where: { id: jobId },
    select: { cancelRequested: true }
  });
  return Boolean(job?.cancelRequested);
}

function readSocialCancelPollMs() {
  const value = Number(process.env.SOCIAL_CANCEL_POLL_MS);
  if (!Number.isFinite(value) || value <= 0) return 1_000;
  return Math.max(10, Math.round(value));
}

function readInstagramNoAccountRetryDelayMs() {
  const value = Number(process.env.INSTAGRAM_NO_ACCOUNT_RETRY_DELAY_MS);
  if (!Number.isFinite(value) || value <= 0) return 60_000;
  return Math.min(30 * 60_000, Math.max(5_000, Math.round(value)));
}

function readInstagramAccountFailoverAttempts() {
  const value = Number(process.env.INSTAGRAM_ACCOUNT_FAILOVER_ATTEMPTS);
  if (!Number.isFinite(value) || value <= 0) return 4;
  return Math.min(20, Math.max(1, Math.round(value)));
}

function readInstagramAccountSuccessRestMs() {
  const value = Number(process.env.INSTAGRAM_ACCOUNT_SUCCESS_REST_MS);
  if (!Number.isFinite(value) || value < 0) return 15 * 60_000;
  return Math.min(24 * 60 * 60_000, Math.round(value));
}

function instagramSuccessRestMetadata(now = new Date()) {
  const restMs = readInstagramAccountSuccessRestMs();
  return restMs > 0 ? { nextAvailableAt: new Date(now.getTime() + restMs).toISOString() } : {};
}

export async function knownSocialProfileIds(
  db: DbClient,
  platform: "INSTAGRAM" | "VK" | "YOUTUBE",
  limit = readKnownSocialProfileSkipLimit()
) {
  const take = Math.max(0, Math.round(limit));
  if (take === 0) return [];
  const profiles = await db.candidateProfile.findMany({
    where: { platform },
    orderBy: { lastCollectedAt: "desc" },
    take,
    select: { platformProfileId: true }
  });
  return profiles.map((profile) => profile.platformProfileId);
}

function readKnownSocialProfileSkipLimit() {
  const value = Number(process.env.SOCIAL_KNOWN_PROFILE_SKIP_LIMIT);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_KNOWN_SOCIAL_PROFILE_SKIP_LIMIT;
  return Math.round(value);
}

function isSocialCollectorBlockedError(message: string) {
  return /automation|automated|rate_limited|please_wait|throttled|sentry_block|proxy_blocked|quota_exceeded|quotaExceeded|youtube_quota_exceeded|rateLimit|another ip address|challenge_required|checkpoint|login_required/i.test(message);
}

function isInstagramAccountTemporaryError(message: string) {
  return /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|network|connection|net::/i.test(message);
}

function isInstagramLoginChallengeError(message: string) {
  return /challenge_required|checkpoint|login_required/i.test(message);
}

function isInstagramAccountFailoverError(message: string) {
  return isSocialCollectorBlockedError(message) || isInstagramAccountTemporaryError(message);
}

function instagramAccountStatusFromError(
  message: string,
  blocked: boolean
): "BLOCKED" | "FAILED" | "MISSING_CREDENTIALS" {
  if (/missing_credentials/i.test(message)) return "MISSING_CREDENTIALS";
  if (isInstagramLoginChallengeError(message)) return "BLOCKED";
  if (isInstagramAccountTemporaryError(message)) return "FAILED";
  return blocked ? "BLOCKED" : "FAILED";
}

function instagramBlockedUntil(message: string, now = new Date()) {
  const hours = /challenge_required|checkpoint/i.test(message)
    ? 24
    : /login_required/i.test(message)
    ? 6
    : /automation|automated/i.test(message)
    ? 24
    : /rate_limited|please_wait|throttled|sentry_block/i.test(message)
    ? 12
    : /proxy_blocked/i.test(message)
    ? 3
    : isInstagramAccountTemporaryError(message)
    ? 0.25
    : 1;
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

function socialBlockedUntil(message: string, now = new Date()) {
  const hours = /quota/i.test(message) ? 24 : 1;
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

async function recordInstagramAccountStatus(
  db: DbClient,
  input: {
    status: "RUNNING" | "OK" | "BLOCKED" | "FAILED" | "MISSING_CREDENTIALS";
    blockedUntil?: Date | null;
    lastError?: string | null;
    metadata?: unknown;
  },
  account?: SelectedInstagramAccount | null
) {
  const now = new Date();
  const inputMetadata = {
    ...jsonRecord(input.metadata),
    ...(input.status === "OK" ? instagramSuccessRestMetadata(now) : {})
  };
  if (account?.source === "pool") {
    const existing = await db.socialPlatformAccount.findUnique({
      where: { accountKey: account.accountKey },
      select: { metadata: true, consecutiveErrors: true }
    });
    const nextMetadata = compactRecord({
      ...jsonRecord(existing?.metadata),
      ...inputMetadata,
      username: account.username,
      sessionFile: account.sessionFile,
      proxyUrl: account.proxyUrl
    });
    const consecutiveErrors = input.status === "OK"
      ? 0
      : input.status === "RUNNING"
      ? existing?.consecutiveErrors ?? 0
      : (existing?.consecutiveErrors ?? 0) + 1;
    await db.socialPlatformAccount.upsert({
      where: { accountKey: account.accountKey },
      create: {
        platform: "INSTAGRAM",
        accountKey: account.accountKey,
        username: account.username,
        label: account.label,
        status: input.status,
        blockedUntil: input.blockedUntil ?? null,
        lastSuccessAt: input.status === "OK" ? now : null,
        lastErrorAt: input.lastError ? now : null,
        lastError: input.lastError ?? null,
        consecutiveErrors,
        metadata: nextMetadata as never
      },
      update: {
        username: account.username,
        label: account.label,
        status: input.status,
        ...(input.blockedUntil !== undefined ? { blockedUntil: input.blockedUntil } : {}),
        ...(input.status === "OK" ? { lastSuccessAt: now, lastError: null, blockedUntil: null } : {}),
        ...(input.lastError ? { lastErrorAt: now, lastError: input.lastError } : {}),
        consecutiveErrors,
        metadata: nextMetadata as never
      }
    });
    return;
  }

  await upsertSocialPlatformAccountStatus({
    platform: "instagram",
    username: process.env.INSTAGRAM_USERNAME || null,
    label: "Instagram env account",
    ...input,
    metadata: inputMetadata
  }, db);
}

function instagramAccountKey() {
  return socialPlatformAccountKey("instagram", process.env.INSTAGRAM_USERNAME || null);
}

function instagramAccountMetadata(value: unknown) {
  const record = jsonRecord(value);
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    username: stringMetadataValue(record.username),
    password: stringMetadataValue(record.password),
    sessionId: stringMetadataValue(record.sessionId),
    sessionSettings: stringMetadataValue(record.sessionSettings),
    sessionFile: stringMetadataValue(record.sessionFile),
    proxyUrl: stringMetadataValue(record.proxyUrl),
    nextAvailableAt: stringMetadataValue(record.nextAvailableAt)
  };
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function compactRecord(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function stringMetadataValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function decodeBase64Env(value: string | undefined) {
  if (!value) return undefined;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8").trim();
    return decoded || undefined;
  } catch {
    return undefined;
  }
}

function parseMetadataDate(value: string | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

async function recordVkAccountStatus(
  db: DbClient,
  input: {
    status: "RUNNING" | "OK" | "BLOCKED" | "FAILED" | "MISSING_CREDENTIALS";
    blockedUntil?: Date | null;
    lastError?: string | null;
    metadata?: unknown;
  },
  account?: SelectedCredentialAccount | null
) {
  if (account) {
    await recordCredentialAccountStatus(db, account, input);
    return;
  }
  await upsertSocialPlatformAccountStatus({
    platform: "vk",
    username: "api-token",
    label: "VK API token",
    ...input
  }, db);
}

async function recordYouTubeAccountStatus(
  db: DbClient,
  input: {
    status: "RUNNING" | "OK" | "BLOCKED" | "FAILED" | "MISSING_CREDENTIALS";
    blockedUntil?: Date | null;
    lastError?: string | null;
    metadata?: unknown;
  },
  account?: SelectedCredentialAccount | null
) {
  if (account) {
    await recordCredentialAccountStatus(db, account, input);
    return;
  }
  await upsertSocialPlatformAccountStatus({
    platform: "youtube",
    username: "api-key",
    label: "YouTube Data API key",
    ...input
  }, db);
}

async function recordCredentialAccountStatus(
  db: DbClient,
  account: SelectedCredentialAccount,
  input: {
    status: "RUNNING" | "OK" | "BLOCKED" | "FAILED" | "MISSING_CREDENTIALS";
    blockedUntil?: Date | null;
    lastError?: string | null;
    metadata?: unknown;
  }
) {
  const now = new Date();
  const existing = await db.socialPlatformAccount.findUnique({
    where: { accountKey: account.accountKey },
    select: { metadata: true, consecutiveErrors: true }
  });
  const currentMetadata = jsonRecord(existing?.metadata);
  const inputMetadata = jsonRecord(input.metadata);
  const nextMetadata = compactRecord({
    ...currentMetadata,
    ...inputMetadata
  });
  const consecutiveErrors = input.status === "OK"
    ? 0
    : input.status === "RUNNING"
    ? existing?.consecutiveErrors ?? 0
    : (existing?.consecutiveErrors ?? 0) + 1;
  await db.socialPlatformAccount.upsert({
    where: { accountKey: account.accountKey },
    create: {
      platform: account.platform,
      accountKey: account.accountKey,
      username: account.username,
      label: account.label,
      status: input.status,
      blockedUntil: input.blockedUntil ?? null,
      lastSuccessAt: input.status === "OK" ? now : null,
      lastErrorAt: input.lastError ? now : null,
      lastError: input.lastError ?? null,
      consecutiveErrors,
      metadata: nextMetadata as never
    },
    update: {
      username: account.username,
      label: account.label,
      status: input.status,
      ...(input.blockedUntil !== undefined ? { blockedUntil: input.blockedUntil } : {}),
      ...(input.status === "OK" ? { lastSuccessAt: now, lastError: null, blockedUntil: null } : {}),
      ...(input.lastError ? { lastErrorAt: now, lastError: input.lastError } : {}),
      consecutiveErrors,
      metadata: nextMetadata as never
    }
  });
}

export async function selectInstagramProxy(db: DbClient, accountProxyUrl?: string): Promise<SelectedProxy | null> {
  if (process.env.INSTAGRAM_PROXY_URL) {
    return { url: process.env.INSTAGRAM_PROXY_URL, source: "env" };
  }

  const settings = await db.systemSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {}
  });

  if (!settings.proxyEnabled) return null;
  if (accountProxyUrl) return { url: accountProxyUrl, source: "account" };
  if (settings.proxyUrl) return { url: settings.proxyUrl, source: "settings" };

  const now = new Date();
  const proxy = await db.proxyEndpoint.findFirst({
    where: {
      OR: [
        {
          status: "OK",
          OR: [
            { blockedUntil: null },
            { blockedUntil: { lte: now } }
          ]
        },
        {
          status: "BLOCKED",
          blockedUntil: { lte: now }
        }
      ]
    },
    orderBy: [
      { lastUsedAt: "asc" },
      { createdAt: "asc" }
    ]
  });
  if (!proxy) return null;

  await db.proxyEndpoint.update({
    where: { id: proxy.id },
    data: {
      lastUsedAt: now,
      ...(proxy.status === "BLOCKED" ? {
        status: "OK",
        blockedUntil: null,
        lastError: null
      } : {})
    }
  });
  return { id: proxy.id, url: proxy.url, source: "pool" };
}

async function markInstagramProxyIssue(db: DbClient, proxy: SelectedProxy | null, message: string, safeMessage: string, blocked: boolean) {
  if (!isInstagramProxyIssue(message)) return;
  if (!proxy?.id) return;
  const proxyBlocked = blocked && /proxy_blocked|another ip address/i.test(message);
  await db.proxyEndpoint.updateMany({
    where: { id: proxy.id },
    data: {
      status: proxyBlocked ? "BLOCKED" : "FAILED",
      blockedUntil: proxyBlocked ? instagramBlockedUntil(message) : null,
      failCount: { increment: 1 },
      lastError: safeMessage
    }
  });
}

export function isInstagramProxyIssue(message: string) {
  if (isInstagramLoginChallengeError(message)) return false;
  return /proxy_blocked|another ip address|proxy(?:\s|_|-)*(?:error|failed|failure|refused|unavailable)|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|network|connection|net::/i.test(message);
}
