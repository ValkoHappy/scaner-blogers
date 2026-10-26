"use server";

import {
  getSystemSettings,
  queueAdvertiserScan,
  queueCollectionJob,
  stringList,
  upsertAdvertiser,
  upsertSearchKeyword,
  prisma
} from "@scaner-blogers/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { instagramScanPreset } from "@/lib/instagram-scan-presets";
import { vkScanPreset } from "@/lib/vk-scan-presets";
import { estimateYouTubeQuotaUnits, youtubeScanPreset } from "@/lib/youtube-scan-presets";
import { platformFollowerRange } from "@/lib/platform-follower-ranges";

export async function addAdvertiserAction(formData: FormData) {
  await requireAuth();
  const input = String(formData.get("input") ?? "");
  const name = String(formData.get("name") ?? "") || undefined;
  const countries = parseCountries(String(formData.get("countries") ?? ""));
  const scanMode = scanModeValue(formData.get("scanMode"));

  await upsertAdvertiser({ input, name, selectedCountries: countries, scanMode });
  revalidatePath("/advertisers");
  revalidatePath("/");
}

export async function addKeywordAction(formData: FormData) {
  await requireAuth();
  const value = String(formData.get("value") ?? "").trim();
  if (!value) return;

  const hashtags = parseTags(String(formData.get("hashtags") ?? ""));
  await upsertSearchKeyword({
    value,
    topic: String(formData.get("topic") ?? "").trim() || undefined,
    platforms: ["instagram", "vk", "youtube"],
    countries: parseCountries(String(formData.get("countries") ?? "RU KZ")),
    minFollowers: numberValue(formData.get("minFollowers")) ?? 20_000,
    maxFollowers: numberValue(formData.get("maxFollowers")) ?? 60_000,
    instagramMinFollowers: numberValue(formData.get("instagramMinFollowers")) ?? 20_000,
    instagramMaxFollowers: numberValue(formData.get("instagramMaxFollowers")) ?? 60_000,
    vkMinFollowers: numberValue(formData.get("vkMinFollowers")) ?? 5_000,
    vkMaxFollowers: numberValue(formData.get("vkMaxFollowers")) ?? 100_000,
    youtubeMinFollowers: numberValue(formData.get("youtubeMinFollowers")) ?? 10_000,
    youtubeMaxFollowers: numberValue(formData.get("youtubeMaxFollowers")) ?? 150_000,
    hashtags: hashtags.length ? hashtags : [keywordToHashtag(value)],
    notes: String(formData.get("notes") ?? "").trim() || undefined
  });

  revalidatePath("/keywords");
  revalidatePath("/");
  redirect("/keywords");
}

export async function addKeywordsBulkAction(formData: FormData) {
  await requireAuth();
  const values = parseBulkKeywords(String(formData.get("values") ?? ""));
  if (!values.length) return;

  const countries = parseCountries(String(formData.get("countries") ?? "RU KZ"));
  const instagramMinFollowers = numberValue(formData.get("instagramMinFollowers")) ?? 20_000;
  const instagramMaxFollowers = numberValue(formData.get("instagramMaxFollowers")) ?? 60_000;
  const vkMinFollowers = numberValue(formData.get("vkMinFollowers")) ?? 5_000;
  const vkMaxFollowers = numberValue(formData.get("vkMaxFollowers")) ?? 100_000;
  const youtubeMinFollowers = numberValue(formData.get("youtubeMinFollowers")) ?? 10_000;
  const youtubeMaxFollowers = numberValue(formData.get("youtubeMaxFollowers")) ?? 150_000;
  const queueAfterAdd = String(formData.get("queueAfterAdd") ?? "") === "1";
  const autoHashtags = String(formData.get("autoHashtags") ?? "") === "1";
  const queuePlatforms = selectedCollectionPlatforms(formData.getAll("queuePlatforms"));
  const instagramPreset = instagramScanPreset(formData.get("instagramBulkScanMode"));
  const vkPreset = vkScanPreset(formData.get("vkBulkScanMode"));
  const youtubePreset = youtubeScanPreset(formData.get("youtubeBulkScanMode"));

  for (const value of values) {
    const keyword = await upsertSearchKeyword({
      value,
      platforms: ["instagram", "vk", "youtube"],
      countries,
      minFollowers: instagramMinFollowers,
      maxFollowers: instagramMaxFollowers,
      instagramMinFollowers,
      instagramMaxFollowers,
      vkMinFollowers,
      vkMaxFollowers,
      youtubeMinFollowers,
      youtubeMaxFollowers,
      hashtags: autoHashtags ? [keywordToHashtag(value)] : []
    });
    if (queueAfterAdd) {
      await queueKeywordForPlatforms(keyword, queuePlatforms, {
        instagram: instagramPreset,
        vk: vkPreset,
        youtube: youtubePreset,
        ranges: {
          instagram: { minFollowers: instagramMinFollowers, maxFollowers: instagramMaxFollowers },
          vk: { minFollowers: vkMinFollowers, maxFollowers: vkMaxFollowers },
          youtube: { minFollowers: youtubeMinFollowers, maxFollowers: youtubeMaxFollowers }
        }
      });
    }
  }

  revalidatePath("/keywords");
  revalidatePath("/scans");
  revalidatePath("/");
  redirect("/keywords");
}

