import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { loadDotEnv } from "./social-smoke-env.js";

const rootDir = process.cwd();
loadDotEnv(path.join(rootDir, ".env.local"), process.env);
loadDotEnv(path.join(rootDir, ".env"), process.env);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Example: file:./data/scaner.db");
}

if (!databaseUrl.startsWith("file:")) {
  throw new Error(`sqlite-migrate only supports SQLite file: URLs, got ${databaseUrl}`);
}

const migrationsDir = path.join(rootDir, "packages", "db", "prisma", "migrations");
const databaseFile = sqlitePathFromUrl(databaseUrl);

if (databaseFile !== ":memory:") {
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
}

const db = new Database(databaseFile);

try {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    );
  `);

  const migrationNames = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const selectMigration = db.prepare<{ migration_name: string }, { checksum: string }>(
    `SELECT checksum FROM "_prisma_migrations" WHERE migration_name = @migration_name AND rolled_back_at IS NULL`
  );

  const insertMigration = db.prepare(`
    INSERT INTO "_prisma_migrations" (
      id,
      checksum,
      finished_at,
      migration_name,
      logs,
      rolled_back_at,
      started_at,
      applied_steps_count
    )
    VALUES (
      @id,
      @checksum,
      CURRENT_TIMESTAMP,
      @migration_name,
      NULL,
      NULL,
      CURRENT_TIMESTAMP,
      @applied_steps_count
    )
  `);

  for (const migrationName of migrationNames) {
    const migrationPath = path.join(migrationsDir, migrationName, "migration.sql");
    if (!fs.existsSync(migrationPath)) continue;

    const sql = fs.readFileSync(migrationPath, "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const existing = selectMigration.get({ migration_name: migrationName });

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`Migration ${migrationName} changed after it was applied.`);
      }
      console.log(`Already applied: ${migrationName}`);
      continue;
    }

    const apply = db.transaction(() => {
      db.exec(sql);
      insertMigration.run({
        id: crypto.randomUUID(),
        checksum,
        migration_name: migrationName,
        applied_steps_count: countStatements(sql)
      });
    });

    apply();
    console.log(`Applied: ${migrationName}`);
  }

  console.log(`SQLite database is ready: ${databaseFile}`);
} finally {
  db.close();
}

function sqlitePathFromUrl(url: string) {
  const rawPath = url.slice("file:".length);
  if (rawPath === ":memory:") return rawPath;

  const normalized = rawPath.replaceAll("/", path.sep);
  if (path.isAbsolute(normalized)) return normalized;
  return path.resolve(rootDir, normalized);
}

function countStatements(sql: string) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean).length;
}
