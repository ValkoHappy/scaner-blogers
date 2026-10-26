import { prisma as defaultPrisma } from "@scaner-blogers/db";

type DbClient = typeof defaultPrisma;

export interface YouTubeLoginCheckOutcome {
  ok: boolean;
  code: string;
  message: string;
  accountStatus: "OK" | "BLOCKED" | "FAILED" | "MISSING_CREDENTIALS";
  blockedUntil?: Date | null;
}

export interface RunYouTubeAccountLoginCheckOptions {
  accountKey: string;
  db?: DbClient;
  request?: typeof fetch;
}

export function youtubeLoginCheckOutcome(input: { ok: boolean; status: number; message: string }, now = new Date()): YouTubeLoginCheckOutcome {
  if (input.ok) {
    return {
      ok: true,
      code: "youtube_api_key_check_ok",
      message: input.message,
      accountStatus: "OK",
      blockedUntil: null
    };
  }

  const quota = /quota|dailyLimit|rateLimit/i.test(input.message);
  const missing = /missing|not configured/i.test(input.message);
  return {
    ok: false,
    code: quota ? "youtube_quota_exceeded" : missing ? "youtube_missing_api_key" : "youtube_api_key_check_failed",
    message: input.message,
    accountStatus: quota ? "BLOCKED" : missing ? "MISSING_CREDENTIALS" : "FAILED",
    blockedUntil: quota ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : null
  };
}

export async function runYouTubeAccountLoginCheck(options: RunYouTubeAccountLoginCheckOptions) {
  const db = options.db ?? defaultPrisma;
  const account = await db.socialPlatformAccount.findFirst({
    where: { accountKey: options.accountKey, platform: "YOUTUBE" },
    select: { accountKey: true, metadata: true }
  });
  if (!account) throw new Error("youtube_account_not_found");

  const metadata = metadataRecord(account.metadata);
  const apiKey = metadataString(metadata.apiKey);
  if (!apiKey) {
    const outcome = youtubeLoginCheckOutcome({ ok: false, status: 400, message: "YouTube API key is not configured for this account" });
    await updateCheckedYouTubeAccount(db, account.accountKey, metadata, outcome);
    return outcome;
  }

  const request = options.request ?? fetch;
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "id");
  url.searchParams.set("id", "UC_x5XG1OV2P6uZZ5FSM9Ttw");
  url.searchParams.set("key", apiKey);
  const response = await request(url);
  const body = await response.json().catch(() => null) as { error?: { message?: string; errors?: Array<{ reason?: string }> } } | null;
  const reason = body?.error?.errors?.map((item) => item.reason).filter(Boolean).join(", ");
  const message = response.ok
    ? "YouTube API key check succeeded"
    : [body?.error?.message, reason].filter(Boolean).join(" - ") || `YouTube API returned HTTP ${response.status}`;
  const outcome = youtubeLoginCheckOutcome({ ok: response.ok, status: response.status, message });
  await updateCheckedYouTubeAccount(db, account.accountKey, metadata, outcome);
  return outcome;
}

async function updateCheckedYouTubeAccount(
  db: DbClient,
  accountKey: string,
  metadata: Record<string, unknown>,
  outcome: YouTubeLoginCheckOutcome
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
      lastError: outcome.ok ? null : `youtube-login-check:${outcome.code}:${outcome.message}`,
      consecutiveErrors: outcome.ok ? 0 : { increment: 1 },
      metadata: {
        ...metadata,
        loginCheck: true,
        loginCheckCode: outcome.code
      }
    }
  });
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function metadataString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
