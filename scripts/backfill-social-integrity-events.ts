import { existsSync, readFileSync } from "node:fs";
import { createPrismaClient, type prisma as PrismaClientLike } from "@scaner-blogers/db";

type DbClient = typeof PrismaClientLike;

export type SocialIntegrityBackfillOptions = {
  dryRun?: boolean;
  limit?: number;
};

export type SocialIntegrityBackfillResult = {
  checkedJobs: number;
  backfilledJobs: number;
  eventsCreated: number;
};

const REQUIRED_SUCCESS_EVENTS = ["social_candidates_saved", "social_collection_completed"] as const;

if (isDirectRun()) {
  await runCli();
}

export async function backfillSocialIntegrityEvents(
  db: DbClient,
  options: SocialIntegrityBackfillOptions = {}
): Promise<SocialIntegrityBackfillResult> {
  const jobs = await db.collectionJob.findMany({
    where: { status: "SUCCESS" },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 500,
    include: {
      runs: { orderBy: { startedAt: "desc" }, take: 1 },
      events: {
        select: { data: true }
      }
    }
  });

  let backfilledJobs = 0;
  let eventsCreated = 0;

  for (const job of jobs) {
    const existingCodes = new Set(job.events.map((event) => eventCode(event.data)).filter(Boolean));
    const missingCodes = REQUIRED_SUCCESS_EVENTS.filter((code) => !existingCodes.has(code));
    if (!missingCodes.length) continue;

    backfilledJobs += 1;
    if (options.dryRun) continue;

    const latestRun = job.runs[0] ?? null;
    const createdAt = job.finishedAt ?? latestRun?.finishedAt ?? job.updatedAt;
    for (const code of missingCodes) {
      await db.collectionEvent.create({
        data: {
          collectionJobId: job.id,
          collectionRunId: latestRun?.id,
          level: "info",
          message: code,
          createdAt,
          data: backfillEventData(code, job.platform, {
            candidatesFound: job.candidatesFound,
            profilesChecked: job.profilesChecked,
            runId: latestRun?.id ?? null
          })
        }
      });
      eventsCreated += 1;
    }
  }

  return { checkedJobs: jobs.length, backfilledJobs, eventsCreated };
}

function backfillEventData(
  code: typeof REQUIRED_SUCCESS_EVENTS[number],
  platform: string,
  counters: { candidatesFound: number; profilesChecked: number; runId: string | null }
) {
  if (code === "social_candidates_saved") {
    return {
      code,
      platform,
      backfilled: true,
      candidatesReceived: counters.candidatesFound,
      uniqueInputProfiles: counters.candidatesFound,
      duplicateRowsInCollectorOutput: 0,
      savedProfiles: counters.candidatesFound,
      affectedCandidates: counters.candidatesFound,
      profilesChecked: counters.profilesChecked,
      sourceRunId: counters.runId
    };
  }
  return {
    code,
    platform,
    backfilled: true,
    status: "SUCCESS",
    candidatesFound: counters.candidatesFound,
    profilesChecked: counters.profilesChecked,
    sourceRunId: counters.runId
  };
}

async function runCli() {
  loadDotEnv(".env.local");
  loadDotEnv(".env");
  const db = createPrismaClient();
  try {
    const result = await backfillSocialIntegrityEvents(db, {
      dryRun: process.argv.includes("--dry-run"),
      limit: parsePositiveInt(process.env.SOCIAL_INTEGRITY_BACKFILL_LIMIT, 500)
    });
    console.log([
      "ok - social integrity backfill",
      `checked=${result.checkedJobs}`,
      `jobs=${result.backfilledJobs}`,
      `events=${result.eventsCreated}`
    ].join(" "));
  } finally {
    await db.$disconnect();
  }
}

function eventCode(data: unknown) {
  if (data && typeof data === "object" && "code" in data) {
    const code = (data as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator);
    let value = trimmed.slice(separator + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

function isDirectRun() {
  const entry = process.argv[1]?.replace(/\\/g, "/");
  return Boolean(entry?.endsWith("/scripts/backfill-social-integrity-events.ts") || entry?.endsWith("/scripts/backfill-social-integrity-events.js"));
}
