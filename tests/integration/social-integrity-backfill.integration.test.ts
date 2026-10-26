import { describe, expect, it } from "vitest";
import { evaluateSocialIntegrity, type SocialIntegrityJob } from "@scaner-blogers/core";
import { prisma, upsertSearchKeyword } from "@scaner-blogers/db";
import { backfillSocialIntegrityEvents } from "../../scripts/backfill-social-integrity-events";
import { clearTestDatabase } from "./test-db";

describe("social integrity event backfill", () => {
  it("adds missing successful collection events once and removes integrity warnings", async () => {
    await clearTestDatabase();
    const keyword = await upsertSearchKeyword({
      value: "legacy success",
      platforms: ["instagram"],
      minFollowers: 20_000,
      maxFollowers: 60_000
    });
    const job = await prisma.collectionJob.create({
      data: {
        keywordId: keyword.id,
        platform: "INSTAGRAM",
        status: "SUCCESS",
        startedAt: new Date("2026-05-30T10:00:00.000Z"),
        finishedAt: new Date("2026-05-30T10:02:00.000Z"),
        candidatesFound: 3,
        profilesChecked: 40,
        minFollowers: 20_000,
        maxFollowers: 60_000
      }
    });
    await prisma.collectionRun.create({
      data: {
        collectionJobId: job.id,
        platform: "INSTAGRAM",
        status: "SUCCESS",
        startedAt: new Date("2026-05-30T10:00:00.000Z"),
        finishedAt: new Date("2026-05-30T10:02:00.000Z"),
        candidatesFound: 3,
        profilesChecked: 40
      }
    });

    const dryRun = await backfillSocialIntegrityEvents(prisma, { dryRun: true });
    expect(dryRun).toMatchObject({ checkedJobs: 1, backfilledJobs: 1, eventsCreated: 0 });
    expect(await prisma.collectionEvent.count({ where: { collectionJobId: job.id } })).toBe(0);

    const written = await backfillSocialIntegrityEvents(prisma);
    expect(written).toMatchObject({ checkedJobs: 1, backfilledJobs: 1, eventsCreated: 2 });

    const repeated = await backfillSocialIntegrityEvents(prisma);
    expect(repeated).toMatchObject({ checkedJobs: 1, backfilledJobs: 0, eventsCreated: 0 });

    const hydrated = await prisma.collectionJob.findMany({
      where: { id: job.id },
      include: {
        runs: true,
        events: true
      }
    });
    const integrity = evaluateSocialIntegrity(hydrated as SocialIntegrityJob[]);
    expect(integrity).toMatchObject({ errors: 0, warnings: 0 });
    expect(hydrated[0]?.events.map((event) => (event.data as { code?: string }).code).sort()).toEqual([
      "social_candidates_saved",
      "social_collection_completed"
    ]);
  });
});
