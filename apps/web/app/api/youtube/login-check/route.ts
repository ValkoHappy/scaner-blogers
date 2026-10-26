import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { runYouTubeAccountLoginCheck } from "@/lib/youtube-login-check";

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { accountKey?: unknown } | null;
  const accountKey = typeof body?.accountKey === "string" ? body.accountKey.trim() : "";
  if (!accountKey) return NextResponse.json({ message: "YouTube account key is required" }, { status: 400 });

  const result = await runYouTubeAccountLoginCheck({ accountKey });
  revalidatePath("/settings");
  revalidatePath("/health");
  return NextResponse.json(result);
}
