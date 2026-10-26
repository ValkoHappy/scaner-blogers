import { exchangeVkAuthorizationCode } from "@scaner-blogers/core";
import { prisma, socialPlatformAccountKey } from "@scaner-blogers/db";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { runVkAccountLoginCheck } from "@/lib/vk-login-check";

const STATE_COOKIE = "vk_oauth_state";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = await requestOrigin(request);
  const code = url.searchParams.get("code")?.trim();
  const deviceId = url.searchParams.get("device_id")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const cookieJar = await cookies();
  const stored = readStateCookie(cookieJar.get(STATE_COOKIE)?.value);
  cookieJar.delete(STATE_COOKIE);

  if (!code || !deviceId || !state || !stored || stored.state !== state) {
    return NextResponse.redirect(`${origin}/settings/connect/vk?error=oauth_state_invalid`);
  }

  try {
    const tokens = await exchangeVkAuthorizationCode({
      clientId: stored.clientId,
      code,
      codeVerifier: stored.codeVerifier,
      deviceId,
      redirectUri: stored.redirectUri,
      state
    });
    const userId = tokens.userId;
    const username = userId ? `vk-user-${userId}` : stableOauthUsername(tokens.accessToken);
    const accountKey = socialPlatformAccountKey("vk", username);
    const expiresAt = tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
      : null;
    const metadata = {
      enabled: true,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: "access",
      oauth: true,
      oauthFlow: "vk-id-pkce",
      clientId: stored.clientId,
      deviceId,
      userId,
      expiresAt
    };
    await prisma.socialPlatformAccount.upsert({
      where: { accountKey },
      create: {
        platform: "VK",
        accountKey,
        username,
        label: stored.label || (userId ? `VK ${userId}` : "VK account"),
        status: "UNKNOWN",
        metadata: metadata as never
      },
      update: {
        username,
        ...(stored.label ? { label: stored.label } : {}),
        status: "UNKNOWN",
        blockedUntil: null,
        lastError: null,
        consecutiveErrors: 0,
        metadata: metadata as never
      }
    });
    const verification = await runVkAccountLoginCheck({ accountKey });
    return NextResponse.redirect(`${origin}/settings?vk=${verification.ok ? "connected" : "check_failed"}#accounts`);
  } catch {
    return NextResponse.redirect(`${origin}/settings/connect/vk?error=oauth_exchange_failed`);
  }
}

function readStateCookie(value?: string) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!["state", "codeVerifier", "redirectUri", "clientId"].every((key) => typeof parsed[key] === "string" && parsed[key])) {
      return null;
    }
    return {
      state: String(parsed.state),
      codeVerifier: String(parsed.codeVerifier),
      redirectUri: String(parsed.redirectUri),
      clientId: String(parsed.clientId),
      label: typeof parsed.label === "string" && parsed.label.trim() ? parsed.label.trim() : null
    };
  } catch {
    return null;
  }
}

function stableOauthUsername(token: string) {
  const hash = Array.from(token).reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) >>> 0, 0).toString(16);
  return `vk-oauth-${hash.slice(0, 10)}`;
}

async function requestOrigin(request: Request) {
  const envOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  const headerList = await headers();
  const proto = headerList.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
  const host = headerList.get("x-forwarded-host") || headerList.get("host") || new URL(request.url).host;
  return `${proto}://${host}`;
}
