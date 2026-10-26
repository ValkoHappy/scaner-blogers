import { NextResponse } from "next/server";
import { prisma } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";
import { getSocialIntegrityData, getSocialKeywordQualityData } from "@/lib/data";
import { buildSocialCredentialReadiness } from "@/lib/social-credential-readiness";
import { safeSocialAccountStatus } from "@/lib/system-status-sanitize";

const STALE_HEARTBEAT_MS = 90_000;

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const startedAt = Date.now();
  try {
    await prisma.advertiser.count();
    const [
      scanQueued,
      scanRunning,
      scanFailed,
      collectionQueued,
      collectionRunning,
      collectionFailed,
      lastScan,
      lastCollectionJob,
      lastSuccessfulScan,
      lastSuccessfulCollectionJob,
      heartbeat,
      googleHealth,
      activeChunk,
      creativesWithoutApp,
      creativesWithoutPreviewUrl,
      rawSnapshots,
      candidateProfiles,
      rawSocialSnapshots,
      socialAccounts,
      socialSearchHistory,
      socialKeywordQuality,
      socialRunningByPlatform,
      socialQueuedByPlatform,
      socialIntegrity
    ] = await Promise.all([
      prisma.scanJob.count({ where: { status: "QUEUED" } }),
      prisma.scanJob.count({ where: { status: "RUNNING" } }),
      prisma.scanJob.count({ where: { status: "FAILED" } }),
      prisma.collectionJob.count({ where: { status: "QUEUED" } }),
      prisma.collectionJob.count({ where: { status: "RUNNING" } }),
      prisma.collectionJob.count({ where: { status: "FAILED" } }),
      prisma.scanJob.findFirst({ orderBy: { updatedAt: "desc" }, include: { advertiser: true, events: { orderBy: { createdAt: "desc" }, take: 1 } } }),
      prisma.collectionJob.findFirst({ orderBy: { updatedAt: "desc" }, include: { keyword: true, events: { orderBy: { createdAt: "desc" }, take: 1 } } }),
      prisma.scanJob.findFirst({ where: { status: "SUCCESS" }, orderBy: { finishedAt: "desc" } }),
      prisma.collectionJob.findFirst({ where: { status: "SUCCESS" }, orderBy: { finishedAt: "desc" } }),
      prisma.workerHeartbeat.findUnique({ where: { id: "default" } }),
      prisma.googleHealth.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} }),
      prisma.scanJob.findFirst({ where: { status: "RUNNING", chunkStartedAt: { not: null } }, orderBy: { updatedAt: "desc" }, select: { id: true, currentCountryCode: true, nextPageToken: true, pagesFetched: true, creativesFound: true, chunkStartedAt: true } }),
      prisma.creative.count({ where: { appDbId: null } }),
      prisma.creative.count({ where: { previewUrl: null } }),
      prisma.rawApiSnapshot.count(),
      prisma.candidateProfile.count(),
      prisma.rawSocialSnapshot.count(),
      prisma.socialPlatformAccount.findMany({ orderBy: { updatedAt: "desc" }, take: 10 }),
      prisma.collectionSearchHistory.findMany({ orderBy: { lastSearchedAt: "desc" }, take: 10, include: { keyword: true } }),
      getSocialKeywordQualityData(),
      prisma.collectionJob.groupBy({ by: ["platform"], where: { status: "RUNNING" }, _count: { _all: true } }),
      prisma.collectionJob.groupBy({ by: ["platform"], where: { status: "QUEUED" }, _count: { _all: true } }),
      getSocialIntegrityData()
    ]);

    const heartbeatAgeMs = heartbeat ? Date.now() - heartbeat.lastSeenAt.getTime() : null;
    const workerOnline = heartbeatAgeMs !== null && heartbeatAgeMs <= STALE_HEARTBEAT_MS;
    const queued = scanQueued + collectionQueued;
    const running = scanRunning + collectionRunning;
    const failed = scanFailed + collectionFailed;

    return NextResponse.json({
      ok: true,
      db: { ok: true, latencyMs: Date.now() - startedAt },
      worker: {
        online: workerOnline,
        status: heartbeat?.status ?? "unknown",
        message: heartbeat?.message ?? null,
        pid: heartbeat?.pid ?? null,
        lastSeenAt: heartbeat?.lastSeenAt ?? null,
        heartbeatAgeMs
      },
      queue: {
        queued,
        running,
        failed,
        scan: { queued: scanQueued, running: scanRunning, failed: scanFailed },
        social: { queued: collectionQueued, running: collectionRunning, failed: collectionFailed },
        activeChunk
      },
      google: {
        status: googleHealth.status,
        blockedUntil: googleHealth.blockedUntil,
        nextProbeAt: googleHealth.blockedUntil,
        lastProbeResult: googleHealth.lastError ? "blocked" : "ok",
        lastProbeAt: googleHealth.lastProbeAt,
        lastSuccessAt: googleHealth.lastSuccessAt,
        consecutiveBlocks: googleHealth.consecutiveBlocks
      },
      scans: {
        last: lastScan ? {
          id: lastScan.id,
          status: lastScan.status,
          advertiser: lastScan.advertiser.name ?? lastScan.advertiser.googleAdvertiserId,
          updatedAt: lastScan.updatedAt,
          event: lastScan.events[0]?.message ?? null,
          reasonCode: scanEventReasonCode(lastScan.events[0]?.data)
        } : null,
        lastSuccessAt: latestDate(lastSuccessfulScan?.finishedAt, lastSuccessfulCollectionJob?.finishedAt)
      },
      collections: {
        last: lastCollectionJob ? {
          id: lastCollectionJob.id,
          status: lastCollectionJob.status,
          platform: lastCollectionJob.platform,
          keyword: lastCollectionJob.keyword?.value ?? null,
          updatedAt: lastCollectionJob.updatedAt,
          event: lastCollectionJob.events[0]?.message ?? null,
          reasonCode: scanEventReasonCode(lastCollectionJob.events[0]?.data)
        } : null
      },
      social: {
        credentials: buildSocialCredentialReadiness(process.env),
        accounts: socialAccounts.map((account) => safeSocialAccountStatus(account)),
        lanes: {
          running: Object.fromEntries(socialRunningByPlatform.map((row) => [row.platform, row._count._all])),
          queued: Object.fromEntries(socialQueuedByPlatform.map((row) => [row.platform, row._count._all]))
        },
        recentSearches: socialSearchHistory.map((row) => ({
          platform: row.platform,
          query: row.query,
          queryType: row.queryType,
          regionCode: row.regionCode,
          keyword: row.keyword?.value ?? null,
          searches: row.searches,
          lastItemsFound: row.lastItemsFound,
          lastProfilesChecked: row.lastProfilesChecked,
          lastSearchedAt: row.lastSearchedAt
        })),
        keywordQuality: socialKeywordQuality,
        integrity: socialIntegrity
      },
      data: {
        creativesWithoutApp,
        creativesWithoutPreviewUrl,
        rawSnapshots,
        candidateProfiles,
        rawSocialSnapshots
      }
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      db: { ok: false, latencyMs: Date.now() - startedAt },
      error: error instanceof Error ? error.message : "Unknown system status error"
    }, { status: 500 });
  }
}

function scanEventReasonCode(data: unknown) {
  if (!data || typeof data !== "object") return null;
  const value = (data as { reasonCode?: unknown }).reasonCode;
  return typeof value === "string" ? value : null;
}

function latestDate(...dates: Array<Date | null | undefined>) {
  const values = dates.filter((date): date is Date => Boolean(date));
  if (!values.length) return null;
  return new Date(Math.max(...values.map((date) => date.getTime())));
}
