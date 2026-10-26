import { NextResponse } from "next/server";
import { prisma } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const apps = await prisma.app.findMany({
    orderBy: { lastSeenAt: "desc" },
    include: { _count: { select: { creatives: true } } }
  });
  return NextResponse.json({ apps });
}
