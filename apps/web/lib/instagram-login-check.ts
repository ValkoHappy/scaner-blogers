import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, isAbsolute, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isInstagramPreparedAuthSource, normalizeInstagramStoredCredentials, resolveInstagramAuthSource, type CollectorEventRow, parseCollectorEventRow } from "@scaner-blogers/core";
import {
  prisma as defaultPrisma,
  upsertSocialPlatformAccountStatus
} from "@scaner-blogers/db";

type DbClient = typeof defaultPrisma;
const WEB_LIB_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_COLLECTOR_ROOT = resolve(WEB_LIB_ROOT, "../../../collectors/instagram");
const DEFAULT_INSTAGRAPI_REPO = resolve(WEB_LIB_ROOT, "../../../vendor/instagram-instagrapi");
const DEFAULT_WINDOWS_PYTHON = resolve(WEB_LIB_ROOT, "../../../.venv-instagram/Scripts/python.exe");
const DEFAULT_UNIX_PYTHON = resolve(WEB_LIB_ROOT, "../../../.venv-instagram/bin/python");

export interface SelectedInstagramProxy {
  id?: string;
  url: string;
  source: "env" | "settings" | "pool" | "account";
}

export interface InstagramLoginCheckCollectorResult {
  exitCode: number;
  events: CollectorEventRow[];
  stderr?: string[];
  sessionSettings?: string;
}

export interface InstagramLoginCheckOutcome {
  ok: boolean;
  code: string;
  message: string;
  accountStatus: "OK" | "BLOCKED" | "FAILED" | "MISSING_CREDENTIALS";
  blockedUntil?: Date | null;
  requiresVerification?: boolean;
}

export interface RunInstagramLoginCheckOptions {
  db?: DbClient;
  env?: NodeJS.ProcessEnv;
  runCollector?: (input: { proxyUrl?: string; env?: NodeJS.ProcessEnv }) => Promise<InstagramLoginCheckCollectorResult>;
}

export interface RunInstagramAccountLoginCheckOptions extends RunInstagramLoginCheckOptions {
  accountKey: string;
  verificationCode?: string;
}

export async function resolveInstagramLoginCheckProxy(
  db: DbClient = defaultPrisma,
  accountProxyUrl?: string
): Promise<SelectedInstagramProxy | null> {
  if (process.env.INSTAGRAM_PROXY_URL) {
    return { url: process.env.INSTAGRAM_PROXY_URL, source: "env" };
  }

  const settings = await db.systemSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {}
  });
  if (!settings.proxyEnabled) return null;
  if (accountProxyUrl) return { url: accountProxyUrl, source: "account" };
  if (settings.proxyUrl) return { url: settings.proxyUrl, source: "settings" };

  const proxy = await db.proxyEndpoint.findFirst({
    where: {
      status: "OK",
      OR: [
        { blockedUntil: null },
        { blockedUntil: { lte: new Date() } }
      ]
    },
    orderBy: [
      { lastUsedAt: "asc" },
      { createdAt: "asc" }
    ]
  });
  if (!proxy) return null;
  await db.proxyEndpoint.update({
    where: { id: proxy.id },
    data: { lastUsedAt: new Date() }
  });
  return { id: proxy.id, url: proxy.url, source: "pool" };
}

export function instagramLoginCheckOutcome(result: InstagramLoginCheckCollectorResult, now = new Date()): InstagramLoginCheckOutcome {
  const okEvent = result.events.find((row) => row.event.code === "instagram_login_check_ok");
  if (result.exitCode === 0 && okEvent) {
    return {
      ok: true,
      code: okEvent.event.code,
      message: okEvent.event.message,
      accountStatus: "OK",
      blockedUntil: null
    };
  }

  const errorEvent = [...result.events].reverse().find((row) => row.event.level === "error") ?? result.events.at(-1);
  const code = errorEvent?.event.code ?? "instagram_login_check_failed";
  const message = errorEvent?.event.message ?? result.stderr?.at(-1) ?? `instagram login-check exited with ${result.exitCode}`;
  const diagnostic = `${code}:${message}`;
  const requiresVerification = /challenge_required|checkpoint|two_factor_required|verification_code/i.test(diagnostic);
  const requiresLogin = requiresVerification || /login_required/i.test(diagnostic);
  const blocked = /automation|automated|rate_limited|please_wait|throttled|sentry_block|proxy_blocked/i.test(diagnostic);
  const accountStatus = /missing_credentials/i.test(`${code}:${message}`)
    ? "MISSING_CREDENTIALS"
    : requiresLogin
      ? "FAILED"
    : blocked
      ? "BLOCKED"
      : "FAILED";

  return {
    ok: false,
    code,
    message,
    accountStatus,
    blockedUntil: accountStatus === "BLOCKED" ? instagramBlockedUntil(`${code}:${message}`, now) : null,
    requiresVerification
  };
}

