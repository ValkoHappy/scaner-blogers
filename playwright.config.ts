import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const e2ePort = Number(process.env.E2E_PORT ?? 3101);
const e2eBaseUrl = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${e2ePort}`;
const e2eDatabaseUrl = normalizeSqliteUrl(
  process.env.DATABASE_URL ?? "file:./data/scaner-e2e-test.db"
);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry",
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}
  },
  webServer: {
    command: `npm --workspace apps/web run start -- --hostname 127.0.0.1 --port ${e2ePort}`,
    url: `${e2eBaseUrl}/login`,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 120_000,
    env: {
      DATABASE_URL: e2eDatabaseUrl,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "test-secret",
      ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? "admin@scaner-blogers.local",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "TestOnly!ChangeInCi2026",
      ALLOW_INSECURE_TEST_SECRETS: "true"
    }
  },
  globalSetup: "./tests/e2e/global-setup.ts",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } }
  ]
});

function normalizeSqliteUrl(databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) return databaseUrl;
  const sqlitePath = databaseUrl.slice("file:".length);
  if (path.isAbsolute(sqlitePath)) return databaseUrl;
  return `file:${path.resolve(process.cwd(), sqlitePath).replaceAll("\\", "/")}`;
}
