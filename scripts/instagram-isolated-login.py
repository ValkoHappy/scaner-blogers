from __future__ import annotations

import argparse
import getpass
import json
import os
import secrets
import string
import sys
from pathlib import Path
from typing import Any

from instagrapi import Client
from instagrapi.exceptions import ChallengeRequired, LoginRequired, TwoFactorRequired
from instagrapi.mixins.challenge import ChallengeChoice


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_STATE_DIR = ROOT_DIR / ".tmp" / "isolated-instagram-login"
DEFAULT_SESSION_FILE = DEFAULT_STATE_DIR / "session.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Standalone instagrapi login smoke-test isolated from the main ScanerBlogers auth flow."
    )
    parser.add_argument(
        "command",
        nargs="?",
        default="login",
        choices=["login", "fresh-login", "status", "clear"],
        help="login: reuse saved session if available; fresh-login: ignore saved session; status: validate session; clear: delete saved session",
    )
    parser.add_argument("--username", help="Instagram username. Falls back to IG_USERNAME.")
    parser.add_argument("--password", help="Instagram password. Falls back to IG_PASSWORD.")
    parser.add_argument(
        "--verification-code",
        help="2FA code or 8-digit backup code. If omitted and required, you will be prompted.",
    )
    parser.add_argument("--proxy", help="Proxy DSN, for example socks5://user:pass@host:port or http://host:port.")
    parser.add_argument(
        "--phone-number",
        help="Phone number used for submit_phone challenges, for example +15551234567.",
    )
    parser.add_argument(
        "--session-file",
        default=str(DEFAULT_SESSION_FILE),
        help=f"Path to isolated session settings JSON. Default: {DEFAULT_SESSION_FILE}",
    )
    parser.add_argument(
        "--allow-password-change",
        action="store_true",
        help="Allow change_password_handler for password-reset challenges. Use with care.",
    )
    parser.add_argument(
        "--no-prompt",
        action="store_true",
        help="Fail instead of prompting for missing username/password/2FA/challenge codes.",
    )
    return parser.parse_args()


def env_or_value(value: str | None, env_name: str) -> str:
    return (value or os.environ.get(env_name) or "").strip()


def session_path(raw: str) -> Path:
    return Path(raw).expanduser().resolve()


def prompt_value(label: str, secret: bool = False) -> str:
    if secret:
        return getpass.getpass(f"{label}: ").strip()
    return input(f"{label}: ").strip()


def require_value(current: str, label: str, no_prompt: bool, secret: bool = False) -> str:
    if current:
        return current
    if no_prompt:
        raise SystemExit(f"Missing required value: {label}")
    return prompt_value(label, secret=secret)


def truncate(value: str, start: int = 6, end: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= start + end + 3:
        return value
    return f"{value[:start]}...{value[-end:]}"


def sanitize_last_json(last_json: Any) -> Any:
    if not isinstance(last_json, dict):
        return last_json
    redacted_keys = {
        "sessionid",
        "authorization",
        "ig-set-authorization",
        "cookie",
        "csrftoken",
        "password",
        "enc_password",
        "verification_code",
        "security_code",
        "phone_number",
        "email",
    }
    output: dict[str, Any] = {}
    for key, value in last_json.items():
        lower_key = str(key).lower()
        if lower_key in redacted_keys:
            output[key] = "<redacted>"
        elif isinstance(value, dict):
            output[key] = sanitize_last_json(value)
        elif isinstance(value, list):
            output[key] = [sanitize_last_json(item) for item in value]
        else:
            output[key] = value
    return output


def print_diagnostics(client: Client, exc: Exception) -> None:
    print(f"[error] {exc.__class__.__name__}: {exc}")
    last_json = sanitize_last_json(getattr(client, "last_json", None))
    if last_json:
        print("[error] client.last_json:")
        print(json.dumps(last_json, ensure_ascii=False, indent=2))


def generate_password() -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(16))


def make_client(args: argparse.Namespace) -> Client:
    proxy = env_or_value(args.proxy, "IG_PROXY")
    client = Client(proxy=proxy or None)
    phone_number = env_or_value(args.phone_number, "IG_PHONE_NUMBER")
    if phone_number:
        client.phone_number = phone_number

    def challenge_code_handler(username: str, choice: ChallengeChoice) -> str | bool:
        label = "SMS" if choice == ChallengeChoice.SMS else "EMAIL"
        if args.no_prompt:
            return False
        code = input(f"[challenge] Enter {label} code for @{username}: ").strip()
        return code or False

    client.challenge_code_handler = challenge_code_handler

    if args.allow_password_change:
        def change_password_handler(username: str) -> str:
            if args.no_prompt:
                return generate_password()
            new_password = getpass.getpass(
                f"[challenge] Password reset required for @{username}. Enter a new password or leave blank to auto-generate: "
            ).strip()
            return new_password or generate_password()

        client.change_password_handler = change_password_handler
    return client


