import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPrismaClient } from "@scaner-blogers/db";

type OutOfRangeProfile = {
  id: string;
  candidateId: string;
  platform: string;
  username: string;
  profileUrl: string;
  followers: number;
  keyword: string;
  minFollowers: number;
  maxFollowers: number;
};

if (isDirectRun()) {
  await runCli();
}

async function runCli() {
  loadDotEnv(".env.local");
  loadDotEnv(".env");

  const apply = process.argv.includes("--apply") || process.env.PRUNE_OUT_OF_RANGE_APPLY === "1";
  const backupDir = resolve(process.cwd(), "backups");
  const db = createPrismaClient();

  try {
    const profiles = await findOutOfRangeProfiles(db);
    const counts = countByPlatform(profiles);

    console.log(`out-of-range social candidates: total=${profiles.length} ${formatCounts(counts)}`);
    if (!profiles.length) {
      console.log("ok - nothing to prune");
      return;
    }

    mkdirSync(backupDir, { recursive: true });
    const backupPath = resolve(backupDir, `out-of-range-social-candidates-${timestamp()}.json`);
    writeFileSync(backupPath, JSON.stringify({
      createdAt: new Date().toISOString(),
      apply,
      counts,
      profiles
    }, null, 2));
    console.log(`backup written: ${backupPath}`);

    if (!apply) {
      console.log("dry-run only - pass --apply or PRUNE_OUT_OF_RANGE_APPLY=1 to delete these profiles");
      return;
    }

    const deletedProfiles = await deleteOutOfRangeProfiles(db);
    const deletedOrphanCandidates = await deleteOrphanCandidates(db, uniqueCandidateIds(deletedProfiles));
    console.log(`deleted profiles=${deletedProfiles.length}; deleted orphan candidates=${deletedOrphanCandidates.length}`);

    const remaining = await findOutOfRangeProfiles(db);
    if (remaining.length > 0) {
      console.error(`error - out-of-range profiles remain after prune: ${remaining.length}`);
      process.exitCode = 1;
      return;
    }

    console.log("ok - out-of-range social candidates pruned");
  } finally {
    await db.$disconnect();
  }
}

async function findOutOfRangeProfiles(db: ReturnType<typeof createPrismaClient>) {
  return db.$queryRaw<OutOfRangeProfile[]>`
    WITH ranged AS (
      SELECT
        p.id,
        p."candidateId",
        p.platform,
        p.username,
        p."profileUrl",
        p.followers,
        k.value AS keyword,
        CASE p.platform
          WHEN 'INSTAGRAM'::"SocialPlatform" THEN COALESCE(k."instagramMinFollowers", k."minFollowers")
          WHEN 'VK'::"SocialPlatform" THEN COALESCE(k."vkMinFollowers", k."minFollowers")
          WHEN 'YOUTUBE'::"SocialPlatform" THEN COALESCE(k."youtubeMinFollowers", k."minFollowers")
        END AS "minFollowers",
        CASE p.platform
          WHEN 'INSTAGRAM'::"SocialPlatform" THEN COALESCE(k."instagramMaxFollowers", k."maxFollowers")
          WHEN 'VK'::"SocialPlatform" THEN COALESCE(k."vkMaxFollowers", k."maxFollowers")
          WHEN 'YOUTUBE'::"SocialPlatform" THEN COALESCE(k."youtubeMaxFollowers", k."maxFollowers")
        END AS "maxFollowers"
      FROM "CandidateProfile" p
      JOIN "SearchKeyword" k ON k.id = p."keywordId"
    )
    SELECT
      id,
      "candidateId",
      platform::text AS platform,
      username,
      "profileUrl",
      followers,
      keyword,
      "minFollowers",
      "maxFollowers"
    FROM ranged
    WHERE followers < "minFollowers" OR followers > "maxFollowers"
    ORDER BY platform, followers, username
  `;
}

async function deleteOutOfRangeProfiles(db: ReturnType<typeof createPrismaClient>) {
  return db.$queryRaw<Array<{ id: string; candidateId: string }>>`
    WITH ranged AS (
      SELECT
        p.id,
        CASE p.platform
          WHEN 'INSTAGRAM'::"SocialPlatform" THEN COALESCE(k."instagramMinFollowers", k."minFollowers")
          WHEN 'VK'::"SocialPlatform" THEN COALESCE(k."vkMinFollowers", k."minFollowers")
          WHEN 'YOUTUBE'::"SocialPlatform" THEN COALESCE(k."youtubeMinFollowers", k."minFollowers")
        END AS "minFollowers",
        CASE p.platform
          WHEN 'INSTAGRAM'::"SocialPlatform" THEN COALESCE(k."instagramMaxFollowers", k."maxFollowers")
          WHEN 'VK'::"SocialPlatform" THEN COALESCE(k."vkMaxFollowers", k."maxFollowers")
          WHEN 'YOUTUBE'::"SocialPlatform" THEN COALESCE(k."youtubeMaxFollowers", k."maxFollowers")
        END AS "maxFollowers"
      FROM "CandidateProfile" p
      JOIN "SearchKeyword" k ON k.id = p."keywordId"
    )
    DELETE FROM "CandidateProfile" p
    USING ranged r
    WHERE p.id = r.id
      AND (p.followers < r."minFollowers" OR p.followers > r."maxFollowers")
    RETURNING p.id, p."candidateId"
  `;
}

async function deleteOrphanCandidates(db: ReturnType<typeof createPrismaClient>, candidateIds: string[]) {
  if (!candidateIds.length) return [];

  const deleted: Array<{ id: string }> = [];
  for (const candidateId of candidateIds) {
    const candidate = await db.candidate.findFirst({
      where: {
        id: candidateId,
        profiles: { none: {} }
      },
      select: { id: true }
    });
    if (!candidate) continue;
    await db.candidate.delete({ where: { id: candidate.id } });
    deleted.push(candidate);
  }
  return deleted;
}

function countByPlatform(profiles: OutOfRangeProfile[]) {
  const counts: Record<string, number> = {};
  for (const profile of profiles) counts[profile.platform] = (counts[profile.platform] ?? 0) + 1;
  return counts;
}

function formatCounts(counts: Record<string, number>) {
  const entries = Object.entries(counts);
  return entries.length ? entries.map(([platform, count]) => `${platform}=${count}`).join(" ") : "";
}

function uniqueCandidateIds(profiles: Array<{ candidateId: string }>) {
  return Array.from(new Set(profiles.map((profile) => profile.candidateId)));
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
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
  return Boolean(entry?.endsWith("/scripts/prune-out-of-range-social-candidates.ts") || entry?.endsWith("/scripts/prune-out-of-range-social-candidates.js"));
}
