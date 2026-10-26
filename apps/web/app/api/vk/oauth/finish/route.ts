import { isAuthenticated } from "@/lib/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const STATE_COOKIE = "vk_oauth_state";

export async function POST() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const cookieJar = await cookies();
  cookieJar.delete(STATE_COOKIE);
  return NextResponse.json({
    ok: false,
    error: "vk_oauth_legacy_callback_disabled",
    message: "Legacy hash-token callback is disabled. Use the canonical server callback /api/vk/oauth/callback so VK access and refresh tokens are saved together."
  }, { status: 410 });
}
