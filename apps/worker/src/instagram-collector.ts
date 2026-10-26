import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, isAbsolute, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import {
  parseCollectorEventRow,
  parseSocialCandidateRow,
  type CollectorEventRow,
  type SocialCandidateRow
} from "@scaner-blogers/core";
import { collectorStderrParseFailedEvent, collectorStdoutParseFailedEvent } from "./collector-events.js";
import { normalizeRuntimeProxyUrl } from "./proxy-bridge.js";

export interface InstagramCollectorInput {
  loginCheck?: boolean;
  configPath?: string;
  keywords?: string[];
  hashtags?: string[];
  countries?: string[];
  excludedProfileIds?: string[];
  requireGeoMatch?: boolean;
  minFollowers?: number;
  maxFollowers?: number;
  maxProfiles?: number;
  maxProfileChecks?: number;
  maxTagsPerKeyword?: number;
  maxMediasPerTag?: number;
  recentMediaPerProfile?: number;
  profileDelayMinSec?: number;
  profileDelayMaxSec?: number;
  mediaDelayMinSec?: number;
  mediaDelayMaxSec?: number;
  useHashtagSearch?: boolean;
  useDerivedHashtags?: boolean;
  includeKeywordReelsSearch?: boolean;
  includeUserSearch?: boolean;
  includeAccountSerpSearch?: boolean;
  includeTypeaheadSearch?: boolean;
  maxUserSearchResultsPerKeyword?: number;
  timeoutMs?: number;
  proxyUrl?: string;
  username?: string;
  password?: string;
  sessionId?: string;
  sessionSettings?: string;
  sessionFile?: string;
}

export interface InstagramCollectorRunOptions {
  cwd?: string;
  pythonBin?: string;
  scriptPath?: string;
  env?: NodeJS.ProcessEnv;
  abortSignal?: AbortSignal;
  onEvent?: (event: CollectorEventRow) => void | Promise<void>;
}

export interface InstagramCollectorRunResult {
  candidates: SocialCandidateRow[];
  events: CollectorEventRow[];
  exitCode: number;
  sessionSettings?: string;
  eventsPersistedLive?: boolean;
}

export function buildInstagramCollectorArgs(input: InstagramCollectorInput) {
  const args: string[] = [];
  if (input.configPath) args.push("--config", input.configPath);
  if (input.loginCheck) args.push("--login-check");
  for (const keyword of input.keywords ?? []) {
    if (keyword.trim()) args.push("--keyword", keyword);
  }
  for (const hashtag of input.hashtags ?? []) {
    if (hashtag.trim()) args.push("--hashtag", hashtag);
  }
  for (const country of input.countries ?? []) {
    if (country.trim()) args.push("--country", country);
  }
  for (const profileId of input.excludedProfileIds ?? []) {
    if (profileId.trim()) args.push("--exclude-profile-id", profileId);
  }
  if (input.requireGeoMatch) args.push("--require-geo-match");
  if (input.minFollowers !== undefined) args.push("--min-followers", String(input.minFollowers));
  if (input.maxFollowers !== undefined) args.push("--max-followers", String(input.maxFollowers));
  if (input.maxProfiles !== undefined) args.push("--max-profiles", String(input.maxProfiles));
  if (input.maxProfileChecks !== undefined) args.push("--max-profile-checks", String(input.maxProfileChecks));
  if (input.maxTagsPerKeyword !== undefined) args.push("--max-tags-per-keyword", String(input.maxTagsPerKeyword));
  if (input.maxMediasPerTag !== undefined) args.push("--max-medias-per-tag", String(input.maxMediasPerTag));
  if (input.recentMediaPerProfile !== undefined) args.push("--recent-media-per-profile", String(input.recentMediaPerProfile));
  if (input.profileDelayMinSec !== undefined) args.push("--profile-delay-min-sec", String(input.profileDelayMinSec));
  if (input.profileDelayMaxSec !== undefined) args.push("--profile-delay-max-sec", String(input.profileDelayMaxSec));
  if (input.mediaDelayMinSec !== undefined) args.push("--media-delay-min-sec", String(input.mediaDelayMinSec));
  if (input.mediaDelayMaxSec !== undefined) args.push("--media-delay-max-sec", String(input.mediaDelayMaxSec));
  if (input.useHashtagSearch === false) args.push("--no-hashtag-search");
  if (input.useDerivedHashtags === false) args.push("--no-derived-hashtags");
  if (input.includeKeywordReelsSearch === false) args.push("--no-keyword-reels-search");
  if (input.includeUserSearch === false) args.push("--no-user-search");
  if (input.includeAccountSerpSearch === false) args.push("--no-account-serp-search");
  if (input.includeTypeaheadSearch === false) args.push("--no-typeahead-search");
  if (input.maxUserSearchResultsPerKeyword !== undefined) {
    args.push("--max-user-search-results", String(input.maxUserSearchResultsPerKeyword));
  }
  return args;
}

export function parseInstagramCollectorStdoutLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  return parseSocialCandidateRow(JSON.parse(trimmed));
}

export function parseInstagramCollectorStderrLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  return parseCollectorEventRow(JSON.parse(trimmed));
}