export async function runInstagramLoginCheck(options: RunInstagramLoginCheckOptions = {}) {
  const db = options.db ?? defaultPrisma;
  const env = options.env ?? process.env;
  const selectedProxy = await resolveInstagramLoginCheckProxy(db);
  const collector = options.runCollector ?? runPythonInstagramLoginCheck;
  const result = await collector({ proxyUrl: selectedProxy?.url, env });
  const outcome = instagramLoginCheckOutcome(result);
  const username = env.INSTAGRAM_USERNAME || env.IG_USERNAME || null;

  await upsertSocialPlatformAccountStatus({
    platform: "instagram",
    username,
    label: "Instagram env account",
    status: outcome.accountStatus,
    blockedUntil: outcome.blockedUntil,
    lastError: outcome.ok ? null : `instagram-login-check:${outcome.code}:${outcome.message}`,
    metadata: {
      loginCheck: true,
      proxySource: selectedProxy?.source ?? "none",
      proxyId: selectedProxy?.id,
      events: result.events.map((row) => row.event.code)
    }
  }, db);

  return {
    ...outcome,
    events: result.events,
    proxySource: selectedProxy?.source ?? "none"
  };
}

export async function runInstagramAccountLoginCheck(options: RunInstagramAccountLoginCheckOptions) {
  const db = options.db ?? defaultPrisma;
  const account = await db.socialPlatformAccount.findFirst({
    where: { accountKey: options.accountKey, platform: "INSTAGRAM" },
    select: { accountKey: true, blockedUntil: true, metadata: true }
  });
  if (!account) throw new Error("instagram_account_not_found");

  const metadata = metadataRecord(account.metadata);
  if (!options.verificationCode && account.blockedUntil && account.blockedUntil > new Date()) {
    return {
      ok: false,
      code: "instagram_account_cooldown",
      message: `Instagram account is on cooldown until ${account.blockedUntil.toISOString()}`,
      accountStatus: "BLOCKED" as const,
      blockedUntil: account.blockedUntil,
      events: []
    };
  }

  const auth = resolveInstagramAuthSource(metadata);
  const username = metadataString(metadata.username);
  const accountProxyUrl = metadataString(metadata.proxyUrl);
  if (!username || !isInstagramPreparedAuthSource(auth.authSource)) {
    const outcome: InstagramLoginCheckOutcome = {
      ok: false,
      code: !username || auth.authSource === "missing"
        ? "instagram_missing_credentials"
        : auth.authSource === "mixed"
        ? "instagram_mixed_auth_state"
        : "instagram_helper_session_required",
      message: !username || auth.authSource === "missing"
        ? "Instagram username and one prepared donor session are required for this account"
        : auth.authSource === "mixed"
        ? "Instagram account stores conflicting auth sources. Reconnect it through the donor helper before running login-check again"
        : "Password-only Instagram access is legacy. Refresh the donor session through the donor helper and reconnect the exported JSON before running login-check again",
      accountStatus: "MISSING_CREDENTIALS",
      blockedUntil: null
    };
    await updateCheckedInstagramAccount(db, account.accountKey, metadata, outcome, []);
    return { ...outcome, events: [] };
  }
  const { password, sessionId, sessionSettings, sessionFile } = auth.metadata;

  const collector = options.runCollector ?? runPythonInstagramLoginCheck;
  const selectedProxy = await resolveInstagramLoginCheckProxy(db, accountProxyUrl);
  const result = await collector({
    proxyUrl: selectedProxy?.url,
    env: selectedInstagramAccountEnv(options.env ?? process.env, {
      username,
      password,
      sessionId,
      sessionSettings,
      sessionFile,
      verificationCode: options.verificationCode
    })
  });
  const outcome = instagramLoginCheckOutcome(result);
  await updateCheckedInstagramAccount(db, account.accountKey, metadata, outcome, result.events, selectedProxy, result.sessionSettings);
  return { ...outcome, events: result.events, proxySource: selectedProxy?.source ?? "none" };
}

