"use server";

import { isInstagramPreparedAuthSource, normalizeInstagramStoredCredentials } from "@scaner-blogers/core";
import { prisma, socialPlatformAccountKey, updateSystemSettings } from "@scaner-blogers/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { type InstagramAccountInput, parseInstagramAccountLine } from "@/lib/instagram-account-bulk";
import { instagramLoginCheckOutcome, runPythonInstagramLoginCheck } from "@/lib/instagram-login-check";
import { runVkAccountLoginCheck } from "@/lib/vk-login-check";
import { normalizeProxyList, normalizeProxyUrl } from "@/lib/proxy";

export async function updateSettingsAction(formData: FormData) {
  await requireAuth();
  const exportDefaultFields = formData.getAll("exportDefaultFields").map(String).filter(Boolean);
  await updateSystemSettings({
    scanMode: scanModeValue(formData.get("scanMode")),
    dailyScanHour: formData.has("dailyScanHours") ? parseScheduleHours(String(formData.get("dailyScanHours") ?? ""))[0] ?? 3 : undefined,
    scheduleType: formData.has("scheduleType") ? scheduleTypeValue(formData.get("scheduleType")) : undefined,
    dailyScanHours: formData.has("dailyScanHours") ? parseScheduleHours(String(formData.get("dailyScanHours") ?? "")) : undefined,
    scanIntervalHours: boundedNumberValue(formData.get("scanIntervalHours"), 1, 24),
    requestDelayMs: numberValue(formData.get("requestDelayMs")),
    maxPagesPerRun: nullableBoundedNumberValue(formData.get("maxPagesPerRun"), 1, 1000),
    maxCreativesPerRun: nullableBoundedNumberValue(formData.get("maxCreativesPerRun"), 1, 100000),
    workerConcurrency: boundedNumberValue(formData.get("workerConcurrency"), 1, 6),
    advertiserDelayMs: boundedNumberValue(formData.get("advertiserDelayMs"), 0, 3_600_000),
    probeIntervalMs: boundedNumberValue(formData.get("probeIntervalMs"), 60_000, 86_400_000),
    rawSnapshotRetentionDays: boundedNumberValue(formData.get("rawSnapshotRetentionDays"), 1, 365),
    scanEventRetentionDays: boundedNumberValue(formData.get("scanEventRetentionDays"), 1, 365),
    exportDefaultFields: exportDefaultFields.length ? exportDefaultFields : undefined,
    proxyEnabled: formData.get("proxyEnabled") === "on",
    proxyUrl: normalizeProxyUrl(String(formData.get("proxyUrl") ?? "")) || null
  });
  await syncProxyPool(String(formData.get("proxyPool") ?? ""));
  revalidatePath("/settings");
}

export async function addInstagramAccountAction(formData: FormData) {
  await requireAuth();
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || username;
  const sessionFile = String(formData.get("sessionFile") ?? "").trim() || `.instagram/${username || "account"}.session.json`;
  const proxyUrl = normalizeProxyUrl(String(formData.get("proxyUrl") ?? "")) || undefined;
  const sessionId = String(formData.get("sessionId") ?? "").trim() || undefined;
  const sessionSettings = await readInstagramSessionSettings(formData);
  if (!username || (!password && !sessionId && !sessionSettings)) {
    throw new Error("instagram_account_requires_password_sessionid_or_session_settings");
  }
  await upsertInstagramAccount({
    username,
    password,
    label,
    sessionFile,
    proxyUrl,
    sessionId,
    sessionSettings
  });
  revalidatePath("/settings");
}

