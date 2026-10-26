import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import vm from "node:vm";
import { NextResponse } from "next/server";
import { prisma } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";
import { buildCandidateProfileWhere } from "@/lib/candidate-profile-filters";
import { candidateStatusValue } from "@/lib/candidate-status";
import { safeSpreadsheetRows } from "@/lib/export-cell";

export const runtime = "nodejs";

type CellValue = string | number;
type XlsxCell = { l?: { Target: string } };
type XlsxSheet = Record<string, unknown> & {
  "!autofilter"?: { ref: string };
  "!cols"?: Array<{ wch: number }>;
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
  const filters = candidateProfileFilters(new URL(request.url).searchParams);

  const profiles = (await prisma.candidateProfile.findMany({
    where: filters,
    orderBy: { lastCollectedAt: "desc" },
    take: 50_000,
    include: { candidate: true, keyword: true }
  })).filter((profile) => matchesMetricFilters(profile.metrics, new URL(request.url).searchParams));

  const rows: CellValue[][] = safeSpreadsheetRows([
    [
      "Площадка",
      "Профиль",
      "Ник",
      "Имя",
      "Подписчики",
      "Score",
      "Сигналы качества",
      "Био",
      "Контакты",
      "Ключ",
      "Хэштег",
      "matched_by",
      "exported_at",
      "Гео",
      "Средние лайки",
      "Средние комментарии",
      "Средние просмотры",
      "Последние посты",
      "Почему подходит",
      "Статус",
      "Просмотрен",
      "Приоритет",
      "Связались",
      "Отклонён",
      "Сохранён",
      "Последний сбор"
    ],
    ...profiles.map((profile) => [
      profile.platform,
      profile.profileUrl,
      profile.username,
      profile.displayName ?? "",
      profile.followers,
      profile.qualityScore,
      qualitySignalsSummary(profile.qualitySignals),
      profile.bio ?? "",
      contactsSummary(profile.contacts),
      profile.keyword?.value ?? profile.sourceKeyword ?? "",
      profile.sourceTag ?? "",
      profile.matchedBy ?? "",
      formatOptionalDateTime(profile.candidate.exportedAt),
      profile.geoGuess ?? "",
      metricValue(profile.metrics, "avgLikes"),
      metricValue(profile.metrics, "avgComments"),
      metricValue(profile.metrics, "avgViews"),
      lastPostsSummary(profile.lastPosts),
      profile.reason ?? "",
      profile.candidate.status,
      formatOptionalDateTime(profile.candidate.reviewedAt),
      formatOptionalDateTime(profile.candidate.priorityAt),
      formatOptionalDateTime(profile.candidate.contactedAt),
      formatOptionalDateTime(profile.candidate.rejectedAt),
      formatOptionalDateTime(profile.candidate.savedAt),
      formatDateTime(profile.lastCollectedAt)
    ])
  ]);

  const XLSX = loadXlsx();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = rows[0].map((_, index) => columnWidth(rows, index));
  if (rows[0]?.length) {
    sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
  }
  addHyperlinks(XLSX, sheet, rows, [1, 17]);

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: "ScanerBlogers Candidates",
    CreatedDate: new Date()
  };
  XLSX.utils.book_append_sheet(workbook, sheet, "candidates");

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer", compression: true }) as Buffer;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="candidates.xlsx"`,
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

function addHyperlinks(XLSX: XlsxRuntime, sheet: XlsxSheet, rows: CellValue[][], indexes: number[]) {
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    for (const columnIndex of indexes) {
      const value = rows[rowIndex]?.[columnIndex];
      if (typeof value !== "string" || !value.startsWith("http")) continue;
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = sheet[address];
      if (cell && typeof cell === "object") (cell as XlsxCell).l = { Target: value };
    }
  }
}

function columnWidth(rows: CellValue[][], index: number) {
  const maxLen = rows.reduce((max, row) => Math.max(max, String(row[index] ?? "").length), 0);
  return { wch: Math.min(maxLen + 2, index === 7 || index === 17 ? 70 : 34) };
}

function contactsSummary(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const contacts = value as { emails?: unknown; phones?: unknown; urls?: unknown };
  return [
    ...stringList(contacts.emails),
    ...stringList(contacts.phones),
    ...stringList(contacts.urls)
  ].join(" | ");
}

function metricValue(value: unknown, key: string) {
  if (!value || typeof value !== "object") return "";
  const metric = (value as Record<string, unknown>)[key];
  return typeof metric === "number" ? Math.round(metric) : "";
}

function lastPostsSummary(value: unknown) {
  if (!Array.isArray(value)) return "";
  return value
    .map((post) => post && typeof post === "object" ? (post as { url?: unknown }).url : undefined)
    .filter((url): url is string => typeof url === "string" && Boolean(url))
    .join(" | ");
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function candidateProfileFilters(params: URLSearchParams) {
  const q = params.get("q")?.trim();
  const status = candidateStatusValue(params.get("status") ?? undefined);
  const platform = socialPlatformValue(params.get("platform") ?? undefined);
  const matchedBy = params.get("matchedBy");
  const minFollowers = positiveIntValue(params.get("minFollowers") ?? undefined);
  const maxFollowers = positiveIntValue(params.get("maxFollowers") ?? undefined);
  const minScore = positiveIntValue(params.get("minScore") ?? undefined);
  const exported = candidateExportFilter(params.get("exported") ?? undefined);
  return {
    ...buildCandidateProfileWhere({
      q,
      status,
      platform,
      matchedBy,
      minFollowers,
      maxFollowers,
      minScore,
      exported
    })
  };
}

function socialPlatformValue(value?: string): "INSTAGRAM" | "VK" | "YOUTUBE" | undefined {
  if (value === "INSTAGRAM") return "INSTAGRAM";
  if (value === "VK") return "VK";
  if (value === "YOUTUBE") return "YOUTUBE";
  return undefined;
}

function qualitySignalsSummary(value: unknown) {
  return stringList(value).join(" | ");
}

function matchesMetricFilters(metrics: unknown, params: URLSearchParams) {
  const minAvgViews = positiveIntValue(params.get("minAvgViews") ?? undefined);
  const minAvgLikes = positiveIntValue(params.get("minAvgLikes") ?? undefined);
  if (minAvgViews && metricNumber(metrics, "avgViews") < minAvgViews) return false;
  if (minAvgLikes && metricNumber(metrics, "avgLikes") < minAvgLikes) return false;
  return true;
}

function positiveIntValue(value?: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function candidateExportFilter(value?: string) {
  if (value === "YES") return "YES";
  if (value === "NO") return "NO";
  return undefined;
}

function metricNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object") return 0;
  const metric = (value as Record<string, unknown>)[key];
  return typeof metric === "number" && Number.isFinite(metric) ? metric : 0;
}

function formatDateTime(value: Date) {
  return value.toISOString();
}

function formatOptionalDateTime(value?: Date | null) {
  return value ? formatDateTime(value) : "";
}
