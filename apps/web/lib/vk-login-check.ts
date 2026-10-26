import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCollectorEventRow, refreshVkOAuthToken, type CollectorEventRow } from "@scaner-blogers/core";
import { randomUUID } from "node:crypto";
import {
  prisma as defaultPrisma,
  upsertSocialPlatformAccountStatus
} from "@scaner-blogers/db";
import { buildSocialCredentialReadiness } from "./social-credential-readiness";

type DbClient = typeof defaultPrisma;
const WEB_LIB_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_COLLECTOR_ROOT = resolve(WEB_LIB_ROOT, "../../../collectors/vk");
const DEFAULT_WINDOWS_PYTHON = resolve(WEB_LIB_ROOT, "../../../.venv-instagram/Scripts/python.exe");
const DEFAULT_UNIX_PYTHON = resolve(WEB_LIB_ROOT, "../../../.venv-instagram/bin/python");

export interface VkLoginCheckCollectorResult {
  exitCode: number;
  events: CollectorEventRow[];
  stderr?: string[];
}

export interface VkLoginCheckOutcome {
  ok: boolean;
  code: string;
  message: string;
  accountStatus: "OK" | "BLOCKED" | "FAILED" | "MISSING_CREDENTIALS";
  blockedUntil?: Date | null;
}

export interface RunVkLoginCheckOptions {
  db?: DbClient;
  env?: NodeJS.ProcessEnv;
  runCollector?: (input: { env?: NodeJS.ProcessEnv }) => Promise<VkLoginCheckCollectorResult>;
  refreshToken?: typeof refreshVkOAuthToken;
}

export interface RunVkAccountLoginCheckOptions extends RunVkLoginCheckOptions {
  accountKey: string;
}

export function vkLoginCheckOutcome(result: VkLoginCheckCollectorResult, now = new Date()): VkLoginCheckOutcome {
  const okEvent = result.events.find((row) => row.event.code === "vk_token_check_ok");
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
  const code = errorEvent?.event.code ?? "vk_login_check_failed";
  const message = errorEvent?.event.message ?? result.stderr?.at(-1) ?? `vk login-check exited with ${result.exitCode}`;
  const diagnostic = `${code}:${message}`;
  const missingCredentials = /missing_token|vk_user_token_required|VK_ACCESS_TOKEN.*not configured|user access token.*required/i.test(diagnostic);
  const blocked = /another ip address|rate_limited|too many requests|quota|flood control|access denied|user authorization failed/i.test(diagnostic);
  const accountStatus = missingCredentials ? "MISSING_CREDENTIALS" : blocked ? "BLOCKED" : "FAILED";
  return {
    ok: false,
    code,
    message,
    accountStatus,
    blockedUntil: accountStatus === "BLOCKED" ? socialBlockedUntil(diagnostic, now) : null
  };
}

export async function runVkLoginCheck(options: RunVkLoginCheckOptions = {}) {
  const db = options.db ?? defaultPrisma;
  const env = options.env ?? process.env;
  const collector = options.runCollector ?? runPythonVkLoginCheck;
  const result = await collector({ env });
  const outcome = vkLoginCheckOutcome(result);
  const vkCredential = buildSocialCredentialReadiness(env).find((item) => item.platform === "VK");

  await upsertSocialPlatformAccountStatus({
    platform: "vk",
    username: "api-token",
    label: "VK API token",
    status: outcome.accountStatus,
    blockedUntil: outcome.blockedUntil,
    lastError: outcome.ok ? null : `vk-login-check:${outcome.code}:${outcome.message}`,
    metadata: {
      loginCheck: true,
      serviceTokenConfigured: Boolean(env.VK_SERVICE_TOKEN),
      serverTokenConfigured: Boolean(env.VK_SERVER_TOKEN),
      accessTokenConfigured: Boolean(env.VK_ACCESS_TOKEN),
      tokenConfigured: Boolean(vkCredential?.ready),
      preferredToken: vkCredential?.source ?? "none",
      credentialStatus: vkCredential?.status ?? "MISSING",
      events: result.events.map((row) => row.event.code)
    }
  }, db);

  return {
    ...outcome,
    events: result.events
  };
}

