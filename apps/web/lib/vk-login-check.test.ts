import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runVkAccountLoginCheck, runVkLoginCheck, vkLoginCheckOutcome } from "./vk-login-check";

describe("vk login check", () => {
  it("returns OK when the collector emits vk_token_check_ok", () => {
    expect(vkLoginCheckOutcome({
      exitCode: 0,
      events: [{
        event: {
          level: "info",
          code: "vk_token_check_ok",
          message: "VK token check succeeded",
          data: { groupsFound: 1 }
        }
      }]
    })).toEqual({
      ok: true,
      code: "vk_token_check_ok",
      message: "VK token check succeeded",
      accountStatus: "OK",
      blockedUntil: null
    });
  });

  it("classifies a missing token as missing credentials", () => {
    expect(vkLoginCheckOutcome({
      exitCode: 1,
      events: [{
        event: {
          level: "error",
          code: "vk_missing_token",
          message: "VK_SERVICE_TOKEN, VK_SERVER_TOKEN, VK_ACCESS_TOKEN are not configured"
        }
      }]
    })).toMatchObject({
      ok: false,
      accountStatus: "MISSING_CREDENTIALS",
      code: "vk_missing_token"
    });
  });

  it("classifies IP-bound token errors as blocked", () => {
    expect(vkLoginCheckOutcome({
      exitCode: 1,
      events: [{
        event: {
          level: "error",
          code: "vk_api_request_failed",
          message: "access_token was given to another ip address"
        }
      }]
    })).toMatchObject({
      ok: false,
      accountStatus: "BLOCKED",
      blockedUntil: expect.any(Date),
      code: "vk_api_request_failed"
    });
  });

  it("stores VK_TOKEN_FILE as the preferred token source when only cached OAuth is available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaner-blogers-vk-login-check-"));
    const tokenFile = join(dir, "token.json");
    await writeFile(tokenFile, JSON.stringify({
      accessToken: "vk1.a.test-token",
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
    }), "utf8");

    const upserts: Array<{ create: { metadata?: unknown }, update: { metadata?: unknown } }> = [];
    const db = {
      socialPlatformAccount: {
        upsert: async (args: { create: { metadata?: unknown }, update: { metadata?: unknown } }) => {
          upserts.push(args);
          return args.update;
        }
      }
    };

    await runVkLoginCheck({
      db: db as never,
      env: {
        VK_TOKEN_FILE: tokenFile
      } as unknown as NodeJS.ProcessEnv,
      runCollector: async () => ({
        exitCode: 0,
        events: [{
          event: {
            level: "info",
            code: "vk_token_check_ok",
            message: "VK token check succeeded",
            data: { groupsFound: 1 }
          }
        }]
      })
    });

    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.create.metadata).toMatchObject({
      loginCheck: true,
      preferredToken: "VK_TOKEN_FILE",
      tokenConfigured: true,
      credentialStatus: "READY"
    });
    expect(JSON.stringify(upserts[0]?.create.metadata)).not.toContain("vk1.a.test-token");
  });

  it("rejects service tokens before starting the collector", async () => {
    const updates: Array<{ data: { status: string; lastError?: string | null } }> = [];
    const db = {
      socialPlatformAccount: {
        findFirst: async () => ({
          accountKey: "VK:service",
          metadata: { token: "vk_service_token_placeholder", tokenType: "service" }
        }),
        update: async (args: { data: { status: string; lastError?: string | null } }) => {
          updates.push(args);
          return args.data;
        }
      }
    };
    let collectorCalled = false;

    const result = await runVkAccountLoginCheck({
      accountKey: "VK:service",
      db: db as never,
      runCollector: async () => {
        collectorCalled = true;
        return { exitCode: 0, events: [] };
      }
    });

    expect(result).toMatchObject({ ok: false, code: "vk_user_token_required", accountStatus: "MISSING_CREDENTIALS" });
    expect(collectorCalled).toBe(false);
    expect(updates[0]?.data.status).toBe("MISSING_CREDENTIALS");
  });

  it("refreshes an OAuth token and retries when VK binds it to another IP", async () => {
    let metadata: Record<string, unknown> = {
      enabled: true,
      token: "vk1.a.old-token",
      tokenType: "access",
      refreshToken: "refresh-token",
      clientId: "54643820",
      deviceId: "device-id"
    };
    const collectorTokens: string[] = [];
    const db = {
      socialPlatformAccount: {
        findFirst: async () => ({ accountKey: "VK:oauth", metadata }),
        update: async (args: { data: { metadata?: Record<string, unknown> } }) => {
          if (args.data.metadata) metadata = args.data.metadata;
          return args.data;
        }
      }
    };

    const result = await runVkAccountLoginCheck({
      accountKey: "VK:oauth",
      db: db as never,
      refreshToken: async () => ({
        accessToken: "vk1.a.new-token",
        refreshToken: "new-refresh-token",
        expiresIn: 3600,
        userId: "162927023"
      }),
      runCollector: async ({ env }) => {
        collectorTokens.push(env?.VK_ACCESS_TOKEN ?? "");
        return collectorTokens.length === 1
          ? {
              exitCode: 1,
              events: [{
                event: {
                  level: "error",
                  code: "vk_api_request_failed",
                  message: "access_token was given to another ip address"
                }
              }]
            }
          : {
              exitCode: 0,
              events: [{
                event: {
                  level: "info",
                  code: "vk_token_check_ok",
                  message: "VK token check succeeded"
                }
              }]
            };
      }
    });

    expect(result).toMatchObject({ ok: true, code: "vk_token_check_ok" });
    expect(collectorTokens).toEqual(["vk1.a.old-token", "vk1.a.new-token"]);
    expect(metadata).toMatchObject({
      token: "vk1.a.new-token",
      refreshToken: "new-refresh-token"
    });
  });
  it("checks and updates the exact VK account selected in settings", async () => {
    const updates: Array<{
      where: { accountKey: string };
      data: { status: string; metadata?: unknown; lastError?: string | null };
    }> = [];
    const db = {
      socialPlatformAccount: {
        findFirst: async () => ({
          accountKey: "VK:vk-user-162927023",
          metadata: {
            enabled: true,
            token: "vk1.a.saved-token",
            tokenType: "access"
          }
        }),
        update: async (args: {
          where: { accountKey: string };
          data: { status: string; metadata?: unknown; lastError?: string | null };
        }) => {
          updates.push(args);
          return args.data;
        }
      }
    };
    let collectorEnv: NodeJS.ProcessEnv | undefined;

    const result = await runVkAccountLoginCheck({
      accountKey: "VK:vk-user-162927023",
      db: db as never,
      runCollector: async ({ env }) => {
        collectorEnv = env;
        return {
          exitCode: 0,
          events: [{
            event: {
              level: "info",
              code: "vk_token_check_ok",
              message: "VK token check succeeded"
            }
          }]
        };
      }
    });

    expect(result.ok).toBe(true);
    expect(collectorEnv?.VK_ACCESS_TOKEN).toBe("vk1.a.saved-token");
    expect(collectorEnv?.VK_SERVICE_TOKEN).toBeUndefined();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      where: { accountKey: "VK:vk-user-162927023" },
      data: {
        status: "OK",
        lastError: null,
        metadata: {
          enabled: true,
          token: "vk1.a.saved-token",
          tokenType: "access",
          loginCheck: true
        }
      }
    });
  });
});
