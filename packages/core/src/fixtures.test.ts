import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractRpcCalls, parseCreativeDetails, parseSearchCreatives } from "./index";

const fixturesDir = resolve(process.cwd(), "fixtures/api-calls");

describe("captured API fixtures", () => {
  it("extracts known RPC calls from local exports when present", () => {
    if (!existsSync(fixturesDir)) return;
    const files = readdirSync(fixturesDir).filter((file) => file.endsWith(".json"));
    if (!files.length) return;

    const calls = files.flatMap((file) => extractRpcCalls(JSON.parse(readFileSync(resolve(fixturesDir, file), "utf8"))));
    const methods = new Set(calls.map((call) => call.method));

    expect(methods.has("SearchCreatives")).toBe(true);

    const search = calls.find((call) => call.method === "SearchCreatives" && call.response);
    if (search) {
      expect(parseSearchCreatives(search.response).creatives.length).toBeGreaterThan(0);
    }

    const detail = calls.find((call) => call.method === "GetCreativeById" && call.response);
    if (detail) {
      expect(parseCreativeDetails(detail.response).creativeId).toMatch(/^CR/);
    }
  });
});
