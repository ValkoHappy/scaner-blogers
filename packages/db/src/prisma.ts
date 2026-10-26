import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};
const DB_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_ROOT = path.resolve(DB_PACKAGE_ROOT, "../..");

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }

  const normalizedConnectionString = normalizeConnectionString(connectionString);
  prepareSqliteDatabase(normalizedConnectionString);
  const adapter = new PrismaBetterSqlite3({ url: normalizedConnectionString }, { timestampFormat: "iso8601" });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? (
  process.env.DATABASE_URL
    ? createPrismaClient()
    : new Proxy({} as PrismaClient, {
      get() {
        throw new Error("DATABASE_URL is required.");
      }
    })
);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

function prepareSqliteDatabase(connectionString: string) {
  const filePath = sqliteFilePath(connectionString);
  if (!filePath || filePath === ":memory:") return;

  mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  const db = new Database(filePath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
  } finally {
    db.close();
  }
}

export function sqliteFilePath(connectionString: string) {
  if (connectionString === ":memory:") return connectionString;
  if (connectionString.startsWith("file:")) return connectionString.slice("file:".length);
  return connectionString;
}

export function normalizeConnectionString(connectionString: string) {
  const filePath = sqliteFilePath(connectionString);
  if (!filePath || filePath === ":memory:" || path.isAbsolute(filePath)) return connectionString;
  return `file:${path.resolve(APP_ROOT, filePath).replaceAll("\\", "/")}`;
}
