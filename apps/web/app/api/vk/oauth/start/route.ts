import { requireAuth } from "@/lib/auth";
import { inspectVkOAuthRedirectUri, resolveVkOAuthClientId } from "@/lib/vk-oauth-config";
import { getSystemSettings } from "@scaner-blogers/db";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

const STATE_COOKIE = "vk_oauth_state";
const STATE_TTL_SECONDS = 10 * 60;

export async function GET(request: Request) {
  await requireAuth();

  const requestUrl = new URL(request.url);
  const label = requestUrl.searchParams.get("label")?.trim() || null;
  const settings = await getSystemSettings();
  const origin = await requestOrigin(request);
  const client = resolveVkOAuthClientId({
    settingsVkAppId: settings.vkAppId,
    envVkAppId: process.env.VK_APP_ID
  });
  if (!client.activeClientId) {
    return NextResponse.redirect(`${origin}/settings/connect/vk?error=missing_app_id`);
  }
  const redirect = inspectVkOAuthRedirectUri(origin, process.env.VK_OAUTH_REDIRECT_URI);
  if (!redirect.isReady) {
    return NextResponse.redirect(`${origin}/settings/connect/vk?error=redirect_uri_not_ready`);
  }

  const state = randomBytes(24).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const redirectUri = redirect.redirectUri;

  const cookieJar = await cookies();
  cookieJar.set(STATE_COOKIE, JSON.stringify({
    state,
    codeVerifier,
    redirectUri,
    clientId: client.activeClientId,
    label
  }), {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(origin).protocol === "https:",
    path: "/",
    maxAge: STATE_TTL_SECONDS
  });

  const authUrl = new URL("https://id.vk.ru/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", client.activeClientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("scope", process.env.VK_OAUTH_SCOPE?.trim() || "groups wall");

  return NextResponse.redirect(authUrl);
}

async function requestOrigin(request: Request) {
  const envOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");

  const headerList = await headers();
  const proto = headerList.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
  const host = headerList.get("x-forwarded-host") || headerList.get("host") || new URL(request.url).host;
  return `${proto}://${host}`;
}
