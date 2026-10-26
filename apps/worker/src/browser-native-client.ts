import {
  normalizeCreative,
  parsePreviewContentJs,
  parseSearchCreatives,
  type NormalizedCreative,
  type ParsedSearchCreatives,
  type PreviewAsset
} from "@scaner-blogers/core";
import { chromium, type BrowserContext, type Page, type Response } from "playwright";
import { enrichAppMetadata } from "./app-metadata.js";
import { browserNativeProfileDir, classifyChallengeText, type BrowserNativePageState } from "./browser-native-diagnostics.js";
import { defaultUserAgent, type GoogleCreativeClient, type GoogleRpcClientOptions, type SearchPayloadInput } from "./google-client.js";
import { normalizeRuntimeProxyUrl, resolvePlaywrightProxy } from "./proxy-bridge.js";

type SearchPage = ParsedSearchCreatives & { consumed?: boolean };
type BrowserNativeDomCreative = ParsedSearchCreatives["creatives"][number] & {
  raw: {
    browserNativeDom: true;
    source: string;
    creativeUrl?: string;
    appId?: string;
    appName?: string;
    store?: "GOOGLE_PLAY" | "APP_STORE" | "UNKNOWN";
    storeUrl?: string;
    title?: string;
    description?: string;
    assets?: Array<{ kind: "LANDSCAPE_IMAGE" | "APP_ICON" | "SCREENSHOT" | "COVER_IMAGE" | "VIDEO" | "LANDING_URL"; url: string }>;
  };
};

export class BrowserNativeGoogleClient implements GoogleCreativeClient {
  private context?: BrowserContext;
  private page?: Page;
  private previewPage?: Page;
  private advertiserPageKey?: string;
  private advertiserId?: string;
  private pages: SearchPage[] = [];
  private seenPageKeys = new Set<string>();
  private seenDomCreativeIds = new Set<string>();
  private domCreatives = new Map<string, BrowserNativeDomCreative>();
  private lastPruneAt = 0;

  constructor(private readonly options: GoogleRpcClientOptions = {}) {}

  async searchCreatives(input: SearchPayloadInput) {
    await this.ensureAdvertiserPage(input);
    const page = await this.nextSearchPage();
    return page;
  }

  async getCreativeById(input: { advertiserId: string; creativeId: string }) {
    return {
      advertiserId: input.advertiserId,
      creativeId: input.creativeId,
      previewUrls: [],
      countries: [],
      format: "UNKNOWN" as const,
      raw: {}
    };
  }

