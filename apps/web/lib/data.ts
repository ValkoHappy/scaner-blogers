import { evaluateSocialIntegrity, resolveInstagramAuthSource, type SocialIntegrityJob } from "@scaner-blogers/core";
import { countCreatives, findCreatives, getSystemSettings, parseCreativeFilters, prisma, socialPlatformList, stringList, type Prisma } from "@scaner-blogers/db";
import { buildCandidateProfileWhere } from "./candidate-profile-filters";
import { candidateStatusValue } from "./candidate-status";
import { buildSocialCredentialReadiness } from "./social-credential-readiness";
import { buildSocialKeywordQuality } from "./social-keyword-quality";
import { sanitizeStatusText } from "./system-status-sanitize";

type CandidateProfileWithRelations = Prisma.CandidateProfileGetPayload<{
  include: {
    candidate: true;
    keyword: true;
    collectionRun: true;
  };
}>;

export async function getDashboardData() {
  try {
    const [
      advertisers,
      creatives,
      activeCreatives,
      apps,
      scans,
      recentAdvertisers,
      recentCreatives,
      recentScanJobs,
      allCreatives,
      scanJobsForStats
    ] = await Promise.all([
      prisma.advertiser.count(),
      prisma.creative.count(),
      prisma.creative.count({ where: { status: "ACTIVE" } }),
      prisma.app.count(),
      prisma.scan.count(),
      prisma.advertiser.findMany({ orderBy: { updatedAt: "desc" }, take: 5 }),
      prisma.creative.findMany({
        orderBy: { updatedAt: "desc" },
        take: 6,
        include: { advertiser: true, app: true, countries: true }
      }),
      prisma.scanJob.findMany({ orderBy: { createdAt: "desc" }, take: 12, include: { advertiser: true, events: { orderBy: { createdAt: "desc" }, take: 1 } } }),
      prisma.creative.findMany({
        select: {
          format: true,
          app: { select: { store: true } },
          countries: { select: { countryCode: true }, take: 20 }
        },
        take: 5000
      }),
        prisma.scanJob.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { advertiser: true } })
    ]);

  return {
      advertisers,
      creatives,
      activeCreatives,
      apps,
      scans,
      recentAdvertisers,
      recentCreatives,
      recentScanJobs,
      formatStats: countBy(allCreatives, (creative) => creative.format),
      storeStats: countBy(allCreatives, (creative) => creative.app?.store ?? "UNKNOWN"),
      countryStats: topCountries(allCreatives),
      scanStatusStats: countBy(scanJobsForStats, (scan) => scan.status),
      scanVolumeStats: scanJobsForStats
        .slice(0, 10)
        .reverse()
        .map((scan) => ({
          label: new Date(scan.createdAt).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" }),
          timeLabel: new Date(scan.createdAt).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }),
          dateTimeLabel: new Date(scan.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
          finishedTimeLabel: scan.finishedAt ? new Date(scan.finishedAt).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }) : null,
          value: scan.creativesFound,
          details: scan.detailsFetched,
          previews: scan.previewsFetched,
          status: scan.status,
          advertiserName: scan.advertiser.name ?? scan.advertiser.googleAdvertiserId,
          googleAdvertiserId: scan.advertiser.googleAdvertiserId
        }))
    };
  } catch {
    if (process.env.NODE_ENV === "production" && process.env.DATABASE_URL) throw new Error("Dashboard data is unavailable.");
    return demoDashboardData();
  }
}

export async function getSocialDashboardData() {
  try {
    const [
      candidates,
      profiles,
      profileRowsForContacts,
      platformRows,
      collectionJobs,
      recentCandidates,
      recentProfiles,
      keywords
    ] = await Promise.all([
      prisma.candidate.count(),
      prisma.candidateProfile.count(),
      prisma.candidateProfile.findMany({ select: { contacts: true }, take: 5000 }),
      prisma.candidateProfile.findMany({ select: { platform: true }, take: 5000 }),
      prisma.collectionJob.findMany({ orderBy: { createdAt: "desc" }, take: 120, include: { keyword: true } }),
      prisma.candidate.findMany({
        orderBy: { lastFoundAt: "desc" },
        take: 6,
        include: { profiles: { orderBy: { lastCollectedAt: "desc" }, take: 3 } }
      }),
      prisma.candidateProfile.findMany({
        where: {
          OR: [
            { platform: "INSTAGRAM", followers: { gte: 20_000, lte: 60_000 } },
            { platform: "VK", followers: { gte: 5_000, lte: 100_000 } },
            { platform: "YOUTUBE", followers: { gte: 10_000, lte: 150_000 } }
          ]
        },
        orderBy: { lastCollectedAt: "desc" },
        take: 8,
        include: { candidate: true, keyword: true }
      }),
      prisma.searchKeyword.findMany({
        orderBy: { updatedAt: "desc" },
        take: 8,
        include: { _count: { select: { profiles: true, jobs: true } } }
      })
    ]);
    const withContacts = profileRowsForContacts.filter((profile) => hasContacts(profile.contacts)).length;
    const platformStats = countBy(platformRows, (profile) => profile.platform);
    const statusStats = countBy(collectionJobs, (job) => job.status);
    return {
      candidates,
      profiles,
      activeProfiles: profiles,
      withContacts,
      keywords: keywords.length,
      collections: collectionJobs.length,
      platformStats,
      keywordStats: keywords.map((keyword) => ({ label: keyword.value, value: keyword._count.profiles })),
      scanStatusStats: statusStats,
      scanVolumeStats: collectionJobs
        .slice(0, 12)
        .reverse()
        .map((job) => ({
          label: new Date(job.createdAt).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" }),
          timeLabel: new Date(job.createdAt).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }),
          dateTimeLabel: new Date(job.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
          finishedTimeLabel: job.finishedAt ? new Date(job.finishedAt).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }) : null,
          value: job.candidatesFound,
          details: job.profilesChecked,
          previews: job.maxProfiles ?? 0,
          status: job.status,
          advertiserName: job.keyword?.value ?? "СЂСѓС‡РЅРѕР№ СЃР±РѕСЂ",
          googleAdvertiserId: job.platform
        })),
      recentCandidates,
      recentProfiles
    };
  } catch {
    return {
      candidates: 0,
      profiles: 0,
      activeProfiles: 0,
      withContacts: 0,
      keywords: 0,
      collections: 0,
      platformStats: [
        { label: "INSTAGRAM", value: 0 },
        { label: "VK", value: 0 },
        { label: "YOUTUBE", value: 0 }
      ],
      keywordStats: [],
      scanStatusStats: [],
      scanVolumeStats: [],
      recentCandidates: [],
      recentProfiles: []
    };
  }
}

