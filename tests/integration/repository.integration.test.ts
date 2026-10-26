import { beforeEach, describe, expect, it } from "vitest";
import {
  getSystemSettings,
  prisma,
  queueAdvertiserScan,
  queueCollectionJob,
  updateSystemSettings,
  upsertAdvertiser,
  upsertSearchKeyword,
  stringList
} from "@scaner-blogers/db";
import { buildCreativeWhere } from "@scaner-blogers/db";
import { buildCandidateProfileWhere } from "../../apps/web/lib/candidate-profile-filters";
import { seedDemoData } from "../../scripts/seed-demo-data";
import { clearTestDatabase } from "./test-db";

describe("repository integration", () => {
  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("upserts advertiser, queues scans, saves normalized creatives and stays idempotent", async () => {
    const advertiser = await upsertAdvertiser({
      input: "https://adstransparency.google.com/advertiser/AR14577439029227159553?region=GB",
      name: "Karen Manukyan",
      selectedCountries: ["GB", "BE"]
    });

    const job = await queueAdvertiserScan(advertiser.id, ["GB"]);
    expect(job.status).toBe("QUEUED");

    await seedDemoData(prisma);
    await seedDemoData(prisma);

    expect(await prisma.advertiser.count()).toBe(1);
    expect(await prisma.app.count()).toBe(1);
    expect(await prisma.creative.count()).toBe(1);
    expect(await prisma.creativeAsset.count()).toBe(1);
    expect(await prisma.creativeCountry.count()).toBe(3);
    expect(await prisma.rawApiSnapshot.count()).toBeGreaterThanOrEqual(3);

    const creative = await prisma.creative.findUniqueOrThrow({
      where: { creativeId: "CR06346342443637538817" },
      include: { advertiser: true, app: true, countries: true }
    });
    expect(creative.advertiser.googleAdvertiserId).toBe("AR14577439029227159553");
    expect(creative.app?.appId).toBe("com.flightsbooking.tickets.app");
    expect(creative.countries.map((country) => country.countryCode).sort()).toEqual(["DE", "GB", "IT"]);
    expect(await prisma.creative.count({ where: buildCreativeWhere({ q: "cr063", appId: "FLIGHTS" }) })).toBe(1);
    await expect(prisma.candidateProfile.findMany({ where: buildCandidateProfileWhere({ q: "test" }) })).resolves.toEqual([]);
  });

  it("creates and updates singleton settings in the database", async () => {
    const defaults = await getSystemSettings(prisma);
    expect(defaults.defaultCountries).toEqual([]);
    expect(defaults.scanMode).toBe("FULL");

    const updated = await updateSystemSettings({
      scanMode: "FULL",
      requestDelayMs: 1500,
      exportDefaultFields: ["creativeId", "advertiserName", "status"],
      proxyEnabled: true,
      proxyUrl: "http://proxy.local:8080"
    }, prisma);

    expect(updated.defaultCountries).toEqual([]);
    expect(updated.scanMode).toBe("FULL");
    expect(updated.requestDelayMs).toBe(1500);
    expect(await prisma.systemSettings.count()).toBe(1);
  });

  it("queues scan jobs with mode and retry metadata without executing worker code", async () => {
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553", selectedCountries: ["GB"] });
    const original = await queueAdvertiserScan(advertiser.id, ["GB"], { scanMode: "FULL", maxPagesPerRun: 10 });
    const retry = await queueAdvertiserScan(advertiser.id, ["GB"], {
      retryOfJobId: original.id,
      retryRequestedFrom: "admin",
      scanMode: "CAUTIOUS"
    });

    expect(original.status).toBe("QUEUED");
    expect(original.scanMode).toBe("FULL");
    expect(original.maxPagesPerRun).toBe(10);
    expect(retry.retryOfJobId).toBe(original.id);
    const retryEvents = await prisma.scanEvent.findMany({
      where: { scanJobId: original.id },
      orderBy: { createdAt: "asc" }
    });
    expect(retryEvents.some((event) => event.message === "scan-retry-requested")).toBe(true);
    expect(JSON.stringify(retryEvents)).toContain("scan_retry_requested");
    expect(JSON.stringify(retryEvents)).toContain("admin");
    expect(await prisma.scan.count()).toBe(0);
  });

  it("records social collection queue and retry events", async () => {
    const keyword = await upsertSearchKeyword({ value: "РјР°СЃСЃР°Р¶ Р»РёС†Р°" });
    const original = await queueCollectionJob({
      keywordId: keyword.id,
      platform: "instagram",
      minFollowers: 20_000,
      maxFollowers: 60_000,
      countries: ["RU"],
      hashtags: ["massageface"]
    });
    const retry = await queueCollectionJob({
      keywordId: keyword.id,
      platform: "instagram",
      minFollowers: original.minFollowers,
      maxFollowers: original.maxFollowers,
      countries: stringList(original.countries),
      hashtags: stringList(original.hashtags),
      retryOfJobId: original.id,
      retryRequestedFrom: "api"
    });

    expect(retry.retryOfJobId).toBe(original.id);
    const originalEvents = await prisma.collectionEvent.findMany({
      where: { collectionJobId: original.id },
      orderBy: { createdAt: "asc" }
    });
    const retryEvents = await prisma.collectionEvent.findMany({
      where: { collectionJobId: retry.id },
      orderBy: { createdAt: "asc" }
    });
    expect(originalEvents.some((event) => event.message === "collection-queued")).toBe(true);
    expect(originalEvents.some((event) => event.message === "collection-retry-requested")).toBe(true);
    expect(JSON.stringify(originalEvents)).toContain("collection_retry_requested");
    expect(JSON.stringify(originalEvents)).toContain("api");
    expect(retryEvents.some((event) => event.message === "collection-queued")).toBe(true);
  });

  it("records dedupe events when an active ad scan already exists", async () => {
    const advertiser = await upsertAdvertiser({ input: "AR14577439029227159553", selectedCountries: ["GB"] });
    const original = await queueAdvertiserScan(advertiser.id, ["GB"], { scanMode: "FAST" });
    const duplicate = await queueAdvertiserScan(advertiser.id, ["GB"], { scanMode: "FAST" });

    expect(duplicate.id).toBe(original.id);
    expect(await prisma.scanJob.count({ where: { advertiserId: advertiser.id } })).toBe(1);
    const events = await prisma.scanEvent.findMany({
      where: { scanJobId: original.id },
      orderBy: { createdAt: "asc" }
    });
    expect(events.some((event) => event.message === "scan-queue-deduped")).toBe(true);
    expect(JSON.stringify(events)).toContain("scan_queue_deduped");
  });

  it("records dedupe events when an active social collection already exists", async () => {
    const keyword = await upsertSearchKeyword({ value: "face yoga" });
    const original = await queueCollectionJob({
      keywordId: keyword.id,
      platform: "youtube",
      minFollowers: 10_000,
      maxFollowers: 150_000,
      countries: ["RU"]
    });
    const duplicate = await queueCollectionJob({
      keywordId: keyword.id,
      platform: "youtube",
      minFollowers: 10_000,
      maxFollowers: 150_000,
      countries: ["RU"]
    });

    expect(duplicate.id).toBe(original.id);
    expect(await prisma.collectionJob.count({ where: { keywordId: keyword.id, platform: "YOUTUBE" } })).toBe(1);
    const events = await prisma.collectionEvent.findMany({
      where: { collectionJobId: original.id },
      orderBy: { createdAt: "asc" }
    });
    expect(events.some((event) => event.message === "collection-queue-deduped")).toBe(true);
    expect(JSON.stringify(events)).toContain("collection_queue_deduped");
  });
});