export async function connectInstagramAccountAction(formData: FormData) {
  await requireAuth();
  const importedSessionId = await readInstagramSessionIdImport(formData);
  const importedSessionSettings = await readInstagramSessionSettingsImport(formData);
  const username = String(formData.get("username") ?? "").trim()
    || importedSessionId.username
    || importedSessionSettings.username
    || "";
  const password = String(formData.get("password") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim()
    || importedSessionId.label
    || importedSessionSettings.label
    || username;
  const sessionFile = String(formData.get("sessionFile") ?? "").trim()
    || importedSessionId.sessionFile
    || importedSessionSettings.sessionFile
    || `.instagram/${username || "account"}.session.json`;
  const proxyUrl = normalizeProxyUrl(String(formData.get("proxyUrl") ?? "")) || undefined;
  const sessionId = importedSessionId.sessionId;
  const verificationCode = String(formData.get("verificationCode") ?? "").replace(/\s+/g, "") || undefined;
  const verifyNow = formData.get("verifyNow") === "true";
  const sessionSettings = importedSessionSettings.sessionSettings;
  if (!username || (!password && !sessionId && !sessionSettings)) {
    throw new Error("instagram_account_requires_password_sessionid_or_session_settings");
  }
  const input = { username, password: password || undefined, label, sessionFile, proxyUrl, sessionId, sessionSettings, verificationCode };
  await upsertInstagramAccount(input);
  if (verifyNow) {
    await checkInstagramAccountLogin(input);
  }
  revalidatePath("/settings");
  redirect("/settings#accounts");
}

export async function addInstagramAccountsBulkAction(formData: FormData) {
  await requireAuth();
  const lines = String(formData.get("accounts") ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    throw new Error("instagram_accounts_bulk_empty");
  }
  const rows = lines.map(parseInstagramAccountLine).filter((row): row is InstagramAccountInput => Boolean(row));
  if (!rows.length) {
    throw new Error("instagram_accounts_bulk_no_valid_rows");
  }
  await Promise.all(rows.map(upsertInstagramAccount));
  revalidatePath("/settings");
  redirect("/settings#accounts");
}

export async function toggleInstagramAccountAction(formData: FormData) {
  await requireAuth();
  const accountKey = String(formData.get("accountKey") ?? "");
  const enabled = formData.get("enabled") === "true";
  const account = await prisma.socialPlatformAccount.findFirst({
    where: { accountKey, platform: "INSTAGRAM" },
    select: { metadata: true }
  });
  if (!account) return;
  await prisma.socialPlatformAccount.update({
    where: { accountKey },
    data: {
      metadata: {
        ...metadataRecord(account.metadata),
        enabled
      } as never
    }
  });
  revalidatePath("/settings");
}

export async function resetInstagramAccountCooldownAction(formData: FormData) {
  await requireAuth();
  const accountKey = String(formData.get("accountKey") ?? "");
  const now = new Date();
  await prisma.socialPlatformAccount.updateMany({
    where: { accountKey, platform: "INSTAGRAM" },
    data: {
      status: "OK",
      blockedUntil: null,
      lastError: null,
      consecutiveErrors: 0
    }
  });
  await wakeQueuedInstagramJobs(now);
  revalidatePath("/settings");
  revalidatePath("/scans");
}

export async function resetAllInstagramAccountCooldownsAction() {
  await requireAuth();
  const now = new Date();
  await prisma.socialPlatformAccount.updateMany({
    where: { platform: "INSTAGRAM" },
    data: {
      status: "OK",
      blockedUntil: null,
      lastError: null,
      consecutiveErrors: 0
    }
  });
  await wakeQueuedInstagramJobs(now);
  revalidatePath("/settings");
  revalidatePath("/health");
  revalidatePath("/scans");
}

export async function resetProxyStatusAction(formData: FormData) {
  await requireAuth();
  const proxyId = String(formData.get("proxyId") ?? "").trim();
  if (!proxyId) return;
  await prisma.proxyEndpoint.updateMany({
    where: { id: proxyId },
    data: {
      status: "OK",
      blockedUntil: null,
      failCount: 0,
      lastError: null
    }
  });
  revalidatePath("/settings");
  revalidatePath("/health");
}

export async function addVkAccountAction(formData: FormData) {
  await requireAuth();
  const imported = await readVkTokenImport(formData);
  const directToken = String(formData.get("token") ?? "").trim();
  const token = imported.token || directToken;
  const directLogin = String(formData.get("login") ?? "").trim();
  const login = directLogin || (imported.userId ? `vk-user-${imported.userId}` : "");
  const password = String(formData.get("password") ?? "").trim();
  const tokenType = "access" as const;
  const label = String(formData.get("label") ?? "").trim() || imported.label || login || "VK account";
  if (!token) throw new Error("vk_account_requires_token");
  const accountKey = await upsertVkAccount({ label, login, password, token, tokenType });
  await runVkAccountLoginCheck({ accountKey });
  revalidatePath("/settings");
  redirect("/settings#accounts");
}

export async function saveVkAppIdAndConnectAction(formData: FormData) {
  await requireAuth();
  const appId = String(formData.get("appId") ?? "").trim();
  if (!/^\d+$/.test(appId)) {
    redirect("/settings/connect/vk?error=invalid_app_id");
  }
  await updateSystemSettings({ vkAppId: appId });
  redirect("/api/vk/oauth/start");
}

export async function connectVkOauthUrlAction(formData: FormData) {
  await requireAuth();
  const label = String(formData.get("label") ?? "").trim() || "VK OAuth account";
  const pastedUrl = String(formData.get("oauthUrl") ?? "").trim();
  const parsed = parseVkOauthUrl(pastedUrl);
  if (!parsed.token) throw new Error("vk_oauth_url_requires_access_token");
  const accountKey = await upsertVkAccount({
    label,
    login: parsed.userId ? `vk-user-${parsed.userId}` : undefined,
    token: parsed.token,
    tokenType: "access"
  });
  await runVkAccountLoginCheck({ accountKey });
  revalidatePath("/settings");
  redirect("/settings#accounts");
}

export async function addVkAccountsBulkAction(formData: FormData) {
  await requireAuth();
  const lines = String(formData.get("accounts") ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error("vk_accounts_bulk_empty");
  await Promise.all(lines.map((line, index) => upsertVkAccount(parseVkAccountLine(line, index))));
  revalidatePath("/settings");
  redirect("/settings#accounts");
}

export async function addYouTubeAccountAction(formData: FormData) {
  await requireAuth();
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || "YouTube API key";
  if (!apiKey) throw new Error("youtube_account_requires_api_key");
  await upsertYouTubeAccount({ label, apiKey });
  revalidatePath("/settings");
  redirect("/settings#accounts");
}

export async function addYouTubeAccountsBulkAction(formData: FormData) {
  await requireAuth();
  const lines = String(formData.get("accounts") ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error("youtube_accounts_bulk_empty");
  await Promise.all(lines.map((line, index) => upsertYouTubeAccount(parseYouTubeAccountLine(line, index))));
  revalidatePath("/settings");
  redirect("/settings#accounts");
}

export async function toggleSocialPlatformAccountAction(formData: FormData) {
  await requireAuth();
  const accountKey = String(formData.get("accountKey") ?? "");
  const platform = socialAccountPlatformValue(formData.get("platform"));
  const enabled = formData.get("enabled") === "true";
  const account = await prisma.socialPlatformAccount.findFirst({
    where: { accountKey, platform },
    select: { metadata: true }
  });
  if (!account) return;
  await prisma.socialPlatformAccount.update({
    where: { accountKey },
    data: {
      metadata: {
        ...metadataRecord(account.metadata),
        enabled
      } as never
    }
  });
  revalidatePath("/settings");
}

export async function resetSocialPlatformAccountCooldownAction(formData: FormData) {
  await requireAuth();
  const accountKey = String(formData.get("accountKey") ?? "");
  const platform = socialAccountPlatformValue(formData.get("platform"));
  await prisma.socialPlatformAccount.updateMany({
    where: { accountKey, platform },
    data: {
      status: "OK",
      blockedUntil: null,
      lastError: null,
      consecutiveErrors: 0
    }
  });
  revalidatePath("/settings");
}

export async function deleteSocialPlatformAccountAction(formData: FormData) {
  await requireAuth();
  const accountKey = String(formData.get("accountKey") ?? "");
  const platform = socialAccountPlatformValue(formData.get("platform"));
  if (!accountKey) return;
  await prisma.socialPlatformAccount.deleteMany({ where: { accountKey, platform } });
  revalidatePath("/settings");
  revalidatePath("/health");
}

export async function deleteSocialPlatformAccountsAction(formData: FormData) {
  await requireAuth();
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (confirm !== "DELETE") {
    throw new Error("delete_accounts_requires_DELETE_confirmation");
  }
  const rawPlatform = String(formData.get("platform") ?? "ALL").toUpperCase();
  await prisma.socialPlatformAccount.deleteMany({
    where: rawPlatform === "ALL" ? {} : { platform: socialAccountPlatformValue(rawPlatform) }
  });
  revalidatePath("/settings");
  revalidatePath("/health");
}

function scanModeValue(value: FormDataEntryValue | null) {
  return value === "FAST" || value === "FULL" || value === "CAUTIOUS" ? value : undefined;
}

function scheduleTypeValue(value: FormDataEntryValue | null) {
  return value === "DAILY" || value === "MULTIPLE" || value === "INTERVAL" ? value : "DAILY";
}

function parseScheduleHours(value: string) {
  const hours = value
    .split(/[,\s]+/)
    .map((item) => Number(item))
    .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);
  return [...new Set(hours)].sort((a, b) => a - b);
}

function boundedNumberValue(value: FormDataEntryValue | null, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function nullableBoundedNumberValue(value: FormDataEntryValue | null, min: number, max: number) {
  if (value === null || String(value).trim() === "") return null;
  return boundedNumberValue(value, min, max);
}

function numberValue(value: FormDataEntryValue | null) {
  if (value === null || String(value).trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

async function syncProxyPool(value: string) {
  const urls = normalizeProxyList(value.split(/[\r\n,]+/));
  const existing = await prisma.proxyEndpoint.findMany({ select: { id: true, url: true } });
  await Promise.all([
    ...urls.map((url) => prisma.proxyEndpoint.upsert({
      where: { url },
      create: { url, status: "OK" },
      update: {}
    })),
    ...existing.filter((proxy) => !urls.includes(proxy.url)).map((proxy) => prisma.proxyEndpoint.delete({ where: { id: proxy.id } }))
  ]);
}

async function upsertInstagramAccount(input: InstagramAccountInput) {
  const accountKey = socialPlatformAccountKey("instagram", input.username);
  const normalized = normalizeInstagramStoredCredentials({
    username: input.username,
    password: input.password,
    sessionId: input.sessionId,
    sessionSettings: input.sessionSettings,
    sessionFile: input.sessionFile
  });
  const metadata = compactMetadata({
    enabled: true,
    ...normalized.metadata,
    authSource: normalized.authSource,
    proxyUrl: input.proxyUrl
  }) as never;
  await prisma.socialPlatformAccount.upsert({
    where: { accountKey },
    create: {
      platform: "INSTAGRAM",
      accountKey,
      username: input.username,
      label: input.label,
      status: isInstagramPreparedAuthSource(normalized.authSource) ? "UNKNOWN" : "MISSING_CREDENTIALS",
      metadata
    },
    update: {
      username: input.username,
      label: input.label,
      status: isInstagramPreparedAuthSource(normalized.authSource) ? undefined : "MISSING_CREDENTIALS",
      metadata
    }
  });
}

async function checkInstagramAccountLogin(input: InstagramAccountInput) {
  const accountKey = socialPlatformAccountKey("instagram", input.username);
  const proxyUrl = await selectInstagramLoginCheckProxy(input.proxyUrl);
  const result = await runPythonInstagramLoginCheck({
    proxyUrl,
    env: {
      ...process.env,
      INSTAGRAM_USERNAME: input.username,
      ...(input.password ? { INSTAGRAM_PASSWORD: input.password } : {}),
      ...(input.sessionId ? { INSTAGRAM_SESSIONID: input.sessionId } : {}),
      ...(input.sessionSettings ? { INSTAGRAM_SESSION_SETTINGS_B64: Buffer.from(input.sessionSettings, "utf8").toString("base64") } : {}),
      ...(input.verificationCode ? { INSTAGRAM_VERIFICATION_CODE: input.verificationCode } : {}),
      INSTAGRAM_SESSION_FILE: input.sessionFile
    }
  });
  const outcome = instagramLoginCheckOutcome(result);
  const normalized = normalizeInstagramStoredCredentials({
    username: input.username,
    password: input.password,
    sessionId: input.sessionId,
    sessionSettings: result.sessionSettings ?? input.sessionSettings,
    sessionFile: input.sessionFile
  });
  const now = new Date();
  const hasError = ["BLOCKED", "FAILED", "MISSING_CREDENTIALS"].includes(outcome.accountStatus);
  await prisma.socialPlatformAccount.update({
    where: { accountKey },
    data: {
      status: outcome.accountStatus,
      blockedUntil: outcome.blockedUntil ?? null,
      lastSuccessAt: outcome.ok ? now : undefined,
      lastErrorAt: hasError ? now : undefined,
      lastError: outcome.ok ? null : `instagram-login-check:${outcome.code}:${outcome.message}`,
      consecutiveErrors: outcome.ok ? 0 : hasError ? { increment: 1 } : undefined,
      metadata: compactMetadata({
        enabled: true,
        ...normalized.metadata,
        authSource: normalized.authSource,
        proxyUrl: input.proxyUrl,
        proxySource: input.proxyUrl ? "account" : proxyUrl ? "pool" : "none",
        loginCheck: true,
        events: result.events.map((row) => row.event.code)
      }) as never
    }
  });
}

async function selectInstagramLoginCheckProxy(accountProxyUrl?: string) {
  if (process.env.INSTAGRAM_PROXY_URL) return process.env.INSTAGRAM_PROXY_URL;

  const settings = await prisma.systemSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {}
  });
  if (!settings.proxyEnabled) return undefined;
  if (accountProxyUrl) return accountProxyUrl;
  if (settings.proxyUrl) return settings.proxyUrl;

  const now = new Date();
  const proxy = await prisma.proxyEndpoint.findFirst({
    where: {
      status: "OK",
      OR: [
        { blockedUntil: null },
        { blockedUntil: { lte: now } }
      ]
    },
    orderBy: [
      { lastUsedAt: "asc" },
      { createdAt: "asc" }
    ]
  });
  if (!proxy) return undefined;

  await prisma.proxyEndpoint.update({
    where: { id: proxy.id },
    data: { lastUsedAt: now }
  });
  return proxy.url;
}

async function upsertVkAccount(input: { label: string; login?: string; password?: string; token: string; tokenType: "service" | "server" | "access" }) {
  const username = input.login?.trim() || stableCredentialUsername("vk", input.label, input.token);
  const accountKey = socialPlatformAccountKey("vk", username);
  await prisma.socialPlatformAccount.upsert({
    where: { accountKey },
    create: {
      platform: "VK",
      accountKey,
      username,
      label: input.label,
      status: "UNKNOWN",
      metadata: compactMetadata({
        enabled: true,
        login: input.login,
        password: input.password,
        token: input.token,
        tokenType: input.tokenType
      }) as never
    },
    update: {
      username,
      label: input.label,
      metadata: compactMetadata({
        enabled: true,
        login: input.login,
        password: input.password,
        token: input.token,
        tokenType: input.tokenType
      }) as never
    }
  });
  return accountKey;
}

async function upsertYouTubeAccount(input: { label: string; apiKey: string }) {
  const username = stableCredentialUsername("youtube", input.label, input.apiKey);
  const accountKey = socialPlatformAccountKey("youtube", username);
  await prisma.socialPlatformAccount.upsert({
    where: { accountKey },
    create: {
      platform: "YOUTUBE",
      accountKey,
      username,
      label: input.label,
      status: "UNKNOWN",
      metadata: compactMetadata({ enabled: true, apiKey: input.apiKey }) as never
    },
    update: {
      label: input.label,
      metadata: compactMetadata({ enabled: true, apiKey: input.apiKey }) as never
    }
  });
}

async function readVkTokenImport(formData: FormData) {
  const uploaded = formData.get("tokenFile");
  if (!(uploaded instanceof File) || uploaded.size <= 0) {
    return { token: "", label: "", userId: "" };
  }
  if (uploaded.size > 250_000) {
    throw new Error("vk_token_file_too_large");
  }

  const text = (await uploaded.text()).trim();
  if (!text) return { token: "", label: "", userId: "" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("vk_token_file_invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("vk_token_file_invalid_shape");
  }

  const record = parsed as Record<string, unknown>;
  const token = readOptionalString(record, "accessToken")
    || readOptionalString(record, "access_token")
    || readOptionalString(record, "token")
    || "";
  if (!token) {
    throw new Error("vk_token_file_missing_access_token");
  }
  return {
    token,
    label: readOptionalString(record, "label") || "",
    userId: readOptionalString(record, "userId") || readOptionalString(record, "user_id") || ""
  };
}
function parseVkAccountLine(line: string, index: number) {
  const parts = line.split("|").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 5) {
    return {
      label: parts[0],
      login: parts[1],
      password: parts[2],
      tokenType: vkTokenTypeValue(parts[3]),
      token: parts.slice(4).join("|")
    };
  }
  if (parts.length >= 3) {
    return { label: parts[0], login: "", password: "", tokenType: vkTokenTypeValue(parts[1]), token: parts.slice(2).join("|") };
  }
  if (parts.length === 2) {
    const looksLikeType = /^(service|server|access)$/i.test(parts[0]);
    return looksLikeType
      ? { label: `VK ${parts[0]} account ${index + 1}`, login: "", password: "", tokenType: vkTokenTypeValue(parts[0]), token: parts[1] }
      : { label: parts[0], login: "", password: "", tokenType: "access" as const, token: parts[1] };
  }
  return { label: `VK account ${index + 1}`, login: "", password: "", tokenType: "access" as const, token: parts[0] ?? line };
}

function parseVkOauthUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { token: "" };
  if (/^vk1\./.test(trimmed)) return { token: trimmed };
  try {
    const url = new URL(trimmed);
    const params = new URLSearchParams(url.hash.replace(/^#/, "") || url.search.replace(/^\?/, ""));
    return {
      token: params.get("access_token")?.trim() || "",
      userId: params.get("user_id")?.trim() || undefined
    };
  } catch {
    const tokenMatch = trimmed.match(/access_token=([^&\s]+)/);
    const userIdMatch = trimmed.match(/user_id=([^&\s]+)/);
    return {
      token: tokenMatch ? decodeURIComponent(tokenMatch[1]) : "",
      userId: userIdMatch ? decodeURIComponent(userIdMatch[1]) : undefined
    };
  }
}

function parseYouTubeAccountLine(line: string, index: number) {
  const parts = line.split("|").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { label: parts[0], apiKey: parts.slice(1).join("|") };
  return { label: `YouTube API key ${index + 1}`, apiKey: parts[0] ?? line };
}

function vkTokenTypeValue(value: FormDataEntryValue | string | null): "service" | "server" | "access" {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "service" || normalized === "server" || normalized === "access" ? normalized : "access";
}

function socialAccountPlatformValue(value: FormDataEntryValue | string | null): "INSTAGRAM" | "VK" | "YOUTUBE" {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "INSTAGRAM") return "INSTAGRAM";
  if (normalized === "YOUTUBE") return "YOUTUBE";
  return "VK";
}

async function wakeQueuedInstagramJobs(now = new Date()) {
  await prisma.collectionJob.updateMany({
    where: {
      platform: "INSTAGRAM",
      status: "QUEUED",
      scheduledFor: { gt: now }
    },
    data: { scheduledFor: now }
  });
}

function stableCredentialUsername(prefix: "vk" | "youtube", label: string, secret: string) {
  const slug = label
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "account";
  const hash = Array.from(secret).reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) >>> 0, 0).toString(16);
  return `${prefix}-${slug}-${hash.slice(0, 8)}`;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function compactMetadata(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

async function readInstagramSessionSettings(formData: FormData) {
  const imported = await readInstagramSessionSettingsImport(formData);
  return imported.sessionSettings;
}

async function readInstagramSessionSettingsImport(formData: FormData) {
  const pasted = String(formData.get("sessionSettings") ?? "").trim();
  if (pasted) {
    validateInstagramSessionSettings(pasted);
    return {
      sessionSettings: pasted,
      username: undefined,
      label: undefined,
      sessionFile: undefined
    };
  }

  const uploaded = formData.get("sessionSettingsFile");
  if (!(uploaded instanceof File) || uploaded.size <= 0) {
    return {
      sessionSettings: undefined,
      username: undefined,
      label: undefined,
      sessionFile: undefined
    };
  }
  if (uploaded.size > 1_000_000) {
    throw new Error("instagram_session_settings_file_too_large");
  }

  const text = (await uploaded.text()).trim();
  if (!text) {
    return {
      sessionSettings: undefined,
      username: undefined,
      label: undefined,
      sessionFile: undefined
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("instagram_session_settings_invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("instagram_session_settings_invalid_shape");
  }

  const wrappedSettings = readWrappedInstagramSessionSettings(parsed);
  if (wrappedSettings) {
    validateInstagramSessionSettings(wrappedSettings);
    return {
      sessionSettings: wrappedSettings,
      username: readOptionalString(parsed, "username"),
      label: readOptionalString(parsed, "label"),
      sessionFile: readOptionalString(parsed, "sessionFile")
    };
  }

  validateInstagramSessionSettings(text);
  return {
    sessionSettings: text,
    username: undefined,
    label: undefined,
    sessionFile: undefined
  };
}

async function readInstagramSessionId(formData: FormData) {
  const imported = await readInstagramSessionIdImport(formData);
  return imported.sessionId;
}

async function readInstagramSessionIdImport(formData: FormData) {
  const direct = normalizeInstagramSessionId(String(formData.get("sessionId") ?? "").trim());
  if (direct) {
    return {
      sessionId: direct,
      username: undefined,
      label: undefined,
      sessionFile: undefined
    };
  }

  const uploaded = formData.get("sessionIdFile");
  if (!(uploaded instanceof File) || uploaded.size <= 0) {
    return {
      sessionId: undefined,
      username: undefined,
      label: undefined,
      sessionFile: undefined
    };
  }
  if (uploaded.size > 250_000) {
    throw new Error("instagram_sessionid_file_too_large");
  }

  const text = (await uploaded.text()).trim();
  if (!text) {
    return {
      sessionId: undefined,
      username: undefined,
      label: undefined,
      sessionFile: undefined
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("instagram_sessionid_file_invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("instagram_sessionid_file_invalid_shape");
  }

  const sessionId = typeof (parsed as Record<string, unknown>).sessionId === "string"
    ? normalizeInstagramSessionId((parsed as Record<string, string>).sessionId.trim())
    : "";
  if (!sessionId) {
    throw new Error("instagram_sessionid_file_missing_sessionid");
  }
  return {
    sessionId,
    username: readOptionalString(parsed, "username"),
    label: readOptionalString(parsed, "label"),
    sessionFile: readOptionalString(parsed, "sessionFile")
  };
}

function normalizeInstagramSessionId(value: string) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function validateInstagramSessionSettings(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("instagram_session_settings_invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("instagram_session_settings_invalid_shape");
  }
  const settings = parsed as Record<string, unknown>;
  const uuids = metadataRecord(settings.uuids);
  const cookies = metadataRecord(settings.cookies);
  const authorizationData = metadataRecord(settings.authorization_data);
  const hasDeviceIdentity = Boolean(
    typeof uuids.phone_id === "string"
    && typeof uuids.uuid === "string"
    && typeof uuids.android_device_id === "string"
  );
  const hasAuthenticatedSession = Boolean(
    (typeof authorizationData.sessionid === "string" && authorizationData.sessionid)
    || (typeof cookies.sessionid === "string" && cookies.sessionid)
  );
  if (!hasDeviceIdentity || !hasAuthenticatedSession) {
    throw new Error("instagram_session_settings_not_authenticated");
  }
}

function readOptionalString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  if (typeof field !== "string") return undefined;
  const trimmed = field.trim();
  return trimmed || undefined;
}

function readWrappedInstagramSessionSettings(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const field = record.sessionSettings;
  if (!field) return undefined;
  if (typeof field === "string") {
    return field.trim() || undefined;
  }
  if (typeof field === "object" && !Array.isArray(field)) {
    return JSON.stringify(field);
  }
  return undefined;
}
