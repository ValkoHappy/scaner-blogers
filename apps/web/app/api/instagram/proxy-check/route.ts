import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { resolveInstagramHelperAppRoot } from "@/lib/instagram-helper";
import { normalizeProxyUrl } from "@/lib/proxy";

const PYTHON_SCRIPT = String.raw`import json
import os

import requests

proxy = os.environ.get("PROXY_URL", "").strip()
proxies = {"http": proxy, "https": proxy} if proxy else None


def fail(status, message, error_type=None):
    payload = {"ok": False, "status": status, "message": message}
    if error_type:
        payload["errorType"] = error_type
    print(json.dumps(payload, ensure_ascii=False))
    raise SystemExit(0)


try:
    ip_response = requests.get("https://api.ipify.org?format=json", proxies=proxies, timeout=12)
    ip_response.raise_for_status()
    ip = ip_response.json().get("ip")
except Exception as exc:
    name = exc.__class__.__name__
    lowered = str(exc).lower()
    if "getaddrinfo" in lowered or "name or service not known" in lowered or "temporary failure in name resolution" in lowered or "nodename nor servname" in lowered:
        fail("proxy_dns_failed", "The proxy host could not be resolved.", name)
    if "timed out" in lowered or "timeout" in lowered:
        fail("proxy_timeout", "The proxy timed out before returning a response.", name)
    if "connection refused" in lowered or "failed to establish a new connection" in lowered or "proxy" in lowered:
        fail("proxy_connect_failed", "The proxy refused the connection or could not create an outbound tunnel.", name)
    if "ssl" in lowered or "certificate" in lowered:
        fail("ssl_error", "TLS/SSL setup failed during the proxy check.", name)
    fail("proxy_check_failed", str(exc) or name, name)

try:
    instagram = requests.get(
        "https://i.instagram.com/api/v1/si/fetch_headers/?challenge_type=signup&guid=00000000-0000-0000-0000-000000000000",
        proxies=proxies,
        timeout=12,
        headers={"User-Agent": "Instagram 275.0.0.27.98 Android"}
    )
    print(json.dumps({
        "ok": True,
        "status": "proxy_ok",
        "message": "Proxy responded and Instagram endpoint was reachable.",
        "ip": ip,
        "instagramStatus": instagram.status_code,
        "proxyMode": proxy or "direct"
    }, ensure_ascii=False))
except Exception as exc:
    name = exc.__class__.__name__
    lowered = str(exc).lower()
    if "timed out" in lowered or "timeout" in lowered:
        fail("instagram_timeout", "The proxy responded, but Instagram endpoint timed out through it.", name)
    if "ssl" in lowered or "certificate" in lowered:
        fail("instagram_ssl_error", "The proxy worked, but Instagram TLS/SSL handshake failed.", name)
    fail("instagram_unreachable", str(exc) or name, name)
`;

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const proxyUrl = normalizeProxyUrl(searchParams.get("proxyUrl")?.trim() || "");
  const appRoot = resolveInstagramHelperAppRoot({
    cwd: process.cwd(),
    appRootEnv: process.env.SCANER_APP_ROOT
  });
  const pythonBin = process.env.INSTAGRAM_PYTHON_BIN || resolveInstagramPythonBin(appRoot);

  const result = await runProxyCheck(pythonBin, proxyUrl, appRoot);
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" }
  });
}

async function runProxyCheck(pythonBin: string, proxyUrl: string, appRoot: string) {
  return await new Promise<Record<string, unknown>>((resolve) => {
    const child = spawn(pythonBin, ["-c", PYTHON_SCRIPT], {
      cwd: appRoot,
      env: {
        ...process.env,
        PROXY_URL: proxyUrl,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1"
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.once("error", (error) => {
      resolve({
        ok: false,
        status: "proxy_check_spawn_failed",
        message: error instanceof Error ? error.message : String(error),
        proxyMode: proxyUrl || "direct",
        pythonBin
      });
    });

    child.once("close", (code) => {
      try {
        const parsed = JSON.parse(stdout.trim() || "{}") as Record<string, unknown>;
        resolve({
          ...parsed,
          exitCode: code ?? 0,
          proxyMode: parsed.proxyMode || proxyUrl || "direct"
        });
      } catch {
        resolve({
          ok: false,
          status: "proxy_check_invalid_output",
          message: stderr.trim() || stdout.trim() || `proxy check exited with ${code ?? 1}`,
          exitCode: code ?? 1,
          proxyMode: proxyUrl || "direct",
          pythonBin
        });
      }
    });
  });
}

function resolveInstagramPythonBin(appRoot: string) {
  return `${appRoot}\\.venv-instagram\\Scripts\\python.exe`;
}
