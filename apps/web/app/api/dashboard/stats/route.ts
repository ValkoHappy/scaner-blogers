import { NextResponse } from "next/server";
import { prisma } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [advertisers, creatives, activeCreatives, apps, scans] = await Promise.all([
    prisma.advertiser.count(),
    prisma.creative.count(),
    prisma.creative.count({ where: { status: "ACTIVE" } }),
    prisma.app.count(),
    prisma.scan.count()
  ]);
  return NextResponse.json({ advertisers, creatives, activeCreatives, apps, scans });
}