def save_settings(client: Client, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    client.dump_settings(path)
    print(f"[session] Saved settings to {path}")


def describe_session_file(path: Path) -> None:
    if not path.exists():
        print(f"[session] No isolated session file at {path}")
        return
    print(f"[session] Using isolated session file: {path}")


def validate_session(client: Client) -> tuple[bool, str]:
    account = client.account_info()
    sessionid = truncate(getattr(client, "sessionid", "") or "")
    return True, f"Session valid for @{account.username} (user_id={account.pk}, sessionid={sessionid})"


def attempt_password_login(
    client: Client,
    username: str,
    password: str,
    verification_code: str,
) -> bool:
    try:
        return client.login(username, password, verification_code=verification_code)
    except TwoFactorRequired:
        code = verification_code
        if not code:
            code = prompt_value("Instagram 2FA code or 8-digit backup code", secret=False).strip()
        return client.login(username, password, verification_code=code)


def restore_with_same_uuids(client: Client, username: str, password: str, verification_code: str) -> bool:
    previous_settings = client.get_settings()
    uuids = previous_settings.get("uuids") or {}
    client.set_settings({})
    if uuids:
        client.set_uuids(uuids)
    return attempt_password_login(client, username, password, verification_code)


def command_status(args: argparse.Namespace) -> int:
    path = session_path(args.session_file)
    describe_session_file(path)
    if not path.exists():
        print("[status] Nothing to validate yet. Run login or fresh-login first.")
        return 1
    client = make_client(args)
    client.load_settings(path)
    try:
        ok, message = validate_session(client)
        print(f"[status] {'OK' if ok else 'NO'} {message}")
        return 0
    except Exception as exc:
        print_diagnostics(client, exc)
        return 1


def command_clear(args: argparse.Namespace) -> int:
    path = session_path(args.session_file)
    if path.exists():
        path.unlink()
        print(f"[session] Deleted isolated session file {path}")
        return 0
    print(f"[session] Nothing to delete at {path}")
    return 0


def command_login(args: argparse.Namespace, fresh: bool) -> int:
    path = session_path(args.session_file)
    username = env_or_value(args.username, "IG_USERNAME")
    password = env_or_value(args.password, "IG_PASSWORD")
    verification_code = env_or_value(args.verification_code, "IG_VERIFICATION_CODE")

    client = make_client(args)
    describe_session_file(path)

    if not fresh and path.exists():
        print("[login] Loading saved settings before login.")
        client.load_settings(path)
        if username and password:
            try:
                client.login(username, password)
                ok, message = validate_session(client)
                print(f"[login] {'OK' if ok else 'NO'} {message}")
                save_settings(client, path)
                return 0
            except LoginRequired:
                print("[login] Saved session is stale. Retrying password login with the same device UUIDs.")
                try:
                    username = require_value(username, "Instagram username", args.no_prompt)
                    password = require_value(password, "Instagram password", args.no_prompt, secret=True)
                    restore_with_same_uuids(client, username, password, verification_code)
                    ok, message = validate_session(client)
                    print(f"[login] OK {message}")
                    save_settings(client, path)
                    return 0
                except Exception as exc:
                    try:
                        save_settings(client, path)
                    except Exception:
                        pass
                    print_diagnostics(client, exc)
                    return 1
            except Exception as exc:
                try:
                    save_settings(client, path)
                except Exception:
                    pass
                print_diagnostics(client, exc)
                return 1
        else:
            try:
                ok, message = validate_session(client)
                print(f"[login] OK {message}")
                return 0
            except Exception as exc:
                print("[login] Saved session exists, but username/password were not provided for recovery.")
                print_diagnostics(client, exc)
                return 1

    username = require_value(username, "Instagram username", args.no_prompt)
    password = require_value(password, "Instagram password", args.no_prompt, secret=True)

    try:
        print("[login] Starting fresh password login.")
        attempt_password_login(client, username, password, verification_code)
        ok, message = validate_session(client)
        print(f"[login] OK {message}")
        save_settings(client, path)
        return 0
    except ChallengeRequired as exc:
        try:
            save_settings(client, path)
        except Exception:
            pass
        print("[login] Instagram requested an additional challenge.")
        print_diagnostics(client, exc)
        return 1
    except Exception as exc:
        try:
            save_settings(client, path)
        except Exception:
            pass
        print_diagnostics(client, exc)
        return 1


def main() -> int:
    args = parse_args()
    if args.command == "status":
        return command_status(args)
    if args.command == "clear":
        return command_clear(args)
    if args.command == "fresh-login":
        return command_login(args, fresh=True)
    return command_login(args, fresh=False)


if __name__ == "__main__":
    raise SystemExit(main())
