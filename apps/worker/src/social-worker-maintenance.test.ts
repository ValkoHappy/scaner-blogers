import { describe, expect, it, vi } from "vitest";
import {
  clearExpiredSocialPlatformBlocks,
  cleanupRetainedSocialData,
  recoverInterruptedRunningCollectionJobs,
  recoverStaleRunningCollectionJobs
} from "./social-worker-maintenance";

function createDb(jobs: Array<{ id: string; cancelRequested: boolean }>) {
  return {
    collectionJob: {
      findMany: vi.fn().mockResolvedValue(jobs),
      update: vi.fn().mockResolvedValue({})
    },
    collectionRun: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    collectionEvent: {
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 })
    },
    collectionSearchHistory: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 })
    },
    candidate: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 })
    },
    rawSocialSnapshot: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 })
    },
    socialPlatformAccount: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 })
    }
  };
}

describe("social worker maintenance", () => {
  it("returns interrupted social jobs to the queue after restart", async () => {
    const db = createDb([{ id: "job-1", cancelRequested: false }]);
    const now = new Date("2026-05-28T10:00:00.000Z");

    await recoverInterruptedRunningCollectionJobs(db as never, now);

    expect(db.collectionJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "QUEUED",
        startedAt: null,
        errorMessage: null,
        blockedReason: null
      }
    });
    expect(db.collectionRun.updateMany).toHaveBeenCalledWith({
      where: { collectionJobId: "job-1", status: "RUNNING" },
      data: {
        status: "FAILED",
        finishedAt: now,
        errorMessage: "worker-restart-requeued",
        blockedReason: null
      }
    });    expect(db.socialPlatformAccount.updateMany).toHaveBeenCalledWith({
      where: { status: "RUNNING" },
      data: {
        status: "OK",
        blockedUntil: null,
        lastError: null,
        lastErrorAt: null
      }
    });
  });

  it("finalizes canceled interrupted social jobs instead of retrying them", async () => {
    const db = createDb([{ id: "job-2", cancelRequested: true }]);
    const now = new Date("2026-05-28T10:00:00.000Z");

    await recoverInterruptedRunningCollectionJobs(db as never, now);

    expect(db.collectionJob.update).toHaveBeenCalledWith({
      where: { id: "job-2" },
      data: {
        status: "CANCELED",
        finishedAt: now,
        errorMessage: "collection-canceled-during-worker-restart",
        blockedReason: null
      }
    });
  });

  it("marks stale social jobs as failed", async () => {
    const db = createDb([{ id: "job-3", cancelRequested: false }]);
    const now = new Date("2026-05-28T10:00:00.000Z");

    await recoverStaleRunningCollectionJobs(db as never, now);

    expect(db.collectionJob.update).toHaveBeenCalledWith({
      where: { id: "job-3" },
      data: {
        status: "FAILED",
        finishedAt: now,
        errorMessage: "stale-running-collection-job",
        blockedReason: null
      }
    });
  });

  it("cleans old social snapshots and events with retention cutoffs", async () => {
    const db = createDb([]);
    const rawBefore = new Date("2026-05-01T00:00:00.000Z");
    const eventsBefore = new Date("2026-05-15T00:00:00.000Z");

    await cleanupRetainedSocialData(db as never, rawBefore, eventsBefore);

    expect(db.rawSocialSnapshot.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: rawBefore } } });
    expect(db.collectionEvent.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: eventsBefore } } });
    expect(db.collectionSearchHistory.deleteMany).toHaveBeenCalledWith({ where: { lastSearchedAt: { lt: eventsBefore } } });
    expect(db.candidate.deleteMany).toHaveBeenCalledWith({
      where: {
        profiles: { none: {} },
        updatedAt: { lt: eventsBefore }
      }
    });
  });

  it("clears expired social account blocks", async () => {
    const db = createDb([]);
    const now = new Date("2026-06-02T18:00:00.000Z");

    await clearExpiredSocialPlatformBlocks(db as never, now);

    expect(db.socialPlatformAccount.updateMany).toHaveBeenCalledWith({
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
  });
});
