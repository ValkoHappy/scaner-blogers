import { describe, expect, it } from "vitest";
import { diagnoseSmokeFailure, sanitizeSecretText } from "../scripts/social-smoke-output";

describe("social smoke output", () => {
  it("diagnoses VK IP-bound OAuth tokens without exposing the token", () => {
    const diagnosis = diagnoseSmokeFailure(
      "vk",
      "vk-collector:vk_api_request_failed:[5] User authorization failed: access_token was given to another ip address"
    );

    expect(diagnosis).toEqual({
      code: "vk_oauth_ip_bound",
      summary: "VK OAuth token is bound to another IP address.",
      action: "Run npm.cmd run vk:refresh-token on the same machine/IP as the worker. VK groups.search requires a user access token."
    });
  });

  it("diagnoses Instagram certificate verification failures as network setup issues", () => {
    const diagnosis = diagnoseSmokeFailure(
      "instagram",
      "instagram-collector:network_or_proxy:SSLCertVerificationError certificate verify failed"
    );

    expect(diagnosis).toEqual({
      code: "instagram_ssl_certificate",
      summary: "Instagram HTTPS certificate validation failed in the local Python environment.",
      action: "Use a working Instagram proxy or install/export the local trusted root CA for Python; do not disable SSL verification."
    });
  });

  it("keeps fallback diagnosis generic and sanitized", () => {
    const diagnosis = diagnoseSmokeFailure("youtube", "failed with access_token=vk1.a.secretValue and password=secret");

    expect(diagnosis).toEqual({
      code: "social_smoke_failed",
      summary: "Live social smoke check failed.",
      action: "Read the platform message and credential preflight, then retry after fixing the external access issue."
    });
    expect(sanitizeSecretText("access_token=vk1.a.secretValue password=secret")).not.toContain("secret");
  });

  it("redacts authorization headers and Instagram session cookies in smoke text", () => {
    const vkToken = `vk1.a.${"abcdefghijklmnopqrstuvwxyz0123456789"}`;

    expect(sanitizeSecretText(`Authorization: Bearer ${vkToken}; sessionid=ig-session-secret csrftoken=csrf-secret`)).toBe(
      "Authorization: ***; sessionid=*** csrftoken=***"
    );
  });
});
