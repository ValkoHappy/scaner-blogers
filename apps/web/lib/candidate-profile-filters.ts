import type { CandidateStatusValue } from "./candidate-status";
import type { Prisma } from "@scaner-blogers/db";

export interface CandidateProfileFilterInput {
  q?: string | null;
  status?: CandidateStatusValue;
  platform?: "INSTAGRAM" | "VK" | "YOUTUBE";
  matchedBy?: string | null;
  minFollowers?: number;
  maxFollowers?: number;
  minScore?: number;
  exported?: "YES" | "NO";
}

export function buildCandidateProfileWhere(input: CandidateProfileFilterInput): Prisma.CandidateProfileWhereInput {
  const q = input.q?.trim();
  const matchedBy = input.matchedBy?.trim();

  return {
    platform: input.platform,
    matchedBy: matchedBy && matchedBy !== "ALL" ? matchedBy : undefined,
    qualityScore: input.minScore ? { gte: input.minScore } : undefined,
    followers: input.minFollowers || input.maxFollowers
      ? {
        gte: input.minFollowers,
        lte: input.maxFollowers
      }
      : undefined,
    candidate: candidateRelationFilter(input.status, input.exported),
    OR: q
      ? [
        { username: textContains(q) },
        { displayName: textContains(q) },
        { bio: textContains(q) },
        { sourceKeyword: textContains(q) },
        { sourceTag: textContains(q) }
      ]
      : undefined
  };
}

export function textContains(value: string) {
  return {
    contains: value
  };
}

function candidateRelationFilter(status?: CandidateStatusValue, exported?: "YES" | "NO") {
  if (!status && !exported) return undefined;
  return {
    is: {
      status,
      exportedAt: exported === "YES" ? { not: null } : exported === "NO" ? null : undefined
    }
  };
}