function hasContacts(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const contacts = value as { emails?: unknown; phones?: unknown; urls?: unknown };
  return [contacts.emails, contacts.phones, contacts.urls].some((list) => Array.isArray(list) && list.some((item) => typeof item === "string" && Boolean(item.trim())));
}

export async function getAdvertisers() {
  try {
    const advertisers = await prisma.advertiser.findMany({ orderBy: { updatedAt: "desc" }, include: { scanJobs: { take: 1, orderBy: { createdAt: "desc" } } } });
    return advertisers.map(normalizeAdvertiser);
  } catch {
    if (process.env.NODE_ENV === "production") throw new Error("Advertisers data is unavailable.");
    return demoDashboardData().recentAdvertisers;
  }
}

export async function getAdvertiser(id: string) {
  try {
    const advertiser = await prisma.advertiser.findFirst({
      where: {
        OR: [
          { id },
          { googleAdvertiserId: id }
        ]
      },
      include: {
        creatives: {
          orderBy: { updatedAt: "desc" },
          include: {
            app: true,
            countries: { take: 8 },
            assets: { take: 1 }
          },
          take: 100
        },
        scanJobs: {
          orderBy: { createdAt: "desc" },
          include: { events: { orderBy: { createdAt: "desc" }, take: 200 } },
          take: 20
        },
        scans: { orderBy: { startedAt: "desc" }, take: 10 }
      }
    });
    return advertiser ? normalizeAdvertiser(advertiser) : null;
  } catch {
    return null;
  }
}

export async function getCreatives(params?: {
  advertiserId?: string;
  country?: string;
  status?: string;
  format?: string;
  store?: string;
  appId?: string;
  q?: string;
  activity?: string;
  dateField?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
  take?: number;
}) {
  try {
    const take = params?.take ?? 100;
    const page = Math.max(1, Number(params?.page ?? 1) || 1);
    return await findCreatives({
      advertiserId: params?.advertiserId,
      country: params?.country?.toUpperCase(),
      status: params?.status && params.status !== "ALL" ? params.status as never : undefined,
      format: params?.format && params.format !== "ALL" ? params.format as never : undefined,
      store: params?.store && params.store !== "ALL" ? params.store as never : undefined,
      appId: params?.appId,
      q: params?.q,
      activity: params?.activity && params.activity !== "ALL" ? params.activity as never : undefined,
      dateField: params?.dateField as never,
      dateFrom: params?.dateFrom,
      dateTo: params?.dateTo
    }, prisma, take, (page - 1) * take);
  } catch {
    if (process.env.NODE_ENV === "production") throw new Error("Creatives data is unavailable.");
    return demoDashboardData().recentCreatives;
  }
}

export async function getCreativesCount(params?: {
  advertiserId?: string;
  country?: string;
  status?: string;
  format?: string;
  store?: string;
  appId?: string;
  q?: string;
  activity?: string;
  dateField?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    return await countCreatives({
      advertiserId: params?.advertiserId,
      country: params?.country?.toUpperCase(),
      status: params?.status && params.status !== "ALL" ? params.status as never : undefined,
      format: params?.format && params.format !== "ALL" ? params.format as never : undefined,
      store: params?.store && params.store !== "ALL" ? params.store as never : undefined,
      appId: params?.appId,
      q: params?.q,
      activity: params?.activity && params.activity !== "ALL" ? params.activity as never : undefined,
      dateField: params?.dateField as never,
      dateFrom: params?.dateFrom,
      dateTo: params?.dateTo
    }, prisma);
  } catch {
    if (process.env.NODE_ENV === "production") throw new Error("Creatives count is unavailable.");
    return demoDashboardData().recentCreatives.length;
  }
}

