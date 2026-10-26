import type { NormalizedCreative } from "@scaner-blogers/core";
import type { Prisma } from "./generated/prisma/client";
import type { CreativeFilters } from "./filters.js";
import { sanitizeEventData, sanitizeEventMessage } from "./event-sanitize.js";
import { buildCreativeWhere } from "./filters.js";
import { jsonNumberList, jsonStringList, numberList, stringList } from "./list-json.js";
import { buildCreativePersistenceModel, parseAdvertiserInput } from "./mappers.js";
import { prisma as defaultPrisma } from "./prisma.js";

type DbClient = typeof defaultPrisma;

export interface CreateAdvertiserInput {
  input: string;
  name?: string;
  selectedCountries?: string[];
  notes?: string;
  dailyScanEnabled?: boolean;
  scanMode?: "FAST" | "FULL" | "CAUTIOUS";
  requestDelayMs?: number;
  maxPagesPerRun?: number;
  maxCreativesPerRun?: number;
  scanStartDate?: string | null;
  scanEndDate?: string | null;
}

export interface QueueScanOptions {
  scanMode?: "FAST" | "FULL" | "CAUTIOUS";
  requestDelayMs?: number;
  maxPagesPerRun?: number;
  maxCreativesPerRun?: number;
  scanStartDate?: string | null;
  scanEndDate?: string | null;
  retryOfJobId?: string;
  retryRequestedFrom?: "admin" | "api" | "system";
}

export interface SystemSettingsInput {
  vkAppId?: string | null;
  scanMode?: "FAST" | "FULL" | "CAUTIOUS";
  dailyScanHour?: number;
  scheduleType?: string;
  dailyScanHours?: number[];
  scanIntervalHours?: number | null;
  requestDelayMs?: number;
  maxPagesPerRun?: number | null;
  maxCreativesPerRun?: number | null;
  workerConcurrency?: number;
  advertiserDelayMs?: number;
  probeIntervalMs?: number;
  rawSnapshotRetentionDays?: number;
  scanEventRetentionDays?: number;
  exportDefaultFields?: string[];
  proxyEnabled?: boolean;
  proxyUrl?: string | null;
}

export async function upsertAdvertiser(input: CreateAdvertiserInput, db: DbClient = defaultPrisma) {
  const parsed = parseAdvertiserInput(input.input);

  return db.advertiser.upsert({
    where: { googleAdvertiserId: parsed.googleAdvertiserId },
    create: {
      googleAdvertiserId: parsed.googleAdvertiserId,
      transparencyUrl: parsed.transparencyUrl,
      name: input.name,
      selectedCountries: jsonStringList(input.selectedCountries, []),
      dailyScanEnabled: input.dailyScanEnabled ?? true,
      scanMode: input.scanMode,
      requestDelayMs: input.requestDelayMs,
      maxPagesPerRun: input.maxPagesPerRun,
      maxCreativesPerRun: input.maxCreativesPerRun,
      scanStartDate: input.scanStartDate,
      scanEndDate: input.scanEndDate,
      notes: input.notes
    },
    update: {
      transparencyUrl: parsed.transparencyUrl,
      name: input.name,
      selectedCountries: jsonStringList(input.selectedCountries),
      dailyScanEnabled: input.dailyScanEnabled,
      scanMode: input.scanMode,
      requestDelayMs: input.requestDelayMs,
      maxPagesPerRun: input.maxPagesPerRun,
      maxCreativesPerRun: input.maxCreativesPerRun,
      scanStartDate: input.scanStartDate,
      scanEndDate: input.scanEndDate,
      notes: input.notes
    }
  });
}

