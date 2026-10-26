import { describe, expect, it } from "vitest";
import { safeSpreadsheetCell } from "./export-cell";

describe("export cell safety", () => {
  it("prefixes spreadsheet formulas in external text cells", () => {
    expect(safeSpreadsheetCell("=HYPERLINK(\"https://evil.test\")")).toBe("'=HYPERLINK(\"https://evil.test\")");
    expect(safeSpreadsheetCell("+SUM(1,1)")).toBe("'+SUM(1,1)");
    expect(safeSpreadsheetCell("-10+20")).toBe("'-10+20");
    expect(safeSpreadsheetCell("@cmd")).toBe("'@cmd");
    expect(safeSpreadsheetCell("\t=cmd")).toBe("'\t=cmd");
    expect(safeSpreadsheetCell("\r+cmd")).toBe("'\r+cmd");
  });

  it("leaves ordinary text and numbers unchanged", () => {
    expect(safeSpreadsheetCell("face massage")).toBe("face massage");
    expect(safeSpreadsheetCell("https://example.test")).toBe("https://example.test");
    expect(safeSpreadsheetCell(42)).toBe(42);
    expect(safeSpreadsheetCell("")).toBe("");
  });
});