export async function getCreative(creativeId: string) {
  try {
    return await prisma.creative.findUnique({
      where: { creativeId },
      include: {
        advertiser: true,
        app: true,
        countries: { orderBy: { impressionsMax: "desc" } },
        assets: true,
        rawSnapshots: { orderBy: { createdAt: "desc" }, take: 20 }
      }
    });
  } catch {
    if (process.env.NODE_ENV === "production") throw new Error("Creative data is unavailable.");
    return demoDashboardData().recentCreatives.find((creative) => creative.creativeId === creativeId) ?? demoDashboardData().recentCreatives[0];
  }
}

export async function getScans() {
  try {
    const jobs = await prisma.scanJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        advertiser: true,
        scans: { orderBy: { startedAt: "desc" }, take: 1 },
        events: { orderBy: { createdAt: "desc" }, take: 3 }
      }
    });
    return jobs.map(normalizeScanJob);
  } catch {
    return [];
  }
}

export async function getKeywords() {
  try {
    const keywords = await prisma.searchKeyword.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { profiles: true, jobs: true } },
        jobs: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    });
    return keywords.map(normalizeSearchKeyword);
  } catch {
    return [];
  }
}

export async function getCandidateProfiles(params?: {
  status?: string;
  platform?: string;
  q?: string;
  matchedBy?: string;
  minFollowers?: string;
  maxFollowers?: string;
  minAvgViews?: string;
  minAvgLikes?: string;
  minScore?: string;
  exported?: string;
}) {
  try {
    const q = params?.q?.trim();
    const status = candidateStatusValue(params?.status);
    const platform = socialPlatformValue(params?.platform);
    const matchedBy = params?.matchedBy && params.matchedBy !== "ALL" ? params.matchedBy : undefined;
    const minFollowers = positiveIntValue(params?.minFollowers);
    const maxFollowers = positiveIntValue(params?.maxFollowers);
    const minAvgViews = positiveIntValue(params?.minAvgViews);
    const minAvgLikes = positiveIntValue(params?.minAvgLikes);
    const minScore = positiveIntValue(params?.minScore);
    const exported = candidateExportFilter(params?.exported);
    const profiles = await prisma.candidateProfile.findMany({
      where: buildCandidateProfileWhere({
        q,
        status,
        platform,
        matchedBy,
        minFollowers,
        maxFollowers,
        minScore,
        exported
      }),
      orderBy: [
        { qualityScore: "desc" },
        { lastCollectedAt: "desc" }
      ],
      take: minAvgViews || minAvgLikes ? 2_000 : 200,
      include: {
        candidate: true,
        keyword: true,
        collectionRun: true
      }
    }) as CandidateProfileWithRelations[];
    return profiles.filter((profile) => {
      if (minAvgViews && metricNumber(profile.metrics, "avgViews") < minAvgViews) return false;
      if (minAvgLikes && metricNumber(profile.metrics, "avgLikes") < minAvgLikes) return false;
      return true;
    }).slice(0, 200);
  } catch {
    return [];
  }
}

function socialPlatformValue(value?: string): "INSTAGRAM" | "VK" | "YOUTUBE" | undefined {
  if (value === "INSTAGRAM") return "INSTAGRAM";
  if (value === "VK") return "VK";
  if (value === "YOUTUBE") return "YOUTUBE";
  return undefined;
}

function positiveIntValue(value?: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function candidateExportFilter(value?: string) {
  if (value === "YES") return "YES";
  if (value === "NO") return "NO";
  return undefined;
}

function metricNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object") return 0;
  const metric = (value as Record<string, unknown>)[key];
  return typeof metric === "number" && Number.isFinite(metric) ? metric : 0;
}

export async function getCollectionJobs() {
  try {
    const jobs = await prisma.collectionJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        keyword: true,
        runs: { orderBy: { startedAt: "desc" }, take: 1 },
        events: { orderBy: { createdAt: "desc" }, take: 3 }
      }
    });
    return jobs.map(normalizeCollectionJob);
  } catch {
    return [];
  }
}

export async function getExportStats() {
  try {
    const [creatives, rawSnapshots, advertisers, apps] = await Promise.all([
      prisma.creative.count(),
      prisma.rawApiSnapshot.count(),
      prisma.advertiser.count(),
      prisma.app.count()
    ]);

  return { creatives, rawSnapshots, advertisers, apps };
  } catch {
    return { creatives: 0, rawSnapshots: 0, advertisers: 0, apps: 0 };
  }
}

export async function getExportData(searchParams?: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((item) => params.append(key, item));
    } else if (value) {
      params.set(key, value);
    }
  }

  const filters = parseCreativeFilters(params);
  try {
    const [stats, advertisers, apps, previewCount, settings, previewRows] = await Promise.all([
      getExportStats(),
      prisma.advertiser.findMany({ orderBy: { name: "asc" } }),
      prisma.app.findMany({ orderBy: { name: "asc" }, take: 100 }),
      countCreatives(filters, prisma),
      getSystemSettings(prisma),
      findCreatives(filters, prisma, 100)
    ]);

  return { stats, advertisers, apps, previewCount, settings, filters, previewRows };
  } catch {
    return {
      stats: await getExportStats(),
      advertisers: [],
      apps: [],
      previewCount: 0,
      settings: demoSystemSettings(),
      filters,
      previewRows: []
    };
  }
}

