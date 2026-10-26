import {
  getGoogleHealth,
  getSystemSettings,
  isGoogleBlockedError,
  markGoogleBlocked,
  markGoogleOk,
  markGoogleProbeStarted,
  prisma,
  queueAdvertiserScan,
  sanitizeDiagnosticError,
  shouldProbeGoogle,
  numberList,
  stringList,
  validateWorkerEnv
} from "@scaner-blogers/db";
import { createGoogleClient } from "./browser-google-client.js";
import { classifyBrowserNativeError } from "./browser-native-diagnostics.js";
import { runAdvertiserScan } from "./scanner.js";
import { processNextSocialCollectionJob } from "./social-collection-worker.js";
import {
  clearExpiredSocialPlatformBlocks,
  cleanupRetainedSocialData,
  recoverInterruptedRunningCollectionJobs,
  recoverStaleRunningCollectionJobs
} from "./social-worker-maintenance.js";

type ScanMode = "FAST" | "FULL" | "CAUTIOUS";

function dateRangeForMode(mode: ScanMode = "CAUTIOUS") {
  if (mode === "FULL") return undefined;

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - { FAST: 3, CAUTIOUS: 7 }[mode]);
  return {
    start: toGoogleDate(start),
    end: toGoogleDate(end)
  };
}

function dateRangeForJob(job: { scanMode: ScanMode; scanStartDate?: string | null; scanEndDate?: string | null }) {
  if (job.scanStartDate && job.scanEndDate) {
    return {
      start: job.scanStartDate.replaceAll("-", ""),
      end: job.scanEndDate.replaceAll("-", "")
    };
  }
  return dateRangeForMode(job.scanMode);
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_WORKER_CONCURRENCY = 1;
const MAX_WORKER_CONCURRENCY = 6;
const STALE_RUNNING_JOB_MS = 60 * 60 * 1000;
const DEFAULT_CHUNK_BUDGET_MS = 8 * 60 * 1000;
const HEARTBEAT_PULSE_MS = 30_000;
const PROBE_ADVERTISER_ID = process.env.GOOGLE_PROBE_ADVERTISER_ID ?? "AR14577439029227159553";
let stopping = false;
let lastIdleLogAt = 0;

process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

async function main() {
  validateWorkerEnv();
  await recoverInterruptedRunningJobs();
  await recoverInterruptedRunningCollectionJobs();
  await recoverStaleRunningJobs();
  await recoverStaleRunningCollectionJobs();
  await clearExpiredSocialPlatformBlocks();
  await updateHeartbeat("starting");

  if (process.env.WORKER_RUN_ONCE === "true") {
    await processQueueCycle();
    await updateHeartbeat("idle", "run-once complete");
    return;
  }

  const pollIntervalMs = readPollInterval();
  console.log(`Scan worker started. Polling queue every ${pollIntervalMs}ms.`);

  while (!stopping) {
    const processed = await processQueueCycle();
    if (!processed) await sleep(pollIntervalMs);
  }
  await updateHeartbeat("stopping");
}

async function processQueueCycle() {
  await updateHeartbeat("polling");
  await recoverStaleRunningJobs();
  await recoverStaleRunningCollectionJobs();
  await clearExpiredSocialPlatformBlocks();
  await cleanupRetainedData();

  const processedSocial = await runWithHeartbeatPulse(
    "running",
    "processing social collection job",
    () => processNextSocialCollectionJob()
  );
  if (processedSocial) {
    await updateHeartbeat("processed", "processed 1 social collection job");
    return 1;
  }

  const settings = await getSystemSettings(prisma);
  const health = await getGoogleHealth(prisma);
  if (health.status === "BLOCKED") {
    if (shouldProbeGoogle(health, settings.probeIntervalMs)) {
      const probeOk = await probeGoogleAccess(settings.proxyEnabled ? settings.proxyUrl ?? undefined : undefined);
      if (!probeOk) return 0;
    } else {
      await updateHeartbeat("cooldown", `Google blocked until ${health.blockedUntil?.toISOString() ?? "probe window"}`);
      return 0;
    }
  }

  await enqueueDueDailyJobs();

  const concurrency = readWorkerConcurrency(settings.workerConcurrency);
  const results = await Promise.all(Array.from({ length: concurrency }, (_, index) => processQueueSlot(index + 1)));
  const processed = results.reduce((sum, value) => sum + value, 0);

  if (!processed) logIdleOncePerMinute();
  await updateHeartbeat(processed ? "processed" : "idle", processed ? `processed ${processed} job(s)` : "queue is empty");
  return processed;
}

async function processQueueSlot(slot: number) {
  let processed = 0;
  while (!stopping && await processNextQueuedJob(slot)) processed += 1;
  return processed;
}

async function processNextQueuedJob(slot: number) {
  const job = await claimNextQueuedJob();
  if (!job) return false;

  const settings = await getSystemSettings(prisma);
  const proxy = await selectProxy(settings.proxyEnabled ? settings.proxyUrl ?? undefined : undefined);
  if (settings.proxyEnabled && !proxy && await prisma.proxyEndpoint.count() > 0) {
    await prisma.scanJob.updateMany({
      where: { id: job.id, status: "RUNNING" },
      data: { status: "QUEUED", startedAt: null }
    });
    await updateHeartbeat("cooldown", "no healthy proxy available");
    return false;
  }
  const client = createGoogleClient({
    proxyUrl: proxy?.url,
    profileKey: proxy ? `worker-slot-${slot}-${proxy.id}` : `worker-slot-${slot}-direct`
  });
  try {
    const result = await runWithHeartbeatPulse("running", `slot ${slot}, job ${job.id}`, () =>
      runAdvertiserScan({
        scanJobId: job.id,
        advertiserDbId: job.advertiser.id,
        googleAdvertiserId: job.advertiser.googleAdvertiserId,
        countryCodes: stringList(job.countries),
        dateRange: dateRangeForJob(job),
        scanMode: job.scanMode,
        requestDelayMs: job.requestDelayMs ?? undefined,
        maxPagesPerRun: job.maxPagesPerRun ?? undefined,
        maxCreativesPerRun: job.maxCreativesPerRun ?? undefined,
        chunkBudgetMs: readChunkBudget(),
        initialPageToken: job.nextPageToken
      }, client)
    );
    if (result.chunked) {
      await prisma.scanJob.update({
        where: { id: job.id },
        data: { status: "QUEUED", startedAt: null, finishedAt: null }
      });
      await updateHeartbeat("processed", `chunk saved for job ${job.id}`);
      return true;
    }
    if (job.scanMode === "FULL") await sleep(settings.advertiserDelayMs);
  } catch (error) {
    const proxyIssue = classifyBrowserNativeError(error);
    if (proxy && proxyIssue !== "FAILED") {
      await markProxyIssue(proxy.id, error, proxyIssue);
      const nextProxy = await selectProxy(settings.proxyEnabled ? settings.proxyUrl ?? undefined : undefined);
      await prisma.scanJob.updateMany({
        where: { id: job.id, status: { in: ["RUNNING", "BLOCKED", "FAILED"] } },
        data: { status: "QUEUED", startedAt: null, errorMessage: null, blockedReason: null }
      });
      await updateHeartbeat("cooldown", nextProxy
        ? `proxy ${proxy.id} ${proxyIssue.toLowerCase()}, job requeued`
        : `proxy ${proxy.id} ${proxyIssue.toLowerCase()}, no spare proxy`);
      if (nextProxy) return true;
    }
    if (isGoogleBlockedError(error)) {
      if (proxy) {
        await markProxyIssue(proxy.id, error, "BLOCKED");
        const nextProxy = await selectProxy(settings.proxyEnabled ? settings.proxyUrl ?? undefined : undefined);
        if (nextProxy) {
          await prisma.scanJob.updateMany({
            where: { id: job.id, status: { in: ["RUNNING", "BLOCKED"] } },
            data: { status: "QUEUED", startedAt: null, errorMessage: null, blockedReason: null }
          });
          await updateHeartbeat("cooldown", `proxy ${proxy.id} blocked, job requeued for next proxy`);
          return true;
        }
      }
      await markGoogleBlocked(error, prisma);
    }
    await prisma.scanJob.updateMany({
      where: { id: job.id, status: "RUNNING" },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: sanitizeDiagnosticError(error)
      }
    });
    console.error(error);
  } finally {
    await client.close?.();
    await updateHeartbeat("polling");
  }
  return true;
}

