import { NextResponse } from "next/server";
import { prisma } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const creative = await prisma.creative.findUnique({
    where: { creativeId: id },
    include: {
      advertiser: true,
      app: true,
      countries: true,
      assets: true,
      rawSnapshots: { orderBy: { createdAt: "desc" } }
    }
  });
  if (!creative) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ creative });
}
