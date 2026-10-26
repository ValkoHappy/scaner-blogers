import { prisma as defaultPrisma } from "@scaner-blogers/db";

type DbClient = typeof defaultPrisma;

export const DEFAULT_STALE_SOCIAL_COLLECTION_JOB_MS = 60 * 60 * 1000;

export async function recoverStaleRunningCollectionJobs(
  db: DbClient = defaultPrisma,
  now = new Date(),
  staleMs = DEFAULT_STALE_SOCIAL_COLLECTION_JOB_MS
) {
  const staleBefore = new Date(now.getTime() - staleMs);
  const staleJobs = await db.collectionJob.findMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: staleBefore },
      finishedAt: null
    },
    select: { id: true, cancelRequested: true }
  });

  for (const job of staleJobs) {
    const status = job.cancelRequested ? "CANCELED" : "FAILED";
    const errorMessage = job.cancelRequested ? "stale-running-collection-job-canceled" : "stale-running-collection-job";
    await db.collectionJob.update({
      where: { id: job.id },
      data: {
        status,
        finishedAt: now,
        errorMessage,
        blockedReason: null
      }
    });
    await db.collectionRun.updateMany({
      where: { collectionJobId: job.id, status: "RUNNING" },
      data: {
        status,
        finishedAt: now,
        errorMessage,
        blockedReason: null
      }
    });
    await db.collectionEvent.create({
      data: {
        collectionJobId: job.id,
        level: status === "CANCELED" ? "warn" : "error",
        message: "Stale social collection job was finalized after worker restart",
        data: { reasonCode: "STALE_SOCIAL_COLLECTION_JOB", status }
      }
    });
  }
}

export async function recoverInterruptedRunningCollectionJobs(
  db: DbClient = defaultPrisma,
  now = new Date(),
  staleMs = DEFAULT_STALE_SOCIAL_COLLECTION_JOB_MS
) {
  const staleBefore = new Date(now.getTime() - staleMs);
  const runningJobs = await db.collectionJob.findMany({
    where: {
      status: "RUNNING",
      finishedAt: null,
      OR: [
        { startedAt: null },
        { startedAt: { gte: staleBefore } }
      ]
    },
    select: { id: true, cancelRequested: true }
  });

  if (runningJobs.length) {
    await db.socialPlatformAccount.updateMany({
      where: { status: "RUNNING" },
      data: {
        status: "OK",
        blockedUntil: null,
        lastError: null,
        lastErrorAt: null
      }
    });
  }

  for (const job of runningJobs) {
    if (job.cancelRequested) {
      await db.collectionJob.update({
        where: { id: job.id },
        data: {
          status: "CANCELED",
          finishedAt: now,
          errorMessage: "collection-canceled-during-worker-restart",
          blockedReason: null
        }
      });
      await db.collectionRun.updateMany({
        where: { collectionJobId: job.id, status: "RUNNING" },
        data: {
          status: "CANCELED",
          finishedAt: now,
          errorMessage: "collection-canceled-during-worker-restart",
          blockedReason: null
        }
      });
      await db.collectionEvent.create({
        data: {
          collectionJobId: job.id,
          level: "warn",
          message: "Social collection job was canceled during worker restart recovery",
          data: { reasonCode: "SOCIAL_WORKER_RESTART_CANCELED" }
        }
      });
      continue;
    }

    await db.collectionJob.update({
      where: { id: job.id },
      data: {
        status: "QUEUED",
        startedAt: null,
        errorMessage: null,
        blockedReason: null
      }
    });
    await db.collectionRun.updateMany({
      where: { collectionJobId: job.id, status: "RUNNING" },
      data: {
        status: "FAILED",
        finishedAt: now,
        errorMessage: "worker-restart-requeued",
        blockedReason: null
      }
    });
    await db.collectionEvent.create({
      data: {
        collectionJobId: job.id,
        level: "warn",
        message: "Social collection job was returned to queue after worker restart",
        data: { reasonCode: "SOCIAL_WORKER_RESTART_REQUEUED" }
      }
    });
  }
}

export async function cleanupRetainedSocialData(db: DbClient, rawBefore: Date | null, eventsBefore: Date | null) {
  await Promise.all([
    rawBefore
      ? db.rawSocialSnapshot.deleteMany({ where: { createdAt: { lt: rawBefore } } })
      : Promise.resolve({ count: 0 }),
    eventsBefore
      ? db.collectionEvent.deleteMany({ where: { createdAt: { lt: eventsBefore } } })
      : Promise.resolve({ count: 0 }),
    eventsBefore
      ? db.collectionSearchHistory.deleteMany({ where: { lastSearchedAt: { lt: eventsBefore } } })
      : Promise.resolve({ count: 0 }),
    eventsBefore
      ? db.candidate.deleteMany({
        where: {
          profiles: { none: {} },
          updatedAt: { lt: eventsBefore }
        }
      })
      : Promise.resolve({ count: 0 })
  ]);
}

export async function clearExpiredSocialPlatformBlocks(db: DbClient = defaultPrisma, now = new Date()) {
  return db.socialPlatformAccount.updateMany({
    where: {
      status: "BLOCKED",
      blockedUntil: { lte: now }
    },
    data: {
      status: "OK",
      blockedUntil: null,
      lastError: null
    }
  });
}