export async function runVkAccountLoginCheck(options: RunVkAccountLoginCheckOptions) {
  const db = options.db ?? defaultPrisma;
  const account = await db.socialPlatformAccount.findFirst({
    where: { accountKey: options.accountKey, platform: "VK" },
    select: { accountKey: true, metadata: true }
  });
  if (!account) throw new Error("vk_account_not_found");

  let metadata = metadataRecord(account.metadata);
  if (!freshVkAccountToken(metadata, new Date())) {
    const refreshed = await refreshStoredVkAccount(db, account.accountKey, metadata, options.refreshToken);
    if (!refreshed) {
      const outcome: VkLoginCheckOutcome = {
        ok: false,
        code: "vk_token_refresh_failed",
        message: "VK access token expired and could not be refreshed; reconnect the VK account",
        accountStatus: "FAILED",
        blockedUntil: null
      };
      await updateCheckedVkAccount(db, account.accountKey, metadata, outcome, []);
      return { ...outcome, events: [] };
    }
    metadata = refreshed;
  }
  const token = typeof metadata.token === "string" ? metadata.token.trim() : "";
  const tokenType = vkTokenType(metadata.tokenType);
  if (!token) {
    const outcome: VkLoginCheckOutcome = {
      ok: false,
      code: "vk_missing_token",
      message: "VK token is not configured for this account",
      accountStatus: "MISSING_CREDENTIALS",
      blockedUntil: null
    };
    await updateCheckedVkAccount(db, account.accountKey, metadata, outcome, []);
    return { ...outcome, events: [] };
  }
  if (tokenType !== "access") {
    const outcome: VkLoginCheckOutcome = {
      ok: false,
      code: "vk_user_token_required",
      message: "VK groups.search requires a user access token; service/server tokens cannot be used for parsing",
      accountStatus: "MISSING_CREDENTIALS",
      blockedUntil: null
    };
    await updateCheckedVkAccount(db, account.accountKey, metadata, outcome, []);
    return { ...outcome, events: [] };
  }

  let env = selectedVkAccountEnv(options.env ?? process.env, token, tokenType);
  const collector = options.runCollector ?? runPythonVkLoginCheck;
  let result = await collector({ env });
  let outcome = vkLoginCheckOutcome(result);

  if (!outcome.ok && /another ip address/i.test(`${outcome.code}:${outcome.message}`)) {
    const refreshed = await refreshStoredVkAccount(db, account.accountKey, metadata, options.refreshToken);
    const refreshedToken = refreshed && typeof refreshed.token === "string" ? refreshed.token.trim() : "";
    if (refreshed && refreshedToken) {
      metadata = refreshed;
      env = selectedVkAccountEnv(options.env ?? process.env, refreshedToken, "access");
      result = await collector({ env });
      outcome = vkLoginCheckOutcome(result);
    }
  }

  await updateCheckedVkAccount(db, account.accountKey, metadata, outcome, result.events);
  return { ...outcome, events: result.events };
}

function socialBlockedUntil(message: string, now = new Date()) {
  const hours = /quota/i.test(message) ? 24 : 1;
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

function selectedVkAccountEnv(baseEnv: NodeJS.ProcessEnv, token: string, tokenType: "service" | "server" | "access") {
  const env = { ...baseEnv };
  delete env.VK_SERVICE_TOKEN;
  delete env.VK_SERVER_TOKEN;
  delete env.VK_ACCESS_TOKEN;
  env[tokenType === "service" ? "VK_SERVICE_TOKEN" : tokenType === "server" ? "VK_SERVER_TOKEN" : "VK_ACCESS_TOKEN"] = token;
  return env;
}

async function updateCheckedVkAccount(
  db: DbClient,
  accountKey: string,
  metadata: Record<string, unknown>,
  outcome: VkLoginCheckOutcome,
  events: CollectorEventRow[]
) {
  const now = new Date();
  const hasError = outcome.accountStatus !== "OK";
  await db.socialPlatformAccount.update({
    where: { accountKey },
    data: {
      status: outcome.accountStatus,
      blockedUntil: outcome.blockedUntil ?? null,
      lastLoginAt: now,
      lastSuccessAt: outcome.ok ? now : undefined,
      lastErrorAt: hasError ? now : undefined,
      lastError: outcome.ok ? null : `vk-login-check:${outcome.code}:${outcome.message}`,
      consecutiveErrors: outcome.ok ? 0 : { increment: 1 },
      metadata: {
        ...metadata,
        loginCheck: true,
        loginCheckCode: outcome.code,
        loginCheckEvents: events.map((row) => row.event.code)
      }
    }
  });
}

function vkTokenType(value: unknown): "service" | "server" | "access" {
  return value === "service" || value === "server" ? value : "access";
}

function freshVkAccountToken(metadata: Record<string, unknown>, now: Date) {
  const expiresAt = metadataString(metadata.expiresAt) ?? metadataString(metadata.expires_at);
  if (!expiresAt) return true;
  const timestamp = Date.parse(expiresAt);
  return !Number.isFinite(timestamp) || timestamp > now.getTime() + 5 * 60_000;
}

async function refreshStoredVkAccount(
  db: DbClient,
  accountKey: string,
  metadata: Record<string, unknown>,
  refreshVkTokenFn: typeof refreshVkOAuthToken = refreshVkOAuthToken
) {
  const refreshToken = metadataString(metadata.refreshToken);
  const clientId = metadataString(metadata.clientId);
  const deviceId = metadataString(metadata.deviceId);
  if (!refreshToken || !clientId || !deviceId) return null;
  try {
    const tokens = await refreshVkTokenFn({ clientId, deviceId, refreshToken, state: randomUUID() });
    const nextMetadata = {
      ...metadata,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? refreshToken,
      ...(tokens.expiresIn ? { expiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString() } : {})
    };
    await db.socialPlatformAccount.update({ where: { accountKey }, data: { metadata: nextMetadata as never } });
    return nextMetadata;
  } catch {
    return null;
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

export async function runPythonVkLoginCheck(input: { env?: NodeJS.ProcessEnv }): Promise<VkLoginCheckCollectorResult> {
  const collectorRoot = resolveVkCollectorRoot();
  const pythonBin = process.env.VK_PYTHON_BIN ?? resolveVkPythonBin("python");
  const scriptPath = resolve(collectorRoot, "vk_collector.py");
  const args = [scriptPath, "--login-check"];
  const events: CollectorEventRow[] = [];
  const stderr: string[] = [];
  const env = {
    ...process.env,
    ...input.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1"
  };

  const child = spawn(pythonBin, args, {
    cwd: collectorRoot,
    env,
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"]
  });

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

  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolveExit(code ?? 1));
  });
  return { exitCode, events, stderr };
}

function resolveVkCollectorRoot() {
  return process.env.SCANER_APP_ROOT
    ? resolve(process.env.SCANER_APP_ROOT, "collectors", "vk")
    : DEFAULT_COLLECTOR_ROOT;
}

function resolveVkPythonBin(fallback = "python") {
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
