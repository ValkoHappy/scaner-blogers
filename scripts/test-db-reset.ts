import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? "file:./data/scaner-test.db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl.startsWith("file:")) {
  throw new Error(`Refusing to reset non-SQLite test database: ${databaseUrl}`);
}

const databaseFile = sqlitePathFromUrl(databaseUrl);
const normalized = path.basename(databaseFile).toLowerCase();
if (!normalized.includes("test") && !normalized.includes("verify")) {
  throw new Error(`Refusing to reset non-test SQLite database: ${databaseFile}`);
}

for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`${databaseFile}${suffix}`, { force: true });
}

execSync(`${npxCommand()} tsx scripts/sqlite-migrate.ts`, {
  stdio: "inherit",
  env: process.env
});

function sqlitePathFromUrl(url: string) {
  const rawPath = url.slice("file:".length).replaceAll("/", path.sep);
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}
