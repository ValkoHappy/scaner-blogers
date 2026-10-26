from __future__ import annotations

import argparse
import getpass
import json
from pathlib import Path

from instagram_collector import (
    APP_ROOT,
    configure_ssl_certificates,
    configure_stdio,
    ensure_instagrapi_import_path,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Login to Instagram locally and export full instagrapi settings JSON.")
    parser.add_argument("--username", required=True, help="Instagram username")
    parser.add_argument("--password", help="Instagram password (omit to enter it securely)")
    parser.add_argument("--output", required=True, help="Output JSON file path")
    parser.add_argument("--proxy", help="Optional proxy URL")
    parser.add_argument("--verification-code", help="Optional 2FA or challenge code")
    parser.add_argument("--phone-number", help="Phone number for submit_phone challenges")
    return parser.parse_args()


def resolve_output(path_value: str) -> Path:
    path = Path(path_value)
    if path.is_absolute():
        return path
    return APP_ROOT / path


def main() -> int:
    configure_stdio()
    configure_ssl_certificates()
    ensure_instagrapi_import_path()
    from instagrapi import Client

    args = parse_args()
    output_path = resolve_output(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    client = Client(proxy=args.proxy or None)
    if args.phone_number:
        client.phone_number = args.phone_number.strip()

    verification_code = (args.verification_code or "").strip()
    def challenge_code_handler(username: str, choice: object) -> str:
        if verification_code:
            return verification_code
        channel = str(getattr(choice, "name", choice)).lower()
        return input(f"Instagram sent a code for {username} via {channel}. Enter code: ").strip()

    client.challenge_code_handler = challenge_code_handler
    password = args.password or getpass.getpass(f"Instagram password for {args.username}: ")
    if not password:
        raise SystemExit("Instagram password is required")

    client.login(args.username, password, verification_code=verification_code)
    settings = client.get_settings()
    output_path.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
    print(str(output_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
