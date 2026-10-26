import { existsSync, readFileSync } from "node:fs";
import { evaluateSocialIntegrity, type SocialIntegrityJob } from "@scaner-blogers/core";
import { createPrismaClient } from "@scaner-blogers/db";

const DEFAULT_STALE_MINUTES = 180;

if (isDirectRun()) {
  await runCli();
}

async function runCli() {
  loadDotEnv(".env.local");
  loadDotEnv(".env");
  const db = createPrismaClient();

  const limit = parsePositiveInt(process.env.SOCIAL_INTEGRITY_JOB_LIMIT, 200);
  const staleMinutes = parsePositiveInt(process.env.SOCIAL_INTEGRITY_STALE_MINUTES, DEFAULT_STALE_MINUTES);
  try {
    const jobs = await db.collectionJob.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        runs: { orderBy: { startedAt: "desc" }, take: 10 },
        events: { orderBy: { createdAt: "desc" }, take: 500 }
      }
    });

    const result = evaluateSocialIntegrity(jobs as SocialIntegrityJob[], new Date(), { staleMinutes });

    for (const issue of result.issues) {
      const subject = [
        issue.platform ? `platform=${issue.platform}` : null,
        issue.jobId ? `job=${issue.jobId}` : null,
        issue.runId ? `run=${issue.runId}` : null
      ].filter(Boolean).join(" ");
      const details = issue.details ? ` details=${JSON.stringify(issue.details)}` : "";
      console.log(`${issue.level} - ${issue.code}${subject ? ` ${subject}` : ""} - ${issue.message}${details}`);
    }

    console.log(`ok - social integrity checked jobs=${result.checkedJobs} errors=${result.errors} warnings=${result.warnings}`);

    if (result.errors > 0) {
      process.exitCode = 1;
    }
  } finally {
    await db.$disconnect();
  }
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
  return Boolean(entry?.endsWith("/scripts/social-integrity.ts") || entry?.endsWith("/scripts/social-integrity.js"));
}
