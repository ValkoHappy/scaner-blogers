import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { runInstagramAccountLoginCheck, runInstagramLoginCheck } from "@/lib/instagram-login-check";

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { accountKey?: unknown; verificationCode?: unknown } | null;
  const accountKey = typeof body?.accountKey === "string" ? body.accountKey.trim() : "";
  const verificationCode = typeof body?.verificationCode === "string"
    ? body.verificationCode.replace(/\s+/g, "").trim().slice(0, 32)
    : "";
  const result = accountKey
    ? await runInstagramAccountLoginCheck({ accountKey, verificationCode: verificationCode || undefined })
    : await runInstagramLoginCheck();
  revalidatePath("/settings");
  revalidatePath("/health");
  return NextResponse.json({
    ok: result.ok,
    code: result.code,
    message: result.message,
    accountStatus: result.accountStatus,
    requiresVerification: "requiresVerification" in result ? result.requiresVerification : false,
    proxySource: "proxySource" in result ? result.proxySource : undefined
  });
}