export async function queueAllKeywordsAction(formData: FormData) {
  await requireAuth();
  const platforms = selectedCollectionPlatforms(formData.getAll("platforms"));
  if (!platforms.length) return;

  const onlyUncollected = String(formData.get("onlyUncollected") ?? "") === "1";
  const keywords = await prisma.searchKeyword.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      jobs: {
        select: { platform: true }
      }
    }
  });
  const presets = {
    instagram: instagramScanPreset(formData.get("instagramBulkScanMode")),
    vk: vkScanPreset(formData.get("vkBulkScanMode")),
    youtube: youtubeScanPreset(formData.get("youtubeBulkScanMode"))
  };
  const ranges = {
    instagram: {
      minFollowers: numberValue(formData.get("instagramMinFollowers")),
      maxFollowers: numberValue(formData.get("instagramMaxFollowers"))
    },
    vk: {
      minFollowers: numberValue(formData.get("vkMinFollowers")),
      maxFollowers: numberValue(formData.get("vkMaxFollowers"))
    },
    youtube: {
      minFollowers: numberValue(formData.get("youtubeMinFollowers")),
      maxFollowers: numberValue(formData.get("youtubeMaxFollowers"))
    }
  };

  for (const keyword of keywords) {
    const targetPlatforms = onlyUncollected
      ? platforms.filter((platform) => !keyword.jobs.some((job) => platformValue(job.platform) === platform))
      : platforms;
    if (!targetPlatforms.length) continue;
    await queueKeywordForPlatforms(keyword, targetPlatforms, { instagram: presets.instagram, vk: presets.vk, youtube: presets.youtube, ranges });
  }

  revalidatePath("/keywords");
  revalidatePath("/scans");
  redirect("/keywords");
}

export async function queueVkKeywordAction(formData: FormData) {
  await requireAuth();
  const keywordId = String(formData.get("keywordId") ?? "");
  if (!keywordId) return;

  const keyword = await prisma.searchKeyword.findUnique({ where: { id: keywordId } });
  if (!keyword) return;
  const scanPreset = vkScanPreset(formData.get("vkScanMode"));
  const range = platformFollowerRange(keyword, "vk");
  const minFollowers = numberValue(formData.get("minFollowers")) ?? range.minFollowers;
  const maxFollowers = numberValue(formData.get("maxFollowers")) ?? range.maxFollowers;

  await queueCollectionJob({
    keywordId: keyword.id,
    platform: "vk",
    minFollowers,
    maxFollowers,
    countries: stringList(keyword.countries),
    maxProfiles: scanPreset.maxProfiles,
    config: {
      ...scanPreset.config,
      requireGeoMatch: false
    }
  });

  revalidatePath("/keywords");
  revalidatePath("/scans");
  redirect("/keywords");
}

export async function queueInstagramKeywordAction(formData: FormData) {
  await requireAuth();
  const keywordId = String(formData.get("keywordId") ?? "");
  if (!keywordId) return;

  const keyword = await prisma.searchKeyword.findUnique({ where: { id: keywordId } });
  if (!keyword) return;
  const scanPreset = instagramScanPreset(formData.get("instagramScanMode"));
  const range = platformFollowerRange(keyword, "instagram");
  const minFollowers = numberValue(formData.get("minFollowers")) ?? range.minFollowers;
  const maxFollowers = numberValue(formData.get("maxFollowers")) ?? range.maxFollowers;

  await queueCollectionJob({
    keywordId: keyword.id,
    platform: "instagram",
    minFollowers,
    maxFollowers,
    countries: stringList(keyword.countries),
    hashtags: stringList(keyword.hashtags),
    maxProfiles: scanPreset.maxProfiles,
    config: {
      ...scanPreset.config,
      quotaEstimate: estimateYouTubeQuotaUnits(scanPreset, {
        keywordCount: 1,
        countryCount: Math.max(1, stringList(keyword.countries).length || 1)
      }),
      requireGeoMatch: false
    }
  });

  revalidatePath("/keywords");
  revalidatePath("/scans");
  redirect("/keywords");
}