async function claimNextQueuedJob() {
  return prisma.$transaction(async (tx) => {
    const queued = await tx.scanJob.findFirst({
      where: { status: "QUEUED" },
      select: { id: true },
      orderBy: { createdAt: "asc" }
    });

    if (!queued) return null;

    const claimed = await tx.scanJob.updateMany({
      where: { id: queued.id, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: new Date() }
    });

    if (claimed.count !== 1) return null;

    return tx.scanJob.findUnique({
      where: { id: queued.id },
      include: { advertiser: true }
    });
  });
}

async function probeGoogleAccess(proxyUrl?: string) {
  await markGoogleProbeStarted(prisma);
  await updateHeartbeat("probing", "Checking Google access");
  const client = createGoogleClient({ proxyUrl });
  try {
    await client.searchCreatives({
      advertiserId: PROBE_ADVERTISER_ID,
      geoId: 2826,
      dateRange: { start: "20260516", end: "20260523" }
    });
    await markGoogleOk(prisma);
    await updateHeartbeat("idle", "Google probe succeeded");
    return true;
  } catch (error) {
    if (isGoogleBlockedError(error)) {
      const health = await markGoogleBlocked(error, prisma);
      await updateHeartbeat("cooldown", `Google blocked until ${health.blockedUntil?.toISOString()}`);
      return false;
    }
    await prisma.googleHealth.update({
      where: { id: "default" },
      data: { status: "DEGRADED", lastError: sanitizeDiagnosticError(error), lastProbeAt: new Date() }
    });
    return false;
  } finally {
    await client.close?.();
  }
}

function toGoogleDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("");
}

async function enqueueDueDailyJobs(now = new Date()) {
  const settings = await getSystemSettings(prisma);
  const dueAdvertisers = await prisma.advertiser.findMany({
    where: {
      dailyScanEnabled: true,
      OR: [
        { nextScanAt: null },
        { nextScanAt: { lte: now } }
      ]
    },
    include: {
      scanJobs: {
        where: { status: { in: ["QUEUED", "RUNNING"] } },
        select: { id: true },
        take: 1
      }
    }
  });

  for (const advertiser of dueAdvertisers) {
    if (advertiser.scanJobs.length) continue;
    await queueAdvertiserScan(advertiser.id, [], {
      scanMode: advertiser.scanMode ?? settings.scanMode,
      requestDelayMs: advertiser.requestDelayMs ?? settings.requestDelayMs,
      maxPagesPerRun: advertiser.maxPagesPerRun ?? settings.maxPagesPerRun ?? undefined,
      maxCreativesPerRun: advertiser.maxCreativesPerRun ?? settings.maxCreativesPerRun ?? undefined
    }, prisma);
    await prisma.advertiser.update({
      where: { id: advertiser.id },
      data: { nextScanAt: nextScheduledScanTime(now, settings) }
    });
  }
}

function nextScheduledScanTime(
  from: Date,
  settings: {
    dailyScanHour?: number | null;
    scheduleType?: string | null;
    dailyScanHours?: unknown;
    scanIntervalHours?: number | null;
  }
) {
  if ((settings.scheduleType ?? "DAILY") === "INTERVAL") {
    const interval = clampInterval(settings.scanIntervalHours);
    const next = new Date(from);
    const nextHour = Math.floor(next.getHours() / interval) * interval + interval;
    next.setMinutes(0, 0, 0);
    next.setHours(nextHour);
    return next;
  }

  const hours = normalizeScheduleHours(settings);
  for (const hour of hours) {
    const next = new Date(from);
    next.setHours(hour, 0, 0, 0);
    if (next > from) return next;
  }
  const tomorrow = new Date(from);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(hours[0] ?? 3, 0, 0, 0);
  return tomorrow;
}

function normalizeScheduleHours(settings: { dailyScanHour?: number | null; dailyScanHours?: unknown }) {
  const dailyScanHours = numberList(settings.dailyScanHours);
  const source = dailyScanHours.length ? dailyScanHours : [settings.dailyScanHour ?? 3];
  const hours = [...new Set(source.map(Number).filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23))];
  return hours.length ? hours.sort((a, b) => a - b) : [3];
}

function clampInterval(value?: number | null) {
  const interval = Number(value);
  if (!Number.isFinite(interval)) return 24;
  return Math.min(24, Math.max(1, Math.round(interval)));
}

function readPollInterval() {
  const value = Number(process.env.WORKER_POLL_INTERVAL_MS);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_POLL_INTERVAL_MS;
  return Math.max(2_000, Math.round(value));
}

function readWorkerConcurrency(settingsValue?: number | null) {
  const value = Number(settingsValue ?? process.env.WORKER_CONCURRENCY ?? DEFAULT_WORKER_CONCURRENCY);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_WORKER_CONCURRENCY;
  return Math.min(MAX_WORKER_CONCURRENCY, Math.max(1, Math.round(value)));
}

async function cleanupRetainedData(now = new Date()) {
  const settings = await getSystemSettings(prisma);
  const rawBefore = retentionCutoff(now, settings.rawSnapshotRetentionDays);
  const eventsBefore = retentionCutoff(now, settings.scanEventRetentionDays);

  await Promise.all([
    rawBefore
      ? prisma.rawApiSnapshot.deleteMany({ where: { createdAt: { lt: rawBefore } } })
      : Promise.resolve({ count: 0 }),
    eventsBefore
      ? prisma.scanEvent.deleteMany({ where: { createdAt: { lt: eventsBefore } } })
      : Promise.resolve({ count: 0 }),
    cleanupRetainedSocialData(prisma, rawBefore, eventsBefore)
  ]).catch((error) => {
    console.warn("Retention cleanup failed:", error instanceof Error ? error.message : error);
  });
}