export async function getSettingsData() {
  const socialCredentialReadiness = buildSocialCredentialReadiness(process.env);
  const vkCredential = socialCredentialReadiness.find((item) => item.platform === "VK");
  const [data, settings, systemStatus, proxies, socialAccounts] = await Promise.all([
    getDashboardData(),
    getSystemSettings(prisma).catch(() => demoSystemSettings()),
    getSystemStatusData(),
    prisma.proxyEndpoint.findMany({ orderBy: { createdAt: "asc" } }).catch(() => []),
    prisma.socialPlatformAccount.findMany({ orderBy: { updatedAt: "desc" } }).catch(() => [])
  ]);
  const settingsVkAppId = "vkAppId" in settings ? settings.vkAppId : null;
  const envVkAppId = cleanVkAppId(process.env.VK_APP_ID);
  const normalizedSettingsVkAppId = cleanVkAppId(settingsVkAppId);
  const vkOauthClientId = normalizedSettingsVkAppId || envVkAppId;
  const vkOauthClientIdSource = normalizedSettingsVkAppId ? "db" : envVkAppId ? "env" : "missing";
  const vkConfigMismatch = Boolean(
    normalizedSettingsVkAppId
    && envVkAppId
    && normalizedSettingsVkAppId !== envVkAppId
  );
  const vkAccounts = socialAccounts
    .filter((account) => account.platform === "VK")
    .filter((account) => !isStaleEnvCredentialAccount(account, "VK", Boolean(vkCredential?.ready)))
    .map((account) => safeCredentialAccountForUi(account, "VK token"));
  const hasRefreshableVkAccount = vkAccounts.some((account) => account.refreshEnabled && account.enabled);
  const hasAnyVkAccountSecret = vkAccounts.some((account) => account.hasSecret && account.enabled);

  return {
    ...data,
    settings,
    systemStatus,
    proxies,
    adminEmail: process.env.ADMIN_EMAIL ?? "admin@scaner-blogers.local",
    databaseUrl: maskDatabaseUrl(process.env.DATABASE_URL),
    appName: process.env.NEXT_PUBLIC_APP_NAME ?? "ScanerBlogers",
    instagram: {
      usernameConfigured: Boolean(process.env.INSTAGRAM_USERNAME),
      passwordConfigured: Boolean(process.env.INSTAGRAM_PASSWORD),
      proxyConfigured: Boolean(process.env.INSTAGRAM_PROXY_URL),
      sessionFile: process.env.INSTAGRAM_SESSION_FILE ?? ".instagram/session.json",
      pythonBin: process.env.INSTAGRAM_PYTHON_BIN ?? ".venv-instagram"
    },
    vk: {
      serviceTokenConfigured: Boolean(process.env.VK_SERVICE_TOKEN),
      serverTokenConfigured: Boolean(process.env.VK_SERVER_TOKEN),
      accessTokenConfigured: Boolean(process.env.VK_ACCESS_TOKEN),
      tokenConfigured: hasRefreshableVkAccount || Boolean(vkCredential?.ready) || hasAnyVkAccountSecret,
      preferredToken: hasRefreshableVkAccount ? "oauth_account" : vkCredential?.source ?? (hasAnyVkAccountSecret ? "stored_account" : "none"),
      oauthClientId: vkOauthClientId,
      oauthClientIdSource: vkOauthClientIdSource,
      oauthConfigMismatch: vkConfigMismatch,
      refreshEnabledAccounts: vkAccounts.filter((account) => account.refreshEnabled && account.enabled).length,
      apiRepoPath: process.env.VK_API_REPO_PATH ?? "../research/repos/vk-vk-api",
      pythonBin: process.env.VK_PYTHON_BIN ?? ".venv-instagram"
    },
      youtube: {
        apiKeyConfigured: Boolean(process.env.YOUTUBE_API_KEY),
        pythonBin: process.env.YOUTUBE_PYTHON_BIN ?? ".venv-instagram",
        collectorScript: process.env.YOUTUBE_COLLECTOR_SCRIPT ?? "collectors/youtube/youtube_collector.py"
      },
      socialAccounts: socialAccounts.map(safeSocialAccountForUi),
      instagramAccounts: socialAccounts
        .filter((account) => account.platform === "INSTAGRAM")
        .filter((account) => !isStaleEnvInstagramAccount(account))
        .map(safeInstagramAccountForUi),
      vkAccounts,

      youtubeAccounts: socialAccounts
        .filter((account) => account.platform === "YOUTUBE")
        .filter((account) => !isStaleEnvCredentialAccount(account, "YOUTUBE", Boolean(process.env.YOUTUBE_API_KEY)))
        .map((account) => safeCredentialAccountForUi(account, "YouTube API key")),
      instagramConcurrency: Number(process.env.SOCIAL_PLATFORM_CONCURRENCY_INSTAGRAM || 1) || 1,
      vkConcurrency: Number(process.env.SOCIAL_PLATFORM_CONCURRENCY_VK || 1) || 1,
      youtubeConcurrency: Number(process.env.SOCIAL_PLATFORM_CONCURRENCY_YOUTUBE || 1) || 1
    };
  }

