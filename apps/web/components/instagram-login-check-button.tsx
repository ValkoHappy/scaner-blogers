"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface LoginCheckPayload {
  ok?: boolean;
  message?: string;
  accountStatus?: string;
  requiresVerification?: boolean;
}

export function InstagramLoginCheckButton({
  accountKey,
  compact = false
}: {
  accountKey?: string;
  compact?: boolean;
} = {}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [requiresVerification, setRequiresVerification] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");

  async function runCheck(withVerificationCode = false) {
    setPending(true);
    setMessage(null);
    setOk(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 100_000);
    try {
      const response = await fetch("/api/instagram/login-check", {
        method: "POST",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify(accountKey ? {
          accountKey,
          ...(withVerificationCode ? { verificationCode } : {})
        } : {})
      });
      const payload = await response.json().catch(() => null) as LoginCheckPayload | null;
      if (!response.ok) throw new Error(payload?.message ?? "HTTP " + response.status);
      setOk(Boolean(payload?.ok));
      setRequiresVerification(Boolean(payload?.requiresVerification) && !payload?.ok);
      if (payload?.ok) setVerificationCode("");
      setMessage(payload?.ok ? "Server login check passed: account is ready" : loginCheckMessage(payload));
      router.refresh();
    } catch (error) {
      setOk(false);
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessage("Login check stopped after 100 seconds. Proxy or Instagram did not respond in time.");
        return;
      }
      setMessage(error instanceof Error ? "Server login check failed: " + error.message : "Server login check failed");
    } finally {
      window.clearTimeout(timeout);
      setPending(false);
    }
  }

  return (
    <span className={`inline-action-status${compact ? " compact" : ""}`}>
      <button className={`button ${pending ? "is-pending" : ""}`} disabled={pending} onClick={() => runCheck(false)} type="button">
        {pending ? (
          <>
            <span className="button-spinner" aria-hidden="true" />
            Checking
          </>
        ) : compact ? "Check on server" : "Run server login check"}
      </button>
      {requiresVerification && accountKey ? (
        <span className="instagram-verification-code">
          <input
            aria-label="Instagram verification code"
            autoComplete="one-time-code"
            inputMode="numeric"
            onChange={(event) => setVerificationCode(event.target.value)}
            placeholder="One-time code from SMS, email or app"
            type="text"
            value={verificationCode}
          />
          <button
            className={`button ${pending ? "is-pending" : ""}`}
            disabled={pending || !verificationCode.trim()}
            onClick={() => runCheck(true)}
            type="button"
          >
            Send code
          </button>
          <small>This code is used one time only. If the account keeps asking for codes, refresh the donor session through the helper instead of retrying scans.</small>
        </span>
      ) : null}
      {message ? <span className={`instagram-check-result ${ok ? "success" : "error"}`} aria-live="polite">{message}</span> : null}
    </span>
  );
}

function loginCheckMessage(payload: LoginCheckPayload | null) {
  const details = payload?.message?.trim() ?? "";
  if (payload?.accountStatus === "MISSING_CREDENTIALS" && /missing_credentials|mixed_auth_state|helper_session_required/i.test(details)) {
    return /helper_session_required/i.test(details)
      ? "This account still relies on password-only auth. Refresh the donor session through the helper and reconnect the JSON before running scans."
      : "No single prepared donor session is stored for this account. Reconnect it through the helper JSON.";
  }
  if (payload?.requiresVerification) {
    return "Instagram requested a one-time verification step. You can enter the code below once, but repeated verification issues should be resolved by refreshing the donor session through the helper.";
  }
  if (/login_required/i.test(details)) {
    return "The current donor session is no longer valid. Refresh it through the helper, reconnect the JSON, then retry the login check.";
  }
  if (/bad_credentials/i.test(details)) {
    return "Instagram rejected the password. Use the helper for the next login and save a fresh donor session.";
  }
  return details ? "Server login check failed: " + details : "Server login check failed for Instagram";
}
