import { describe, expect, it } from "vitest";
import { buildSearchCreativesPayload, collectBestPreview, decodeRpcFormBody, encodeRpcFormBody } from "./google-client";

describe("Google Transparency RPC client helpers", () => {
  it("builds SearchCreatives payload with advertiser, country, date range and page token", () => {
    const payload = buildSearchCreativesPayload({
      advertiserId: "AR14577439029227159553",
      geoId: 2826,
      dateRange: { start: "20260516", end: "20260523" },
      pageToken: "NEXT",
      format: "VIDEO",
      platform: "PLAY"
    });

    expect(payload).toEqual({
      "2": 40,
      "3": {
        "4": 3,
        "6": 20260516,
        "7": 20260523,
        "8": [2826],
        "12": { "1": "", "2": true },
        "13": { "1": ["AR14577439029227159553"] },
        "14": [1]
      },
      "4": "NEXT",
      "7": { "1": 1, "2": 26, "3": 2528 }
    });
  });

  it("roundtrips f.req form bodies", () => {
    const payload = { "1": "AR", "2": "CR" };
    const body = encodeRpcFormBody(payload);

    expect(body).toContain("f.req=");
    expect(decodeRpcFormBody(body)).toEqual(payload);
  });

  it("tries preview variants until one contains app metadata", async () => {
    const calls: string[] = [];
    const preview = await collectBestPreview(["empty", "rich"], async (url) => {
      calls.push(url);
      return url === "rich"
        ? { appId: "com.example.app", assets: [] }
        : { assets: [] };
    });

    expect(calls).toEqual(["empty", "rich"]);
    expect(preview).toMatchObject({ appId: "com.example.app" });
  });
});