function safeSocialAccountForUi<T extends {
  id: string;
  platform: string;
  accountKey: string;
  username: string | null;
  status: string;
  blockedUntil: Date | null;
  consecutiveErrors: number;
  lastError: string | null;
}>(account: T): T {
  return {
    ...account,
    accountKey: redactAccountKey(account.accountKey),
    username: account.username ? "[redacted]" : null,
    lastError: account.lastError ? sanitizeStatusText(account.lastError) : null
  };
}

  function redactAccountKey(value: string) {
    const separator = value.indexOf(":");
    if (separator < 0) return "[redacted]";
    return `${value.slice(0, separator)}:[redacted]`;
  }

  function safeInstagramAccountForUi(account: {
    id: string;
    accountKey: string;
    label: string | null;
    username: string | null;
    status: string;
    blockedUntil: Date | null;
    lastSuccessAt: Date | null;
    lastErrorAt: Date | null;
    lastError: string | null;
    consecutiveErrors: number;
    metadata: unknown;
  }) {
    const metadata = account.metadata && typeof account.metadata === "object" && !Array.isArray(account.metadata)
      ? account.metadata as Record<string, unknown>
      : {};
    const auth = resolveInstagramAuthSource(metadata);
    return {
      id: account.id,
      accountKey: account.accountKey,
      label: account.label ?? account.username ?? "Instagram account",
      username: account.username ?? (typeof metadata.username === "string" ? metadata.username : ""),
      status: account.status,
      blockedUntil: account.blockedUntil,
      lastSuccessAt: account.lastSuccessAt,
      lastErrorAt: account.lastErrorAt,
      lastError: account.lastError ? sanitizeStatusText(account.lastError) : null,
      consecutiveErrors: account.consecutiveErrors,
      enabled: metadata.enabled !== false,
      hasPassword: auth.hasPassword,
      hasSessionSettings: auth.hasSessionSettings,
      hasProxy: typeof metadata.proxyUrl === "string" && Boolean(metadata.proxyUrl.trim()),
      sessionFile: auth.metadata.sessionFile ?? "",
      authSource: auth.authSource
    };
  }

  function isStaleEnvInstagramAccount(account: { accountKey: string; username: string | null; metadata: unknown }) {
    if (account.accountKey !== "INSTAGRAM:env") return false;
    if (!process.env.INSTAGRAM_USERNAME) return false;
    const metadata = account.metadata && typeof account.metadata === "object" && !Array.isArray(account.metadata)
      ? account.metadata as Record<string, unknown>
      : {};
    return !account.username && typeof metadata.password !== "string";
  }

  function isStaleEnvCredentialAccount(account: { platform: string; accountKey: string; metadata: unknown }, platform: "VK" | "YOUTUBE", envReady: boolean) {
    if (!envReady || account.platform !== platform) return false;
    const metadata = account.metadata && typeof account.metadata === "object" && !Array.isArray(account.metadata)
      ? account.metadata as Record<string, unknown>
      : {};
    const hasSecret = typeof metadata.token === "string" || typeof metadata.apiKey === "string";
    return !hasSecret && (account.accountKey === "VK:api-token" || account.accountKey === "YOUTUBE:api-key");
  }

  function safeCredentialAccountForUi(account: {
    id: string;
    platform: string;
    accountKey: string;
    label: string | null;
    username: string | null;
    status: string;
    blockedUntil: Date | null;
    lastSuccessAt: Date | null;
    lastErrorAt: Date | null;
    lastError: string | null;
    consecutiveErrors: number;
    metadata: unknown;
  }, fallbackLabel: string) {
    const metadata = account.metadata && typeof account.metadata === "object" && !Array.isArray(account.metadata)
      ? account.metadata as Record<string, unknown>
      : {};
    const refreshToken = typeof metadata.refreshToken === "string" ? metadata.refreshToken.trim() : "";
    const clientId = typeof metadata.clientId === "string" ? metadata.clientId.trim() : "";
    const deviceId = typeof metadata.deviceId === "string" ? metadata.deviceId.trim() : "";
    const oauth = metadata.oauth === true;
    const refreshEnabled = Boolean(oauth && refreshToken && clientId && deviceId);
    return {
      id: account.id,
      platform: account.platform,
      accountKey: account.accountKey,
      label: account.label ?? fallbackLabel,
      username: account.username ?? "",
      status: account.status,
      blockedUntil: account.blockedUntil,
      lastSuccessAt: account.lastSuccessAt,
      lastErrorAt: account.lastErrorAt,
      lastError: account.lastError ? sanitizeStatusText(account.lastError) : null,
      consecutiveErrors: account.consecutiveErrors,
      enabled: metadata.enabled !== false,
      hasSecret: typeof metadata.token === "string" || typeof metadata.apiKey === "string",
      hasPassword: typeof metadata.password === "string" && Boolean(metadata.password.trim()),
      login: typeof metadata.login === "string" ? metadata.login : account.username ?? "",
      tokenType: typeof metadata.tokenType === "string" ? metadata.tokenType : "",
      oauth,
      oauthFlow: typeof metadata.oauthFlow === "string" ? metadata.oauthFlow : "",
      refreshEnabled,
      clientId,
      userId: typeof metadata.userId === "string" ? metadata.userId : ""
    };
  }

export async function getAppSettings() {
  return getSystemSettings(prisma).catch(() => demoSystemSettings());
}