export async function queueYouTubeKeywordAction(formData: FormData) {
  await requireAuth();
  const keywordId = String(formData.get("keywordId") ?? "");
  if (!keywordId) return;

  const keyword = await prisma.searchKeyword.findUnique({ where: { id: keywordId } });
  if (!keyword) return;
  const scanPreset = youtubeScanPreset(formData.get("youtubeScanMode"));
  const range = platformFollowerRange(keyword, "youtube");
  const minFollowers = numberValue(formData.get("minFollowers")) ?? range.minFollowers;
  const maxFollowers = numberValue(formData.get("maxFollowers")) ?? range.maxFollowers;

  await queueCollectionJob({
    keywordId: keyword.id,
    platform: "youtube",
    minFollowers,
    maxFollowers,
    countries: stringList(keyword.countries),
    maxProfiles: scanPreset.maxProfiles,
    config: {
      ...scanPreset.config,
      requireGeoMatch: false
    }
  });

  revalidatePath("/keywords");
  revalidatePath("/scans");
  redirect("/keywords");
}

export async function updateAdvertiserAction(formData: FormData) {
  await requireAuth();
  const advertiserId = String(formData.get("advertiserId") ?? "");
  if (!advertiserId) return;

  const name = String(formData.get("name") ?? "").trim();
  const countries = parseCountries(String(formData.get("countries") ?? ""));
  const scanMode = scanModeValue(formData.get("scanMode"));
  const requestDelayMs = numberValue(formData.get("requestDelayMs"));
  const scanStartDate = dateValue(formData.get("scanStartDate"));
  const scanEndDate = dateValue(formData.get("scanEndDate"));
  const notes = String(formData.get("notes") ?? "").trim();

  await prisma.advertiser.update({
    where: { id: advertiserId },
    data: {
      name: name || null,
      selectedCountries: countries,
      scanMode,
      dailyScanEnabled: formData.get("dailyScanEnabled") === "on",
      requestDelayMs,
      scanStartDate,
      scanEndDate,
      notes: notes || null
    }
  });

  revalidatePath("/");
  revalidatePath("/advertisers");
  revalidatePath(`/advertisers/${advertiserId}`);
  revalidatePath("/scans");
}

export async function queueScanAction(formData: FormData) {
  await requireAuth();
  const advertiserId = String(formData.get("advertiserId") ?? "");

  if (!advertiserId) return;
  const advertiser = await prisma.advertiser.findUnique({ where: { id: advertiserId } });
  if (!advertiser) return;
  const settings = await getSystemSettings(prisma);

  await queueAdvertiserScan(advertiserId, [], {
    scanMode: advertiser.scanMode ?? settings.scanMode,
    requestDelayMs: advertiser.requestDelayMs ?? settings.requestDelayMs,
    maxPagesPerRun: advertiser.maxPagesPerRun ?? settings.maxPagesPerRun ?? undefined,
    maxCreativesPerRun: advertiser.maxCreativesPerRun ?? settings.maxCreativesPerRun ?? undefined,
    scanStartDate: advertiser.scanStartDate,
    scanEndDate: advertiser.scanEndDate
  });
  revalidatePath("/advertisers");
  revalidatePath("/scans");
}

export async function runFullScanAction(formData: FormData) {
  await requireAuth();
  const advertiserId = String(formData.get("advertiserId") ?? "");
  if (!advertiserId) return;

  const advertiser = await prisma.advertiser.findUnique({ where: { id: advertiserId } });
  if (!advertiser) return;
  const settings = await getSystemSettings(prisma);

  await queueAdvertiserScan(advertiserId, [], {
    scanMode: "FULL",
    requestDelayMs: advertiser.requestDelayMs ?? settings.requestDelayMs,
    maxPagesPerRun: undefined,
    maxCreativesPerRun: undefined,
    scanStartDate: advertiser.scanStartDate,
    scanEndDate: advertiser.scanEndDate
  });
  revalidatePath("/");
  revalidatePath("/advertisers");
  revalidatePath(`/advertisers/${advertiser.id}`);
  revalidatePath("/scans");
}

