import type { Prisma } from "./generated/prisma/client";

export const EXPORT_FIELDS = [
  "creativeId",
  "advertiserId",
  "advertiserName",
  "appId",
  "appName",
  "store",
  "format",
  "status",
  "countries",
  "firstShownAt",
  "lastShownAt",
  "publicDays",
  "impressions",
  "previewUrl"
] as const;

export type ExportField = typeof EXPORT_FIELDS[number];
export type DateField = "firstShownAt" | "lastShownAt" | "firstFoundAt" | "lastFoundAt" | "updatedAt" | "createdAt";
export type CreativeActivity = "NEW_TODAY" | "DISAPPEARED";

export interface CreativeFilters {
  advertiserId?: string;
  creativeIds?: string[];
  country?: string;
  status?: "ACTIVE" | "STOPPED" | "UNKNOWN";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "UNKNOWN";
  store?: "GOOGLE_PLAY" | "APP_STORE" | "UNKNOWN";
  appId?: string;
  q?: string;
  activity?: CreativeActivity;
  dateField?: DateField;
  dateFrom?: string;
  dateTo?: string;
}

export function parseCreativeFilters(searchParams: URLSearchParams): CreativeFilters {
  return {
    advertiserId: clean(searchParams.get("advertiserId")),
    creativeIds: parseListValues(searchParams.getAll("creativeIds")),
    country: clean(searchParams.get("country"))?.toUpperCase(),
    status: enumValue(searchParams.get("status"), ["ACTIVE", "STOPPED", "UNKNOWN"]),
    format: enumValue(searchParams.get("format"), ["TEXT", "IMAGE", "VIDEO", "UNKNOWN"]),
    store: enumValue(searchParams.get("store"), ["GOOGLE_PLAY", "APP_STORE", "UNKNOWN"]),
    appId: clean(searchParams.get("appId")),
    q: clean(searchParams.get("q")),
    activity: enumValue(searchParams.get("activity"), ["NEW_TODAY", "DISAPPEARED"]) ?? undefined,
    dateField: enumValue(searchParams.get("dateField"), ["firstShownAt", "lastShownAt", "firstFoundAt", "lastFoundAt", "updatedAt", "createdAt"]) ?? undefined,
    dateFrom: clean(searchParams.get("dateFrom")),
    dateTo: clean(searchParams.get("dateTo"))
  };
}

export function buildCreativeWhere(filters: CreativeFilters): Prisma.CreativeWhereInput {
  const normalized = normalizeCreativeFilters(filters);
  const dateField = normalized.dateField ?? "updatedAt";
  const dateRange = buildDateRange(normalized.dateFrom, normalized.dateTo);
  const activityRange = buildActivityWhere(normalized.activity);

  return stripUndefined({
    advertiserId: normalized.advertiserId,
    creativeId: normalized.creativeIds?.length ? { in: normalized.creativeIds } : undefined,
    status: normalized.status ?? activityRange.status,
    format: normalized.format,
    firstFoundAt: activityRange.firstFoundAt,
    countries: normalized.country ? { some: { countryCode: normalized.country } } : undefined,
    app: normalized.store || normalized.appId ? {
      store: normalized.store,
      OR: normalized.appId ? [
        { appId: { contains: normalized.appId } },
        { name: { contains: normalized.appId } }
      ] : undefined
    } : undefined,
    OR: normalized.q ? [
      { creativeId: { contains: normalized.q } },
      { advertiser: { name: { contains: normalized.q } } },
      { advertiser: { googleAdvertiserId: { contains: normalized.q } } },
      { app: { appId: { contains: normalized.q } } },
      { app: { name: { contains: normalized.q } } }
    ] : undefined,
    [dateField]: dateRange
  });
}

export function resolveExportFields(value?: string | string[] | null): ExportField[] {
  const requested = Array.isArray(value) ? value : parseList(value ?? undefined);
  if (!requested.length) return [...EXPORT_FIELDS];
  return EXPORT_FIELDS.filter((field) => requested.includes(field));
}

function buildDateRange(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return {
    gte: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
    lte: to ? new Date(`${to}T23:59:59.999Z`) : undefined
  };
}

function buildActivityWhere(activity?: CreativeActivity): Prisma.CreativeWhereInput {
  if (activity === "DISAPPEARED") return { status: "STOPPED" };
  if (activity === "NEW_TODAY") {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    return { firstFoundAt: { gte: from } };
  }
  return {};
}

function clean(value: string | null) {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "ALL" ? trimmed : undefined;
}

function parseList(value?: string | null) {
  return (value ?? "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseListValues(values: string[]) {
  return values.flatMap((value) => parseList(value));
}

function enumValue<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  const cleaned = clean(value);
  return allowed.includes(cleaned as T) ? cleaned as T : undefined;
}

function normalizeCreativeFilters(filters: CreativeFilters): CreativeFilters {
  return {
    advertiserId: clean(filters.advertiserId ?? null),
    creativeIds: filters.creativeIds?.filter(Boolean),
    country: clean(filters.country ?? null)?.toUpperCase(),
    status: filters.status,
    format: filters.format,
    store: filters.store,
    appId: clean(filters.appId ?? null),
    q: clean(filters.q ?? null),
    activity: filters.activity,
    dateField: filters.dateField,
    dateFrom: clean(filters.dateFrom ?? null),
    dateTo: clean(filters.dateTo ?? null)
  };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}
