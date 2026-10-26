import { NextResponse } from "next/server";
import { prisma } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const jobs = await prisma.scanJob.findMany({
    orderBy: { createdAt: "desc" },
    include: { advertiser: true, scans: { orderBy: { startedAt: "desc" }, take: 1 }, events: { orderBy: { createdAt: "desc" }, take: 5 } },
    take: 100
  });
  return NextResponse.json({ jobs });
}
