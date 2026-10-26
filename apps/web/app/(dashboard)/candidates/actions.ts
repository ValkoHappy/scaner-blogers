"use server";

import { prisma } from "@scaner-blogers/db";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { candidateExportUpdateData, candidateReviewUpdateData } from "@/lib/candidate-review";
import { candidateReviewActionStatusValue } from "@/lib/candidate-status";

export async function updateCandidateStatusAction(formData: FormData) {
  await requireAuth();
  const candidateIds = formData
    .getAll("candidateId")
    .map((value) => String(value).trim())
    .filter(Boolean);
  if (!candidateIds.length) return;
  if (formData.get("intent") === "mark_exported") {
    await prisma.candidate.updateMany({
      where: { id: { in: [...new Set(candidateIds)] } },
      data: candidateExportUpdateData()
    });

    revalidatePath("/candidates");
    return;
  }

  const status = candidateReviewActionStatusValue(formData.get("status"));
  if (!status) return;

  await prisma.candidate.updateMany({
    where: { id: { in: [...new Set(candidateIds)] } },
    data: candidateReviewUpdateData(status)
  });

  revalidatePath("/candidates");
}
