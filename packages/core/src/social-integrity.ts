export type SocialIntegrityPlatform = "INSTAGRAM" | "VK" | "YOUTUBE";
export type ScanStatus = "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "BLOCKED" | "CANCELED";
export type IssueLevel = "error" | "warn";

export type SocialIntegrityEvent = {
  id: string;
  level: string;
  message: string;
  data: unknown;
  createdAt: Date;
};

export type SocialIntegrityRun = {
  id: string;
  platform: SocialIntegrityPlatform;
  status: ScanStatus;
  startedAt: Date;
  finishedAt: Date | null;
  candidatesFound: number;
  profilesChecked: number;
  errorMessage: string | null;
  blockedReason: string | null;
};

export type SocialIntegrityJob = {
  id: string;
  platform: SocialIntegrityPlatform;
  status: ScanStatus;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  candidatesFound: number;
  profilesChecked: number;
  errorMessage: string | null;
  blockedReason: string | null;
  runs: SocialIntegrityRun[];
  events: SocialIntegrityEvent[];
};

export type SocialIntegrityIssue = {
  level: IssueLevel;
  code: string;
  message: string;
  jobId?: string;
  runId?: string;
  platform?: SocialIntegrityPlatform;
  details?: Record<string, string | number | boolean | null>;
};

export type SocialIntegrityOptions = {
  staleMinutes?: number;
};

const TERMINAL_STATUSES = new Set<ScanStatus>(["SUCCESS", "FAILED", "BLOCKED", "CANCELED"]);
const DEFAULT_STALE_MINUTES = 180;

