import { describe, expect, it } from "vitest";
import { mergeMonotonicCounters, resolveLimits } from "./scanner";

describe("scanner limits", () => {
  it("keeps full scans unlimited when limits are nullish", () => {
    const limits = resolveLimits({ scanMode: "FULL", maxPagesPerRun: undefined, maxCreativesPerRun: undefined });
    expect(limits.requestDelayMs).toBe(8000);
    expect(limits.maxPagesPerRun).toBe(Number.POSITIVE_INFINITY);
    expect(limits.maxCreativesPerRun).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps fast and cautious finite when explicit limits are passed", () => {
    expect(resolveLimits({ scanMode: "FAST", maxPagesPerRun: 1, maxCreativesPerRun: 20 }).maxCreativesPerRun).toBe(20);
    expect(resolveLimits({ scanMode: "CAUTIOUS", maxPagesPerRun: 1, maxCreativesPerRun: 10 }).maxPagesPerRun).toBe(1);
  });

  it("does not make cautious scans unlimited when stored limits are empty", () => {
    const limits = resolveLimits({ scanMode: "CAUTIOUS", maxPagesPerRun: undefined, maxCreativesPerRun: undefined });
    expect(limits.requestDelayMs).toBe(45000);
    expect(limits.maxPagesPerRun).toBe(1);
    expect(limits.maxCreativesPerRun).toBe(10);
  });

  it("does not roll scan job counters back after worker restart", () => {
    expect(
      mergeMonotonicCounters(
        { pagesFetched: 11, creativesFound: 440, detailsFetched: 440, previewsFetched: 438 },
        { pagesFetched: 6, detailsFetched: 215, previewsFetched: 214 },
        215
      )
    ).toEqual({ pagesFetched: 11, creativesFound: 440, detailsFetched: 440, previewsFetched: 438 });
  });
});
