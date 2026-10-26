import { describe, expect, it } from "vitest";
import { normalizeProxyList, normalizeProxyUrl } from "./proxy";

describe("proxy settings normalization", () => {
  it("keeps explicit proxy URLs", () => {
    expect(normalizeProxyUrl("socks5://user:pass@198.51.100.10:8000")).toBe("socks5h://user:pass@198.51.100.10:8000");
    expect(normalizeProxyUrl("http://user:pass@127.0.0.1:8080")).toBe("http://user:pass@127.0.0.1:8080");
  });

  it("converts host:port:user:pass to authenticated SOCKS5", () => {
    expect(normalizeProxyUrl("198.51.100.10:8000:user:pass")).toBe("socks5h://user:pass@198.51.100.10:8000");
  });

  it("preserves colons inside password when converting compact format", () => {
    expect(normalizeProxyUrl("198.51.100.10:8000:user:pa:ss")).toBe("socks5h://user:pa%3Ass@198.51.100.10:8000");
  });

  it("defaults bare host:port values to HTTP proxy", () => {
    expect(normalizeProxyUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });

  it("dedupes proxy pool and drops empty values", () => {
    expect(normalizeProxyList(["", " 198.51.100.10:8000:user:pass ", "socks5://user:pass@198.51.100.10:8000"])).toEqual([
      "socks5h://user:pass@198.51.100.10:8000"
    ]);
  });
});
