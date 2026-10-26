import { describe, expect, it } from "vitest";
import { evaluateSocialIntegrity, type SocialIntegrityJob } from "@scaner-blogers/core";

const now = new Date("2026-05-31T12:00:00.000Z");

describe("social integrity verifier", () => {
  it("accepts a healthy successful job with matching run counters and events", () => {
    const result = evaluateSocialIntegrity([
      job({
        status: "SUCCESS",
        candidatesFound: 7,
        profilesChecked: 34,
        finishedAt: new Date("2026-05-31T11:10:00.000Z"),
        runs: [
          run({
            status: "SUCCESS",
            candidatesFound: 7,
            profilesChecked: 34,
            finishedAt: new Date("2026-05-31T11:10:00.000Z")
          })
        ],
        events: [
          event("social_candidates_saved"),
          event("social_collection_completed")
        ]
      })
    ], now);

    expect(result).toMatchObject({ checkedJobs: 1, errors: 0, warnings: 0 });
  });

  it("reports data loss risk when counters say fewer profiles checked than candidates found", () => {
    const result = evaluateSocialIntegrity([
      job({
        status: "SUCCESS",
        candidatesFound: 12,
        profilesChecked: 8,
        finishedAt: new Date("2026-05-31T11:10:00.000Z"),
        runs: [
          run({
            status: "SUCCESS",
            candidatesFound: 12,
            profilesChecked: 8,
            finishedAt: new Date("2026-05-31T11:10:00.000Z")
          })
        ],
        events: [
          event("social_candidates_saved"),
          event("social_collection_completed")
        ]
      })
    ], now);

    expect(result.errors).toBe(2);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "job_profiles_less_than_candidates",
      "run_profiles_less_than_candidates"
    ]);
  });

  it("reports latest run and job counter mismatch", () => {
    const result = evaluateSocialIntegrity([
      job({
        status: "SUCCESS",
        candidatesFound: 3,
        profilesChecked: 10,
        finishedAt: new Date("2026-05-31T11:10:00.000Z"),
        runs: [
          run({
            status: "SUCCESS",
            candidatesFound: 2,
            profilesChecked: 10,
            finishedAt: new Date("2026-05-31T11:10:00.000Z")
          })
        ],
        events: [
          event("social_candidates_saved"),
          event("social_collection_completed")
        ]
      })
    ], now);

    expect(result.errors).toBe(1);
    expect(result.issues[0]).toMatchObject({ code: "job_run_counter_mismatch" });
  });

  it("reports successful jobs whose saved-event counters contradict job counters", () => {
    const result = evaluateSocialIntegrity([
      job({
        status: "SUCCESS",
        candidatesFound: 3,
        profilesChecked: 12,
        finishedAt: new Date("2026-05-31T11:10:00.000Z"),
        runs: [
          run({
            status: "SUCCESS",
            candidatesFound: 3,
            profilesChecked: 12,
            finishedAt: new Date("2026-05-31T11:10:00.000Z")
          })
        ],
        events: [
          event("social_candidates_saved", {
            candidatesReceived: 4,
            uniqueInputProfiles: 3,
            duplicateRowsInCollectorOutput: 1,
            savedProfiles: 4,
            affectedCandidates: 3,
            profilesChecked: 11
          }),
          event("social_collection_completed")
        ]
      })
    ], now);

    expect(result.errors).toBe(3);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "saved_event_job_counter_mismatch",
      "saved_profiles_exceed_unique_profiles",
      "saved_event_profiles_checked_mismatch"
    ]);
  });

  it("checks the newest saved-event counters by createdAt instead of array order", () => {
    const result = evaluateSocialIntegrity([
      job({
        status: "SUCCESS",
        candidatesFound: 3,
        profilesChecked: 12,
        finishedAt: new Date("2026-05-31T11:10:00.000Z"),
        runs: [
          run({
            status: "SUCCESS",
            candidatesFound: 3,
            profilesChecked: 12,
            finishedAt: new Date("2026-05-31T11:10:00.000Z")
          })
        ],
        events: [
          event("social_candidates_saved", {
            candidatesReceived: 3,
            uniqueInputProfiles: 3,
            duplicateRowsInCollectorOutput: 0,
            savedProfiles: 3,
            profilesChecked: 12
          }, new Date("2026-05-31T11:11:00.000Z")),
          event("social_collection_completed", {}, new Date("2026-05-31T11:12:00.000Z")),
          event("social_candidates_saved", {
            candidatesReceived: 4,
            uniqueInputProfiles: 3,
            duplicateRowsInCollectorOutput: 1,
            savedProfiles: 3,
            profilesChecked: 12
          }, new Date("2026-05-31T11:05:00.000Z"))
        ]
      })
    ], now);

    expect(result).toMatchObject({ checkedJobs: 1, errors: 0, warnings: 0 });
  });

  it("reports stale running jobs and runs", () => {
    const result = evaluateSocialIntegrity([
      job({
        status: "RUNNING",
        startedAt: new Date("2026-05-31T07:00:00.000Z"),
        updatedAt: new Date("2026-05-31T07:00:00.000Z"),
        runs: [
          run({
            status: "RUNNING",
            startedAt: new Date("2026-05-31T07:00:00.000Z")
          })
        ]
      })
    ], now, { staleMinutes: 180 });

    expect(result.errors).toBe(2);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "stale_running_job",
      "stale_running_run"
    ]);
  });

  it("uses warnings for diagnostic gaps that do not prove lost data", () => {
    const result = evaluateSocialIntegrity([
      job({
        status: "SUCCESS",
        finishedAt: null,
        candidatesFound: 0,
        profilesChecked: 0,
        runs: [run({ status: "SUCCESS", finishedAt: null })],
        events: []
      }),
      job({ id: "failed", status: "FAILED", finishedAt: new Date("2026-05-31T11:00:00.000Z") }),
      job({ id: "blocked", status: "BLOCKED", finishedAt: new Date("2026-05-31T11:00:00.000Z") })
    ], now);

    expect(result.errors).toBe(0);
    expect(result.warnings).toBe(6);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "terminal_job_without_finished_at",
      "successful_job_without_saved_event",
      "successful_job_without_completed_event",
      "terminal_run_without_finished_at",
      "failed_job_without_error",
      "blocked_job_without_reason"
    ]);
  });

  it("warns when terminal non-success jobs have no diagnostic event", () => {
    const result = evaluateSocialIntegrity([
      job({
        id: "failed",
        status: "FAILED",
        finishedAt: new Date("2026-05-31T11:00:00.000Z"),
        errorMessage: "collector failed",
        runs: [run({ status: "FAILED", finishedAt: new Date("2026-05-31T11:00:00.000Z"), errorMessage: "collector failed" })],
        events: []
      }),
      job({
        id: "blocked",
        status: "BLOCKED",
        finishedAt: new Date("2026-05-31T11:00:00.000Z"),
        blockedReason: "quota exceeded",
        runs: [run({ status: "BLOCKED", finishedAt: new Date("2026-05-31T11:00:00.000Z"), blockedReason: "quota exceeded" })],
        events: []
      }),
      job({
        id: "canceled",
        status: "CANCELED",
        finishedAt: new Date("2026-05-31T11:00:00.000Z"),
        errorMessage: "collection-canceled",
        runs: [run({ status: "CANCELED", finishedAt: new Date("2026-05-31T11:00:00.000Z"), errorMessage: "collection-canceled" })],
        events: []
      })
    ], now);

    expect(result.errors).toBe(0);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "terminal_job_without_diagnostic_event",
      "terminal_job_without_diagnostic_event",
      "terminal_job_without_diagnostic_event"
    ]);
  });
});

