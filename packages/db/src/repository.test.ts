import { describe, expect, it } from "vitest";
import { recordScanEvent } from "./repository";

describe("scan repository helpers", () => {
  it("redacts secrets before scan events are stored", async () => {
    const writes: unknown[] = [];
    const db = {
      scanEvent: {
        create: async (input: unknown) => {
          writes.push(input);
          return input;
        }
      }
    };
    const vkToken = "vk1.a." + "x".repeat(85);

    await recordScanEvent({
      scanJobId: "scan-job-1",
      level: "error",
      message: `scan failed access_token=${vkToken} proxy http://user:pass@1.2.3.4:8080`,
      data: {
        code: "dirty_scan",
        authorization: `Bearer ${vkToken}`,
        nested: {
          proxyUrl: "http://user:pass@1.2.3.4:8080",
          note: `api_key=${"AIza" + "SyCVuLxIeUVqz6oTKNToroPvK5ublGWAbhQ"}`
        }
      }
    }, db as never);

    const stored = writes[0] as {
      data: {
        message: string;
        data: {
          authorization: string;
          nested: { proxyUrl: string; note: string };
        };
      };
    };
    expect(stored.data.message).toContain("access_token=***");
    expect(stored.data.message).toContain("http://[redacted]@1.2.3.4:8080");
    expect(stored.data.data.authorization).toBe("[redacted]");
    expect(stored.data.data.nested.proxyUrl).toBe("[redacted]");
    expect(stored.data.data.nested.note).toContain("api_key=***");
    expect(JSON.stringify(stored)).not.toContain(vkToken);
    expect(JSON.stringify(stored)).not.toContain("user:pass");
  });
});
