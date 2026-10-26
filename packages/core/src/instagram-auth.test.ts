import { describe, expect, it } from "vitest";
import {
  normalizeInstagramStoredCredentials,
  resolveInstagramAuthSource
} from "./instagram-auth";

describe("instagram auth source helpers", () => {
  it("classifies helper session metadata without treating session file as a conflict", () => {
    expect(resolveInstagramAuthSource({
      username: "helper-user",
      sessionSettings: "{\"uuids\":{}}",
      sessionFile: ".instagram/helper-user.session.json"
    })).toMatchObject({
      authSource: "helper_session",
      hasSessionSettings: true,
      hasSessionFile: true
    });
  });

  it("marks session settings plus session id as mixed", () => {
    expect(resolveInstagramAuthSource({
      username: "mixed-user",
      sessionSettings: "{\"uuids\":{}}",
      sessionId: "session-id-value",
      sessionFile: ".instagram/mixed-user.session.json"
    }).authSource).toBe("mixed");
  });

  it("preserves mixed imports for explicit cleanup messaging", () => {
    expect(normalizeInstagramStoredCredentials({
      username: "helper-user",
      password: "secret",
      sessionId: "browser-session",
      sessionSettings: "{\"uuids\":{}}",
      sessionFile: ".instagram/helper-user.session.json"
    })).toEqual({
      authSource: "mixed",
      metadata: {
        username: "helper-user",
        password: "secret",
        sessionId: "browser-session",
        sessionSettings: "{\"uuids\":{}}",
        sessionFile: ".instagram/helper-user.session.json"
      }
    });
  });

  it("stores password accounts without stale session settings or session ids", () => {
    expect(normalizeInstagramStoredCredentials({
      username: "password-user",
      password: "secret",
      sessionFile: ".instagram/password-user.session.json"
    })).toEqual({
      authSource: "password",
      metadata: {
        username: "password-user",
        password: "secret",
        sessionFile: ".instagram/password-user.session.json"
      }
    });
  });
});