export function evaluateSocialIntegrity(
  jobs: SocialIntegrityJob[],
  now = new Date(),
  options: SocialIntegrityOptions = {}
) {
  const staleMs = (options.staleMinutes ?? DEFAULT_STALE_MINUTES) * 60_000;
  const issues: SocialIntegrityIssue[] = [];

  for (const job of jobs) {
    const latestRun = getLatestRun(job.runs);
    const eventCodes = new Set(job.events.map((event) => extractEventCode(event)));

    if (job.status === "RUNNING") {
      const referenceTime = job.startedAt ?? job.updatedAt ?? job.createdAt;
      if (isOlderThan(referenceTime, now, staleMs)) {
        issues.push({
          level: "error",
          code: "stale_running_job",
          message: "Running collection job is older than the stale threshold.",
          jobId: job.id,
          platform: job.platform,
          details: { staleMinutes: Math.round((now.getTime() - referenceTime.getTime()) / 60_000) }
        });
      }
    }

    if (TERMINAL_STATUSES.has(job.status) && !job.finishedAt) {
      issues.push({
        level: "warn",
        code: "terminal_job_without_finished_at",
        message: "Terminal collection job has no finishedAt timestamp.",
        jobId: job.id,
        platform: job.platform
      });
    }

    if (job.status === "SUCCESS") {
      const savedEventData = latestEventData(job.events, "social_candidates_saved");
      if (!latestRun) {
        issues.push({
          level: "error",
          code: "successful_job_without_run",
          message: "Successful collection job has no collection run.",
          jobId: job.id,
          platform: job.platform
        });
      }

      if (job.profilesChecked < job.candidatesFound) {
        issues.push({
          level: "error",
          code: "job_profiles_less_than_candidates",
          message: "Successful collection job has profilesChecked lower than candidatesFound.",
          jobId: job.id,
          platform: job.platform,
          details: { profilesChecked: job.profilesChecked, candidatesFound: job.candidatesFound }
        });
      }

      if (latestRun && (latestRun.candidatesFound !== job.candidatesFound || latestRun.profilesChecked !== job.profilesChecked)) {
        issues.push({
          level: "error",
          code: "job_run_counter_mismatch",
          message: "Latest collection run counters do not match the parent job counters.",
          jobId: job.id,
          runId: latestRun.id,
          platform: job.platform,
          details: {
            jobCandidatesFound: job.candidatesFound,
            runCandidatesFound: latestRun.candidatesFound,
            jobProfilesChecked: job.profilesChecked,
            runProfilesChecked: latestRun.profilesChecked
          }
        });
      }

      if (!eventCodes.has("social_candidates_saved")) {
        issues.push({
          level: "warn",
          code: "successful_job_without_saved_event",
          message: "Successful collection job has no social_candidates_saved event.",
          jobId: job.id,
          platform: job.platform
        });
      }

      if (savedEventData) {
        const candidatesReceived = numericEventValue(savedEventData.candidatesReceived);
        const candidatesInFollowerRange = numericEventValue(savedEventData.candidatesInFollowerRange);
        const filteredOutByFollowerRange = numericEventValue(savedEventData.filteredOutByFollowerRange);
        const uniqueInputProfiles = numericEventValue(savedEventData.uniqueInputProfiles);
        const uniqueEligibleProfiles = numericEventValue(savedEventData.uniqueEligibleProfiles);
        const duplicateRowsInCollectorOutput = numericEventValue(savedEventData.duplicateRowsInCollectorOutput);
        const savedProfiles = numericEventValue(savedEventData.savedProfiles);
        const profilesCheckedFromEvent = numericEventValue(savedEventData.profilesChecked);
        const eligibleCandidatesFromEvent = candidatesInFollowerRange ?? candidatesReceived;
        const eligibleProfilesFromEvent = uniqueEligibleProfiles ?? uniqueInputProfiles;

        if (eligibleCandidatesFromEvent !== null && eligibleCandidatesFromEvent !== job.candidatesFound) {
          issues.push({
            level: "error",
            code: "saved_event_job_counter_mismatch",
            message: "social_candidates_saved eligible candidate count does not match the parent job candidatesFound counter.",
            jobId: job.id,
            platform: job.platform,
            details: { candidatesFound: job.candidatesFound, eligibleCandidatesFromEvent }
          });
        }

        if (
          candidatesReceived !== null
          && candidatesInFollowerRange !== null
          && filteredOutByFollowerRange !== null
          && candidatesInFollowerRange + filteredOutByFollowerRange !== candidatesReceived
        ) {
          issues.push({
            level: "error",
            code: "saved_event_follower_range_counter_mismatch",
            message: "social_candidates_saved follower range counters do not add up to candidatesReceived.",
            jobId: job.id,
            platform: job.platform,
            details: { candidatesReceived, candidatesInFollowerRange, filteredOutByFollowerRange }
          });
        }

        if (
          candidatesReceived !== null
          && uniqueInputProfiles !== null
          && duplicateRowsInCollectorOutput !== null
          && uniqueInputProfiles + duplicateRowsInCollectorOutput !== candidatesReceived
        ) {
          issues.push({
            level: "error",
            code: "saved_event_duplicate_counter_mismatch",
            message: "social_candidates_saved unique and duplicate counters do not add up to candidatesReceived.",
            jobId: job.id,
            platform: job.platform,
            details: { candidatesReceived, uniqueInputProfiles, duplicateRowsInCollectorOutput }
          });
        }

        if (savedProfiles !== null && eligibleProfilesFromEvent !== null && savedProfiles > eligibleProfilesFromEvent) {
          issues.push({
            level: "error",
            code: "saved_profiles_exceed_unique_profiles",
            message: "social_candidates_saved savedProfiles is higher than the eligible unique profile count.",
            jobId: job.id,
            platform: job.platform,
            details: { savedProfiles, eligibleProfilesFromEvent }
          });
        }

        if (profilesCheckedFromEvent !== null && profilesCheckedFromEvent !== job.profilesChecked) {
          issues.push({
            level: "error",
            code: "saved_event_profiles_checked_mismatch",
            message: "social_candidates_saved profilesChecked does not match the parent job profilesChecked counter.",
            jobId: job.id,
            platform: job.platform,
            details: { jobProfilesChecked: job.profilesChecked, eventProfilesChecked: profilesCheckedFromEvent }
          });
        }
      }

      if (!eventCodes.has("social_collection_completed")) {
        issues.push({
          level: "warn",
          code: "successful_job_without_completed_event",
          message: "Successful collection job has no social_collection_completed event.",
          jobId: job.id,
          platform: job.platform
        });
      }
    }

    if (job.status === "FAILED" && !job.errorMessage?.trim()) {
      issues.push({
        level: "warn",
        code: "failed_job_without_error",
        message: "Failed collection job has no errorMessage.",
        jobId: job.id,
        platform: job.platform
      });
    }

    if (job.status === "BLOCKED" && !job.blockedReason?.trim()) {
      issues.push({
        level: "warn",
        code: "blocked_job_without_reason",
        message: "Blocked collection job has no blockedReason.",
        jobId: job.id,
        platform: job.platform
      });
    }

    if (
      (job.status === "FAILED" && job.errorMessage?.trim())
      || (job.status === "BLOCKED" && job.blockedReason?.trim())
      || (job.status === "CANCELED" && job.errorMessage?.trim())
    ) {
      if (!hasTerminalDiagnosticEvent(job.status, job.events)) {
        issues.push({
          level: "warn",
          code: "terminal_job_without_diagnostic_event",
          message: "Terminal non-success collection job has no diagnostic collection event.",
          jobId: job.id,
          platform: job.platform
        });
      }
    }

    for (const run of job.runs) {
      if (run.platform !== job.platform) {
        issues.push({
          level: "error",
          code: "run_platform_mismatch",
          message: "Collection run platform differs from the parent job platform.",
          jobId: job.id,
          runId: run.id,
          platform: job.platform
        });
      }

      if (run.status === "RUNNING" && isOlderThan(run.startedAt, now, staleMs)) {
        issues.push({
          level: "error",
          code: "stale_running_run",
          message: "Running collection run is older than the stale threshold.",
          jobId: job.id,
          runId: run.id,
          platform: run.platform,
          details: { staleMinutes: Math.round((now.getTime() - run.startedAt.getTime()) / 60_000) }
        });
      }

      if (TERMINAL_STATUSES.has(run.status) && !run.finishedAt) {
        issues.push({
          level: "warn",
          code: "terminal_run_without_finished_at",
          message: "Terminal collection run has no finishedAt timestamp.",
          jobId: job.id,
          runId: run.id,
          platform: run.platform
        });
      }

      if (run.status === "SUCCESS" && run.profilesChecked < run.candidatesFound) {
        issues.push({
          level: "error",
          code: "run_profiles_less_than_candidates",
          message: "Successful collection run has profilesChecked lower than candidatesFound.",
          jobId: job.id,
          runId: run.id,
          platform: run.platform,
          details: { profilesChecked: run.profilesChecked, candidatesFound: run.candidatesFound }
        });
      }
    }
  }

  return {
    checkedJobs: jobs.length,
    errors: issues.filter((issue) => issue.level === "error").length,
    warnings: issues.filter((issue) => issue.level === "warn").length,
    issues
  };
}