export async function runPythonInstagramLoginCheck(input: { proxyUrl?: string; env?: NodeJS.ProcessEnv }): Promise<InstagramLoginCheckCollectorResult> {
  const collectorRoot = resolveInstagramCollectorRoot();
  const pythonBin = process.env.INSTAGRAM_PYTHON_BIN ?? resolveInstagramPythonBin("python");
  const scriptPath = resolve(collectorRoot, "instagram_collector.py");
  const timeoutMs = normalizeTimeoutMs(process.env.INSTAGRAM_LOGIN_CHECK_TIMEOUT_MS, 90_000);
  const args = [
    scriptPath,
    "--config",
    resolve(collectorRoot, "config.example.json"),
    "--login-check"
  ];
  const events: CollectorEventRow[] = [];
  const stderr: string[] = [];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...input.env,
    INSTAGRAPI_REPO_PATH: process.env.INSTAGRAPI_REPO_PATH ?? DEFAULT_INSTAGRAPI_REPO,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    ...(input.proxyUrl ? { INSTAGRAM_PROXY_URL: input.proxyUrl } : {})
  };

  const child = spawn(pythonBin, args, {
    cwd: collectorRoot,
    env,
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"]
  });
  let timedOut = false;
  const stderrReader = createInterface({ input: child.stderr });
  stderrReader.on("line", (line) => {
    stderr.push(line);
    try {
      const event = parseCollectorEventRow(JSON.parse(line));
      if (event) events.push(event);
    } catch {
      // Keep raw stderr for diagnostics.
    }
  });

  let timeout: NodeJS.Timeout | undefined;
  const exitCode = await new Promise<number>((resolveExit) => {
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      resolveExit(code);
    };

    timeout = setTimeout(() => {
      timedOut = true;
      const line = JSON.stringify({
        timestamp: new Date().toISOString(),
        platform: "instagram",
        event: {
          level: "error",
          code: "instagram_login_check_timeout",
          message: `Instagram login-check timed out after ${timeoutMs}ms`
        }
      });
      stderr.push(line);
      try {
        const event = parseCollectorEventRow(JSON.parse(line));
        if (event) events.push(event);
      } catch {
        // Ignore synthetic event parse errors.
      }
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3_000).unref();
      // Do not wait forever for a stuck child process to emit `close`.
      finish(124);
    }, timeoutMs);
    timeout.unref();

    child.once("error", (error) => {
      stderr.push(error instanceof Error ? error.message : String(error));
      finish(1);
    });
    child.once("close", (code) => finish(code ?? 1));
  });
  if (timeout) clearTimeout(timeout);
  return {
    exitCode: timedOut ? 124 : exitCode,
    events,
    stderr,
    sessionSettings: !timedOut && (
      exitCode === 0 || events.some((row) => /challenge_required|checkpoint|two_factor_required|verification_code/i.test(row.event.code))
    ) ? readUpdatedSessionSettings(collectorRoot, env.INSTAGRAM_SESSION_FILE) : undefined
  };
}

function selectedInstagramAccountEnv(
  baseEnv: NodeJS.ProcessEnv,
  account: {
    username: string;
    password?: string;
    sessionId?: string;
    sessionSettings?: string;
    sessionFile?: string;
    verificationCode?: string;
  }
) {
  const env = { ...baseEnv };
  delete env.INSTAGRAM_USERNAME;
  delete env.IG_USERNAME;
  delete env.INSTAGRAM_PASSWORD;
  delete env.IG_PASSWORD;
  delete env.INSTAGRAM_SESSION_FILE;
  delete env.INSTAGRAM_SESSIONID;
  delete env.INSTAGRAM_SESSION_SETTINGS;
  delete env.INSTAGRAM_SESSION_SETTINGS_B64;
  delete env.INSTAGRAM_VERIFICATION_CODE;
  env.INSTAGRAM_USERNAME = account.username;
  if (account.password) env.INSTAGRAM_PASSWORD = account.password;
  if (account.sessionId) env.INSTAGRAM_SESSIONID = account.sessionId;
  if (account.sessionSettings) env.INSTAGRAM_SESSION_SETTINGS_B64 = Buffer.from(account.sessionSettings, "utf8").toString("base64");
  if (account.sessionFile) env.INSTAGRAM_SESSION_FILE = account.sessionFile;
  if (account.verificationCode) env.INSTAGRAM_VERIFICATION_CODE = account.verificationCode;
  return env;
}

