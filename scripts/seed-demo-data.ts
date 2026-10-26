import type { NormalizedCreative } from "@scaner-blogers/core";
import { refreshAdvertiserCounters, saveNormalizedCreative, upsertAdvertiser, type prisma as PrismaClientLike } from "@scaner-blogers/db";

type DbClient = typeof PrismaClientLike;

export function demoNormalizedCreative(): NormalizedCreative {
  return {
    advertiserId: "AR14577439029227159553",
    advertiserName: "Karen Manukyan",
    creativeId: "CR06346342443637538817",
    format: "VIDEO",
    status: "ACTIVE",
    previewUrls: ["https://displayads-formats.googleusercontent.com/ads/preview/content.js?creativeId=737259876424"],
    firstShownAt: new Date("2025-03-07T00:00:00.000Z"),
    lastShownAt: new Date("2026-05-22T00:00:00.000Z"),
    publicDays: 441,
    app: {
      appId: "com.flightsbooking.tickets.app",
      appName: "Cheap Flights",
      store: "GOOGLE_PLAY",
      storeUrl: "https://play.google.com/store/apps/details?id=com.flightsbooking.tickets.app",
      developer: "Cheap Flights Tickets App",
      category: "TRAVEL_AND_LOCAL",
      description: "Meilleurs prix pour les vols",
      shortDescription: "Recherchez des vols pas chers"
    },
    countries: [
      {
        googleGeoId: 2380,
        countryCode: "IT",
        countryName: "Italy",
        impressionsMin: 25000,
        impressionsMax: 30000,
        firstShownDate: "2025-03-07",
        lastShownDate: "2026-05-22",
        raw: { "1": 2380, "2": "25000", "3": "30000" }
      },
      {
        googleGeoId: 2276,
        countryCode: "DE",
        countryName: "Germany",
        impressionsMin: 15000,
        impressionsMax: 20000,
        firstShownDate: "2025-03-07",
        lastShownDate: "2026-05-22",
        raw: { "1": 2276, "2": "15000", "3": "20000" }
      },
      {
        googleGeoId: 2826,
        countryCode: "GB",
        countryName: "United Kingdom",
        lastShownDate: "2026-05-22",
        raw: { "1": 2826, "5": 20260522 }
      }
    ],
    totalStats: {
      impressionsMin: 60000,
      impressionsMax: 70000,
      firstShownDate: "2025-03-07",
      lastShownDate: "2026-05-22",
      raw: { "2": "60000", "3": "70000" }
    },
    assets: [
      {
        kind: "LANDSCAPE_IMAGE",
        url: "https://tpc.googlesyndication.com/simgad/7117847437982836729"
      }
    ],
    raw: {
      list: { fixture: "search" },
      detail: { fixture: "detail" },
      preview: { appId: "com.flightsbooking.tickets.app", fixture: "preview" }
    }
  };
}