function getLatestRun(runs: SocialIntegrityRun[]) {
  return [...runs].sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())[0] ?? null;
}

function extractEventCode(event: SocialIntegrityEvent) {
  if (event.data && typeof event.data === "object" && "code" in event.data) {
    const code = (event.data as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return event.message;
}

function latestEventData(events: SocialIntegrityEvent[], code: string) {
  const event = [...events]
    .filter((row) => extractEventCode(row) === code)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  return event?.data && typeof event.data === "object" ? event.data as Record<string, unknown> : null;
}

function hasTerminalDiagnosticEvent(status: ScanStatus, events: SocialIntegrityEvent[]) {
  return events.some((event) => {
    const code = extractEventCode(event);
    const reasonCode = event.data && typeof event.data === "object"
      ? (event.data as { reasonCode?: unknown }).reasonCode
      : undefined;
    if (status === "FAILED") {
      return event.level === "error" || code === "social_collector_failed" || reasonCode === "SOCIAL_COLLECTOR_FAILED";
    }
    if (status === "BLOCKED") {
      return code === "social_collector_blocked" || reasonCode === "SOCIAL_COLLECTOR_BLOCKED";
    }
    if (status === "CANCELED") {
      return code === "social_collector_canceled" || reasonCode === "SOCIAL_COLLECTOR_CANCELED" || event.message === "collection-canceled";
    }
    return false;
  });
}

function numericEventValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isOlderThan(value: Date, now: Date, thresholdMs: number) {
  return now.getTime() - value.getTime() > thresholdMs;
}