export async function retryScanAction(formData: FormData) {
  await requireAuth();
  const scanJobId = String(formData.get("scanJobId") ?? "");
  if (!scanJobId) return;
  const job = await prisma.scanJob.findUnique({ where: { id: scanJobId } });
  if (!job) return;
  await queueAdvertiserScan(job.advertiserId, stringList(job.countries), {
    retryOfJobId: job.id,
    scanMode: job.scanMode,
    requestDelayMs: job.requestDelayMs ?? undefined,
    maxPagesPerRun: job.maxPagesPerRun ?? undefined,
    maxCreativesPerRun: job.maxCreativesPerRun ?? undefined,
    scanStartDate: job.scanStartDate,
    scanEndDate: job.scanEndDate,
    retryRequestedFrom: "admin"
  });
  revalidatePath("/scans");
  revalidatePath(`/advertisers/${job.advertiserId}`);
}

export async function cancelScanAction(formData: FormData) {
  await requireAuth();
  const scanJobId = String(formData.get("scanJobId") ?? "");
  if (!scanJobId) return;
  const job = await prisma.scanJob.findUnique({ where: { id: scanJobId } });
  if (!job) return;
  await prisma.$transaction(async (tx) => {
    await tx.scanJob.update({
      where: { id: scanJobId },
      data: job.status === "QUEUED"
        ? { status: "CANCELED", finishedAt: new Date(), cancelRequested: true }
        : { cancelRequested: true }
    });
    await tx.scanEvent.create({
      data: {
        scanJobId,
        level: "info",
        message: "scan-cancel-requested",
        data: {
          code: "scan_cancel_requested",
          requestedFrom: "admin",
          previousStatus: job.status
        }
      }
    });
  });
  revalidatePath("/scans");
  revalidatePath(`/advertisers/${job.advertiserId}`);
}

export async function retryCollectionJobAction(formData: FormData) {
  await requireAuth();
  const collectionJobId = String(formData.get("collectionJobId") ?? "");
  if (!collectionJobId) return;
  const job = await prisma.collectionJob.findUnique({ where: { id: collectionJobId } });
  if (!job) return;

  await queueCollectionJob({
    keywordId: job.keywordId ?? undefined,
    platform: platformValue(job.platform),
    minFollowers: job.minFollowers,
    maxFollowers: job.maxFollowers,
    countries: stringList(job.countries),
    hashtags: stringList(job.hashtags),
    requestDelayMs: job.requestDelayMs ?? undefined,
    maxProfiles: job.maxProfiles ?? undefined,
    config: job.config ?? undefined,
    retryOfJobId: job.id,
    retryRequestedFrom: "admin"
  });

  revalidatePath("/scans");
  revalidatePath("/keywords");
}

export async function cancelCollectionJobAction(formData: FormData) {
  await requireAuth();
  const collectionJobId = String(formData.get("collectionJobId") ?? "");
  if (!collectionJobId) return;
  const job = await prisma.collectionJob.findUnique({ where: { id: collectionJobId } });
  if (!job) return;
  await prisma.$transaction(async (tx) => {
    await tx.collectionJob.update({
      where: { id: collectionJobId },
      data: job.status === "QUEUED"
        ? { status: "CANCELED", finishedAt: new Date(), cancelRequested: true }
        : { cancelRequested: true }
    });
    await tx.collectionEvent.create({
      data: {
        collectionJobId,
        level: "info",
        message: "collection-cancel-requested",
        data: {
          code: "collection_cancel_requested",
          requestedFrom: "admin",
          previousStatus: job.status
        }
      }
    });
  });
  revalidatePath("/scans");
  revalidatePath("/keywords");
}

