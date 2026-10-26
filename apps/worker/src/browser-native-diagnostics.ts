import { createHash } from "node:crypto";
import path from "node:path";

export type BrowserNativePageState = "normal" | "captcha" | "blocked" | "timeout" | "empty";

export function browserNativeProfileDir(proxyUrl?: string, profileKey?: string) {
  const base = process.env.GOOGLE_BROWSER_PROFILE_DIR ?? ".google-browser-profiles";
  const proxyKey = proxyUrl ? createHash("sha256").update(proxyUrl).digest("hex").slice(0, 16) : "direct";
  const safeProfileKey = profileKey?.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
  const key = safeProfileKey ? `${safeProfileKey}-${proxyKey}` : proxyKey;
  return path.resolve(process.cwd(), base, key);
}

export function classifyBrowserNativeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("browser-native:challenge:")) return "CHALLENGE_REQUIRED" as const;
  if (message.startsWith("browser-native:timeout:")) return "TIMEOUT" as const;
  if (message.startsWith("blocked:")) return "BLOCKED" as const;
  return "FAILED" as const;
}

export function classifyChallengeText(input: string) {
  const text = input.toLowerCase();
  if (
    text.includes("unusual traffic") ||
    text.includes("our systems have detected") ||
    text.includes("recaptcha") ||
    text.includes("captcha") ||
    text.includes("ik ben geen robot") ||
    text.includes("ongebruikelijk verkeer") ||
    text.includes("uw computernetwerk vastgesteld") ||
    text.includes("verify you are human") ||
    text.includes("подтвердите, что вы не робот") ||
    text.includes("необычный трафик")
  ) {
    return "captcha" as const;
  }
  if (
    text.includes("access denied") ||
    text.includes("request blocked") ||
    text.includes("temporarily unavailable") ||
    text.includes("too many requests")
  ) {
    return "blocked" as const;
  }
  return "normal" as const;
}

export function dedupeBrowserItems<T>(
  items: T[],
  getKey: (item: T) => { creativeId?: string | null; creativeUrl?: string | null; appId?: string | null; store?: string | null }
) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const keyData = getKey(item);
    const key = keyData.creativeId
      ? `creative:${keyData.creativeId}`
      : `fallback:${keyData.creativeUrl ?? ""}:${keyData.appId ?? ""}:${keyData.store ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