async function updateCheckedInstagramAccount(
  db: DbClient,
  accountKey: string,
  metadata: Record<string, unknown>,
  outcome: InstagramLoginCheckOutcome,
  events: CollectorEventRow[],
  selectedProxy?: SelectedInstagramProxy | { url: string; source: "account" } | null,
  sessionSettings?: string
) {
  const now = new Date();
  const hasError = outcome.accountStatus !== "OK";
  const normalized = normalizeInstagramStoredCredentials({
    username: metadataString(metadata.username) ?? "",
    password: metadataString(metadata.password),
    sessionId: metadataString(metadata.sessionId),
    sessionSettings: sessionSettings ?? metadataString(metadata.sessionSettings),
    sessionFile: metadataString(metadata.sessionFile)
  });
  const { password: _password, sessionId: _sessionId, sessionSettings: _sessionSettings, sessionFile: _sessionFile, authSource: _authSource, ...restMetadata } = metadata;
  await db.socialPlatformAccount.update({
    where: { accountKey },
    data: {
      status: outcome.accountStatus,
      blockedUntil: outcome.blockedUntil ?? null,
      lastLoginAt: now,
      lastSuccessAt: outcome.ok ? now : undefined,
      lastErrorAt: hasError ? now : undefined,
      lastError: outcome.ok ? null : `instagram-login-check:${outcome.code}:${outcome.message}`,
      consecutiveErrors: outcome.ok ? 0 : { increment: 1 },
      metadata: {
        ...restMetadata,
        ...normalized.metadata,
        authSource: normalized.authSource,
        loginCheck: true,
        loginCheckCode: outcome.code,
        loginCheckProxySource: selectedProxy?.source ?? "none",
        ...(selectedProxy && "id" in selectedProxy ? { loginCheckProxyId: selectedProxy.id } : {}),
        loginCheckEvents: events.map((row) => row.event.code)
      }
    }
  });
}

function readUpdatedSessionSettings(collectorRoot: string, sessionFile: string | undefined) {
  if (!sessionFile?.trim()) return undefined;
  const cleanPath = sessionFile.trim();
  const appRoot = resolve(collectorRoot, "..", "..");
  const filePath = isAbsolute(cleanPath) ? cleanPath : resolve(appRoot, cleanPath);
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? JSON.stringify(parsed)
      : undefined;
  } catch {
    return undefined;
  }
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function metadataString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function instagramBlockedUntil(message: string, now = new Date()) {
  const hours = /challenge|automation|automated/i.test(message)
    ? 24
    : /rate_limited|please_wait|throttled|sentry_block/i.test(message)
    ? 12
    : /login_required/i.test(message)
    ? 6
    : /proxy_blocked/i.test(message)
    ? 3
    : 1;
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

function resolveInstagramCollectorRoot() {
  return process.env.SCANER_APP_ROOT
    ? resolve(process.env.SCANER_APP_ROOT, "collectors", "instagram")
    : DEFAULT_COLLECTOR_ROOT;
}

function resolveInstagramPythonBin(fallback = "python") {
  if (process.env.SCANER_APP_ROOT) {
    const appRoot = resolve(process.env.SCANER_APP_ROOT);
    const localWindowsPython = resolve(appRoot, ".venv-instagram", "Scripts", "python.exe");
    const localUnixPython = resolve(appRoot, ".venv-instagram", "bin", "python");
    if (existsSync(localWindowsPython)) return localWindowsPython;
    if (existsSync(localUnixPython)) return localUnixPython;
  }
  if (existsSync(DEFAULT_WINDOWS_PYTHON)) return DEFAULT_WINDOWS_PYTHON;
  if (existsSync(DEFAULT_UNIX_PYTHON)) return DEFAULT_UNIX_PYTHON;
  return fallback;
}

function normalizeTimeoutMs(value: string | undefined, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(180_000, Math.max(10_000, Math.round(number)));
}
