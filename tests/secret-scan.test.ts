import { describe, expect, it } from "vitest";
import { findForbiddenRuntimeMarkers, findMissingRuntimeIgnoreRules, findSecretLeaks, shouldScanSecretPath } from "../scripts/secret-scan";

describe("secret scan", () => {
  it("distinguishes cookie expressions from literal secrets", () => {
    expect(findSecretLeaks([{ path: "cookies.py", content: 'sessionid = payload["sessionId"]\ncsrftoken: csrfCookie?.value\nif (cookies.sessionid === "string") {}' }])).toEqual([]);
    expect(findSecretLeaks([{ path: "cookies.test.ts", content: 'sessionid: "browser-session"' }])).toEqual([]);
    expect(findSecretLeaks([{ path: "cookies.ts", content: 'sessionid: "browser-session"' }])).toHaveLength(1);
  });
  it("ignores private local env and runtime session files", () => {
    expect(shouldScanSecretPath(".env.local")).toBe(false);
    expect(shouldScanSecretPath("apps/web/.env.local")).toBe(false);
    expect(shouldScanSecretPath(".instagram/session.json")).toBe(false);
    expect(shouldScanSecretPath("node_modules/pkg/index.js")).toBe(false);
  });

  it("detects hardcoded platform tokens in scannable files", () => {
    const leaks = findSecretLeaks([
      {
        path: "README.md",
        content: [
          `VK_ACCESS_TOKEN=${"vk1.a." + "thisIsARealLookingToken"}`,
          `VK_SERVER_TOKEN=${"server-secret-token-123456789"}`,
          `VK_SERVICE_TOKEN=${"service-secret-token-123456789"}`,
          `YOUTUBE_API_KEY=${"AIzaSyD_" + "realLookingGoogleApiKey_123456789"}`
        ].join("\n")
      }
    ]);

    expect(leaks.map((leak) => leak.kind)).toEqual([
      "VK_ACCESS_TOKEN",
      "SECRET_ENV_VALUE",
      "SECRET_ENV_VALUE",
      "GOOGLE_API_KEY"
    ]);
    expect(leaks.every((leak) => leak.valuePreview.includes("***"))).toBe(true);
  });

  it("detects hardcoded authorization headers and Instagram session cookies", () => {
    const bearer = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature";
    const session = ["ig", "live", "session", "value"].join("-");
    const csrf = ["csrf", "live", "secret", "value"].join("-");
    const leaks = findSecretLeaks([
      {
        path: "docs/ops.md",
        content: [
          `Authorization: Bearer ${bearer}`,
          `sessionid=${session}`,
          `csrftoken=${csrf}`
        ].join("\n")
      }
    ]);

    expect(leaks.map((leak) => leak.kind)).toEqual([
      "AUTHORIZATION_HEADER",
      "INSTAGRAM_SESSION_COOKIE",
      "INSTAGRAM_SESSION_COOKIE"
    ]);
    expect(leaks.every((leak) => leak.valuePreview.includes("***"))).toBe(true);
  });

  it("detects hardcoded proxy URLs with credentials", () => {
    const firstUser = ["real", "user"].join("-");
    const firstPass = ["real", "pass"].join("-");
    const secondUser = ["another", "user"].join("-");
    const secondPass = ["another", "pass"].join("-");
    const leaks = findSecretLeaks([
      {
        path: "docs/proxy.md",
        content: [
          "Proxy example:",
          `socks5://${firstUser}:${firstPass}@203.0.113.10:9000`,
          `https://${secondUser}:${secondPass}@198.51.100.20:8080`
        ].join("\n")
      }
    ]);

    expect(leaks.map((leak) => leak.kind)).toEqual([
      "PROXY_CREDENTIAL_URL",
      "PROXY_CREDENTIAL_URL"
    ]);
    expect(leaks.every((leak) => leak.valuePreview.includes("***"))).toBe(true);
  });

  it("allows empty placeholders in example files", () => {
    expect(findSecretLeaks([
      {
        path: ".env.example",
        content: [
          `VK_ACCESS_TOKEN=${'""'}`,
          `VK_SERVER_TOKEN=${'""'}`,
          `VK_SERVICE_TOKEN=${'""'}`,
          `YOUTUBE_API_KEY=${'""'}`,
          `ADMIN_PASSWORD=${'"generate-a-long-unique-password"'}`
        ].join("\n")
      }
    ])).toEqual([]);
  });

  it("requires private runtime folders to be ignored by git and docker", () => {
    const files = new Map([
      [".gitignore", [".env.local", ".instagram/", ".vk/", ".vk-browser/", ".tmp-*"].join("\n")],
      [".dockerignore", [".env.local", ".instagram", ".vk", ".vk-browser", ".tmp-*"].join("\n")]
    ]);

    expect(findMissingRuntimeIgnoreRules((name) => files.get(name) ?? "")).toEqual([]);
    files.set(".dockerignore", ".env.local\n.instagram\n");
    expect(findMissingRuntimeIgnoreRules((name) => files.get(name) ?? "")).toEqual([
      ".dockerignore missing .vk",
      ".dockerignore missing .vk-browser",
      ".dockerignore missing .tmp-*"
    ]);
  });

  it("detects PostgreSQL runtime drift outside allowed historical plans", () => {
    const issues = findForbiddenRuntimeMarkers([
      {
        path: "README.md",
        content: [
          "Start PostgreSQL:",
          "docker compose up postgres",
          "DATABASE_URL=postgresql://localhost/db",
          "POSTGRES_PASSWORD=secret"
        ].join("\n")
      },
      {
        path: "docs/superpowers/plans/2026-06-08-sqlite-portable-migration.md",
        content: "Replace the default PostgreSQL/Docker runtime with SQLite."
      }
    ]);

    expect(issues).toEqual([
      { path: "README.md", line: 1, marker: "PostgreSQL" },
      { path: "README.md", line: 2, marker: "docker compose up postgres" },
      { path: "README.md", line: 3, marker: "postgresql://" },
      { path: "README.md", line: 4, marker: "POSTGRES_PASSWORD" }
    ]);
  });
});