export async function seedDemoData(db: DbClient) {
  const advertiser = await upsertAdvertiser({
    input: "AR14577439029227159553",
    name: "Karen Manukyan",
    selectedCountries: ["GB", "BE", "FR", "DE", "IT"]
  }, db);

  await saveNormalizedCreative(advertiser.id, demoNormalizedCreative(), db);

  await db.scanJob.upsert({
    where: { id: "seed-scan-job" },
    create: {
      id: "seed-scan-job",
      advertiserId: advertiser.id,
      status: "SUCCESS",
      countries: ["GB", "BE"],
      finishedAt: new Date("2026-05-23T04:58:36.000Z")
    },
    update: {
      advertiserId: advertiser.id,
      status: "SUCCESS",
      countries: ["GB", "BE"],
      finishedAt: new Date("2026-05-23T04:58:36.000Z")
    }
  });

  await db.scanEvent.upsert({
    where: { id: "seed-scan-event" },
    create: {
      id: "seed-scan-event",
      scanJobId: "seed-scan-job",
      level: "info",
      message: "Seed scan completed",
      data: { fixture: true }
    },
    update: {
      scanJobId: "seed-scan-job",
      level: "info",
      message: "Seed scan completed",
      data: { fixture: true }
    }
  });

  const keyword = await db.searchKeyword.upsert({
    where: { normalizedValue: "seed-face-massage" },
    create: {
      id: "seed-social-keyword",
      value: "seed face massage",
      normalizedValue: "seed-face-massage",
      platforms: ["INSTAGRAM"],
      hashtags: ["facemassage"],
      minFollowers: 20000,
      maxFollowers: 60000
    },
    update: {
      value: "seed face massage",
      platforms: ["INSTAGRAM"],
      hashtags: ["facemassage"],
      minFollowers: 20000,
      maxFollowers: 60000
    }
  });

  await db.collectionJob.upsert({
    where: { id: "seed-social-job" },
    create: {
      id: "seed-social-job",
      keywordId: keyword.id,
      platform: "INSTAGRAM",
      status: "SUCCESS",
      startedAt: new Date("2026-05-31T07:30:00.000Z"),
      finishedAt: new Date("2026-05-31T07:32:10.000Z"),
      minFollowers: 20000,
      maxFollowers: 60000,
      countries: ["RU", "KZ"],
      hashtags: ["facemassage"],
      candidatesFound: 1,
      profilesChecked: 3
    },
    update: {
      keywordId: keyword.id,
      platform: "INSTAGRAM",
      status: "SUCCESS",
      startedAt: new Date("2026-05-31T07:30:00.000Z"),
      finishedAt: new Date("2026-05-31T07:32:10.000Z"),
      minFollowers: 20000,
      maxFollowers: 60000,
      countries: ["RU", "KZ"],
      hashtags: ["facemassage"],
      candidatesFound: 1,
      profilesChecked: 3
    }
  });

  await db.collectionRun.upsert({
    where: { id: "seed-social-run" },
    create: {
      id: "seed-social-run",
      collectionJobId: "seed-social-job",
      platform: "INSTAGRAM",
      status: "SUCCESS",
      startedAt: new Date("2026-05-31T07:30:00.000Z"),
      finishedAt: new Date("2026-05-31T07:32:10.000Z"),
      candidatesFound: 1,
      profilesChecked: 3
    },
    update: {
      collectionJobId: "seed-social-job",
      platform: "INSTAGRAM",
      status: "SUCCESS",
      startedAt: new Date("2026-05-31T07:30:00.000Z"),
      finishedAt: new Date("2026-05-31T07:32:10.000Z"),
      candidatesFound: 1,
      profilesChecked: 3
    }
  });

  await db.collectionEvent.upsert({
    where: { id: "seed-social-parser-warning" },
    create: {
      id: "seed-social-parser-warning",
      collectionJobId: "seed-social-job",
      collectionRunId: "seed-social-run",
      level: "warn",
      message: "instagram collector emitted invalid candidate JSONL row",
      data: {
        code: "collector_stdout_parse_failed",
        collector: "instagram",
        lineLength: 9,
        error: "Unexpected token"
      }
    },
    update: {
      collectionJobId: "seed-social-job",
      collectionRunId: "seed-social-run",
      level: "warn",
      message: "instagram collector emitted invalid candidate JSONL row",
      data: {
        code: "collector_stdout_parse_failed",
        collector: "instagram",
        lineLength: 9,
        error: "Unexpected token"
      }
    }
  });

  await db.collectionEvent.upsert({
    where: { id: "seed-social-saved" },
    create: {
      id: "seed-social-saved",
      collectionJobId: "seed-social-job",
      collectionRunId: "seed-social-run",
      level: "info",
      message: "social candidates saved",
      data: {
        code: "social_candidates_saved",
        platform: "INSTAGRAM",
        candidatesReceived: 1,
        uniqueInputProfiles: 1,
        duplicateRowsInCollectorOutput: 0,
        savedProfiles: 1,
        affectedCandidates: 1,
        profilesChecked: 3,
        durationMs: 130000
      }
    },
    update: {
      collectionJobId: "seed-social-job",
      collectionRunId: "seed-social-run",
      level: "info",
      message: "social candidates saved",
      data: {
        code: "social_candidates_saved",
        platform: "INSTAGRAM",
        candidatesReceived: 1,
        uniqueInputProfiles: 1,
        duplicateRowsInCollectorOutput: 0,
        savedProfiles: 1,
        affectedCandidates: 1,
        profilesChecked: 3,
        durationMs: 130000
      }
    }
  });

  await refreshAdvertiserCounters(advertiser.id, db);

  return advertiser;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  process.env.DATABASE_URL ??= "file:./data/seed-demo.db";
  const { prisma } = await import("@scaner-blogers/db");
  await seedDemoData(prisma);
  await prisma.$disconnect();
}
