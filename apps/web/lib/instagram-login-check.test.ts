import { describe, expect, it } from "vitest";
import {
  instagramLoginCheckOutcome,
  resolveInstagramLoginCheckProxy,
  runInstagramAccountLoginCheck,
  runInstagramLoginCheck
} from "./instagram-login-check";

const okEvent = {
  event: {
    level: "info" as const,
    code: "instagram_login_check_ok",
    message: "Instagram login/session check succeeded"
  },
  collectedAt: "2026-05-28T16:20:00.000Z"
};

describe("instagram login check admin service", () => {
  it("uses env proxy before settings and database pool", async () => {
    const previousProxy = process.env.INSTAGRAM_PROXY_URL;
    process.env.INSTAGRAM_PROXY_URL = "http://env-proxy.local:8000";
    const db = {
      systemSettings: {
        upsert: async () => ({ proxyEnabled: true, proxyUrl: "http://settings-proxy.local:8000" })
      },
      proxyEndpoint: {
        findFirst: async () => {
          throw new Error("pool should not be queried when env proxy exists");
        }
      }
    };

    try {
      await expect(resolveInstagramLoginCheckProxy(db as never)).resolves.toEqual({
        source: "env",
        url: "http://env-proxy.local:8000"
      });
    } finally {
      if (previousProxy === undefined) delete process.env.INSTAGRAM_PROXY_URL;
      else process.env.INSTAGRAM_PROXY_URL = previousProxy;
    }
  });

  it("falls back to a healthy proxy pool entry when settings proxy is empty", async () => {
    const previousProxy = process.env.INSTAGRAM_PROXY_URL;
    delete process.env.INSTAGRAM_PROXY_URL;
    const updates: unknown[] = [];
    const db = {
      systemSettings: {
        upsert: async () => ({ proxyEnabled: true, proxyUrl: null })
      },
      proxyEndpoint: {
        findFirst: async () => ({ id: "proxy-1", url: "http://pool-proxy.local:8000" }),
        update: async (input: unknown) => {
          updates.push(input);
          return input;
        }
      }
    };

    try {
      await expect(resolveInstagramLoginCheckProxy(db as never)).resolves.toEqual({
        id: "proxy-1",
        source: "pool",
        url: "http://pool-proxy.local:8000"
      });
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({
        where: { id: "proxy-1" }
      });
    } finally {
      if (previousProxy === undefined) delete process.env.INSTAGRAM_PROXY_URL;
      else process.env.INSTAGRAM_PROXY_URL = previousProxy;
    }
  });

  it("maps challenge errors to a failed outcome without cooldown", () => {
    const now = new Date("2026-06-02T09:00:00.000Z");
    expect(instagramLoginCheckOutcome({
      exitCode: 2,
      events: [{
        event: {
          level: "error",
          code: "challenge_required",
          message: "instagram_login_check failed: checkpoint"
        }
      }]
    }, now)).toMatchObject({
      ok: false,
      code: "challenge_required",
      accountStatus: "FAILED",
      blockedUntil: null,
      requiresVerification: true
    });
  });

  it("pauses Instagram for a full day after automation warnings", () => {
    const now = new Date("2026-06-02T09:00:00.000Z");
    expect(instagramLoginCheckOutcome({
      exitCode: 2,
      events: [{
        event: {
          level: "error",
          code: "automation_warning",
          message: "Instagram warned about automated behavior"
        }
      }]
    }, now)).toMatchObject({
      ok: false,
      accountStatus: "BLOCKED",
      blockedUntil: new Date("2026-06-03T09:00:00.000Z")
    });
  });

  it("records OK account state when login-check succeeds", async () => {
    const upserts: unknown[] = [];
    const db = {
      systemSettings: {
        upsert: async () => ({ proxyEnabled: false, proxyUrl: null })
      },
      proxyEndpoint: {
        findFirst: async () => null
      },
      socialPlatformAccount: {
        upsert: async (input: unknown) => {
          upserts.push(input);
          return input;
        }
      }
    };

    const result = await runInstagramLoginCheck({
      db: db as never,
      env: { ...process.env, INSTAGRAM_USERNAME: "test_instagram_user" },
      runCollector: async () => ({ exitCode: 0, events: [okEvent] })
    });

    expect(result.ok).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      create: { status: "OK", username: "test_instagram_user" },
      update: { status: "OK", username: "test_instagram_user" }
    });
  });

  it("checks and updates the exact Instagram account selected in settings", async () => {
    const updates: unknown[] = [];
    let collectorInput: { proxyUrl?: string; env?: NodeJS.ProcessEnv } | undefined;
    const db = {
      systemSettings: {
        upsert: async () => ({ proxyEnabled: true, proxyUrl: null })
      },
      socialPlatformAccount: {
        findFirst: async () => ({
          accountKey: "INSTAGRAM:test_instagram_user",
          blockedUntil: null,
          metadata: {
            enabled: true,
            username: "test_instagram_user",
            sessionId: "browser-session",
            sessionFile: ".instagram/test.session.json",
            proxyUrl: "http://proxy.local:8000"
          }
        }),
        update: async (input: unknown) => {
          updates.push(input);
          return input;
        }
      }
    };

    const result = await runInstagramAccountLoginCheck({
      accountKey: "INSTAGRAM:test_instagram_user",
      db: db as never,
      runCollector: async (input) => {
        collectorInput = input;
        return { exitCode: 0, events: [okEvent] };
      }
    });

    expect(result.ok).toBe(true);
    expect(collectorInput).toMatchObject({
      proxyUrl: "http://proxy.local:8000",
      env: {
        INSTAGRAM_USERNAME: "test_instagram_user",
        INSTAGRAM_SESSIONID: "browser-session",
        INSTAGRAM_SESSION_FILE: ".instagram/test.session.json"
      }
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      where: { accountKey: "INSTAGRAM:test_instagram_user" },
      data: {
        status: "OK",
        lastError: null,
        metadata: {
          enabled: true,
          loginCheck: true
        }
      }
    });
  });

  it("passes full session settings to the collector when the account has no password", async () => {
    let collectorInput: { proxyUrl?: string; env?: NodeJS.ProcessEnv } | undefined;
    const sessionSettings = JSON.stringify({
      uuids: { phone_id: "phone-id-placeholder" },
      authorization_data: { ds_user_id: "123" }
    });
    const db = {
      systemSettings: {
        upsert: async () => ({ proxyEnabled: true, proxyUrl: null })
      },
      socialPlatformAccount: {
        findFirst: async () => ({
          accountKey: "INSTAGRAM:test_instagram_user",
          blockedUntil: null,
          metadata: {
            enabled: true,
            username: "test_instagram_user",
            sessionSettings,
            sessionFile: ".instagram/test.session.json",
            proxyUrl: "http://proxy.local:8000"
          }
        }),
        update: async (input: unknown) => input
      }
    };

    const result = await runInstagramAccountLoginCheck({
      accountKey: "INSTAGRAM:test_instagram_user",
      db: db as never,
      runCollector: async (input) => {
        collectorInput = input;
        return { exitCode: 0, events: [okEvent] };
      }
    });

    expect(result.ok).toBe(true);
    expect(collectorInput?.env?.INSTAGRAM_SESSION_SETTINGS_B64).toBe(Buffer.from(sessionSettings, "utf8").toString("base64"));
    expect(collectorInput?.env?.INSTAGRAM_PASSWORD).toBeUndefined();
  });

  it("passes a one-time verification code to the selected account check without persisting it", async () => {
    let collectorInput: { proxyUrl?: string; env?: NodeJS.ProcessEnv } | undefined;
    const updates: unknown[] = [];
    const db = {
      systemSettings: {
        upsert: async () => ({ proxyEnabled: false, proxyUrl: null })
      },
      socialPlatformAccount: {
        findFirst: async () => ({
          accountKey: "INSTAGRAM:test_instagram_user",
          blockedUntil: new Date("2099-01-01T00:00:00.000Z"),
          metadata: {
            enabled: true,
            username: "test_instagram_user",
            sessionId: "browser-session",
            sessionFile: ".instagram/test.session.json"
          }
        }),
        update: async (input: unknown) => {
          updates.push(input);
          return input;
        }
      }
    };

    const result = await runInstagramAccountLoginCheck({
      accountKey: "INSTAGRAM:test_instagram_user",
      verificationCode: "123456",
      db: db as never,
      runCollector: async (input) => {
        collectorInput = input;
        return { exitCode: 0, events: [okEvent] };
      }
    });

    expect(result.ok).toBe(true);
    expect(collectorInput?.env?.INSTAGRAM_VERIFICATION_CODE).toBe("123456");
    expect(updates).toHaveLength(1);
    expect(JSON.stringify(updates[0])).not.toContain("123456");
  });
  it("uses the shared proxy pool when a selected Instagram account has no own proxy", async () => {
    const previousProxy = process.env.INSTAGRAM_PROXY_URL;
    delete process.env.INSTAGRAM_PROXY_URL;
    let collectorInput: { proxyUrl?: string; env?: NodeJS.ProcessEnv } | undefined;
    const updates: unknown[] = [];
    const db = {
      systemSettings: {
        upsert: async () => ({ proxyEnabled: true, proxyUrl: null })
      },
      proxyEndpoint: {
        findFirst: async () => ({ id: "proxy-1", url: "http://pool-proxy.local:8000" }),
        update: async (input: unknown) => {
          updates.push(input);
          return input;
        }
      },
      socialPlatformAccount: {
        findFirst: async () => ({
          accountKey: "INSTAGRAM:test_instagram_user",
          blockedUntil: null,
          metadata: {
            enabled: true,
            username: "test_instagram_user",
            sessionId: "browser-session",
            sessionFile: ".instagram/test.session.json"
          }
        }),
        update: async (input: unknown) => {
          updates.push(input);
          return input;
        }
      }
    };

    try {
      const result = await runInstagramAccountLoginCheck({
        accountKey: "INSTAGRAM:test_instagram_user",
        db: db as never,
        runCollector: async (input) => {
          collectorInput = input;
          return { exitCode: 0, events: [okEvent] };
        }
      });

      expect(result).toMatchObject({ ok: true, proxySource: "pool" });
      expect(collectorInput).toMatchObject({
        proxyUrl: "http://pool-proxy.local:8000"
      });
      expect(updates).toEqual(expect.arrayContaining([
        expect.objectContaining({ where: { id: "proxy-1" } }),
        expect.objectContaining({
          where: { accountKey: "INSTAGRAM:test_instagram_user" },
          data: expect.objectContaining({
            status: "OK",
            metadata: expect.objectContaining({
              loginCheckProxySource: "pool",
              loginCheckProxyId: "proxy-1"
            })
          })
        })
      ]));
    } finally {
      if (previousProxy === undefined) delete process.env.INSTAGRAM_PROXY_URL;
      else process.env.INSTAGRAM_PROXY_URL = previousProxy;
    }
  });

  it("treats mixed auth state as reconnect-required instead of silently picking one source", async () => {
    const updates: unknown[] = [];
    const db = {
      socialPlatformAccount: {
        findFirst: async () => ({
          accountKey: "INSTAGRAM:test_instagram_user",
          blockedUntil: null,
          metadata: {
            enabled: true,
            username: "test_instagram_user",
            sessionId: "browser-session",
            sessionSettings: '{"uuids":{}}',
            sessionFile: ".instagram/test.session.json"
          }
        }),
        update: async (input: unknown) => {
          updates.push(input);
          return input;
        }
      }
    };

    const result = await runInstagramAccountLoginCheck({
      accountKey: "INSTAGRAM:test_instagram_user",
      db: db as never,
      runCollector: async () => {
        throw new Error("collector should not run for mixed auth state");
      }
    });

    expect(result).toMatchObject({
      ok: false,
      code: "instagram_mixed_auth_state",
      accountStatus: "MISSING_CREDENTIALS"
    });
    expect(updates).toHaveLength(1);
  });
  it("rejects password-only accounts until helper session is reconnected", async () => {
    let collectorCalled = false;
    const updates: unknown[] = [];
    const db = {
      socialPlatformAccount: {
        findFirst: async () => ({
          accountKey: "INSTAGRAM:legacy_password_user",
          blockedUntil: null,
          metadata: {
            enabled: true,
            username: "legacy_password_user",
            password: "secret",
            sessionFile: ".instagram/legacy.session.json"
          }
        }),
        update: async (input: unknown) => {
          updates.push(input);
          return input;
        }
      }
    };

    const result = await runInstagramAccountLoginCheck({
      accountKey: "INSTAGRAM:legacy_password_user",
      db: db as never,
      runCollector: async () => {
        collectorCalled = true;
        return { exitCode: 0, events: [okEvent] };
      }
    });

    expect(result).toMatchObject({
      ok: false,
      code: "instagram_helper_session_required",
      accountStatus: "MISSING_CREDENTIALS"
    });
    expect(collectorCalled).toBe(false);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      data: {
        status: "MISSING_CREDENTIALS",
        metadata: {
          authSource: "password"
        }
      }
    });
  });

});
