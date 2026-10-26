import { NextResponse } from "next/server";
import { prisma, queueAdvertiserScan, stringList } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const job = await prisma.scanJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const retry = await queueAdvertiserScan(job.advertiserId, stringList(job.countries), {
    retryOfJobId: job.id,
    scanMode: job.scanMode,
    requestDelayMs: job.requestDelayMs ?? undefined,
    maxPagesPerRun: job.maxPagesPerRun ?? undefined,
    maxCreativesPerRun: job.maxCreativesPerRun ?? undefined,
    scanStartDate: job.scanStartDate,
    scanEndDate: job.scanEndDate,
    retryRequestedFrom: "api"
  });

  return NextResponse.json({ job: retry }, { status: 201 });
}
