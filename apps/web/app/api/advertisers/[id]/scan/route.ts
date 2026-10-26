import { NextResponse } from "next/server";
import { getSystemSettings, prisma, queueAdvertiserScan } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const advertiser = await prisma.advertiser.findUnique({ where: { id } });
  if (!advertiser) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const settings = await getSystemSettings();

  const countries = Array.isArray(body.countries) ? body.countries.map(String) : [];
  const scanMode = body.scanMode === "FAST" || body.scanMode === "FULL" || body.scanMode === "CAUTIOUS"
    ? body.scanMode
    : advertiser.scanMode ?? settings.scanMode;
  const job = await queueAdvertiserScan(id, countries, {
    scanMode,
    requestDelayMs: advertiser.requestDelayMs ?? settings.requestDelayMs,
    maxPagesPerRun: advertiser.maxPagesPerRun ?? settings.maxPagesPerRun ?? undefined,
    maxCreativesPerRun: advertiser.maxCreativesPerRun ?? settings.maxCreativesPerRun ?? undefined,
    scanStartDate: advertiser.scanStartDate,
    scanEndDate: advertiser.scanEndDate
  });
  return NextResponse.json({ job }, { status: 201 });
}
