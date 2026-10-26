import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { runVkAccountLoginCheck, runVkLoginCheck } from "@/lib/vk-login-check";

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { accountKey?: unknown } | null;
  const accountKey = typeof body?.accountKey === "string" ? body.accountKey.trim() : "";
  const result = accountKey ? await runVkAccountLoginCheck({ accountKey }) : await runVkLoginCheck();
  revalidatePath("/settings");
  revalidatePath("/health");
  return NextResponse.json({
    ok: result.ok,
    code: result.code,
    message: result.message,
    accountStatus: result.accountStatus
  });
}