function readChunkBudget() {
  const value = Number(process.env.WORKER_CHUNK_BUDGET_MS);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : DEFAULT_CHUNK_BUDGET_MS;
}

async function selectProxy(fallbackProxyUrl?: string) {
  const now = new Date();
  const [proxy, proxyCount] = await Promise.all([
    prisma.proxyEndpoint.findFirst({
      where: {
        status: "OK",
        OR: [{ blockedUntil: null }, { blockedUntil: { lte: now } }]
      },
      orderBy: [{ lastUsedAt: "asc" }, { createdAt: "asc" }]
    }),
    prisma.proxyEndpoint.count()
  ]);
  if (proxy) {
    await prisma.proxyEndpoint.update({ where: { id: proxy.id }, data: { lastUsedAt: now } });
    return proxy;
  }
  if (proxyCount > 0) return null;
  return fallbackProxyUrl ? { id: "settings", url: fallbackProxyUrl } : null;
}

async function markProxyIssue(id: string, error: unknown, status: "BLOCKED" | "CHALLENGE_REQUIRED" | "TIMEOUT" | "FAILED") {
  if (id === "settings") return;
  const cooldownMs = status === "TIMEOUT" ? 30 * 60 * 1000 : 60 * 60 * 1000;
  await prisma.proxyEndpoint.update({
    where: { id },
    data: {
      status,
      blockedUntil: new Date(Date.now() + cooldownMs),
      failCount: { increment: 1 },
      lastError: sanitizeDiagnosticError(error)
    }
  });
}

function retentionCutoff(now: Date, days?: number | null) {
  const value = Number(days);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(now.getTime() - Math.round(value) * 24 * 60 * 60 * 1000);
}

function logIdleOncePerMinute(now = Date.now()) {
  if (now - lastIdleLogAt < 60_000) return;
  lastIdleLogAt = now;
  console.log("Queue is empty.");
}

async function recoverStaleRunningJobs(now = new Date()) {
  const staleBefore = new Date(now.getTime() - STALE_RUNNING_JOB_MS);
  const staleJobs = await prisma.scanJob.findMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: staleBefore },
      finishedAt: null
    },
    select: { id: true, advertiserId: true }
  });

  for (const job of staleJobs) {
    await prisma.scanJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        finishedAt: now,
        errorMessage: "stale-running-job",
        blockedReason: null
      }
    });
    await prisma.scan.updateMany({
      where: { scanJobId: job.id, status: "RUNNING" },
      data: {
        status: "FAILED",
        finishedAt: now,
        errorMessage: "stale-running-job"
      }
    });
    await prisma.scanEvent.create({
      data: {
        scanJobId: job.id,
        level: "error",
        message: "Зависшая задача помечена как ошибка после рестарта worker",
        data: { reasonCode: "STALE_RUNNING_JOB" }
      }
    });
    await prisma.advertiser.updateMany({
      where: { id: job.advertiserId, lastScanStatus: "RUNNING" },
      data: { lastScanStatus: "FAILED", lastScanAt: now }
    });
  }
}

async function recoverInterruptedRunningJobs(now = new Date()) {
  const runningJobs = await prisma.scanJob.findMany({
    where: {
      status: "RUNNING",
      finishedAt: null
    },
    select: { id: true, advertiserId: true }
  });

  for (const job of runningJobs) {
    await prisma.scanJob.update({
      where: { id: job.id },
      data: {
        status: "QUEUED",
        startedAt: null,
        chunkStartedAt: null,
        errorMessage: null
      }
    });
    await prisma.scan.updateMany({
      where: { scanJobId: job.id, status: "RUNNING" },
      data: { status: "QUEUED", finishedAt: null, errorMessage: null }
    });
    await prisma.scanEvent.create({
      data: {
        scanJobId: job.id,
        level: "warn",
        message: "Задача возвращена в очередь после рестарта worker",
        data: { reasonCode: "WORKER_RESTART_REQUEUED" }
      }
    });
    await prisma.advertiser.updateMany({
      where: { id: job.advertiserId, lastScanStatus: "RUNNING" },
      data: { lastScanStatus: "QUEUED", lastScanAt: now }
    });
  }
}

async function updateHeartbeat(status: string, message?: string) {
  await prisma.workerHeartbeat.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      status,
      message,
      pid: process.pid,
      lastSeenAt: new Date()
    },
    update: {
      status,
      message,
      pid: process.pid,
      lastSeenAt: new Date()
    }
  }).catch(() => undefined);
}

async function runWithHeartbeatPulse<T>(status: string, message: string, task: () => Promise<T>) {
  await updateHeartbeat(status, message);
  const timer = setInterval(() => {
    void updateHeartbeat(status, message);
  }, HEARTBEAT_PULSE_MS);
  timer.unref?.();

  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
