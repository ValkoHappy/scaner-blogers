type SocialPlatform = "INSTAGRAM" | "VK" | "YOUTUBE";

export interface SocialKeywordQualityRow {
  keywordId: string;
  keyword: string;
  platform: SocialPlatform;
  candidates: number;
  jobs: number;
  profilesChecked: number;
  acceptanceRate: number | null;
  avgQualityScore: number;
  avgFollowers: number;
}

interface ProfileGroup {
  keywordId: string | null;
  platform: SocialPlatform;
  _count: { _all: number };
  _avg: { qualityScore: number | null; followers: number | null };
}

interface JobGroup {
  keywordId: string | null;
  platform: SocialPlatform;
  _count: { _all: number };
  _sum: { candidatesFound: number | null; profilesChecked: number | null };
}

export function buildSocialKeywordQuality(input: {
  keywords: Map<string, string>;
  profileGroups: ProfileGroup[];
  jobGroups: JobGroup[];
  limit?: number;
}): SocialKeywordQualityRow[] {
  const jobs = new Map<string, JobGroup>();
  for (const group of input.jobGroups) {
    if (!group.keywordId) continue;
    jobs.set(rowKey(group.keywordId, group.platform), group);
  }

  return input.profileGroups
    .filter((group): group is ProfileGroup & { keywordId: string } => Boolean(group.keywordId))
    .map((group) => {
      const job = jobs.get(rowKey(group.keywordId, group.platform));
      const candidates = group._count._all;
      const profilesChecked = job?._sum.profilesChecked ?? 0;
      return {
        keywordId: group.keywordId,
        keyword: input.keywords.get(group.keywordId) ?? group.keywordId,
        platform: group.platform,
        candidates,
        jobs: job?._count._all ?? 0,
        profilesChecked,
        acceptanceRate: profilesChecked > 0 ? Math.round((candidates / profilesChecked) * 10_000) / 100 : null,
        avgQualityScore: Math.round(group._avg.qualityScore ?? 0),
        avgFollowers: Math.round(group._avg.followers ?? 0)
      };
    })
    .sort((left, right) =>
      right.avgQualityScore - left.avgQualityScore
      || right.candidates - left.candidates
      || left.keyword.localeCompare(right.keyword)
    )
    .slice(0, input.limit ?? 10);
}

function rowKey(keywordId: string, platform: SocialPlatform) {
  return `${keywordId}:${platform}`;
}
