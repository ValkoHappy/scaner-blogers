import { NextResponse } from "next/server";
import { prisma } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";
import { sanitizeEventForClient } from "@/lib/event-sanitize";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const job = await prisma.collectionJob.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      cancelRequested: true,
      platform: true,
      createdAt: true,
      profilesChecked: true,
      candidatesFound: true,
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
      id: job.id,
      status: job.status,
      cancelRequested: job.cancelRequested,
      scanMode: job.platform,
      createdAt: job.createdAt,
      pagesFetched: job.profilesChecked,
      creativesFound: job.candidatesFound,
      detailsFetched: job.profilesChecked,
      previewsFetched: 0,
      events: job.events.map(sanitizeEventForClient)
    }
  }, { headers: { "Cache-Control": "no-store" } });
}