export async function cancelAllActiveWorkAction() {
  await requireAuth();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const [scanJobs, collectionJobs] = await Promise.all([
      tx.scanJob.findMany({
        where: {
          status: { in: ["QUEUED", "RUNNING"] },
          cancelRequested: false
        },
        select: { id: true, status: true }
      }),
      tx.collectionJob.findMany({
        where: {
          status: { in: ["QUEUED", "RUNNING"] },
          cancelRequested: false
        },
        select: { id: true, status: true, platform: true }
      })
    ]);

    await tx.scanJob.updateMany({
      where: { status: "QUEUED", cancelRequested: false },
      data: { status: "CANCELED", finishedAt: now, cancelRequested: true }
    });
    await tx.scanJob.updateMany({
      where: { status: "RUNNING", cancelRequested: false },
      data: { cancelRequested: true }
    });
    await tx.collectionJob.updateMany({
      where: { status: "QUEUED", cancelRequested: false },
      data: { status: "CANCELED", finishedAt: now, cancelRequested: true }
    });
    await tx.collectionJob.updateMany({
      where: { status: "RUNNING", cancelRequested: false },
      data: { cancelRequested: true }
    });

    if (scanJobs.length) {
      await tx.scanEvent.createMany({
        data: scanJobs.map((job) => ({
          scanJobId: job.id,
          level: "info",
          message: "scan-cancel-all-requested",
          data: {
            code: "scan_cancel_all_requested",
            requestedFrom: "admin",
            previousStatus: job.status
          }
        }))
      });
    }

    if (collectionJobs.length) {
      await tx.collectionEvent.createMany({
        data: collectionJobs.map((job) => ({
          collectionJobId: job.id,
          level: "info",
          message: "collection-cancel-all-requested",
          data: {
            code: "collection_cancel_all_requested",
            requestedFrom: "admin",
            platform: job.platform,
            previousStatus: job.status
          }
        }))
      });
    }
  });
  revalidatePath("/scans");
  revalidatePath("/keywords");
  revalidatePath("/advertisers");
}

export async function goToCreativeAction(formData: FormData) {
  await requireAuth();
  const creativeId = String(formData.get("creativeId") ?? "");
  if (creativeId) redirect(`/creatives/${creativeId}`);
}

function parseCountries(value: string) {
  return value
    .split(/[,\s]+/)
    .map((country) => country.trim().toUpperCase())
    .filter(Boolean);
}

function parseTags(value: string) {
  return value
    .split(/[,\s]+/)
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean);
}

function parseBulkKeywords(value: string) {
  return Array.from(new Set(value
    .split(/[\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean)));
}

function keywordToHashtag(value: string) {
  return value
    .trim()
    .replace(/^#/, "")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}_]+/gu, "");
}

function scanModeValue(value: FormDataEntryValue | null) {
  return value === "FAST" || value === "FULL" || value === "CAUTIOUS" ? value : undefined;
}

function numberValue(value: FormDataEntryValue | null) {
  if (value === null || String(value).trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function dateValue(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function platformValue(value: string): "instagram" | "vk" | "youtube" {
  if (value === "INSTAGRAM") return "instagram";
  if (value === "VK") return "vk";
  if (value === "YOUTUBE") return "youtube";
  return "instagram";
}

type CollectionPlatform = "instagram" | "vk" | "youtube";
type CollectionPreset = ReturnType<typeof instagramScanPreset>;
type BulkRangeInput = { minFollowers?: number; maxFollowers?: number };

function selectedCollectionPlatforms(values: FormDataEntryValue[]): CollectionPlatform[] {
  const allowed = new Set<CollectionPlatform>(["instagram", "vk", "youtube"]);
  const platforms = values
    .map((value) => String(value).toLowerCase())
    .filter((value): value is CollectionPlatform => allowed.has(value as CollectionPlatform));
  return Array.from(new Set(platforms));
}

async function queueKeywordForPlatforms(
  keyword: Awaited<ReturnType<typeof upsertSearchKeyword>>,
  platforms: CollectionPlatform[],
  options: {
    instagram: CollectionPreset;
    vk: CollectionPreset;
    youtube: CollectionPreset;
    ranges?: Partial<Record<CollectionPlatform, BulkRangeInput>>;
  }
) {
  for (const platform of platforms) {
    const range = platformFollowerRange(keyword, platform);
    const override = options.ranges?.[platform];
    const minFollowers = override?.minFollowers ?? range.minFollowers;
    const maxFollowers = override?.maxFollowers ?? range.maxFollowers;
    const preset = options[platform];
    await queueCollectionJob({
      keywordId: keyword.id,
      platform,
      minFollowers,
      maxFollowers,
      countries: stringList(keyword.countries),
      hashtags: platform === "instagram" ? stringList(keyword.hashtags) : undefined,
      maxProfiles: preset.maxProfiles,
      config: {
        ...preset.config,
        ...(platform === "instagram"
          ? {
            quotaEstimate: estimateYouTubeQuotaUnits(preset, {
              keywordCount: 1,
              countryCount: Math.max(1, stringList(keyword.countries).length || 1)
            })
          }
          : {}),
        requireGeoMatch: false
      }
    });
  }
}
