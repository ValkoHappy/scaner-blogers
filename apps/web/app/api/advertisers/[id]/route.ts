import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@scaner-blogers/db";
import { isAuthenticated } from "@/lib/auth";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const advertiser = await prisma.advertiser.findFirst({
    where: {
      OR: [
        { id },
        { googleAdvertiserId: id }
      ]
    },
    select: {
      id: true,
      scanJobs: {
        where: { status: { in: ["QUEUED", "RUNNING"] } },
        select: { id: true },
        take: 1
      }
    }
  });

  if (!advertiser) {
    return NextResponse.json({ error: "Advertiser not found." }, { status: 404 });
  }

  if (advertiser.scanJobs.length) {
    return NextResponse.json(
      { error: "Сначала отмените или дождитесь завершения активного сканирования." },
      { status: 409 }
    );
  }

  await prisma.advertiser.delete({ where: { id: advertiser.id } });
  revalidatePath("/");
  revalidatePath("/advertisers");
  revalidatePath("/creatives");
  revalidatePath("/scans");
  revalidatePath("/export");

  return NextResponse.json({ ok: true });
}
