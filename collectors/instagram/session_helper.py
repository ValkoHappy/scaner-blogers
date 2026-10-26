from __future__ import annotations

import argparse
import getpass
import json
from pathlib import Path
from typing import Any

from instagram_collector import configure_ssl_certificates, configure_stdio, ensure_instagrapi_import_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ScanerBlogers donor-style Instagram session helper.")
    parser.add_argument("--default-login", default="", help="Prefilled username, email or phone")
    parser.add_argument("--output", required=True, help="Output JSON path for wrapped helper export")
    parser.add_argument("--proxy", help="Optional proxy URL")
    parser.add_argument("--verification-code", help="Optional prefilled 2FA or challenge code")
    parser.add_argument("--phone-number", help="Optional phone number for submit_phone challenges")
    return parser.parse_args()


def prompt_with_default(label: str, default: str = "") -> str:
    prompt = f"{label} [{default}]: " if default else f"{label}: "
    value = input(prompt).strip()
    return value or default.strip()


def classify_error(exc: BaseException) -> tuple[str, str]:
    name = exc.__class__.__name__
    message = str(exc).strip()
    lowered = message.lower()

    if "change your ip address" in lowered or "blacklist" in lowered:
        return (
            "instagram_blacklisted_ip",
            "Instagram accepted the request but flagged this IP. Retry with another proxy or finish recovery in the browser on this IP."
        )
    if "can't find an account" in lowered or "we can't find an account" in lowered:
        return (
            "login_identifier_not_accepted",
            "Instagram did not accept this login identifier on the mobile API. Retry with the exact username, email, or phone that works in the browser."
        )
    if name in {"BadPassword", "BadCredentials"}:
        return (
            "bad_password_or_flagged_ip",
            "Instagram rejected the password or the current IP reputation is bad. Recheck the password and, if it is correct, retry with another proxy."
        )
    if name in {"ChallengeRequired", "RecaptchaChallengeForm", "SelectContactPointRecoveryForm", "CaptchaChallengeRequired"} or "challenge" in lowered:
        return (
            "challenge_required",
            "Instagram asked for an additional recovery challenge. Complete the email/SMS/app flow in the helper or recover the account in the browser first."
        )
    if "getaddrinfo" in lowered or "name or service not known" in lowered or "nodename nor servname" in lowered or "temporary failure in name resolution" in lowered:
        return (
            "proxy_dns_failed",
            "The proxy host could not be resolved. Check the proxy address or switch to another proxy."
        )
    if "proxy" in lowered and ("connection refused" in lowered or "cannot connect" in lowered or "failed to establish a new connection" in lowered):
        return (
            "proxy_connect_failed",
            "The proxy answered poorly or refused the connection. Switch to another proxy."
        )
    if "timed out" in lowered or "timeout" in lowered:
        return (
            "proxy_dead_or_slow",
            "The network path timed out. The proxy is likely dead, overloaded, or too slow for Instagram login."
        )
    if "ssl" in lowered or "certificate" in lowered:
        return (
            "ssl_error",
            "The connection failed during TLS/SSL setup. Retry with another proxy or restore local certificates."
        )
    if "connection aborted" in lowered or "connection reset" in lowered:
        return (
            "network_reset",
            "The remote side reset the connection. Retry with another proxy or after a short cooldown."
        )
    return (
        name.lower() or "unknown_error",
        "Instagram login failed with an unclassified error. Recheck the login identifier, password, and proxy."
    )


def main() -> int:
    configure_stdio()
    configure_ssl_certificates()
    ensure_instagrapi_import_path()
    from instagrapi import Client

    args = parse_args()
    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print("ScanerBlogers Instagram session helper")
    print("")
    print("You can paste a username, email, or phone number here. If the prefilled login is wrong, replace it now.")
    login_identifier = prompt_with_default("Instagram login", args.default_login)
    if not login_identifier:
        raise SystemExit("Instagram login is required")

    proxy = (args.proxy or "").strip()
    print(f"Session JSON will be saved to: {output_path}")
    print(f"Proxy mode: {proxy if proxy else 'direct connection (no proxy)'}")

    password = getpass.getpass(f"Instagram password for {login_identifier}: ").strip()
    if not password:
        raise SystemExit("Instagram password is required")

    verification_code = (args.verification_code or "").strip()
    if not verification_code:
        verification_code = input("Verification code if you already have one (Enter to wait for challenge): ").strip()

    phone_number = (args.phone_number or "").strip()
    if not phone_number:
        phone_number = input("Phone number for recovery challenges (optional, Enter to skip): ").strip()

    client = Client(proxy=proxy or None)
    client.request_timeout = 30
    if phone_number:
        client.phone_number = phone_number

    def challenge_code_handler(challenge_username: str, choice: Any) -> str:
        nonlocal verification_code
        if verification_code:
            return verification_code
        channel = str(getattr(choice, "name", choice)).lower()
        verification_code = input(
            f"Instagram sent a code for {challenge_username} via {channel}. Enter code: "
        ).strip()
        return verification_code

    client.challenge_code_handler = challenge_code_handler

    print("")
    print("Logging in to Instagram...")
    print("If nothing changes for 30-60 seconds, stop the helper and retry with a working proxy or a different login identifier (username, email, phone).")
    print("If Instagram says the account was not found even through a live proxy, the login identifier is the problem, not the helper.")

    try:
        client.login(login_identifier, password, verification_code=verification_code)
    except Exception as exc:
        code, hint = classify_error(exc)
        print("")
        print(f"[{code}] {hint}")
        if str(exc).strip():
            print(str(exc).strip())
        return 1

    settings = client.get_settings()
    payload = {
        "username": getattr(client, "username", None) or login_identifier,
        "sessionSettings": settings,
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print("")
    print(f"Saved session settings to: {output_path}")
    print("Upload this JSON back into ScanerBlogers. Reconnecting will replace stale auth state on the server.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
