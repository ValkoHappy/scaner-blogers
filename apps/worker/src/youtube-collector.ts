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

export interface YouTubeCollectorInput {
  loginCheck?: boolean;
  keywords?: string[];
  countries?: string[];
  excludedProfileIds?: string[];
  requireGeoMatch?: boolean;
  minFollowers?: number;
  maxFollowers?: number;
  maxChannels?: number;
  maxChannelChecks?: number;
  searchResultsPerQuery?: number;
  recentVideosPerChannel?: number;
  requestDelayMinSec?: number;
  requestDelayMaxSec?: number;
  useDerivedQueries?: boolean;
  includeChannelSearch?: boolean;
  includeShortsSearch?: boolean;
  includeVideoSearch?: boolean;
  useWebFallback?: boolean;
  maxSearchQueriesPerKeyword?: number;
  relevanceLanguage?: string;
  timeoutMs?: number;
}

export interface YouTubeCollectorRunOptions {
  cwd?: string;
  pythonBin?: string;
  scriptPath?: string;
  env?: NodeJS.ProcessEnv;
  abortSignal?: AbortSignal;
}

export interface YouTubeCollectorRunResult {
  candidates: SocialCandidateRow[];
  events: CollectorEventRow[];
  exitCode: number;
}

export function buildYouTubeCollectorArgs(input: YouTubeCollectorInput) {
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
  if (input.maxChannels !== undefined) args.push("--max-channels", String(input.maxChannels));
  if (input.maxChannelChecks !== undefined) args.push("--max-channel-checks", String(input.maxChannelChecks));
  if (input.searchResultsPerQuery !== undefined) {
    args.push("--search-results-per-query", String(input.searchResultsPerQuery));
  }
  if (input.recentVideosPerChannel !== undefined) {
    args.push("--recent-videos-per-channel", String(input.recentVideosPerChannel));
  }
  if (input.requestDelayMinSec !== undefined) args.push("--request-delay-min-sec", String(input.requestDelayMinSec));
  if (input.requestDelayMaxSec !== undefined) args.push("--request-delay-max-sec", String(input.requestDelayMaxSec));
  if (input.useDerivedQueries === false) args.push("--no-derived-queries");
  if (input.includeChannelSearch === false) args.push("--no-channel-search");
  if (input.includeShortsSearch === false) args.push("--no-shorts-search");
  if (input.includeVideoSearch === false) args.push("--no-video-search");
  if (input.useWebFallback) args.push("--use-web-fallback");
  if (input.maxSearchQueriesPerKeyword !== undefined) {
    args.push("--max-search-queries-per-keyword", String(input.maxSearchQueriesPerKeyword));
  }
  if (input.relevanceLanguage) args.push("--relevance-language", input.relevanceLanguage);
  return args;
}

export function parseYouTubeCollectorStdoutLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  return parseSocialCandidateRow(JSON.parse(trimmed));
}

export function parseYouTubeCollectorStderrLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  return parseCollectorEventRow(JSON.parse(trimmed));
}

export function resolveYouTubeCollectorAppRoot(start = process.cwd()) {
  let current = resolve(start);
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(resolve(current, "collectors", "youtube", "youtube_collector.py"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(start);
}

export function buildYouTubeCollectorEnv(env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...env,
    PYTHONIOENCODING: env.PYTHONIOENCODING ?? "utf-8",
    PYTHONUTF8: env.PYTHONUTF8 ?? "1"
  };
}

export async function runYouTubeCollector(
  input: YouTubeCollectorInput,
  options: YouTubeCollectorRunOptions = {}
): Promise<YouTubeCollectorRunResult> {
  const cwd = options.cwd ?? resolveYouTubeCollectorAppRoot();
  const pythonBin = options.pythonBin ?? process.env.YOUTUBE_PYTHON_BIN ?? resolveInstagramPythonBin("python", cwd);
  const scriptPath = options.scriptPath ?? process.env.YOUTUBE_COLLECTOR_SCRIPT ?? resolve(
    cwd,
    "collectors",
    "youtube",
    "youtube_collector.py"
  );
  const args = [scriptPath, ...buildYouTubeCollectorArgs(input)];
  const candidates: SocialCandidateRow[] = [];
  const events: CollectorEventRow[] = [];
  const stderrLines: string[] = [];
  const env = buildYouTubeCollectorEnv(options.env);

  const child = spawn(pythonBin, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const timeoutMs = input.timeoutMs ?? (Number(process.env.YOUTUBE_COLLECTOR_TIMEOUT_MS || 0) || 180_000);
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
      const row = parseYouTubeCollectorStdoutLine(line);
      if (row) candidates.push(row);
    } catch (error) {
      events.push(collectorStdoutParseFailedEvent("youtube", line, error));
    }
  });

  stderr.on("line", (line) => {
    stderrLines.push(line);
    try {
      const event = parseYouTubeCollectorStderrLine(line);
      if (event) events.push(event);
    } catch (error) {
      events.push(collectorStderrParseFailedEvent("youtube", line, error));
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
      ? `youtube-collector:timeout:exceeded ${timeoutMs}ms`
      : lastEvent
      ? `youtube-collector:${lastEvent.code}:${lastEvent.message}`
      : `youtube-collector:exit:${exitCode}${lastStderr ? `:${lastStderr}` : ""}`);
  }

  return { candidates, events, exitCode };
}
