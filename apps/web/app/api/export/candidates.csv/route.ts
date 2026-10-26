import { NextResponse } from "next/server";
import { prisma } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";
import { buildCandidateProfileWhere } from "@/lib/candidate-profile-filters";
import { candidateStatusValue } from "@/lib/candidate-status";
import { safeSpreadsheetRows } from "@/lib/export-cell";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const filters = candidateProfileFilters(new URL(request.url).searchParams);

  const profiles = (await prisma.candidateProfile.findMany({
    where: filters,
    orderBy: { lastCollectedAt: "desc" },
    take: 10_000,
    include: { candidate: true, keyword: true }
  })).filter((profile) => matchesMetricFilters(profile.metrics, new URL(request.url).searchParams));

  const rows = [
    [
      "platform",
      "profile_url",
      "username",
      "name",
      "followers",
      "quality_score",
      "quality_signals",
      "bio",
      "contacts",
      "keyword",
      "source_tag",
      "matched_by",
      "geo_guess",
      "avg_likes",
      "avg_comments",
      "avg_views",
      "last_posts",
      "reason",
      "status",
      "reviewed_at",
      "priority_at",
      "contacted_at",
      "rejected_at",
      "saved_at",
      "exported_at",
      "last_collected_at"
    ],
    ...profiles.map((profile) => [
      profile.platform,
      profile.profileUrl,
      profile.username,
      profile.displayName ?? "",
      String(profile.followers),
      String(profile.qualityScore),
      qualitySignalsSummary(profile.qualitySignals),
      profile.bio ?? "",
      contactsSummary(profile.contacts),
      profile.keyword?.value ?? profile.sourceKeyword ?? "",
      profile.sourceTag ?? "",
      profile.matchedBy ?? "",
      profile.geoGuess ?? "",
      metricValue(profile.metrics, "avgLikes"),
      metricValue(profile.metrics, "avgComments"),
      metricValue(profile.metrics, "avgViews"),
      lastPostsSummary(profile.lastPosts),
      profile.reason ?? "",
      profile.candidate.status,
      isoDate(profile.candidate.reviewedAt),
      isoDate(profile.candidate.priorityAt),
      isoDate(profile.candidate.contactedAt),
      isoDate(profile.candidate.rejectedAt),
      isoDate(profile.candidate.savedAt),
      isoDate(profile.candidate.exportedAt),
      profile.lastCollectedAt.toISOString()
    ])
  ];

  return new NextResponse(`\uFEFF${safeSpreadsheetRows(rows).map(toCsvRow).join("\n")}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=candidates.csv"
    }
  });
}

function toCsvRow(row: string[]) {
  return row.map((cell) => `"${cell.replace(/"/g, "\"\"")}"`).join(",");
}

function isoDate(value?: Date | null) {
  return value ? value.toISOString() : "";
}

function contactsSummary(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const contacts = value as { emails?: unknown; phones?: unknown; urls?: unknown };
  return [
    ...stringList(contacts.emails),
    ...stringList(contacts.phones),
    ...stringList(contacts.urls)
  ].join(" | ");
}

function metricValue(value: unknown, key: string) {
  if (!value || typeof value !== "object") return "";
  const metric = (value as Record<string, unknown>)[key];
  return typeof metric === "number" ? String(Math.round(metric)) : "";
}

function lastPostsSummary(value: unknown) {
  if (!Array.isArray(value)) return "";
  return value
    .map((post) => post && typeof post === "object" ? (post as { url?: unknown }).url : undefined)
    .filter((url): url is string => typeof url === "string" && Boolean(url))
    .join(" | ");
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function candidateProfileFilters(params: URLSearchParams) {
  const q = params.get("q")?.trim();
  const status = candidateStatusValue(params.get("status") ?? undefined);
  const platform = socialPlatformValue(params.get("platform") ?? undefined);
  const matchedBy = params.get("matchedBy");
  const minFollowers = positiveIntValue(params.get("minFollowers") ?? undefined);
  const maxFollowers = positiveIntValue(params.get("maxFollowers") ?? undefined);
  const minScore = positiveIntValue(params.get("minScore") ?? undefined);
  const exported = candidateExportFilter(params.get("exported") ?? undefined);
  return {
    ...buildCandidateProfileWhere({
      q,
      status,
      platform,
      matchedBy,
      minFollowers,
      maxFollowers,
      minScore,
      exported
    })
  };
}

function socialPlatformValue(value?: string): "INSTAGRAM" | "VK" | "YOUTUBE" | undefined {
  if (value === "INSTAGRAM") return "INSTAGRAM";
  if (value === "VK") return "VK";
  if (value === "YOUTUBE") return "YOUTUBE";
  return undefined;
}

function qualitySignalsSummary(value: unknown) {
  return stringList(value).join(" | ");
}

function matchesMetricFilters(metrics: unknown, params: URLSearchParams) {
  const minAvgViews = positiveIntValue(params.get("minAvgViews") ?? undefined);
  const minAvgLikes = positiveIntValue(params.get("minAvgLikes") ?? undefined);
  if (minAvgViews && metricNumber(metrics, "avgViews") < minAvgViews) return false;
  if (minAvgLikes && metricNumber(metrics, "avgLikes") < minAvgLikes) return false;
  return true;
}

function positiveIntValue(value?: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function candidateExportFilter(value?: string) {
  if (value === "YES") return "YES";
  if (value === "NO") return "NO";
  return undefined;
}

function metricNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object") return 0;
  const metric = (value as Record<string, unknown>)[key];
  return typeof metric === "number" && Number.isFinite(metric) ? metric : 0;
}