export function resolveInstagramCollectorAppRoot(start = process.cwd()) {
  let current = resolve(start);
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(resolve(current, "collectors", "instagram", "instagram_collector.py"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(start);
}

export function resolveInstagramPythonBin(fallback = "python", appRoot = resolveInstagramCollectorAppRoot()) {
  const localWindowsPython = resolve(appRoot, ".venv-instagram", "Scripts", "python.exe");
  const localUnixPython = resolve(appRoot, ".venv-instagram", "bin", "python");
  if (existsSync(localWindowsPython)) return localWindowsPython;
  if (existsSync(localUnixPython)) return localUnixPython;
  return fallback;
}

export function buildInstagramCollectorEnv(
  input: InstagramCollectorInput,
  cwd: string,
  env: NodeJS.ProcessEnv = {}
) {
  const mergedEnv = { ...process.env, ...env };
  const instagramSessionFile = stripShellQuotes(input.sessionFile ?? mergedEnv.INSTAGRAM_SESSION_FILE);
  return {
    ...mergedEnv,
    INSTAGRAPI_REPO_PATH: mergedEnv.INSTAGRAPI_REPO_PATH ?? resolve(cwd, "vendor", "instagram-instagrapi"),
    ...(instagramSessionFile ? { INSTAGRAM_SESSION_FILE: instagramSessionFile } : {}),
    ...(input.username ? { INSTAGRAM_USERNAME: input.username } : {}),
    ...(input.password ? { INSTAGRAM_PASSWORD: input.password } : {}),
    ...(input.sessionId ? { INSTAGRAM_SESSIONID: input.sessionId } : {}),
    ...(input.sessionSettings ? { INSTAGRAM_SESSION_SETTINGS_B64: Buffer.from(input.sessionSettings, "utf8").toString("base64") } : {}),
    PYTHONIOENCODING: env.PYTHONIOENCODING ?? "utf-8",
    PYTHONUTF8: env.PYTHONUTF8 ?? "1",
    ...(input.proxyUrl ? { INSTAGRAM_PROXY_URL: normalizeRuntimeProxyUrl(input.proxyUrl) } : {})
  };
}

function stripShellQuotes(value: string | undefined) {
  if (!value) return value;
  const trimmed = value.split(/\r\n|\n|\r/)[0]?.trim() ?? "";
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export async function runInstagramCollector(
  input: InstagramCollectorInput,
  options: InstagramCollectorRunOptions = {}
): Promise<InstagramCollectorRunResult> {
  const cwd = options.cwd ?? resolveInstagramCollectorAppRoot();
  const pythonBin = options.pythonBin ?? process.env.INSTAGRAM_PYTHON_BIN ?? resolveInstagramPythonBin("python", cwd);
  const scriptPath = options.scriptPath ?? process.env.INSTAGRAM_COLLECTOR_SCRIPT ?? resolve(
    cwd,
    "collectors",
    "instagram",
    "instagram_collector.py"
  );
  const args = [scriptPath, ...buildInstagramCollectorArgs(input)];
  const candidates: SocialCandidateRow[] = [];
  const events: CollectorEventRow[] = [];
  const stderrLines: string[] = [];
  const pendingEventWrites: Promise<unknown>[] = [];
  const env = buildInstagramCollectorEnv(input, cwd, options.env);

  const child = spawn(pythonBin, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const abort = () => {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!exited) child.kill("SIGKILL");
    }, 5_000).unref();
  };
  options.abortSignal?.addEventListener("abort", abort, { once: true });
  const timeoutMs = input.timeoutMs ?? (Number(process.env.INSTAGRAM_COLLECTOR_TIMEOUT_MS || 0) || 180_000);
  let timedOut = false;
  let exited = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abort();
  }, timeoutMs);

  const stdout = createInterface({ input: child.stdout });
  const stderr = createInterface({ input: child.stderr });

  stdout.on("line", (line) => {
    try {
      const row = parseInstagramCollectorStdoutLine(line);
      if (row) candidates.push(row);
    } catch (error) {
      events.push(collectorStdoutParseFailedEvent("instagram", line, error));
    }
  });

  stderr.on("line", (line) => {
    stderrLines.push(line);
    try {
      const event = parseInstagramCollectorStderrLine(line);
      if (event) {
        events.push(event);
        if (options.onEvent) pendingEventWrites.push(Promise.resolve(options.onEvent(event)));
      }
    } catch (error) {
      events.push(collectorStderrParseFailedEvent("instagram", line, error));
    }
  });

  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      exited = true;
      clearTimeout(timeout);
      options.abortSignal?.removeEventListener("abort", abort);
      resolveExit(code ?? 1);
    });
  });

  if (pendingEventWrites.length) await Promise.allSettled(pendingEventWrites);

  if (exitCode !== 0) {
    const lastEvent = [...events].reverse().find((row) => row.event.level === "error")?.event;
    const lastStderr = stderrLines.filter(Boolean).at(-1);
    throw new Error(timedOut
      ? `instagram-collector:timeout:exceeded ${timeoutMs}ms`
      : lastEvent
      ? `instagram-collector:${lastEvent.code}:${lastEvent.message}`
      : `instagram-collector:exit:${exitCode}${lastStderr ? `:${lastStderr}` : ""}`);
  }

  return {
    candidates,
    events,
    exitCode,
    sessionSettings: readUpdatedSessionSettings(cwd, input.sessionFile ?? env.INSTAGRAM_SESSION_FILE)
  };
}

function readUpdatedSessionSettings(cwd: string, sessionFile: string | undefined) {
  const cleanPath = stripShellQuotes(sessionFile);
  if (!cleanPath) return undefined;
  const filePath = isAbsolute(cleanPath) ? cleanPath : resolve(cwd, cleanPath);
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? JSON.stringify(parsed)
      : undefined;
  } catch {
    return undefined;
  }
}