export async function getSystemStatusData() {
  const startedAt = Date.now();
  try {
    await prisma.advertiser.count();
    const [
      scanQueued,
      scanRunning,
      scanFailed,
      collectionQueued,
      collectionRunning,
      collectionFailed,
      heartbeat,
      googleHealth,
      lastScan,
      lastCollectionJob,
      lastSuccessfulScan,
      lastSuccessfulCollectionJob,
      creativesWithoutApp,
      creativesWithoutPreviewUrl,
      rawSnapshots,
      candidateProfiles,
      rawSocialSnapshots,
      socialAccounts,
      socialSearchHistory,
      socialKeywordQuality,
      socialRunningByPlatform,
      socialQueuedByPlatform,
      socialIntegrity
    ] = await Promise.all([
      prisma.scanJob.count({ where: { status: "QUEUED" } }),
      prisma.scanJob.count({ where: { status: "RUNNING" } }),
      prisma.scanJob.count({ where: { status: "FAILED" } }),
      prisma.collectionJob.count({ where: { status: "QUEUED" } }),
      prisma.collectionJob.count({ where: { status: "RUNNING" } }),
      prisma.collectionJob.count({ where: { status: "FAILED" } }),
      prisma.workerHeartbeat.findUnique({ where: { id: "default" } }),
      prisma.googleHealth.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} }),
      prisma.scanJob.findFirst({ orderBy: { updatedAt: "desc" }, include: { advertiser: true, events: { orderBy: { createdAt: "desc" }, take: 1 } } }),
      prisma.collectionJob.findFirst({ orderBy: { updatedAt: "desc" }, include: { keyword: true, events: { orderBy: { createdAt: "desc" }, take: 1 } } }),
      prisma.scanJob.findFirst({ where: { status: "SUCCESS" }, orderBy: { finishedAt: "desc" } }),
      prisma.collectionJob.findFirst({ where: { status: "SUCCESS" }, orderBy: { finishedAt: "desc" } }),
      prisma.creative.count({ where: { appDbId: null } }),
      prisma.creative.count({ where: { previewUrl: null } }),
      prisma.rawApiSnapshot.count(),
      prisma.candidateProfile.count(),
      prisma.rawSocialSnapshot.count(),
      prisma.socialPlatformAccount.findMany({ orderBy: { updatedAt: "desc" }, take: 10 }),
      prisma.collectionSearchHistory.findMany({
        orderBy: { lastSearchedAt: "desc" },
        take: 10,
        include: { keyword: true }
      }),
      getSocialKeywordQualityData(),
      prisma.collectionJob.groupBy({
        by: ["platform"],
        where: { status: "RUNNING" },
        _count: { _all: true }
      }),
      prisma.collectionJob.groupBy({
        by: ["platform"],
        where: { status: "QUEUED" },
        _count: { _all: true }
      }),
      getSocialIntegrityData()
    ]);
    const heartbeatAgeMs = heartbeat ? Date.now() - heartbeat.lastSeenAt.getTime() : null;
    const queued = scanQueued + collectionQueued;
    const running = scanRunning + collectionRunning;
    const failed = scanFailed + collectionFailed;
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      workerOnline: heartbeatAgeMs !== null && heartbeatAgeMs <= 90_000,
      workerStatus: heartbeat?.status ?? "unknown",
      workerMessage: heartbeat?.message ?? null,
      workerLastSeenAt: heartbeat?.lastSeenAt ?? null,
      google: {
        status: googleHealth.status,
        blockedUntil: googleHealth.blockedUntil,
        lastProbeAt: googleHealth.lastProbeAt,
        lastSuccessAt: googleHealth.lastSuccessAt,
        consecutiveBlocks: googleHealth.consecutiveBlocks,
        lastError: googleHealth.lastError
      },
      queued,
      running,
      failed,
      legacyQueue: { queued: scanQueued, running: scanRunning, failed: scanFailed },
      socialQueue: { queued: collectionQueued, running: collectionRunning, failed: collectionFailed },
      lastScan,
      lastCollectionJob,
      lastSuccessAt: latestDate(lastSuccessfulScan?.finishedAt, lastSuccessfulCollectionJob?.finishedAt),
      creativesWithoutApp,
      creativesWithoutPreviewUrl,
      rawSnapshots,
      candidateProfiles,
      rawSocialSnapshots,
      socialAccounts: socialAccounts.map(safeSocialAccountForUi),
      socialCredentialReadiness: buildSocialCredentialReadiness(process.env),
      socialSearchHistory,
      socialKeywordQuality,
      socialIntegrity,
      socialLanes: {
        running: Object.fromEntries(socialRunningByPlatform.map((row) => [row.platform, row._count._all])),
        queued: Object.fromEntries(socialQueuedByPlatform.map((row) => [row.platform, row._count._all]))
      }
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown DB error",
      workerOnline: false,
      workerStatus: "unknown",
      workerMessage: null,
      workerLastSeenAt: null,
      google: null,
      queued: 0,
      running: 0,
      failed: 0,
      legacyQueue: { queued: 0, running: 0, failed: 0 },
      socialQueue: { queued: 0, running: 0, failed: 0 },
      lastScan: null,
      lastCollectionJob: null,
      lastSuccessAt: null,
      creativesWithoutApp: 0,
      creativesWithoutPreviewUrl: 0,
      rawSnapshots: 0,
      candidateProfiles: 0,
      rawSocialSnapshots: 0,
      socialAccounts: [],
      socialCredentialReadiness: buildSocialCredentialReadiness(process.env),
      socialSearchHistory: [],
      socialKeywordQuality: [],
      socialIntegrity: emptySocialIntegrityData(),
      socialLanes: { running: {}, queued: {} }
    };
  }
}

