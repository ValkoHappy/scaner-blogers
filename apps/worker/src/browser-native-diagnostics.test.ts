import { describe, expect, it } from "vitest";
import { browserNativeProfileDir, classifyBrowserNativeError, classifyChallengeText, dedupeBrowserItems } from "./browser-native-diagnostics.js";

describe("browser native diagnostics", () => {
  it("classifies challenge, timeout and blocked errors for proxy health", () => {
    expect(classifyBrowserNativeError(new Error("browser-native:challenge:GooglePage:https://example.com"))).toBe("CHALLENGE_REQUIRED");
    expect(classifyBrowserNativeError(new Error("browser-native:timeout:GooglePage:Timeout 60000ms"))).toBe("TIMEOUT");
    expect(classifyBrowserNativeError(new Error("blocked:GooglePage:429"))).toBe("BLOCKED");
    expect(classifyBrowserNativeError(new Error("boom"))).toBe("FAILED");
  });

  it("detects captcha text from Google challenge pages", () => {
    expect(classifyChallengeText("Our systems have detected unusual traffic from your computer network. reCAPTCHA")).toBe("captcha");
    expect(classifyChallengeText("Ik ben geen robot. Onze systemen hebben ongebruikelijk verkeer vastgesteld.")).toBe("captcha");
    expect(classifyChallengeText("Request blocked because too many requests")).toBe("blocked");
    expect(classifyChallengeText("ScanerBlogers Center")).toBe("normal");
  });

  it("keeps worker browser profiles separated by slot while preserving proxy identity", () => {
    const first = browserNativeProfileDir("socks5://user:pass@example.com:1080", "worker-slot-1-proxy-1");
    const second = browserNativeProfileDir("socks5://user:pass@example.com:1080", "worker-slot-2-proxy-1");
    expect(first).not.toBe(second);
    expect(first).toContain("worker-slot-1-proxy-1");
    expect(second).toContain("worker-slot-2-proxy-1");
  });

  it("dedupes by creative id and fallback browser key", () => {
    const items = dedupeBrowserItems([
      { creativeId: "CR1", creativeUrl: "u1", appId: "a", store: "GOOGLE_PLAY" },
      { creativeId: "CR1", creativeUrl: "u2", appId: "b", store: "APP_STORE" },
      { creativeId: null, creativeUrl: "u3", appId: "a", store: "GOOGLE_PLAY" },
      { creativeId: null, creativeUrl: "u3", appId: "a", store: "GOOGLE_PLAY" }
    ], (item) => item);

    expect(items).toHaveLength(2);
    expect(items[0]?.creativeId).toBe("CR1");
    expect(items[1]?.creativeUrl).toBe("u3");
  });
});
