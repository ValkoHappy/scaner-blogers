import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeConnectionString, sqliteFilePath } from "./prisma";

describe("prisma sqlite path helpers", () => {
  it("keeps in-memory and absolute URLs unchanged", () => {
    expect(normalizeConnectionString(":memory:")).toBe(":memory:");
    expect(normalizeConnectionString("file:/tmp/scaner.db")).toBe("file:/tmp/scaner.db");
  });

  it("resolves relative sqlite URLs against the app root", () => {
    const normalized = normalizeConnectionString("file:./data/scaner.db");
    expect(normalized.startsWith("file:")).toBe(true);
    expect(sqliteFilePath(normalized)).toBe(path.resolve(process.cwd(), "data/scaner.db").replaceAll('\\', '/'));
  });
});
