import type { CandidateStatusValue } from "./candidate-status";

export function candidateReviewUpdateData(status: CandidateStatusValue, now = new Date()) {
  return {
    status,
    ...(status !== "NEW" ? { reviewedAt: now } : {}),
    ...(status === "PRIORITY" ? { priorityAt: now } : {}),
    ...(status === "CONTACTED" ? { contactedAt: now } : {}),
    ...(status === "REJECTED" ? { rejectedAt: now } : {}),
    ...(status === "SAVED" ? { savedAt: now } : {})
  };
}

export function candidateExportUpdateData(now = new Date()) {
  return {
    exportedAt: now
  };
}
