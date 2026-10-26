import { getGeoTarget, sanitizeSocialDiagnosticText, type NormalizedCreative } from "@scaner-blogers/core";
import {
  recordScanEvent,
  refreshAdvertiserCounters,
  saveNormalizedCreative,
  prisma as defaultPrisma
} from "@scaner-blogers/db";
import { GoogleTransparencyClient, type GoogleCreativeClient, type ScanDateRange } from "./google-client.js";

type DbClient = typeof defaultPrisma;
type ScanCounters = { pagesFetched: number; detailsFetched: number; previewsFetched: number };
type PersistedScanCounters = ScanCounters & { creativesFound: number };
let lastWorkerHeartbeatTouchAt = 0;

export interface RunScanInput {
  scanJobId: string;
  advertiserDbId: string;
  googleAdvertiserId: string;
  countryCodes: string[];
  dateRange?: ScanDateRange;
  scanMode?: "FAST" | "FULL" | "CAUTIOUS";
  requestDelayMs?: number;
  maxPagesPerRun?: number;
  maxCreativesPerRun?: number;
  chunkBudgetMs?: number;
  initialPageToken?: string | null;
}

export async function runAdvertiserScan(
  input: RunScanInput,
  client: GoogleCreativeClient = new GoogleTransparencyClient(),
  db: DbClient = defaultPrisma
) {
  const scanStartedAt = new Date();
  await db.scanJob.update({
    where: { id: input.scanJobId },
    data: {
      status: "RUNNING",
      scanMode: input.scanMode ?? "CAUTIOUS",
      startedAt: scanStartedAt
    }
  });

  const scan = await db.scan.create({
    data: {
      advertiserId: input.advertiserDbId,
      scanJobId: input.scanJobId,
      status: "RUNNING",
      scanMode: input.scanMode ?? "CAUTIOUS",
      startedAt: scanStartedAt
    }
  });

  const seen = new Map<string, NormalizedCreative>();
  const counters = { pagesFetched: 0, detailsFetched: 0, previewsFetched: 0 };
  const limits = resolveLimits(input);
  const browserNative = isBrowserNativeClient(client);
  const pageDelayMs = browserNative ? Math.min(limits.requestDelayMs, 1200) : limits.requestDelayMs;
  const creativeDelayMs = browserNative ? 0 : limits.requestDelayMs;
  const chunkDeadline = input.chunkBudgetMs && !browserNative ? Date.now() + input.chunkBudgetMs : Number.POSITIVE_INFINITY;
  let creativeErrors = 0;

  try {
    const countryTargets = input.countryCodes.length ? input.countryCodes : [undefined];
    for (const countryCode of countryTargets) {
      if (seen.size >= limits.maxCreativesPerRun) break;
      const geo = countryCode ? findGeoByCountryCode(countryCode) : undefined;
      if (countryCode && !geo) {
        await recordScanEvent({
          scanJobId: input.scanJobId,
          scanId: scan.id,
          level: "warn",
          message: `Неизвестный код страны ${countryCode}`,
          data: { reasonCode: "UNKNOWN_COUNTRY_CODE", countryCode }
        }, db);
        continue;
      }

      let pageToken: string | undefined = input.initialPageToken ?? undefined;
      do {
        if (counters.pagesFetched >= limits.maxPagesPerRun || seen.size >= limits.maxCreativesPerRun) break;
        if (Date.now() >= chunkDeadline) {
          await saveChunkProgress(input.scanJobId, scan.id, countryCode, pageToken, counters, seen.size, db);
          await recordScanEvent({
            scanJobId: input.scanJobId,
            scanId: scan.id,
            level: "info",
            message: "Кусок полного сбора сохранен, задача вернется в очередь",
            data: { reasonCode: "FULL_SCAN_CHUNK_SAVED", nextPageToken: pageToken ?? null, creativesFound: seen.size }
          }, db);
          return { creativesFound: seen.size, chunked: true };
        }

        await assertNotCanceled(input.scanJobId, db);
        await delay(pageDelayMs);
        await recordScanEvent({
          scanJobId: input.scanJobId,
          scanId: scan.id,
          level: "info",
          message: countryCode
            ? `Открыта страница рекламодателя: ${countryCode}, страница ${counters.pagesFetched + 1}`
            : `Открыта страница рекламодателя: все страны, страница ${counters.pagesFetched + 1}`,
          data: { reasonCode: "ADVERTISER_PAGE_OPENED", countryCode: countryCode ?? null, page: counters.pagesFetched + 1 }
        }, db);

        const page = await client.searchCreatives({
          advertiserId: input.googleAdvertiserId,
          geoId: geo?.googleGeoId,
          dateRange: input.dateRange,
          pageToken
        }).catch(async (error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (browserNative && message === "browser-native:no-search-results" && seen.size > 0) {
            await recordScanEvent({
              scanJobId: input.scanJobId,
              scanId: scan.id,
              level: "info",
              message: "Новых страниц больше нет, сбор завершен",
              data: { reasonCode: "BROWSER_NATIVE_NO_MORE_PAGES", creativesFound: seen.size, pagesFetched: counters.pagesFetched }
            }, db);
            return null;
          }
          throw error;
        });
        if (!page) break;
        counters.pagesFetched += 1;
        await persistCounters(input.scanJobId, scan.id, counters, seen.size, db);
        await recordScanEvent({
          scanJobId: input.scanJobId,
          scanId: scan.id,
          level: "info",
          message: `Найдена страница выдачи, креативов: ${page.creatives.length}`,
          data: { reasonCode: "SEARCH_PAGE_FOUND", creatives: page.creatives.length, nextPageToken: page.nextPageToken ?? null }
        }, db);

        for (const listCreative of page.creatives) {
          if (seen.size >= limits.maxCreativesPerRun) break;
          if (seen.has(listCreative.creativeId)) continue;
          await assertNotCanceled(input.scanJobId, db);
          await delay(creativeDelayMs);
          try {
            const normalized = await client.collectCreative({
              advertiserId: input.googleAdvertiserId,
              creativeId: listCreative.creativeId,
              listCreative
            });
            counters.detailsFetched += 1;
            if (normalized.raw.preview) counters.previewsFetched += 1;
            seen.set(normalized.creativeId, normalized);
            await saveNormalizedCreative(input.advertiserDbId, normalized, db);
            await persistCounters(input.scanJobId, scan.id, counters, seen.size, db);
            await recordScanEvent({
              scanJobId: input.scanJobId,
              scanId: scan.id,
              level: "info",
              message: `Собрано из browser-native/network response: ${normalized.creativeId}`,
              data: { reasonCode: "BROWSER_NATIVE_CREATIVE_COLLECTED", creativeId: normalized.creativeId }
            }, db);
          } catch (error) {
            if (isBlockedError(error)) throw error;
            creativeErrors += 1;
            await recordScanEvent({
              scanJobId: input.scanJobId,
              scanId: scan.id,
              level: "warn",
              message: `Не удалось собрать креатив ${listCreative.creativeId}`,
              data: {
                reasonCode: "CREATIVE_COLLECT_FAILED",
                creativeId: listCreative.creativeId,
                error: error instanceof Error ? error.message : String(error)
              }
            }, db);
          }
        }

        pageToken = page.nextPageToken;
        await saveChunkProgress(input.scanJobId, scan.id, countryCode, pageToken, counters, seen.size, db);
      } while (pageToken && counters.pagesFetched < limits.maxPagesPerRun && seen.size < limits.maxCreativesPerRun);
    }

    if (creativeErrors > 0 && seen.size === 0) {
      throw new Error(`creative-details-failed:${creativeErrors}`);
    }

    const disappeared = await markDisappearedCreatives(input, scanStartedAt, db);
    const newCreatives = await countNewCreatives(input.advertiserDbId, scanStartedAt, db);
    await refreshAdvertiserCounters(input.advertiserDbId, db);
    await db.scan.update({
      where: { id: scan.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        pagesFetched: counters.pagesFetched,
        creativesFound: seen.size,
        newCreatives,
        detailsFetched: counters.detailsFetched,
        previewsFetched: counters.previewsFetched
      }
    });
    if (disappeared > 0) {
      await recordScanEvent({
        scanJobId: input.scanJobId,
        scanId: scan.id,
        level: "info",
        message: `Помечены пропавшие креативы: ${disappeared}`,
        data: { reasonCode: "CREATIVES_MARKED_STOPPED", creatives: disappeared }
      }, db);
    }
    const finalJobCounters = await monotonicJobCounters(input.scanJobId, counters, seen.size, db);
    await db.scanJob.update({
      where: { id: input.scanJobId },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        ...finalJobCounters,
        nextPageToken: null,
        currentCountryCode: null,
        chunkStartedAt: null
      }
    });
    await db.advertiser.update({
      where: { id: input.advertiserDbId },
      data: {
        lastScanAt: new Date(),
        lastSuccessfulScanAt: new Date(),
        lastScanStatus: "SUCCESS"
      }
    });

    return { creativesFound: finalJobCounters.creativesFound, chunked: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const safeMessage = sanitizeSocialDiagnosticText(message);
    const blocked = message.startsWith("blocked:") || message.startsWith("browser-native:challenge:") || message.startsWith("browser-native:timeout:");
    const canceled = message === "scan-canceled";
    const status = canceled ? "CANCELED" : blocked ? "BLOCKED" : "FAILED";

    await recordScanEvent({
      scanJobId: input.scanJobId,
      scanId: scan.id,
      level: "error",
      message: humanScanError(safeMessage),
      data: { blocked, reasonCode: scanFailureReasonCode(message), rawMessage: safeMessage }
    }, db);
    await db.scan.update({
      where: { id: scan.id },
      data: {
        status,
        finishedAt: new Date(),
        errorMessage: safeMessage,
        blockedReason: blocked ? safeMessage : undefined,
        pagesFetched: counters.pagesFetched,
        creativesFound: seen.size,
        detailsFetched: counters.detailsFetched,
        previewsFetched: counters.previewsFetched
      }
    });
    const finalJobCounters = await monotonicJobCounters(input.scanJobId, counters, seen.size, db);
    await db.scanJob.update({
      where: { id: input.scanJobId },
      data: {
        status,
        finishedAt: new Date(),
        errorMessage: safeMessage,
        blockedReason: blocked ? safeMessage : undefined,
        ...finalJobCounters
      }
    });
    await db.advertiser.update({
      where: { id: input.advertiserDbId },
      data: { lastScanAt: new Date(), lastScanStatus: status }
    });

    throw error;
  }
}