export async function queueAdvertiserScan(
  advertiserId: string,
  countries: string[],
  optionsOrDb: QueueScanOptions | DbClient = {},
  maybeDb?: DbClient
) {
  const db = isDbClient(optionsOrDb) ? optionsOrDb : maybeDb ?? defaultPrisma;
  const options = isDbClient(optionsOrDb) ? {} : optionsOrDb;
  if (!options.retryOfJobId) {
    const activeJob = await db.scanJob.findFirst({
      where: {
        advertiserId,
        status: { in: ["QUEUED", "RUNNING"] }
      },
      orderBy: { createdAt: "desc" }
    });

    if (activeJob) {
      await recordScanEvent({
        scanJobId: activeJob.id,
        level: "info",
        message: "scan-queue-deduped",
        data: {
          code: "scan_queue_deduped",
          requestedAdvertiserId: advertiserId,
          requestedCountries: countries,
          activeStatus: activeJob.status
        }
      }, db);
      return activeJob;
    }
  }

  const job = await db.scanJob.create({
    data: {
      advertiserId,
      countries: jsonStringList(countries, []),
      status: "QUEUED",
      scanMode: options.scanMode ?? "FULL",
      requestDelayMs: options.requestDelayMs,
      maxPagesPerRun: options.maxPagesPerRun,
      maxCreativesPerRun: options.maxCreativesPerRun,
      scanStartDate: options.scanStartDate,
      scanEndDate: options.scanEndDate,
      retryOfJobId: options.retryOfJobId
    }
  });
  await recordScanEvent({
    scanJobId: job.id,
    level: "info",
    message: "Задача добавлена в очередь",
    data: {
      reasonCode: "SCAN_QUEUED",
      retryOfJobId: options.retryOfJobId
    }
  }, db);
  if (options.retryOfJobId) {
    await recordScanEvent({
      scanJobId: options.retryOfJobId,
      level: "info",
      message: "scan-retry-requested",
      data: {
        code: "scan_retry_requested",
        requestedFrom: options.retryRequestedFrom ?? "system",
        retryJobId: job.id
      }
    }, db);
  }
  return job;
}

export async function getSystemSettings(db: DbClient = defaultPrisma) {
  const settings = await db.systemSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {}
  });
  return normalizeSystemSettings(settings);
}

export async function updateSystemSettings(input: SystemSettingsInput, db: DbClient = defaultPrisma) {
  const settings = await db.systemSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      ...settingsData(input)
    },
    update: settingsData(input)
  });
  return normalizeSystemSettings(settings);
}

export async function findCreatives(filters: CreativeFilters, db: DbClient = defaultPrisma, take = 200, skip = 0) {
  return db.creative.findMany({
    where: buildCreativeWhere(filters),
    include: {
      advertiser: true,
      app: true,
      countries: { take: 8 },
      assets: { take: 1 }
    },
    orderBy: { updatedAt: "desc" },
    skip,
    take
  });
}

export async function countCreatives(filters: CreativeFilters, db: DbClient = defaultPrisma) {
  return db.creative.count({ where: buildCreativeWhere(filters) });
}

export async function saveNormalizedCreative(
  advertiserDbId: string,
  normalized: NormalizedCreative,
  db: DbClient = defaultPrisma
) {
  const model = buildCreativePersistenceModel(normalized);
  const advertiserName = normalized.advertiserName?.trim();

  if (advertiserName) {
    await db.advertiser.updateMany({
      where: {
        id: advertiserDbId,
        OR: [
          { name: null },
          { name: "" }
        ]
      },
      data: { name: advertiserName }
    });
  }

  const app = model.app
    ? await db.app.upsert({
      where: model.app.where,
      create: model.app.create,
      update: model.app.update
    })
    : undefined;

  const creative = await db.creative.upsert({
    where: { creativeId: model.creative.creativeId },
    create: {
      ...model.creative,
      rawList: jsonOrUndefined(model.creative.rawList),
      rawDetail: jsonOrUndefined(model.creative.rawDetail),
      rawPreview: jsonOrUndefined(model.creative.rawPreview),
      advertiserId: advertiserDbId,
      appDbId: app?.id
    },
    update: {
      ...model.creative,
      rawList: jsonOrUndefined(model.creative.rawList),
      rawDetail: jsonOrUndefined(model.creative.rawDetail),
      rawPreview: jsonOrUndefined(model.creative.rawPreview),
      advertiserId: advertiserDbId,
      appDbId: app?.id,
      lastFoundAt: new Date()
    }
  });

  const assets = uniqueBy(model.assets, (asset) => `${asset.kind}:${asset.url}`);
  const countries = uniqueBy(model.countries, (country) => String(country.googleGeoId));

  await Promise.all([
    ...assets.map((asset) => db.creativeAsset.upsert({
      where: {
        creativeId_kind_url: {
          creativeId: creative.id,
          kind: asset.kind,
          url: asset.url
        }
      },
      create: {
        creativeId: creative.id,
        kind: asset.kind,
        url: asset.url,
        width: asset.width,
        height: asset.height
      },
      update: {
        width: asset.width,
        height: asset.height
      }
    })),
    ...countries.map((country) => db.creativeCountry.upsert({
      where: {
        creativeId_googleGeoId: {
          creativeId: creative.id,
          googleGeoId: country.googleGeoId
        }
      },
      create: {
        creativeId: creative.id,
        ...country,
        raw: jsonOrUndefined(country.raw)
      },
      update: {
        ...country,
        raw: jsonOrUndefined(country.raw)
      }
    })),
    ...model.rawSnapshots.map((snapshot) => db.rawApiSnapshot.create({
      data: {
        creativeId: creative.id,
        kind: snapshot.kind,
        payload: jsonValue(snapshot.payload)
      }
    }))
  ]);

  return creative;
}

