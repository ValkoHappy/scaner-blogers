from __future__ import annotations

import argparse
import concurrent.futures
import json
import socket
import ssl
import struct
import sys
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import requests


TARGET_HOST = "i.instagram.com"
TARGET_PORT = 443


@dataclass
class ProxyCandidate:
    raw: str
    url: str
    scheme: str
    host: str
    port: int
    username: str = ""
    password: str = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check proxies against Instagram TLS and optional instagrapi login.")
    parser.add_argument("--url", help="URL with proxy list, one proxy per line")
    parser.add_argument("--file", help="Local proxy list file, one proxy per line")
    parser.add_argument("--scheme", default="socks5", choices=["socks5", "http"], help="Scheme for IP:PORT rows")
    parser.add_argument("--session-json", help="Session JSON from ScanerBlogers Instagram extension")
    parser.add_argument("--login-check", action="store_true", help="Run instagrapi login_by_sessionid for TLS-passing proxies")
    parser.add_argument("--limit", type=int, default=200, help="Max proxies to test")
    parser.add_argument("--workers", type=int, default=30, help="Parallel checks")
    parser.add_argument("--timeout", type=float, default=10, help="Per-step timeout in seconds")
    return parser.parse_args()


def load_lines(args: argparse.Namespace) -> list[str]:
    if not args.url and not args.file:
        raise SystemExit("Pass --url or --file")
    if args.url:
        response = requests.get(args.url, timeout=30)
        response.raise_for_status()
        text = response.text
    else:
        with open(args.file, encoding="utf-8") as handle:
            text = handle.read()
    return [line.strip() for line in text.splitlines() if line.strip() and not line.strip().startswith("#")]


def parse_proxy(raw: str, default_scheme: str) -> ProxyCandidate | None:
    text = raw.strip()
    if not text:
        return None
    if "://" not in text:
        parts = text.split(":")
        if len(parts) == 2:
            host, port = parts
            url = f"{default_scheme}://{host}:{port}"
        elif len(parts) >= 4:
            host, port, username, *password_parts = parts
            password = ":".join(password_parts)
            url = f"{default_scheme}://{username}:{password}@{host}:{port}"
        else:
            return None
    else:
        url = text

    parsed = urlparse(url)
    if parsed.scheme not in {"socks5", "http"} or not parsed.hostname or not parsed.port:
        return None
    return ProxyCandidate(
        raw=raw,
        url=url,
        scheme=parsed.scheme,
        host=parsed.hostname,
        port=parsed.port,
        username=parsed.username or "",
        password=parsed.password or "",
    )


def socks5_tls_check(proxy: ProxyCandidate, timeout: float) -> tuple[bool, str, float]:
    start = time.time()
    try:
        raw = socket.create_connection((proxy.host, proxy.port), timeout=timeout)
        raw.settimeout(timeout)
        if proxy.username or proxy.password:
            raw.sendall(b"\x05\x01\x02")
        else:
            raw.sendall(b"\x05\x01\x00")
        greeting = raw.recv(2)
        if len(greeting) != 2 or greeting[0] != 5:
            return False, f"bad_socks_greeting:{greeting!r}", elapsed(start)
        if greeting[1] == 2:
            user = proxy.username.encode()
            password = proxy.password.encode()
            raw.sendall(b"\x01" + bytes([len(user)]) + user + bytes([len(password)]) + password)
            auth = raw.recv(2)
            if auth != b"\x01\x00":
                return False, f"bad_socks_auth:{auth!r}", elapsed(start)
        elif greeting[1] != 0:
            return False, f"unsupported_socks_auth:{greeting!r}", elapsed(start)

        target = TARGET_HOST.encode()
        raw.sendall(b"\x05\x01\x00\x03" + bytes([len(target)]) + target + struct.pack("!H", TARGET_PORT))
        response = raw.recv(10)
        if len(response) < 2 or response[1] != 0:
            return False, f"socks_connect_failed:{response!r}", elapsed(start)

        tls = ssl.create_default_context().wrap_socket(raw, server_hostname=TARGET_HOST)
        tls.close()
        return True, "instagram_tls_ok", elapsed(start)
    except Exception as exc:
        return False, f"{exc.__class__.__name__}:{exc}", elapsed(start)


def http_tls_check(proxy: ProxyCandidate, timeout: float) -> tuple[bool, str, float]:
    start = time.time()
    try:
        proxies = {"http": proxy.url, "https": proxy.url}
        response = requests.get(f"https://{TARGET_HOST}/api/v1/qe/sync/", proxies=proxies, timeout=timeout)
        return True, f"instagram_https_status:{response.status_code}", elapsed(start)
    except Exception as exc:
        return False, f"{exc.__class__.__name__}:{exc}", elapsed(start)


def instagrapi_login_check(proxy_url: str, session_json: str) -> tuple[bool, str, float]:
    start = time.time()
    try:
        from instagrapi import Client

        with open(session_json, encoding="utf-8") as handle:
            payload = json.load(handle)
        sessionid = payload["sessionId"]
        client = Client(proxy=proxy_url)
        client.login_by_sessionid(sessionid)
        account = client.account_info()
        return True, f"logged_as:{getattr(account, 'username', '')}", elapsed(start)
    except Exception as exc:
        return False, f"{exc.__class__.__name__}:{exc}", elapsed(start)


def elapsed(start: float) -> float:
    return round(time.time() - start, 2)


def check_one(proxy: ProxyCandidate, args: argparse.Namespace) -> tuple[ProxyCandidate, bool, str, float, str | None]:
    ok, message, seconds = socks5_tls_check(proxy, args.timeout) if proxy.scheme == "socks5" else http_tls_check(proxy, args.timeout)
    login_message = None
    if ok and args.login_check and args.session_json:
        login_ok, login_message, login_seconds = instagrapi_login_check(proxy.url, args.session_json)
        ok = login_ok
        seconds += login_seconds
    return proxy, ok, message, seconds, login_message


def main() -> int:
    args = parse_args()
    rows = load_lines(args)[: args.limit]
    proxies = [proxy for row in rows if (proxy := parse_proxy(row, args.scheme))]
    if not proxies:
        raise SystemExit("No valid proxies parsed")

    print(f"Loaded {len(proxies)} proxies. Target: {TARGET_HOST}:{TARGET_PORT}")
    found = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [executor.submit(check_one, proxy, args) for proxy in proxies]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            proxy, ok, message, seconds, login_message = future.result()
            status = "OK" if ok else "NO"
            extra = f" | {login_message}" if login_message else ""
            print(f"[{index}/{len(proxies)}] {status} {proxy.url} | {message}{extra} | {seconds}s")
            if ok:
                found += 1

    print(f"Found {found} usable proxies")
    return 0 if found else 1


if __name__ == "__main__":
    raise SystemExit(main())
