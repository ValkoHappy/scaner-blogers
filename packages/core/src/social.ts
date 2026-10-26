export type SocialPlatform = "instagram" | "vk" | "youtube";

export interface SocialContacts {
  emails: string[];
  phones: string[];
  urls: string[];
}

export interface SocialPostSnapshot {
  id: string;
  code?: string | null;
  url?: string | null;
  takenAt?: string | null;
  caption?: string;
  likeCount?: number;
  commentCount?: number;
  viewCount?: number;
  productType?: string | null;
}

export interface SocialCandidateMetrics {
  avgLikes: number;
  avgComments: number;
  avgViews: number;
  postsChecked: number;
}

export interface SocialCandidateRow {
  platform: SocialPlatform;
  platformProfileId: string;
  username: string;
  displayName: string;
  profileUrl: string;
  followers: number;
  bio?: string;
  externalUrl?: string;
  contacts: SocialContacts;
  sourceKeyword: string;
  sourceTag?: string;
  matchedBy: string;
  lastPosts: SocialPostSnapshot[];
  metrics: SocialCandidateMetrics;
  geoGuess?: string | null;
  reason: string;
  raw: Record<string, unknown>;
  collectedAt: string;
}

export interface CollectorEventRow {
  event: {
    level: "debug" | "info" | "warn" | "error";
    code: string;
    message: string;
    data?: Record<string, unknown>;
  };
  collectedAt?: string;
}

export function parseSocialCandidateRow(value: unknown): SocialCandidateRow {
  const row = requireRecord(value, "candidate");
  const platform = requireString(row.platform, "platform");
  if (!["instagram", "vk", "youtube"].includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  const contacts = requireRecord(row.contacts, "contacts");
  const metrics = requireRecord(row.metrics, "metrics");
  return {
    platform: platform as SocialPlatform,
    platformProfileId: requireString(row.platformProfileId, "platformProfileId"),
    username: requireString(row.username, "username"),
    displayName: requireString(row.displayName, "displayName"),
    profileUrl: requireString(row.profileUrl, "profileUrl"),
    followers: requireNonNegativeNumber(row.followers, "followers"),
    bio: optionalString(row.bio),
    externalUrl: optionalString(row.externalUrl),
    contacts: {
      emails: stringArray(contacts.emails, "contacts.emails"),
      phones: stringArray(contacts.phones, "contacts.phones"),
      urls: stringArray(contacts.urls, "contacts.urls")
    },
    sourceKeyword: requireString(row.sourceKeyword, "sourceKeyword"),
    sourceTag: optionalString(row.sourceTag),
    matchedBy: requireString(row.matchedBy, "matchedBy"),
    lastPosts: Array.isArray(row.lastPosts) ? row.lastPosts.map(parsePostSnapshot) : [],
    metrics: {
      avgLikes: requireNonNegativeNumber(metrics.avgLikes, "metrics.avgLikes"),
      avgComments: requireNonNegativeNumber(metrics.avgComments, "metrics.avgComments"),
      avgViews: requireNonNegativeNumber(metrics.avgViews, "metrics.avgViews"),
      postsChecked: requireNonNegativeNumber(metrics.postsChecked, "metrics.postsChecked")
    },
    geoGuess: optionalString(row.geoGuess),
    reason: requireString(row.reason, "reason"),
    raw: isRecord(row.raw) ? row.raw : {},
    collectedAt: requireString(row.collectedAt, "collectedAt")
  };
}

export function parseCollectorEventRow(value: unknown): CollectorEventRow | null {
  if (!isRecord(value) || !isRecord(value.event)) return null;
  const event = value.event;
  const level = optionalString(event.level) ?? "info";
  if (!["debug", "info", "warn", "error"].includes(level)) return null;
  return {
    event: {
      level: level as CollectorEventRow["event"]["level"],
      code: requireString(event.code, "event.code"),
      message: requireString(event.message, "event.message"),
      data: isRecord(event.data) ? event.data : undefined
    },
    collectedAt: optionalString(value.collectedAt)
  };
}

export function socialCandidateDedupeKey(row: Pick<SocialCandidateRow, "platform" | "platformProfileId">) {
  return `${row.platform}:${row.platformProfileId}`;
}

export function sanitizeSocialDiagnosticText(value: string) {
  return value
    .replace(/(\bauthorization\s*[:=]\s*)[^\s,;]+(?:\s+[^\s,;]+)?/gi, "$1***")
    .replace(/(access_token=)[^&=#\s]+/gi, "$1***")
    .replace(/(api[_-]?key[=:]\s*)[^\s,;]+/gi, "$1***")
    .replace(/(password[=:]\s*)[^\s,;]+/gi, "$1***")
    .replace(/(\btoken[=:]\s*)[^\s,;]+/gi, "$1***")
    .replace(/(\b(?:sessionid|csrftoken|ds_user_id|mid|ig_did)[=:]\s*)[^\s,;]+/gi, "$1***")
    .replace(/\bvk1\.a\.[A-Za-z0-9._-]{12,}/g, "[redacted-vk-token]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, "[redacted-google-api-key]")
    .replace(/\b(socks5h?|https?):\/\/([^:@/\s]+):([^@/\s]+)@/gi, "$1://[redacted]@");
}

function parsePostSnapshot(value: unknown): SocialPostSnapshot {
  const row = requireRecord(value, "lastPosts[]");
  return {
    id: requireString(row.id, "lastPosts[].id"),
    code: optionalString(row.code),
    url: optionalString(row.url),
    takenAt: optionalString(row.takenAt),
    caption: optionalString(row.caption) ?? "",
    likeCount: optionalNumber(row.likeCount),
    commentCount: optionalNumber(row.commentCount),
    viewCount: optionalNumber(row.viewCount),
    productType: optionalString(row.productType)
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function requireNonNegativeNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return value;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.filter((item): item is string => typeof item === "string");
}
