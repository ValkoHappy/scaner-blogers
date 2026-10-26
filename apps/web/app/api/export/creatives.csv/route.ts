import { NextResponse } from "next/server";
import { findCreatives, parseCreativeFilters, resolveExportFields, type ExportField } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";
import { safeSpreadsheetRows } from "@/lib/export-cell";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const creatives = await findCreatives(parseCreativeFilters(url.searchParams), undefined, 5000);
  const selectedFields = url.searchParams.getAll("fields");
  const fields = resolveExportFields(selectedFields.length ? selectedFields : url.searchParams.get("fields"));

  const rows = [
    fields.map(headerForField),
    ...creatives.map((creative) => fields.map((field) => valueForField(field, creative)))
  ];

  return new NextResponse(`\uFEFF${safeSpreadsheetRows(rows).map(toCsvRow).join("\n")}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=creatives.csv"
    }
  });
}

function toCsvRow(row: string[]) {
  return row.map((cell) => `"${cell.replace(/"/g, "\"\"")}"`).join(",");
}

function headerForField(field: ExportField) {
  return ({
    creativeId: "creative_id",
    advertiserId: "advertiser_id",
    advertiserName: "advertiser_name",
    appId: "app_id",
    appName: "app_name",
    store: "store",
    format: "format",
    status: "status",
    countries: "countries",
    firstShownAt: "first_shown",
    lastShownAt: "last_shown",
    publicDays: "public_days",
    impressions: "impressions",
    previewUrl: "preview_url"
  })[field];
}

function valueForField(field: ExportField, creative: Awaited<ReturnType<typeof findCreatives>>[number]) {
  const values: Record<ExportField, string> = {
    creativeId: creative.creativeId,
    advertiserId: creative.advertiser.googleAdvertiserId,
    advertiserName: creative.advertiser.name ?? "",
    appId: creative.app?.appId ?? "",
    appName: creative.app?.name ?? "",
    store: creative.app?.store ?? "",
    format: creative.format,
    status: creative.status,
    countries: creative.countries.map((country) => country.countryCode ?? country.googleGeoId).join("|"),
    firstShownAt: creative.firstShownAt?.toISOString() ?? "",
    lastShownAt: creative.lastShownAt?.toISOString() ?? "",
    publicDays: String(creative.publicDays ?? ""),
    impressions: [creative.impressionsMin, creative.impressionsMax].filter((value) => value !== null && value !== undefined).join("-"),
    previewUrl: creative.previewUrl ?? ""
  };
  return values[field];
}