  async fetchPreviewContent(previewUrl: string) {
    const context = await this.ensureContext();
    if (!this.previewPage || this.previewPage.isClosed()) {
      this.previewPage = await context.newPage();
    }
    const response = await this.previewPage.goto(previewUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000
    });
    if (!response?.ok()) {
      throw new Error(`Preview fetch failed with ${response?.status() ?? "no-response"}`);
    }
    return parsePreviewContentJs(await response.text());
  }

  async collectCreative(input: {
    advertiserId: string;
    creativeId: string;
    listCreative?: ParsedSearchCreatives["creatives"][number];
  }): Promise<NormalizedCreative> {
    if (isBrowserNativeDomCreative(input.listCreative)) {
      return enrichAppMetadata(normalizeDomCreative(input.advertiserId, input.listCreative));
    }

    const preview = input.listCreative?.previewUrl
      ? await this.fetchPreviewContent(input.listCreative.previewUrl).catch(() => undefined)
      : undefined;
    const normalized = normalizeCreative({ list: input.listCreative, preview });
    const dom = domRawFromList(input.listCreative);
    return enrichAppMetadata(dom ? applyDomToNormalized(normalized, dom) : normalized);
  }

  async close() {
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
    this.previewPage = undefined;
  }

  private async nextSearchPage() {
    let noChangeCount = 0;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const cached = this.pages.find((item) => !item.consumed);
      if (cached) {
        await this.captureDomBatch();
        cached.creatives = cached.creatives.map((item) => mergeListCreativeWithDom(item, this.domCreatives.get(item.creativeId)));
        cached.consumed = true;
        return cached;
      }
      const pageCountBefore = this.pages.length;
      const expanded = await this.smartScrollStep(pageCountBefore);
      await this.captureDomBatch();
      if (this.pages.length > pageCountBefore) continue;
      noChangeCount = expanded ? 0 : noChangeCount + 1;
      if (noChangeCount >= 20) break;
    }
    throw new Error("browser-native:no-search-results");
  }

  private async ensureAdvertiserPage(input: SearchPayloadInput) {
    const page = await this.ensurePage();
    const pageKey = `${input.advertiserId}:${input.dateRange?.start ?? ""}:${input.dateRange?.end ?? ""}`;
    if (this.advertiserPageKey === pageKey && page.url().startsWith("https://adstransparency.google.com/")) return;

    this.advertiserPageKey = pageKey;
    this.advertiserId = input.advertiserId;
    this.pages = [];
    this.seenPageKeys.clear();
    this.seenDomCreativeIds.clear();
    this.domCreatives.clear();

    const response = await gotoAdvertiser(page, input.advertiserId, input.dateRange);
    await assertPageIsUsable(page, response);
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    await this.smartScrollStep(this.pages.length);
    await this.captureDomBatch();
  }

  private async ensurePage() {
    const context = await this.ensureContext();
    if (!this.page || this.page.isClosed()) {
      this.page = await context.newPage();
      this.page.on("response", async (response) => {
        const url = response.url();
        if (!url.includes("/anji/_/rpc/SearchService/SearchCreatives")) return;
        if (!response.ok()) return;
        try {
          const parsed = parseSearchCreatives(await response.json());
          const key = `${parsed.nextPageToken ?? "last"}:${parsed.creatives.map((item) => item.creativeId).join(",")}`;
          if (!parsed.creatives.length || this.seenPageKeys.has(key)) return;
          this.seenPageKeys.add(key);
          this.pages.push(parsed);
          await this.pruneSeenCards();
        } catch {
          // Ignore non-standard internal responses; the page may issue auxiliary requests.
        }
      });
    }
    return this.page;
  }

  private async ensureContext() {
    if (this.context) return this.context;
    const rawProxyUrl = this.options.proxyUrl ?? (process.env.GOOGLE_PROXY_ENABLED === "true" ? process.env.GOOGLE_PROXY_URL : undefined);
    const proxyUrl = rawProxyUrl ? normalizeRuntimeProxyUrl(rawProxyUrl) : undefined;
    this.context = await chromium.launchPersistentContext(browserNativeProfileDir(proxyUrl, this.options.profileKey), {
      headless: process.env.GOOGLE_BROWSER_HEADLESS !== "false",
      proxy: proxyUrl ? await resolvePlaywrightProxy(proxyUrl) : undefined,
      locale: "ru-RU",
      userAgent: defaultUserAgent(),
      viewport: { width: 1365, height: 900 },
      args: ["--disable-quic", "--webrtc-ip-handling-policy=default_public_interface_only"]
    });
    return this.context;
  }

  private async smartScrollStep(pageCountBefore: number) {
    const page = await this.ensurePage();
    if (process.env.GOOGLE_BROWSER_SCROLL_MODE === "smooth") {
      await page.mouse.wheel(0, 2200).catch(() => undefined);
      await page.waitForTimeout(1100);
      return this.pages.length > pageCountBefore;
    }

    const previous = await pageMetrics(page);
    await page.evaluate(() => {
      window.scrollTo(0, 9_999_999);
      window.dispatchEvent(new Event("scroll"));
    }).catch(() => undefined);

    const checkIntervalMs = 200;
    const maxWaitMs = 4_000;
    for (let waited = 0; waited < maxWaitMs; waited += checkIntervalMs) {
      if (this.pages.length > pageCountBefore) return true;
      await page.waitForTimeout(checkIntervalMs);
      const current = await pageMetrics(page);
      await this.captureDomBatch();
      if (this.pages.length > pageCountBefore) return true;
      if (current.height > previous.height + 50 || current.cards > previous.cards) {
        await page.waitForTimeout(100);
        return true;
      }
    }
    return this.pages.length > pageCountBefore;
  }

  private async captureDomBatch() {
    const page = await this.ensurePage();
    const items: BrowserNativeDomCreative[] = [];
    for (const frame of page.frames()) {
      const frameItems = await frame.evaluate(extractDomCreatives, this.advertiserId).catch((): BrowserNativeDomCreative[] => []);
      for (const item of frameItems) {
        if (!item.creativeId || this.seenDomCreativeIds.has(item.creativeId)) continue;
        this.seenDomCreativeIds.add(item.creativeId);
        this.domCreatives.set(item.creativeId, item);
        items.push(item);
      }
    }
    if (!items.length) return;
    this.pages.push({
      creatives: items,
      nextPageToken: "browser-native-dom-scroll",
      raw: { browserNativeDomBatch: true, count: items.length }
    });
    await this.pruneSeenCards();
  }

  private async pruneSeenCards() {
    if (process.env.GOOGLE_BROWSER_ECONOMY !== "delete") return;
    const now = Date.now();
    if (now - this.lastPruneAt < 1_500) return;
    this.lastPruneAt = now;
    const page = await this.ensurePage();
    await page.evaluate(() => {
      const selectors = [
        "creative-preview",
        "material-card",
        "div[class*='creative']",
        "div[class*='Creative']"
      ];
      const candidates = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
      for (const element of candidates.slice(0, Math.max(0, candidates.length - 8))) {
        const box = element.getBoundingClientRect();
        if (box.bottom < window.innerHeight * 1.5) element.remove();
      }
    }).catch(() => undefined);
  }
}

