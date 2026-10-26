import { describe, expect, it } from "vitest";
import {
  candidateReviewActionStatusValue,
  candidateStatusLabels,
  candidateStatusValue,
  reviewCandidateStatuses
} from "./candidate-status";

describe("candidate status helpers", () => {
  it("accepts PRIORITY as a real candidate status", () => {
    expect(candidateStatusValue("PRIORITY")).toBe("PRIORITY");
    expect(candidateStatusLabels.PRIORITY).toBe("Приоритет");
    expect(reviewCandidateStatuses).toContain("PRIORITY");
  });

  it("rejects unknown status values", () => {
    expect(candidateStatusValue("ALL")).toBeUndefined();
    expect(candidateStatusValue("priority")).toBeUndefined();
  });

  it("rejects NEW for review actions so old review timestamps cannot conflict with the status", () => {
    expect(candidateReviewActionStatusValue("NEW")).toBeUndefined();
    expect(candidateReviewActionStatusValue("PRIORITY")).toBe("PRIORITY");
  });
});