export async function getSocialIntegrityData(limit = 200) {
  const jobs = await prisma.collectionJob.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      runs: { orderBy: { startedAt: "desc" }, take: 10 },
      events: { orderBy: { createdAt: "desc" }, take: 500 }
    }
  });
  const result = evaluateSocialIntegrity(jobs as SocialIntegrityJob[]);

  return {
    checkedJobs: result.checkedJobs,
    errors: result.errors,
    warnings: result.warnings,
    issues: result.issues.slice(0, 20)
  };
}

function emptySocialIntegrityData() {
  return {
    checkedJobs: 0,
    errors: 0,
    warnings: 0,
    issues: []
  };
}

export async function getSocialKeywordQualityData() {
  const [profileGroups, jobGroups] = await Promise.all([
    prisma.candidateProfile.groupBy({
      by: ["keywordId", "platform"],
      where: { keywordId: { not: null } },
      _count: { _all: true },
      _avg: { qualityScore: true, followers: true }
    }),
    prisma.collectionJob.groupBy({
      by: ["keywordId", "platform"],
      where: { keywordId: { not: null } },
      _count: { _all: true },
      _sum: { candidatesFound: true, profilesChecked: true }
    })
  ]);

  const keywordIds = Array.from(new Set([
    ...profileGroups.map((row) => row.keywordId).filter((id): id is string => Boolean(id)),
    ...jobGroups.map((row) => row.keywordId).filter((id): id is string => Boolean(id))
  ]));
  const keywords = keywordIds.length
    ? await prisma.searchKeyword.findMany({ where: { id: { in: keywordIds } }, select: { id: true, value: true } })
    : [];

  return buildSocialKeywordQuality({
    keywords: new Map(keywords.map((keyword) => [keyword.id, keyword.value])),
    profileGroups,
    jobGroups
  });
}

function cleanVkAppId(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed && /^\d+$/.test(trimmed) ? trimmed : "";
}