export async function refreshAdvertiserCounters(advertiserId: string, db: DbClient = defaultPrisma) {
  const [totalCreatives, activeCreatives] = await Promise.all([
    db.creative.count({ where: { advertiserId } }),
    db.creative.count({ where: { advertiserId, status: "ACTIVE" } })
  ]);

  return db.advertiser.update({
    where: { id: advertiserId },
    data: {
      totalCreatives,
      activeCreatives
    }
  });
}

export async function recordScanEvent(
  input: {
    scanJobId?: string;
    scanId?: string;
    level: "info" | "warn" | "error";
    message: string;
    data?: unknown;
  },
  db: DbClient = defaultPrisma
) {
  return db.scanEvent.create({
    data: {
      scanJobId: input.scanJobId,
      scanId: input.scanId,
      level: input.level,
      message: sanitizeEventMessage(input.message),
      data: jsonOrUndefined(sanitizeEventData(input.data))
    } as Prisma.ScanEventUncheckedCreateInput
  });
}

function jsonOrUndefined(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : jsonValue(value);
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isDbClient(value: QueueScanOptions | DbClient): value is DbClient {
  return Boolean((value as DbClient).scanJob);
}

function settingsData(input: SystemSettingsInput) {
  return {
    vkAppId: input.vkAppId,
    scanMode: input.scanMode,
    dailyScanHour: input.dailyScanHour,
    scheduleType: input.scheduleType,
    dailyScanHours: jsonNumberList(input.dailyScanHours),
    scanIntervalHours: input.scanIntervalHours,
    requestDelayMs: input.requestDelayMs,
    maxPagesPerRun: input.maxPagesPerRun,
    maxCreativesPerRun: input.maxCreativesPerRun,
    workerConcurrency: input.workerConcurrency,
    advertiserDelayMs: input.advertiserDelayMs,
    probeIntervalMs: input.probeIntervalMs,
    rawSnapshotRetentionDays: input.rawSnapshotRetentionDays,
    scanEventRetentionDays: input.scanEventRetentionDays,
    exportDefaultFields: jsonStringList(input.exportDefaultFields),
    proxyEnabled: input.proxyEnabled,
    proxyUrl: input.proxyUrl
  };
}

function normalizeSystemSettings<T extends {
  defaultCountries: unknown;
  dailyScanHours: unknown;
  exportDefaultFields: unknown;
}>(settings: T) {
  return {
    ...settings,
    defaultCountries: stringList(settings.defaultCountries),
    dailyScanHours: numberList(settings.dailyScanHours, [dailyScanHourFallback(settings)]),
    exportDefaultFields: stringList(settings.exportDefaultFields)
  };
}

function dailyScanHourFallback(value: unknown) {
  if (!value || typeof value !== "object" || !("dailyScanHour" in value)) return 3;
  const hour = (value as { dailyScanHour?: unknown }).dailyScanHour;
  return typeof hour === "number" && Number.isInteger(hour) ? hour : 3;
}