function humanScanError(message: string) {
  if (message.startsWith("browser-native:challenge:")) return "Нужна ручная проверка proxy: Google показал captcha или challenge.";
  if (message.startsWith("browser-native:timeout:")) return "Proxy не открыл страницу Google вовремя.";
  if (message.startsWith("blocked:")) return "Google ограничил запрос. Нужна пауза или рабочий proxy.";
  if (message === "scan-canceled") return "Сканирование отменено.";
  return message;
}

function scanFailureReasonCode(message: string) {
  if (message === "scan-canceled") return "SCAN_CANCELED";
  if (message.startsWith("browser-native:challenge:")) return "PROXY_CHALLENGE_REQUIRED";
  if (message.startsWith("browser-native:timeout:")) return "PROXY_TIMEOUT";
  if (message.startsWith("browser-native:empty:")) return "GOOGLE_PAGE_EMPTY";
  if (message.startsWith("blocked:")) return "GOOGLE_BLOCKED";
  if (message.includes("SearchService/SearchCreatives:404")) return "GOOGLE_SEARCH_RPC_NOT_FOUND";
  if (message.startsWith("rpc:")) return "GOOGLE_RPC_FAILED";
  if (message.startsWith("creative-details-failed:")) return "CREATIVE_DETAILS_FAILED";
  return "SCAN_FAILED";
}

function isBlockedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("blocked:") || message.startsWith("browser-native:challenge:") || message.startsWith("browser-native:timeout:");
}

function isBrowserNativeClient(client: GoogleCreativeClient) {
  return client.constructor.name === "BrowserNativeGoogleClient";
}

export function resolveLimits(input: Pick<RunScanInput, "scanMode" | "requestDelayMs" | "maxPagesPerRun" | "maxCreativesPerRun">) {
  const mode = input.scanMode ?? "CAUTIOUS";
  const preset = {
    FAST: { requestDelayMs: 1500, maxPagesPerRun: 1, maxCreativesPerRun: 20 },
    FULL: { requestDelayMs: 8000, maxPagesPerRun: Number.POSITIVE_INFINITY, maxCreativesPerRun: Number.POSITIVE_INFINITY },
    CAUTIOUS: { requestDelayMs: 45000, maxPagesPerRun: 1, maxCreativesPerRun: 10 }
  }[mode];
  return {
    requestDelayMs: input.requestDelayMs ?? preset.requestDelayMs,
    maxPagesPerRun: input.maxPagesPerRun ?? preset.maxPagesPerRun,
    maxCreativesPerRun: input.maxCreativesPerRun ?? preset.maxCreativesPerRun
  };
}

async function saveChunkProgress(
  scanJobId: string,
  scanId: string,
  countryCode: string | undefined,
  nextPageToken: string | undefined,
  counters: ScanCounters,
  creativesFound: number,
  db: DbClient
) {
  const jobCounters = await monotonicJobCounters(scanJobId, counters, creativesFound, db);
  await touchWorkerHeartbeat(db, `scan ${scanJobId}: ${jobCounters.pagesFetched} стр., ${jobCounters.creativesFound} кр.`);
  await Promise.all([
    db.scanJob.update({
      where: { id: scanJobId },
      data: {
        ...jobCounters,
        nextPageToken: nextPageToken ?? null,
        currentCountryCode: countryCode ?? null,
        chunkStartedAt: new Date()
      }
    }),
    db.scan.update({
      where: { id: scanId },
      data: {
        ...counters,
        creativesFound,
        status: "SUCCESS",
        finishedAt: new Date()
      }
    })
  ]);
}

