import { describe, expect, it } from "vitest";
import { evaluateSocialIntegrity, type SocialIntegrityJob } from "./social-integrity";

const baseDate = new Date("2026-06-05T10:00:00.000Z");

function successfulJobWithSavedEvent(data: Record<string, unknown>): SocialIntegrityJob {
  return {
    id: "job-1",
    platform: "INSTAGRAM",
    status: "SUCCESS",
    createdAt: baseDate,
    updatedAt: baseDate,
    startedAt: baseDate,
    finishedAt: baseDate,
    candidatesFound: 2,
    profilesChecked: 5,
    errorMessage: null,
    blockedReason: null,
    runs: [{
      id: "run-1",
      platform: "INSTAGRAM",
      status: "SUCCESS",
      startedAt: baseDate,
      finishedAt: baseDate,
      candidatesFound: 2,
      profilesChecked: 5,
      errorMessage: null,
      blockedReason: null
    }],
    events: [
      {
        id: "event-saved",
        level: "info",
        message: "social_candidates_saved",
        data: { code: "social_candidates_saved", ...data },
        createdAt: baseDate
      },
      {
        id: "event-completed",
        level: "info",
        message: "social_collection_completed",
        data: { code: "social_collection_completed" },
        createdAt: baseDate
      }
    ]
  };
}

describe("social integrity", () => {
  it("compares successful jobs with follower-range eligible candidates when present", () => {
    const result = evaluateSocialIntegrity([successfulJobWithSavedEvent({
      candidatesReceived: 5,
      candidatesInFollowerRange: 2,
      filteredOutByFollowerRange: 3,
      uniqueInputProfiles: 5,
      uniqueEligibleProfiles: 2,
      duplicateRowsInCollectorOutput: 0,
      savedProfiles: 2,
      profilesChecked: 5
    })], baseDate);

    expect(result.errors).toBe(0);
    expect(result.issues.map((issue) => issue.code)).not.toContain("saved_event_job_counter_mismatch");
  });

  it("flags broken follower-range counters in saved events", () => {
    const result = evaluateSocialIntegrity([successfulJobWithSavedEvent({
      candidatesReceived: 5,
      candidatesInFollowerRange: 2,
      filteredOutByFollowerRange: 99,
      uniqueInputProfiles: 5,
      uniqueEligibleProfiles: 2,
      duplicateRowsInCollectorOutput: 0,
      savedProfiles: 2,
      profilesChecked: 5
    })], baseDate);

    expect(result.errors).toBe(1);
    expect(result.issues[0]?.code).toBe("saved_event_follower_range_counter_mismatch");
  });
});