function maskDatabaseUrl(value?: string) {
  if (!value) return "Р»РѕРєР°Р»СЊРЅР°СЏ Р±Р°Р·Р° РЅРµ СѓРєР°Р·Р°РЅР°";
  return value.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

function latestDate(...dates: Array<Date | null | undefined>) {
  const values = dates.filter((date): date is Date => Boolean(date));
  if (!values.length) return null;
  return new Date(Math.max(...values.map((date) => date.getTime())));
}

export function demoDashboardData() {
  const advertiser = {
    id: "demo-adv",
    googleAdvertiserId: "@faceyoga_pro",
    name: "Face Yoga Studio",
    transparencyUrl: "https://instagram.com/faceyoga_pro",
    selectedCountries: ["RU", "KZ"],
    lastScanAt: new Date("2026-05-23T04:58:36.000Z"),
    lastSuccessfulScanAt: new Date("2026-05-23T04:58:36.000Z"),
    lastScanStatus: "SUCCESS",
    dailyScanEnabled: true,
    scanMode: "FULL",
    requestDelayMs: null,
    maxPagesPerRun: null,
    maxCreativesPerRun: null,
    nextScanAt: null,
    totalCreatives: 8,
    activeCreatives: 7,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    scanJobs: []
  };

  const app = {
    id: "demo-app",
    appId: "instagram",
    store: "UNKNOWN",
    storeUrl: "https://instagram.com",
    name: "Instagram",
    developer: "Instagram",
    category: "SOCIAL",
    description: "РџСЂРѕС„РёР»Рё, РЅР°Р№РґРµРЅРЅС‹Рµ РїРѕ С…СЌС€С‚РµРіР°Рј Рё РєР»СЋС‡РµРІС‹Рј СЃР»РѕРІР°Рј",
    shortDescription: "РЎР±РѕСЂ Р±Р»РѕРіРµСЂРѕРІ Instagram",
    firstSeenAt: new Date(),
    lastSeenAt: new Date()
  };

  const countries = [
    { id: "c1", creativeId: "demo", googleGeoId: 2643, countryCode: "RU", countryName: "Russia", impressionsMin: 25000, impressionsMax: 30000, firstShownDate: "2026-05-20", lastShownDate: "2026-05-28", raw: {}, updatedAt: new Date() },
    { id: "c2", creativeId: "demo", googleGeoId: 2398, countryCode: "KZ", countryName: "Kazakhstan", impressionsMin: 15000, impressionsMax: 20000, firstShownDate: "2026-05-20", lastShownDate: "2026-05-28", raw: {}, updatedAt: new Date() }
  ];

  const creative = {
    id: "demo-creative",
    creativeId: "instagram:@faceyoga_pro",
    advertiserId: advertiser.id,
    appDbId: app.id,
    format: "VIDEO",
    status: "ACTIVE",
    previewUrl: "https://instagram.com/faceyoga_pro",
    firstShownAt: new Date("2026-05-20T00:00:00.000Z"),
    lastShownAt: new Date("2026-05-28T00:00:00.000Z"),
    publicDays: 8,
    impressionsMin: 12000,
    impressionsMax: 18000,
    firstFoundAt: new Date(),
    lastFoundAt: new Date(),
    rawList: {},
    rawDetail: {},
    rawPreview: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    advertiser,
    app,
    countries,
    assets: [
      { id: "a1", creativeId: "demo", kind: "LANDSCAPE_IMAGE", url: "https://instagram.com/faceyoga_pro", width: null, height: null, createdAt: new Date() }
    ],
    rawSnapshots: [
      { id: "r1", creativeId: "demo", kind: "CREATIVE_DETAIL", url: null, payload: { demo: true }, createdAt: new Date() }
    ]
  };

  return {
    advertisers: 1,
    creatives: 8,
    activeCreatives: 7,
    apps: 1,
    scans: 4,
    recentAdvertisers: [advertiser],
    recentCreatives: [creative],
    recentScanJobs: [],
    formatStats: [
      { label: "REELS", value: 5 },
      { label: "POST", value: 2 },
      { label: "PROFILE", value: 1 }
    ],
    storeStats: [
      { label: "Instagram", value: 8 },
      { label: "VK", value: 0 },
      { label: "YouTube", value: 0 }
    ],
    countryStats: [
      { label: "РјР°СЃСЃР°Р¶ Р»РёС†Р°", value: 5 },
      { label: "С„РµР№СЃС„РёС‚РЅРµСЃ", value: 3 },
      { label: "face yoga", value: 2 }
    ],
    scanStatusStats: [
      { label: "SUCCESS", value: 3 },
      { label: "FAILED", value: 1 }
    ],
    scanVolumeStats: [
      { label: "26.05", timeLabel: "10:20", value: 2, details: 2, previews: 1, status: "SUCCESS", advertiserName: "Instagram СЃР±РѕСЂ", googleAdvertiserId: "#РјР°СЃСЃР°Р¶Р»РёС†Р°" },
      { label: "27.05", timeLabel: "14:35", value: 5, details: 4, previews: 3, status: "SUCCESS", advertiserName: "Instagram СЃР±РѕСЂ", googleAdvertiserId: "#С„РµР№СЃС„РёС‚РЅРµСЃ" },
      { label: "28.05", timeLabel: "09:10", value: 8, details: 7, previews: 4, status: "SUCCESS", advertiserName: "Instagram СЃР±РѕСЂ", googleAdvertiserId: "#faceyoga" }
    ]
  };
}

function demoSystemSettings() {
  return {
    id: "default",
    defaultCountries: ["RU", "KZ"],
    scanMode: "FULL" as const,
    dailyScanHour: 3,
    scheduleType: "MANUAL",
    dailyScanHours: [3],
    scanIntervalHours: null,
    requestDelayMs: 1000,
    maxPagesPerRun: null,
    maxCreativesPerRun: null,
    workerConcurrency: 1,
    advertiserDelayMs: 60000,
    probeIntervalMs: 3600000,
    rawSnapshotRetentionDays: 30,
    scanEventRetentionDays: 60,
    exportDefaultFields: ["creativeId", "advertiserName", "appName", "store", "status", "countries"],
    proxyEnabled: false,
    proxyUrl: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function countBy<T>(items: T[], getLabel: (item: T) => string | null | undefined) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = getLabel(item) ?? "UNKNOWN";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function topCountries(creatives: Array<{ countries: Array<{ countryCode: string | null }> }>) {
  const counts = new Map<string, number>();
  for (const creative of creatives) {
    const uniqueCountries = new Set(creative.countries.map((country) => country.countryCode).filter(Boolean) as string[]);
    for (const country of uniqueCountries) counts.set(country, (counts.get(country) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

function normalizeAdvertiser<T extends { selectedCountries: unknown; scanJobs?: Array<{ countries?: unknown; completedCountries?: unknown }> }>(advertiser: T) {
  return {
    ...advertiser,
    selectedCountries: stringList(advertiser.selectedCountries),
    scanJobs: Array.isArray(advertiser.scanJobs) ? advertiser.scanJobs.map(normalizeScanJob) : advertiser.scanJobs
  };
}

function normalizeScanJob<T extends { countries?: unknown; completedCountries?: unknown }>(job: T) {
  return {
    ...job,
    countries: stringList(job.countries),
    completedCountries: stringList(job.completedCountries)
  };
}

function normalizeSearchKeyword<T extends { platforms: unknown; countries: unknown; hashtags: unknown; jobs?: Array<{ countries?: unknown; hashtags?: unknown }> }>(keyword: T) {
  return {
    ...keyword,
    platforms: socialPlatformList(keyword.platforms),
    countries: stringList(keyword.countries),
    hashtags: stringList(keyword.hashtags),
    jobs: Array.isArray(keyword.jobs) ? keyword.jobs.map(normalizeCollectionJob) : keyword.jobs
  };
}

function normalizeCollectionJob<T extends { countries?: unknown; hashtags?: unknown }>(job: T) {
  return {
    ...job,
    countries: stringList(job.countries),
    hashtags: stringList(job.hashtags)
  };
}