async function persistCounters(
  scanJobId: string,
  scanId: string,
  counters: ScanCounters,
  creativesFound: number,
  db: DbClient
) {
  const jobCounters = await monotonicJobCounters(scanJobId, counters, creativesFound, db);
  await touchWorkerHeartbeat(db, `scan ${scanJobId}: ${jobCounters.pagesFetched} стр., ${jobCounters.creativesFound} кр.`);
  await Promise.all([
    db.scanJob.update({
      where: { id: scanJobId },
      data: jobCounters
    }),
    db.scan.update({
      where: { id: scanId },
      data: { ...counters, creativesFound }
    })
  ]);
}

async function touchWorkerHeartbeat(db: DbClient, message: string) {
  const now = Date.now();
  if (now - lastWorkerHeartbeatTouchAt < 10_000) return;
  lastWorkerHeartbeatTouchAt = now;
  await db.workerHeartbeat.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      status: "running",
      message,
      pid: process.pid,
      lastSeenAt: new Date(now)
    },
    update: {
      status: "running",
      message,
      pid: process.pid,
      lastSeenAt: new Date(now)
    }
  }).catch(() => undefined);
}

async function monotonicJobCounters(
  scanJobId: string,
  counters: ScanCounters,
  creativesFound: number,
  db: DbClient
): Promise<PersistedScanCounters> {
  const current = await db.scanJob.findUnique({
    where: { id: scanJobId },
    select: {
      pagesFetched: true,
      creativesFound: true,
      detailsFetched: true,
      previewsFetched: true
    }
  });

  return mergeMonotonicCounters(current, counters, creativesFound);
}

export function mergeMonotonicCounters(
  current: PersistedScanCounters | null,
  counters: ScanCounters,
  creativesFound: number
): PersistedScanCounters {
  return {
    pagesFetched: Math.max(current?.pagesFetched ?? 0, counters.pagesFetched),
    creativesFound: Math.max(current?.creativesFound ?? 0, creativesFound),
    detailsFetched: Math.max(current?.detailsFetched ?? 0, counters.detailsFetched),
    previewsFetched: Math.max(current?.previewsFetched ?? 0, counters.previewsFetched)
  };
}

async function assertNotCanceled(scanJobId: string, db: DbClient) {
  const job = await db.scanJob.findUnique({ where: { id: scanJobId }, select: { cancelRequested: true } });
  if (job?.cancelRequested) throw new Error("scan-canceled");
}

async function markDisappearedCreatives(input: RunScanInput, scanStartedAt: Date, db: DbClient) {
  const isCompleteAdvertiserScan =
    (input.scanMode ?? "CAUTIOUS") === "FULL" &&
    input.countryCodes.length === 0 &&
    !input.dateRange?.start &&
    !input.dateRange?.end;

  if (!isCompleteAdvertiserScan) return 0;

  const result = await db.creative.updateMany({
    where: {
      advertiserId: input.advertiserDbId,
      status: { not: "STOPPED" },
      lastFoundAt: { lt: scanStartedAt }
    },
    data: { status: "STOPPED" }
  });
  return result.count;
}

async function countNewCreatives(advertiserId: string, scanStartedAt: Date, db: DbClient) {
  return db.creative.count({
    where: {
      advertiserId,
      firstFoundAt: { gte: scanStartedAt }
    }
  });
}

function delay(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function findGeoByCountryCode(countryCode: string) {
  for (let id = 1; id <= 3000; id += 1) {
    const geo = getGeoTarget(id);
    if (geo?.countryCode === countryCode.toUpperCase()) return geo;
  }
  return undefined;
}
