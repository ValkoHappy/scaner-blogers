import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { buildInstagramSessionHelperPowerShell, resolveInstagramHelperAppRoot } from "@/lib/instagram-helper";
import { normalizeProxyUrl } from "@/lib/proxy";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const login = searchParams.get("username")?.trim() || "";
  const proxyUrl = normalizeProxyUrl(searchParams.get("proxyUrl")?.trim() || "");
  const appRoot = resolveInstagramHelperAppRoot({
    cwd: process.cwd(),
    appRootEnv: process.env.SCANER_APP_ROOT
  });

  const script = buildInstagramSessionHelperPowerShell({
    appRoot,
    defaultLogin: login,
    proxyUrl
  });

  return new NextResponse(script, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": 'attachment; filename="scanerblogers-instagram-helper.ps1"',
      "cache-control": "no-store"
    }
  });
}
