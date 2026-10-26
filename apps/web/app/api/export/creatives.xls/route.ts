import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import vm from "node:vm";
import { NextResponse } from "next/server";
import { findCreatives, parseCreativeFilters, resolveExportFields, type ExportField } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";
import { safeSpreadsheetRows } from "@/lib/export-cell";

export const runtime = "nodejs";

type CreativeRow = Awaited<ReturnType<typeof findCreatives>>[number];
type CellValue = string | number;
type XlsxCell = { l?: { Target: string } };
type XlsxSheet = Record<string, unknown> & {
  "!autofilter"?: { ref: string };
  "!cols"?: Array<{ wch: number }>;
  "!rows"?: Array<{ hpt: number }>;
};
type XlsxWorkbook = {
  Props?: {
    Title: string;
    CreatedDate: Date;
  };
};
type XlsxRuntime = {
  utils: {
    aoa_to_sheet(rows: CellValue[][]): XlsxSheet;
    book_append_sheet(workbook: XlsxWorkbook, sheet: XlsxSheet, name: string): void;
    book_new(): XlsxWorkbook;
    encode_cell(cell: { r: number; c: number }): string;
    encode_range(range: { s: { r: number; c: number }; e: { r: number; c: number } }): string;
  };
  write(workbook: XlsxWorkbook, options: { bookType: "xlsx"; type: "buffer"; compression: boolean }): unknown;
};

let cachedXlsx: XlsxRuntime | undefined;
const cjsRequire = createRequire(import.meta.url);

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const creatives = await findCreatives(parseCreativeFilters(url.searchParams), undefined, 50_000);
  const selectedFields = url.searchParams.getAll("fields");
  const fields = resolveExportFields(selectedFields.length ? selectedFields : url.searchParams.get("fields"));
  const rows: CellValue[][] = safeSpreadsheetRows([
    fields.map(headerForField),
    ...creatives.map((creative) => fields.map((field) => valueForField(field, creative)))
  ]);

  const XLSX = loadXlsx();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = fields.map((field, index) => columnWidth(field, rows, index));
  sheet["!rows"] = rows.map((_, index) => ({ hpt: index === 0 ? 21 : 18 }));
  if (rows[0]?.length) {
    sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
  }
  addPreviewHyperlinks(XLSX, sheet, fields, rows);

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: "ScanerBlogers Creatives",
    CreatedDate: new Date()
  };
  XLSX.utils.book_append_sheet(workbook, sheet, "creatives");

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer", compression: true }) as Buffer;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="creatives.xlsx"`,
      "cache-control": "no-store"
    }
  });
}

function loadXlsx() {
  if (cachedXlsx) return cachedXlsx;
  const xlsxPath = [
    join(process.cwd(), "chrome-extension", "lib", "xlsx.mini.min.js"),
    join(process.cwd(), "..", "..", "chrome-extension", "lib", "xlsx.mini.min.js")
  ].find((candidate) => existsSync(candidate));
  if (!xlsxPath) throw new Error("XLSX library was not found.");
  const code = readFileSync(xlsxPath, "utf8");
  const cjsModule: { exports: unknown } = { exports: {} };
  vm.runInNewContext(code, {
    module: cjsModule,
    exports: cjsModule.exports,
    require: cjsRequire,
    Buffer,
    ArrayBuffer,
    Uint8Array,
    console
  }, { filename: xlsxPath });
  cachedXlsx = cjsModule.exports as XlsxRuntime;
  return cachedXlsx;
}

function addPreviewHyperlinks(XLSX: XlsxRuntime, sheet: XlsxSheet, fields: ExportField[], rows: CellValue[][]) {
  const previewIndex = fields.indexOf("previewUrl");
  if (previewIndex < 0) return;

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const value = rows[rowIndex]?.[previewIndex];
    if (typeof value !== "string" || !value.startsWith("http")) continue;
    const address = XLSX.utils.encode_cell({ r: rowIndex, c: previewIndex });
    const cell = sheet[address];
    if (cell && typeof cell === "object") (cell as XlsxCell).l = { Target: value };
  }
}

function columnWidth(field: ExportField, rows: CellValue[][], index: number) {
  const maxLen = rows.reduce((max, row, rowIndex) => {
    if (rowIndex === 0) return Math.max(max, String(row[index] ?? "").length);
    const value = String(row[index] ?? "");
    return Math.max(max, value.length);
  }, 0);

  const caps: Partial<Record<ExportField, number>> = {
    creativeId: 22,
    advertiserId: 24,
    advertiserName: 28,
    appId: 28,
    appName: 34,
    store: 14,
    format: 12,
    status: 12,
    countries: 28,
    firstShownAt: 14,
    lastShownAt: 14,
    publicDays: 16,
    impressions: 14,
    previewUrl: 80
  };

  return { wch: Math.min(maxLen + 2, caps[field] ?? 40) };
}

function headerForField(field: ExportField) {
  return ({
    creativeId: "Креатив",
    advertiserId: "ID рекламодателя",
    advertiserName: "Рекламодатель",
    appId: "ID приложения",
    appName: "Приложение",
    store: "Магазин",
    format: "Формат",
    status: "Статус",
    countries: "Страны",
    firstShownAt: "Первый показ",
    lastShownAt: "Последний показ",
    publicDays: "Дней опубликован",
    impressions: "Показы",
    previewUrl: "Preview URL"
  })[field];
}

function valueForField(field: ExportField, creative: CreativeRow): CellValue {
  const values: Record<ExportField, CellValue> = {
    creativeId: creative.creativeId,
    advertiserId: creative.advertiser.googleAdvertiserId,
    advertiserName: creative.advertiser.name ?? "",
    appId: creative.app?.appId ?? "",
    appName: creative.app?.name ?? "",
    store: creative.app?.store ?? "",
    format: creative.format,
    status: creative.status,
    countries: creative.countries.map((country) => country.countryCode ?? country.googleGeoId).join(", "),
    firstShownAt: formatDate(creative.firstShownAt),
    lastShownAt: formatDate(creative.lastShownAt),
    publicDays: creative.publicDays ?? "",
    impressions: [creative.impressionsMin, creative.impressionsMax].filter((value) => value !== null && value !== undefined).join("-"),
    previewUrl: creative.previewUrl ?? ""
  };
  return values[field];
}

function formatDate(value: Date | null) {
  if (!value) return "";
  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${value.getUTCFullYear()}`;
}
