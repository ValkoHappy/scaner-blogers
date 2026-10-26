import { describe, expect, it } from "vitest";
import { sanitizeRawExportSnapshot } from "./raw-export-sanitize";

describe("raw export sanitization", () => {
  it("redacts secret-like payloads before raw snapshots are exported", () => {
    const vkToken = "vk1.a." + "w".repeat(85);

    const snapshot = sanitizeRawExportSnapshot({
      id: "raw-1",
      kind: "SEARCH_CREATIVES",
      payload: {
        accessToken: vkToken,
        proxyUrl: "http://user:pass@1.2.3.4:8080",
        nested: {
          message: `api_key=${"AIza" + "SyCVuLxIeUVqz6oTKNToroPvK5ublGWAbhQ"} access_token=${vkToken}`
        }
      },
      creative: {
        id: "creative-1",
        rawDetail: {
          authorization: `Bearer ${vkToken}`
        }
      }
    });

    expect(snapshot.payload).toEqual({
      accessToken: "[redacted]",
      proxyUrl: "[redacted]",
      nested: {
        message: "api_key=*** access_token=***"
      }
    });
    expect(snapshot.creative.rawDetail).toEqual({
      authorization: "[redacted]"
    });
    expect(JSON.stringify(snapshot)).not.toContain(vkToken);
    expect(JSON.stringify(snapshot)).not.toContain("user:pass");
  });
});
