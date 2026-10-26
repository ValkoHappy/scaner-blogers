import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, type Dirent } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { findForbiddenRuntimeMarkers, type SecretScanFile } from "./secret-scan.js";

type Check = {
  name: string;
  ok: boolean;
  details?: string;
};

const REQUIRED_COLUMNS = [
  { table: "Candidate", column: "exportedAt" },
  { table: "Candidate", column: "priorityAt" },
  { table: "CandidateProfile", column: "qualityScore" },
  { table: "CandidateProfile", column: "qualitySignals" },
  { table: "CollectionJob", column: "configHash" },
  { table: "SearchKeyword", column: "instagramMinFollowers" },
  { table: "SearchKeyword", column: "youtubeMaxFollowers" }
];

const REQUIRED_TABLES = ["CollectionSearchHistory", "CollectionEvent", "RawSocialSnapshot"];

loadDotEnv(".env.local");
loadDotEnv(".env");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for verify:db.");
}
if (!databaseUrl.startsWith("file:")) {
  throw new Error(`verify:db only supports SQLite file: URLs, got ${maskSecrets(databaseUrl)}`);
}

const checks: Check[] = [];

try {
  const migrateOutput = runCommand([npxCommand(), "tsx", "scripts/sqlite-migrate.ts"]);
  checks.push({
    name: "SQLite migrations are applied",
    ok: migrateOutput.includes("SQLite database is ready"),
    details: firstUsefulLine(migrateOutput)
  });
} catch (error) {
  checks.push({
    name: "SQLite migrations are applied",
    ok: false,
    details: safeErrorMessage(error)
  });
}

try {
  const runtimeFiles = readRuntimeConsistencyFiles(process.cwd());
  const runtimeDriftIssues = findForbiddenRuntimeMarkers(runtimeFiles);
  checks.push({
    name: "active runtime docs and scripts are SQLite-only",
    ok: runtimeDriftIssues.length === 0,
    details: runtimeDriftIssues[0] ? `${runtimeDriftIssues[0].path}:${runtimeDriftIssues[0].line} ${runtimeDriftIssues[0].marker}` : undefined
  });
} catch (error) {
  checks.push({
    name: "active runtime docs and scripts are SQLite-only",
    ok: false,
    details: safeErrorMessage(error)
  });
}

const databaseFile = sqlitePathFromUrl(databaseUrl);
try {
  const db = new Database(databaseFile, { readonly: true, fileMustExist: true });
  try {
    const tableRows = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
    `).all() as Array<{ name: string }>;
    const existingTables = new Set(tableRows.map((row) => row.name));
    for (const table of REQUIRED_TABLES) {
      checks.push({ name: `table ${table} exists`, ok: existingTables.has(table) });
    }

    for (const column of REQUIRED_COLUMNS) {
      const rows = db.prepare(`PRAGMA table_info("${column.table}")`).all() as Array<{ name: string }>;
      checks.push({
        name: `column ${column.table}.${column.column} exists`,
        ok: rows.some((row) => row.name === column.column)
      });
    }

    const journalMode = db.pragma("journal_mode", { simple: true });
    checks.push({
      name: "SQLite journal mode is readable",
      ok: Boolean(journalMode),
      details: String(journalMode)
    });
  } finally {
    db.close();
  }
} catch (error) {
  checks.push({
    name: "database schema inspection",
    ok: false,
    details: safeErrorMessage(error)
  });
}

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  const suffix = check.details ? ` (${check.details})` : "";
  console.log(`${check.ok ? "ok" : "fail"} - ${check.name}${suffix}`);
}

if (failed.length) {
  process.exitCode = 1;
}

function runCommand(command: string[]) {
  const output = execSync(command.join(" "), {
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return maskSecrets(output);
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function sqlitePathFromUrl(url: string) {
  const rawPath = url.slice("file:".length).replaceAll("/", path.sep);
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
}

function firstUsefulLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith(">"))
    ?.slice(0, 240);
}

function safeErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    const line = firstUsefulLine(maskSecrets(stderr));
    if (line) return line;
  }
  return maskSecrets(error instanceof Error ? error.message : String(error)).slice(0, 240);
}

function maskSecrets(value: string) {
  let masked = value;
  for (const key of ["DATABASE_URL", "AUTH_SECRET", "ADMIN_PASSWORD", "INSTAGRAM_PASSWORD", "INSTAGRAM_PROXY_URL", "VK_ACCESS_TOKEN", "VK_SERVER_TOKEN", "VK_SERVICE_TOKEN", "YOUTUBE_API_KEY"]) {
    const secret = process.env[key];
    if (secret) masked = masked.split(secret).join("[redacted]");
  }
  return masked;
}

function loadDotEnv(filePath: string) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
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

function readRuntimeConsistencyFiles(root: string): SecretScanFile[] {
  const result: SecretScanFile[] = [];
  const exactFiles = [
    "README.md",
    ".env.example",
    ".env.portable.example",
    "package.json",
    "docker-compose.yml"
  ];
  const directories = [
    "docs",
    "scripts"
  ];

  for (const relative of exactFiles) {
    const absolute = path.join(root, relative);
    if (!existsSync(absolute)) continue;
    result.push({ path: relative.replace(/\\/g, "/"), content: readFileSync(absolute, "utf8") });
  }

  for (const relativeDir of directories) {
    const absoluteDir = path.join(root, relativeDir);
    if (!existsSync(absoluteDir)) continue;
    result.push(...readTextFilesRecursively(root, absoluteDir));
  }

  return result;
}

function readTextFilesRecursively(root: string, current: string): SecretScanFile[] {
  const result: SecretScanFile[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true }) as Dirent[]) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      result.push(...readTextFilesRecursively(root, absolute));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(md|ps1|sh|ts|js|json|ya?ml)$/i.test(entry.name)) continue;
    result.push({ path: relative, content: readFileSync(absolute, "utf8") });
  }
  return result;
}
