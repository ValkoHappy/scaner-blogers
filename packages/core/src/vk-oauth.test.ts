import { describe, expect, it, vi } from "vitest";
import { exchangeVkAuthorizationCode, refreshVkOAuthToken } from "./vk-oauth.js";

describe("VK ID OAuth", () => {
  it("exchanges an authorization code with PKCE and device id", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code_verifier")).toBe("verifier");
      expect(body.get("device_id")).toBe("device");
      return new Response(JSON.stringify({
        access_token: "vk1.a.access",
        refresh_token: "vk1.a.refresh",
        expires_in: 3600,
        user_id: 42
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    await expect(exchangeVkAuthorizationCode({
      clientId: "123",
      code: "code",
      codeVerifier: "verifier",
      deviceId: "device",
      redirectUri: "https://example.test/api/vk/oauth/callback",
      state: "state"
    }, fetchImpl as typeof fetch)).resolves.toEqual({
      accessToken: "vk1.a.access",
      refreshToken: "vk1.a.refresh",
      expiresIn: 3600,
      userId: "42"
    });
  });

  it("refreshes access and refresh tokens", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("old-refresh");
      return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    await expect(refreshVkOAuthToken({
      clientId: "123",
      refreshToken: "old-refresh",
      deviceId: "device",
      state: "state"
    }, fetchImpl as typeof fetch)).resolves.toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh"
    });
  });

  it("does not expose token payloads in exchange errors", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: "invalid_grant",
      error_description: "authorization code expired"
    }), { status: 400, headers: { "content-type": "application/json" } }));

    await expect(refreshVkOAuthToken({
      clientId: "123",
      refreshToken: "secret-refresh-token",
      deviceId: "device",
      state: "state"
    }, fetchImpl as typeof fetch)).rejects.toThrow("vk_oauth_token_exchange_failed:invalid_grant:authorization code expired");
  });
});
