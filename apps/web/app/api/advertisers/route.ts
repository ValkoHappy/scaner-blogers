import { NextResponse } from "next/server";
import { prisma, upsertAdvertiser } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const advertisers = await prisma.advertiser.findMany({ orderBy: { updatedAt: "desc" } });
  return NextResponse.json({ advertisers });
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const advertiser = await upsertAdvertiser({
    input: String(body.input ?? ""),
    name: body.name ? String(body.name) : undefined,
    selectedCountries: Array.isArray(body.selectedCountries) ? body.selectedCountries.map(String) : [],
    scanStartDate: dateValue(body.scanStartDate),
    scanEndDate: dateValue(body.scanEndDate)
  });
  return NextResponse.json({ advertiser }, { status: 201 });
}

function dateValue(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}
