export const reviewCandidateStatuses = [
  "NEW",
  "REVIEWED",
  "PRIORITY",
  "CONTACTED",
  "REJECTED",
  "SAVED"
] as const;

export type CandidateStatusValue = typeof reviewCandidateStatuses[number];

export const candidateStatusLabels: Record<CandidateStatusValue, string> = {
  NEW: "Новый",
  REVIEWED: "Просмотрен",
  PRIORITY: "Приоритет",
  CONTACTED: "Связались",
  REJECTED: "Не подходит",
  SAVED: "Сохранён"
};

export function candidateStatusValue(value?: FormDataEntryValue | string | null): CandidateStatusValue | undefined {
  const text = String(value ?? "");
  return reviewCandidateStatuses.includes(text as CandidateStatusValue) ? text as CandidateStatusValue : undefined;
}

export function candidateReviewActionStatusValue(
  value?: FormDataEntryValue | string | null
): Exclude<CandidateStatusValue, "NEW"> | undefined {
  const status = candidateStatusValue(value);
  return status && status !== "NEW" ? status : undefined;
}
