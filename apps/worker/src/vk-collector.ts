import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  parseCollectorEventRow,
  parseSocialCandidateRow,
  type CollectorEventRow,
  type SocialCandidateRow
} from "@scaner-blogers/core";
import { collectorStderrParseFailedEvent, collectorStdoutParseFailedEvent } from "./collector-events.js";
import { resolveInstagramPythonBin } from "./instagram-collector.js";

export interface VkCollectorInput {
  loginCheck?: boolean;
  keywords?: string[];
  countries?: string[];
  excludedProfileIds?: string[];
  requireGeoMatch?: boolean;
  minFollowers?: number;
  maxFollowers?: number;
  maxGroups?: number;
  maxGroupChecks?: number;
  searchCountPerKeyword?: number;
  wallPostsPerGroup?: number;
  requestDelayMinSec?: number;
  requestDelayMaxSec?: number;
  useDerivedQueries?: boolean;
  maxSearchQueriesPerKeyword?: number;
  apiVersion?: string;
  timeoutMs?: number;
}

export interface VkCollectorRunOptions {
  cwd?: string;
  pythonBin?: string;
  scriptPath?: string;
  env?: NodeJS.ProcessEnv;
  abortSignal?: AbortSignal;
}

export interface VkCollectorRunResult {
  candidates: SocialCandidateRow[];
  events: CollectorEventRow[];
  exitCode: number;
}

export function buildVkCollectorArgs(input: VkCollectorInput) {
  const args: string[] = [];
  if (input.loginCheck) args.push("--login-check");
  for (const keyword of input.keywords ?? []) {
    if (keyword.trim()) args.push("--keyword", keyword);
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
  if (input.maxGroups !== undefined) args.push("--max-groups", String(input.maxGroups));
  if (input.maxGroupChecks !== undefined) args.push("--max-group-checks", String(input.maxGroupChecks));
  if (input.searchCountPerKeyword !== undefined) {
    args.push("--search-count-per-keyword", String(input.searchCountPerKeyword));
  }
  if (input.wallPostsPerGroup !== undefined) args.push("--wall-posts-per-group", String(input.wallPostsPerGroup));
  if (input.requestDelayMinSec !== undefined) args.push("--request-delay-min-sec", String(input.requestDelayMinSec));
  if (input.requestDelayMaxSec !== undefined) args.push("--request-delay-max-sec", String(input.requestDelayMaxSec));
  if (input.useDerivedQueries === false) args.push("--no-derived-queries");
  if (input.maxSearchQueriesPerKeyword !== undefined) {
    args.push("--max-search-queries-per-keyword", String(input.maxSearchQueriesPerKeyword));
  }
  if (input.apiVersion) args.push("--api-version", input.apiVersion);
  return args;
}

export function parseVkCollectorStdoutLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  return parseSocialCandidateRow(JSON.parse(trimmed));
}

export function parseVkCollectorStderrLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  return parseCollectorEventRow(JSON.parse(trimmed));
}

export function resolveVkCollectorAppRoot(start = process.cwd()) {
  let current = resolve(start);
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(resolve(current, "collectors", "vk", "vk_collector.py"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(start);
}

export function buildVkCollectorEnv(cwd: string, env: NodeJS.ProcessEnv = {}) {
  const mergedEnv = { ...process.env, ...env };
  return {
    ...mergedEnv,
    PYTHONIOENCODING: env.PYTHONIOENCODING ?? "utf-8",
    PYTHONUTF8: env.PYTHONUTF8 ?? "1"
  };
}

export async function runVkCollector(
  input: VkCollectorInput,
  options: VkCollectorRunOptions = {}
): Promise<VkCollectorRunResult> {
  const cwd = options.cwd ?? resolveVkCollectorAppRoot();
  const pythonBin = options.pythonBin ?? process.env.VK_PYTHON_BIN ?? resolveInstagramPythonBin("python", cwd);
  const scriptPath = options.scriptPath ?? process.env.VK_COLLECTOR_SCRIPT ?? resolve(
    cwd,
    "collectors",
    "vk",
    "vk_collector.py"
  );
  const args = [scriptPath, ...buildVkCollectorArgs(input)];
  const candidates: SocialCandidateRow[] = [];
  const events: CollectorEventRow[] = [];
  const stderrLines: string[] = [];
  const env = buildVkCollectorEnv(cwd, options.env);

  const child = spawn(pythonBin, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const timeoutMs = input.timeoutMs ?? (Number(process.env.VK_COLLECTOR_TIMEOUT_MS || 0) || 180_000);
  let timedOut = false;
  let exited = false;
  const abort = () => {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!exited) child.kill("SIGKILL");
    }, 5_000).unref();
  };
  options.abortSignal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    abort();
  }, timeoutMs);

  const stdout = createInterface({ input: child.stdout });
  const stderr = createInterface({ input: child.stderr });

  stdout.on("line", (line) => {
    try {
      const row = parseVkCollectorStdoutLine(line);
      if (row) candidates.push(row);
    } catch (error) {
      events.push(collectorStdoutParseFailedEvent("vk", line, error));
    }
  });

  stderr.on("line", (line) => {
    stderrLines.push(line);
    try {
      const event = parseVkCollectorStderrLine(line);
      if (event) events.push(event);
    } catch (error) {
      events.push(collectorStderrParseFailedEvent("vk", line, error));
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

  if (exitCode !== 0) {
    const lastEvent = [...events].reverse().find((row) => row.event.level === "error")?.event;
    const lastStderr = stderrLines.filter(Boolean).at(-1);
    throw new Error(timedOut
      ? `vk-collector:timeout:exceeded ${timeoutMs}ms`
      : lastEvent
      ? `vk-collector:${lastEvent.code}:${lastEvent.message}`
      : `vk-collector:exit:${exitCode}${lastStderr ? `:${lastStderr}` : ""}`);
  }

  return { candidates, events, exitCode };
}
