import { NextResponse } from "next/server";
import { prisma } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";
import { sanitizeEventForClient } from "@/lib/event-sanitize";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const job = await prisma.scanJob.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      cancelRequested: true,
      scanMode: true,
      createdAt: true,
      pagesFetched: true,
      creativesFound: true,
      detailsFetched: true,
      previewsFetched: true,
      events: {
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          id: true,
          level: true,
          message: true,
          createdAt: true,
          data: true
        }
      }
    }
  });

  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    job: {
      ...job,
      events: job.events.map(sanitizeEventForClient)
    }
  }, { headers: { "Cache-Control": "no-store" } });
}
