import { NextResponse } from "next/server";
import { buildCreativeWhere, parseCreativeFilters, prisma } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const filters = parseCreativeFilters(url.searchParams);

  const creatives = await prisma.creative.findMany({
    where: buildCreativeWhere(filters),
    include: { advertiser: true, app: true, countries: true, assets: true },
    orderBy: { updatedAt: "desc" },
    take: 200
  });

  return NextResponse.json({ creatives });
}
