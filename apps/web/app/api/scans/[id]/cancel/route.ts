import { NextResponse } from "next/server";
import { prisma } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const job = await prisma.scanJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.$transaction(async (tx) => {
    const scanJob = await tx.scanJob.update({
      where: { id },
      data: job.status === "QUEUED"
        ? { status: "CANCELED", finishedAt: new Date(), cancelRequested: true }
        : { cancelRequested: true }
    });
    await tx.scanEvent.create({
      data: {
        scanJobId: id,
        level: "info",
        message: "scan-cancel-requested",
        data: {
          code: "scan_cancel_requested",
          requestedFrom: "api",
          previousStatus: job.status
        }
      }
    });
    return scanJob;
  });

  return NextResponse.json({ job: updated });
}
