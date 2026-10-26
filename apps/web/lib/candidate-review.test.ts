import { describe, expect, it } from "vitest";
import { candidateExportUpdateData, candidateReviewUpdateData } from "./candidate-review";

describe("candidateReviewUpdateData", () => {
  it("sets reviewedAt when a candidate is marked as reviewed", () => {
    const now = new Date("2026-05-29T20:10:00.000Z");

    expect(candidateReviewUpdateData("REVIEWED", now)).toEqual({
      status: "REVIEWED",
      reviewedAt: now
    });
  });

  it("sets priorityAt and reviewedAt when a candidate is prioritized", () => {
    const now = new Date("2026-05-29T20:15:00.000Z");

    expect(candidateReviewUpdateData("PRIORITY", now)).toEqual({
      status: "PRIORITY",
      reviewedAt: now,
      priorityAt: now
    });
  });

  it("sets the matching funnel timestamp for contacted, rejected and saved statuses", () => {
    const now = new Date("2026-05-29T20:20:00.000Z");

    expect(candidateReviewUpdateData("CONTACTED", now)).toMatchObject({ contactedAt: now, reviewedAt: now });
    expect(candidateReviewUpdateData("REJECTED", now)).toMatchObject({ rejectedAt: now, reviewedAt: now });
    expect(candidateReviewUpdateData("SAVED", now)).toMatchObject({ savedAt: now, reviewedAt: now });
  });

  it("marks exported candidates without changing their review status", () => {
    const now = new Date("2026-05-30T03:00:00.000Z");

    expect(candidateExportUpdateData(now)).toEqual({
      exportedAt: now
    });
  });
});