async function gotoAdvertiser(page: Page, advertiserId: string, dateRange?: SearchPayloadInput["dateRange"]) {
  try {
    return await page.goto(advertiserUrl(advertiserId, dateRange), {
      waitUntil: "domcontentloaded",
      timeout: 60_000
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Timeout") || message.includes("timed out")) {
      throw new Error(`browser-native:timeout:GooglePage:${message}`);
    }
    throw error;
  }
}

function advertiserUrl(advertiserId: string, dateRange?: SearchPayloadInput["dateRange"]) {
  const params = new URLSearchParams({ region: "anywhere" });
  if (dateRange?.start && dateRange.end) {
    params.set("start-date", googleDateToIso(dateRange.start));
    params.set("end-date", googleDateToIso(dateRange.end));
  }
  return `https://adstransparency.google.com/advertiser/${advertiserId}?${params.toString()}`;
}

function googleDateToIso(value: string) {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value;
}

async function assertPageIsUsable(page: Page, response: Response | null) {
  if (!response) throw new Error(`browser-native:timeout:GooglePage:no-response:${page.url()}`);
  if (/google\.[^/]+\/sorry\//i.test(page.url())) throw new Error(`browser-native:challenge:GooglePage:${page.url()}`);
  if ([403, 429].includes(response.status())) throw new Error(`blocked:GooglePage:${response.status()}:${page.url()}`);
  if (!response.ok()) throw new Error(`blocked:GooglePage:${response.status()}:${page.url()}`);

  const state = await detectPageState(page);
  if (state === "captcha") throw new Error(`browser-native:challenge:GooglePage:${page.url()}`);
  if (state === "blocked") throw new Error(`blocked:GooglePage:content:${page.url()}`);
  if (state === "empty") throw new Error(`browser-native:empty:GooglePage:${page.url()}`);
}

async function detectPageState(page: Page): Promise<BrowserNativePageState> {
  const data = await page.evaluate(() => {
    const bodyText = document.body?.innerText ?? "";
    const hasCaptchaFrame = [...document.querySelectorAll("iframe")]
      .some((frame) => /captcha|recaptcha|challenge|sorry/i.test(frame.getAttribute("src") ?? ""));
    const hasCards = document.querySelectorAll("creative-preview, material-card, a[href*='creative'], a[href*='play.google.com'], a[href*='apps.apple.com']").length;
    return { bodyText, hasCaptchaFrame, hasCards };
  }).catch(() => ({ bodyText: "", hasCaptchaFrame: false, hasCards: 0 }));
  if (data.hasCaptchaFrame) return "captcha";
  const textState = classifyChallengeText(data.bodyText);
  if (textState !== "normal") return textState;
  if (!data.bodyText.trim() && data.hasCards === 0) return "empty";
  return "normal";
}

async function pageMetrics(page: Page) {
  return page.evaluate(() => ({
    height: Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight,
      document.body.clientHeight,
      document.documentElement.clientHeight
    ),
    cards: document.querySelectorAll("creative-preview, material-card, a[href*='/creative/'], iframe").length
  })).catch(() => ({ height: 0, cards: 0 }));
}

function isBrowserNativeDomCreative(value: ParsedSearchCreatives["creatives"][number] | undefined): value is BrowserNativeDomCreative {
  return Boolean(value?.raw && typeof value.raw === "object" && (value.raw as { browserNativeDom?: unknown }).browserNativeDom === true);
}

function mergeListCreativeWithDom(
  list: ParsedSearchCreatives["creatives"][number],
  dom: BrowserNativeDomCreative | undefined
): ParsedSearchCreatives["creatives"][number] {
  if (!dom || isBrowserNativeDomCreative(list)) return list;
  return {
    ...list,
    previewUrl: list.previewUrl ?? dom.previewUrl,
    format: list.format !== "UNKNOWN" ? list.format : dom.format,
    raw: {
      list: list.raw,
      dom: dom.raw
    }
  };
}

function normalizeDomCreative(advertiserId: string, item: BrowserNativeDomCreative): NormalizedCreative {
  const assets = dedupeDomAssets(item.raw.assets ?? []);
  const app = item.raw.store && item.raw.store !== "UNKNOWN" ? {
    appId: item.raw.appId,
    appName: item.raw.appName ?? item.raw.title,
    store: item.raw.store,
    storeUrl: item.raw.storeUrl,
    description: item.raw.description
  } : undefined;

  return {
    advertiserId: item.advertiserId || advertiserId,
    advertiserName: item.advertiserName,
    creativeId: item.creativeId,
    format: item.format,
    status: "ACTIVE",
    previewUrls: item.previewUrl ? [item.previewUrl] : [],
    firstShownAt: item.firstShownAt,
    lastShownAt: item.lastShownAt,
    app,
    countries: [],
    assets,
    raw: {
      list: item.raw,
      preview: {
        source: item.raw.source,
        appId: item.raw.appId ?? "",
        appName: item.raw.appName ?? "",
        appStoreName: item.raw.store === "GOOGLE_PLAY" ? "Google Play" : item.raw.store === "APP_STORE" ? "App Store" : "",
        storeUrl: item.raw.storeUrl ?? "",
        description: item.raw.description ?? "",
        destination_url: item.raw.storeUrl ?? item.raw.creativeUrl ?? ""
      }
    }
  };
}

function domRawFromList(list: ParsedSearchCreatives["creatives"][number] | undefined): BrowserNativeDomCreative["raw"] | undefined {
  const raw = list?.raw;
  if (!raw || typeof raw !== "object") return undefined;
  const dom = (raw as { dom?: unknown }).dom;
  if (!dom || typeof dom !== "object") return undefined;
  return (dom as { browserNativeDom?: unknown }).browserNativeDom === true ? dom as BrowserNativeDomCreative["raw"] : undefined;
}

function applyDomToNormalized(normalized: NormalizedCreative, dom: BrowserNativeDomCreative["raw"]): NormalizedCreative {
  const assets = dedupeDomAssets([
    ...normalized.assets,
    ...(dom.assets ?? [])
  ]);
  const domApp = dom.store && dom.store !== "UNKNOWN" ? {
    appId: dom.appId,
    appName: dom.appName ?? dom.title,
    store: dom.store,
    storeUrl: dom.storeUrl,
    description: dom.description
  } : undefined;

  return {
    ...normalized,
    format: normalized.format !== "UNKNOWN" ? normalized.format : assets.some((asset) => asset.kind === "VIDEO") ? "VIDEO" : assets.length ? "IMAGE" : "UNKNOWN",
    app: normalized.app ?? domApp,
    assets,
    raw: {
      ...normalized.raw,
      list: normalized.raw.list,
      preview: {
        ...(normalized.raw.preview ?? {}),
        domSource: dom.source,
        domCreativeUrl: dom.creativeUrl ?? "",
        domStoreUrl: dom.storeUrl ?? "",
        domAppId: dom.appId ?? "",
        domAppName: dom.appName ?? "",
        domDescription: dom.description ?? ""
      }
    }
  };
}

function dedupeDomAssets(assets: PreviewAsset[]): PreviewAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = `${asset.kind}:${asset.url}`;
    if (!asset.url || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractDomCreatives(advertiserId?: string): BrowserNativeDomCreative[] {
  type DomAsset = NonNullable<BrowserNativeDomCreative["raw"]["assets"]>[number];

  const decode = (value: string) => {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    const htmlDecoded = textarea.value.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    try {
      return decodeURIComponent(htmlDecoded);
    } catch {
      return htmlDecoded;
    }
  };

  const absoluteUrl = (value?: string | null) => {
    if (!value) return undefined;
    const cleaned = decode(value.trim());
    if (!cleaned || cleaned.startsWith("data:")) return undefined;
    try {
      return new URL(cleaned, location.origin).href;
    } catch {
      return undefined;
    }
  };

  const text = (root: Element, selectors: string[]) => {
    for (const selector of selectors) {
      const value = root.querySelector(selector)?.textContent?.trim();
      if (value) return value;
    }
    return undefined;
  };

  const extractCreativeId = (source: string) => source.match(/CR\d{10,}/)?.[0];

  const extractStoreUrl = (source: string) => {
    const decoded = decode(source);
    const direct = decoded.match(/https?:\/\/(?:play\.google\.com\/store\/apps\/details\?id=[^"'<>\s\\]+|apps\.apple\.com\/[^"'<>\s\\]+|itunes\.apple\.com\/[^"'<>\s\\]+)/i)?.[0];
    if (direct) return direct;
    const market = decoded.match(/market:\/\/details\?id=([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+)/i)?.[0];
    return market ? `https://play.google.com/store/apps/details?id=${market.match(/id=([^&]+)/)?.[1]}` : undefined;
  };

  const storeFromUrl = (storeUrl?: string) => {
    const lower = storeUrl?.toLowerCase() ?? "";
    if (lower.includes("play.google.com") || lower.startsWith("market://")) return "GOOGLE_PLAY" as const;
    if (lower.includes("apps.apple.com") || lower.includes("itunes.apple.com")) return "APP_STORE" as const;
    return "UNKNOWN" as const;
  };

  const appIdFromUrl = (storeUrl?: string) => {
    if (!storeUrl) return undefined;
    try {
      const url = new URL(storeUrl);
      if (url.hostname.includes("play.google.com")) return url.searchParams.get("id") ?? undefined;
      return url.pathname.match(/\/id(\d+)/)?.[1];
    } catch {
      return storeUrl.match(/[?&]id=([^&\s]+)/)?.[1] ?? storeUrl.match(/\/id(\d+)/)?.[1];
    }
  };

  const pushAsset = (assets: DomAsset[], kind: DomAsset["kind"], rawUrl?: string | null) => {
    const url = absoluteUrl(rawUrl);
    if (url) assets.push({ kind, url });
  };

  const extractAssets = (root: Element, source: string) => {
    const assets: DomAsset[] = [];
    root.querySelectorAll("img[src]").forEach((item) => pushAsset(assets, "LANDSCAPE_IMAGE", item.getAttribute("src")));
    root.querySelectorAll("video[src], source[src]").forEach((item) => pushAsset(assets, "VIDEO", item.getAttribute("src")));
    root.querySelectorAll("[style*='url(']").forEach((item) => {
      const match = item.getAttribute("style")?.match(/url\((['"]?)(.*?)\1\)/i);
      pushAsset(assets, "LANDSCAPE_IMAGE", match?.[2]);
    });
    for (const match of decode(source).matchAll(/https?:\/\/[^"'<>\s\\]+(?:googleusercontent\.com|ytimg\.com|ggpht\.com|googlevideo\.com)[^"'<>\s\\]*/gi)) {
      pushAsset(assets, /googlevideo|youtube|ytimg/i.test(match[0]) ? "VIDEO" : "LANDSCAPE_IMAGE", match[0]);
    }
    const storeUrl = extractStoreUrl(source);
    pushAsset(assets, "LANDING_URL", storeUrl);
    const seen = new Set<string>();
    return assets.filter((asset) => {
      const key = `${asset.kind}:${asset.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const roots = [
    ...document.querySelectorAll("creative-preview, [class*='creative-preview'], .creative-bounding-box, .mys-wrapper, c-wiz[data-p], material-card"),
    ...[...document.querySelectorAll("a[href*='/creative/']")].map((item) => item.closest("creative-preview, material-card, c-wiz, .creative-bounding-box, .mys-wrapper") ?? item)
  ];

  const output = new Map<string, BrowserNativeDomCreative>();
  for (const root of roots) {
    const html = (root as HTMLElement).outerHTML ?? "";
    const bodyText = root.textContent ?? "";
    const creativeUrl = absoluteUrl(root.querySelector("a[href*='/creative/']")?.getAttribute("href")) ?? absoluteUrl((root as HTMLAnchorElement).href);
    const creativeId = extractCreativeId(`${creativeUrl ?? ""} ${bodyText} ${html}`);
    if (!creativeId) continue;

    const storeUrl = extractStoreUrl(html) ?? absoluteUrl(root.querySelector("a[href*='play.google.com'], a[href*='apps.apple.com'], a[href*='itunes.apple.com'], a[href^='market://']")?.getAttribute("href"));
    const store = storeFromUrl(storeUrl);
    const appId = appIdFromUrl(storeUrl) ?? html.match(/\b([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+){1,})\b/i)?.[1];
    const appName = text(root, [
      ".short-app-name a",
      ".end-frame-app-name-v0 span",
      "[data-asoch-targets*='ochAppName']",
      "[data-asoch-targets*='ochEndCardAppName']",
      ".app-name",
      "[aria-label*='Google Play']"
    ]);
    const description = text(root, [
      ".headline [dir='auto']",
      ".headline",
      "[data-asoch-targets*='ochBody']",
      "[data-asoch-targets*='ochDescription']",
      ".description",
      ".app-description"
    ]);
    const assets = extractAssets(root, html);
    const previewUrl = absoluteUrl(root.querySelector("iframe[src*='googleusercontent'], iframe[src*='preview']")?.getAttribute("src"));
    const hasVideo = assets.some((asset) => asset.kind === "VIDEO") || Boolean(root.querySelector("video, iframe[src*='youtube'], [aria-label*='video' i]"));

    output.set(creativeId, {
      advertiserId: advertiserId ?? "",
      creativeId,
      previewUrl,
      format: hasVideo ? "VIDEO" : assets.some((asset) => asset.kind !== "LANDING_URL") ? "IMAGE" : "UNKNOWN",
      raw: {
        browserNativeDom: true,
        source: "dom_card",
        creativeUrl,
        appId,
        appName,
        store,
        storeUrl,
        title: appName,
        description,
        assets
      }
    });
  }

  return [...output.values()];
}
