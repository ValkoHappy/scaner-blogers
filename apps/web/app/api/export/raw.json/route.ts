import { NextResponse } from "next/server";
import { buildCreativeWhere, parseCreativeFilters, prisma } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";
import { sanitizeRawExportSnapshot } from "@/lib/raw-export-sanitize";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const where = buildCreativeWhere(parseCreativeFilters(url.searchParams));
  const requestedLimit = Number(url.searchParams.get("limit"));
  const take = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 5000)
    : 1000;
  const snapshots = await prisma.rawApiSnapshot.findMany({
    where: Object.keys(where).length ? { creative: { is: where } } : undefined,
    orderBy: { createdAt: "desc" },
    take,
    include: { creative: true }
  });

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    count: snapshots.length,
    snapshots: snapshots.map((snapshot) => sanitizeRawExportSnapshot(snapshot))
  });
}