function job(input: Partial<SocialIntegrityJob> = {}): SocialIntegrityJob {
  return {
    id: input.id ?? "job-1",
    platform: input.platform ?? "INSTAGRAM",
    status: input.status ?? "QUEUED",
    createdAt: input.createdAt ?? new Date("2026-05-31T10:00:00.000Z"),
    updatedAt: input.updatedAt ?? new Date("2026-05-31T10:00:00.000Z"),
    startedAt: input.startedAt === undefined ? null : input.startedAt,
    finishedAt: input.finishedAt === undefined ? null : input.finishedAt,
    candidatesFound: input.candidatesFound ?? 0,
    profilesChecked: input.profilesChecked ?? 0,
    errorMessage: input.errorMessage ?? null,
    blockedReason: input.blockedReason ?? null,
    runs: input.runs ?? [],
    events: input.events ?? []
  };
}

function run(input: Partial<SocialIntegrityJob["runs"][number]> = {}): SocialIntegrityJob["runs"][number] {
  return {
    id: input.id ?? "run-1",
    platform: input.platform ?? "INSTAGRAM",
    status: input.status ?? "RUNNING",
    startedAt: input.startedAt ?? new Date("2026-05-31T10:00:00.000Z"),
    finishedAt: input.finishedAt === undefined ? null : input.finishedAt,
    candidatesFound: input.candidatesFound ?? 0,
    profilesChecked: input.profilesChecked ?? 0,
    errorMessage: input.errorMessage ?? null,
    blockedReason: input.blockedReason ?? null
  };
}

function event(
  code: string,
  data: Record<string, unknown> = {},
  createdAt = new Date("2026-05-31T11:00:00.000Z")
): SocialIntegrityJob["events"][number] {
  return {
    id: `event-${code}`,
    level: "info",
    message: code,
    data: { code, ...data },
    createdAt
  };
}
