from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import random
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Iterable


APP_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = APP_ROOT.parent
VENDORED_INSTAGRAPI_REPO = APP_ROOT / "vendor" / "instagram-instagrapi"
RESEARCH_INSTAGRAPI_REPO = REPO_ROOT / "research" / "repos" / "instagram-instagrapi"
DEFAULT_INSTAGRAPI_REPO = VENDORED_INSTAGRAPI_REPO if VENDORED_INSTAGRAPI_REPO.exists() else RESEARCH_INSTAGRAPI_REPO


def configure_stdio() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


configure_stdio()

logging.getLogger("public_request").setLevel(logging.CRITICAL)
logging.getLogger("instagrapi").setLevel(logging.ERROR)
logging.disable(logging.CRITICAL)


def ensure_instagrapi_import_path() -> None:
    repo_path = Path(os.environ.get("INSTAGRAPI_REPO_PATH", DEFAULT_INSTAGRAPI_REPO)).resolve()
    if repo_path.exists() and str(repo_path) not in sys.path:
        sys.path.insert(0, str(repo_path))


def configure_ssl_certificates(
    env: dict[str, str] | os._Environ[str] = os.environ,
    certifi_path_factory: Any | None = None,
) -> str | None:
    if env.get("SSL_CERT_FILE") or env.get("REQUESTS_CA_BUNDLE"):
        return None
    if certifi_path_factory is None:
        try:
            import certifi
            certifi_path_factory = certifi.where
        except Exception:
            return None
    certifi_path = certifi_path_factory()
    if not certifi_path:
        return None
    env["SSL_CERT_FILE"] = certifi_path
    env["REQUESTS_CA_BUNDLE"] = certifi_path
    return certifi_path


@dataclass
class InstagramCollectorConfig:
    keywords: list[str] = field(default_factory=list)
    hashtags: list[str] = field(default_factory=list)
    countries: list[str] = field(default_factory=lambda: ["RU", "KZ"])
    excluded_profile_ids: list[str] = field(default_factory=list)
    require_geo_match: bool = False
    min_followers: int = 20_000
    max_followers: int = 60_000
    max_keywords_per_run: int = 3
    max_tags_per_keyword: int = 2
    max_medias_per_tag: int = 12
    max_profiles_per_run: int = 5
    max_profile_checks_per_run: int = 12
    recent_media_per_profile: int = 0
    profile_delay_min_sec: float = 45
    profile_delay_max_sec: float = 120
    media_delay_min_sec: float = 30
    media_delay_max_sec: float = 90
    session_file: str = ".instagram/session.json"
    settings_dir: str = ".instagram"
    proxy_pool: list[str] = field(default_factory=list)
    use_hashtag_search: bool = True
    use_derived_hashtags: bool = True
    include_recent_posts_fallback: bool = True
    include_keyword_reels_search: bool = True
    include_user_search: bool = True
    include_account_serp_search: bool = True
    include_typeahead_search: bool = True
    max_user_search_results_per_keyword: int = 2
    public_request_retries_count: int = 0
    public_request_retries_timeout: float = 0


@dataclass
class CollectorEvent:
    level: str
    code: str
    message: str
    data: dict[str, Any] = field(default_factory=dict)


class InstagramCollectorError(RuntimeError):
    def __init__(self, code: str, message: str, cooldown_seconds: int | None = None):
        super().__init__(message)
        self.code = code
        self.cooldown_seconds = cooldown_seconds


class ProxyRotator:
    def __init__(self, proxies: Iterable[str]):
        self.proxies = [item.strip() for item in proxies if item and item.strip()]
        self.index = 0

    def current(self) -> str | None:
        if not self.proxies:
            return os.environ.get("INSTAGRAM_PROXY_URL") or None
        return self.proxies[self.index % len(self.proxies)]

    def next(self) -> str | None:
        if not self.proxies:
            return self.current()
        self.index += 1
        return self.current()


TERMINAL_ERROR_CODES = {
    "automation_warning",
    "bad_credentials",
    "challenge_required",
    "rate_limited",
    "login_required",
    "proxy_blocked",
}

EMAIL_RE = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+(?![\w.-])", re.I)
PHONE_RE = re.compile(r"(?<!\d)(?:\+7|8|7)?[\s(.-]*\d{3}[\s).*-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?!\d)")
URL_RE = re.compile(r"(?:https?://|www\.)[^\s<>()]+", re.I)
MASKED_CONTACT_RE = re.compile(r"[*•]")

RU_MARKERS = [
    "россия",
    "москва",
    "спб",
    "санкт",
    "петербург",
    "казань",
    "екатеринбург",
    "новосибирск",
    "краснодар",
    "сочи",
    "онлайн",
]
KZ_MARKERS = ["казахстан", "алматы", "астана", "нур-султан", "шымкент", "караганда", ".kz"]
CYRILLIC_RE = re.compile(r"[а-яё]", re.I)

TOPIC_HASHTAG_ALIASES = {
    "массаж лица": [
        "массажлица",
        "массаж_лица",
        "фейсмассаж",
        "самомассажлица",
        "скульптурныймассаж",
        "лимфодренажлица",
        "facemassage",
        "facialmassage",
    ],
    "фейсфитнес": ["фейсфитнес", "фейсфитнеслица", "facefitness", "faceyoga", "face_yoga"],
    "face yoga": ["faceyoga", "face_yoga", "facefitness", "facialexercise"],
    "facial massage": ["facialmassage", "facemassage", "lymphaticdrainageface"],
    "косметолог": ["косметолог", "косметология", "косметологмосква", "косметологалматы"],
    "уход за лицом": ["уходзалицом", "домашнийуход", "уходзалицомдома", "skincare"],
    "естественное омоложение": ["естественноеомоложение", "омоложениелица", "antiage", "antiaging"],
    "anti-age": ["antiage", "antiaging", "anti_age", "омоложение"],
    "лимфодренаж лица": ["лимфодренажлица", "лимфодренажныймассаж", "lymphaticdrainageface"],
    "тейпирование лица": ["тейпированиелица", "кинезиотейпированиелица", "facetaping"],
    "аппаратная косметология": ["аппаратнаякосметология", "косметология", "rfлифтинг", "микротоки"],
    "домашний уход за лицом": ["домашнийуходзалицом", "домашнийуход", "уходзалицомдома"],
    "микротоки": ["микротоки", "микротокилица", "microcurrentfacial"],
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def emit_event(event: CollectorEvent) -> None:
    print(json.dumps({"event": asdict(event), "collectedAt": now_iso()}, ensure_ascii=False), file=sys.stderr, flush=True)


def normalize_hashtag(value: str) -> str:
    tag = value.strip().lstrip("#").strip()
    tag = re.sub(r"\s+", "", tag)
    return tag


def candidate_tags_for_keyword(keyword: str) -> list[str]:
    keyword = keyword.strip()
    if not keyword:
        return []
    variants = [keyword, keyword.replace("-", " "), keyword.replace("/", " ")]
    tags = []
    for item in variants:
        tags.append(normalize_hashtag(item))
    lowered = keyword.lower().replace("ё", "е")
    for trigger, aliases in TOPIC_HASHTAG_ALIASES.items():
        if trigger.replace("ё", "е") in lowered:
            tags.extend(aliases)
    return unique_non_empty(tags)


def unique_non_empty(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        cleaned = str(value).strip()
        if not cleaned or cleaned.lower() in seen:
            continue
        seen.add(cleaned.lower())
        result.append(cleaned)
    return result


def extract_contacts(*texts: str | None) -> dict[str, list[str]]:
    joined = "\n".join(item for item in texts if item)
    return {
        "emails": unique_non_empty(EMAIL_RE.findall(joined)),
        "phones": unique_non_empty(PHONE_RE.findall(joined)),
        "urls": unique_non_empty(URL_RE.findall(joined)),
    }


def guess_geo(*texts: str | None) -> str | None:
    joined = " ".join(item.lower() for item in texts if item)
    ru_markers = [
        "россия",
        "москва",
        "спб",
        "санкт",
        "петербург",
        "казань",
        "екатеринбург",
        "новосибирск",
        "краснодар",
        "сочи",
        "онлайн",
    ]
    kz_markers = ["казахстан", "алматы", "астана", "нур-султан", "шымкент", "караганда", ".kz"]
    if any(marker in joined for marker in kz_markers):
        return "KZ"
    if any(marker in joined for marker in ru_markers) or re.search(r"[а-яё]", joined, re.I):
        return "RU"
    return None


def source_caption(source_media: Any | None) -> str:
    return getattr(source_media, "caption_text", "") or ""


def media_url(code: str | None) -> str | None:
    return f"https://www.instagram.com/p/{code}/" if code else None


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value or default)
    except (TypeError, ValueError):
        return default


def avg(values: list[int]) -> int:
    return round(sum(values) / len(values)) if values else 0


def media_metric_snapshot(medias: Iterable[Any]) -> tuple[dict[str, int], list[dict[str, Any]]]:
    likes: list[int] = []
    comments: list[int] = []
    views: list[int] = []
    posts: list[dict[str, Any]] = []
    for media in medias:
        like_count = safe_int(getattr(media, "like_count", 0))
        comment_count = safe_int(getattr(media, "comment_count", 0))
        view_count = safe_int(getattr(media, "play_count", None) or getattr(media, "view_count", 0))
        likes.append(like_count)
        comments.append(comment_count)
        views.append(view_count)
        posts.append(
            {
                "id": str(getattr(media, "pk", "")),
                "code": getattr(media, "code", None),
                "url": media_url(getattr(media, "code", None)),
                "takenAt": getattr(getattr(media, "taken_at", None), "isoformat", lambda: None)(),
                "caption": getattr(media, "caption_text", "") or "",
                "likeCount": like_count,
                "commentCount": comment_count,
                "viewCount": view_count,
                "productType": getattr(media, "product_type", None),
            }
        )
    return {
        "avgLikes": avg(likes),
        "avgComments": avg(comments),
        "avgViews": avg([item for item in views if item > 0]),
        "postsChecked": len(posts),
    }, posts


def classify_exception(exc: BaseException) -> tuple[str, int | None]:
    if isinstance(exc, InstagramCollectorError):
        return exc.code, exc.cooldown_seconds
    name = exc.__class__.__name__
    message = str(exc)
    lowered_message = message.lower()
    if name in {"BadPassword", "BadCredentials"}:
        return "bad_credentials", None
    if "automation" in lowered_message or "automated" in lowered_message:
        return "automation_warning", 24 * 60 * 60
    if name in {"ChallengeRequired", "RecaptchaChallengeForm", "SelectContactPointRecoveryForm", "CaptchaChallengeRequired"}:
        return "challenge_required", 24 * 60 * 60
    if name in {"FeedbackRequired", "PleaseWaitFewMinutes", "RateLimitError", "ClientThrottledError", "SentryBlock"}:
        return "rate_limited", 12 * 60 * 60
    if name in {"LoginRequired", "ClientLoginRequired", "ReloginAttemptExceeded"}:
        return "login_required", 6 * 60 * 60
    if name in {"ProxyAddressIsBlocked"}:
        return "proxy_blocked", 6 * 60 * 60
    if name in {"ClientConnectionError", "ClientRequestTimeout", "ProxyError", "HTTPError", "TimeoutError", "SSLError"}:
        return "network_or_proxy", 10 * 60
    if "login_required" in lowered_message or "login required" in lowered_message:
        return "login_required", 6 * 60 * 60
    if "challenge" in lowered_message:
        return "challenge_required", 24 * 60 * 60
    if "timeout" in lowered_message or "timed out" in lowered_message or "ssl" in lowered_message or "certificate verify failed" in lowered_message:
        return "network_or_proxy", 10 * 60
    if "wait" in lowered_message or "rate" in lowered_message or "429" in message:
        return "rate_limited", 12 * 60 * 60
    return "unknown_instagram_error", None


def masked_contact_hint(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if MASKED_CONTACT_RE.search(text):
        return text
    if "@" in text:
        local, _, domain = text.partition("@")
        if not local or not domain:
            return "[redacted-email]"
        return f"{local[:1]}***@{domain}"
    digits = re.sub(r"\D+", "", text)
    if len(digits) >= 4:
        return f"***{digits[-4:]}"
    return "[redacted-contact]"


def challenge_payload_summary(payload: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for key in ("message", "error_type", "error_title", "error_body", "status", "action", "type", "step_name", "bloks_action"):
        value = payload.get(key)
        if value not in (None, "", [], {}):
            summary[key] = value
    for key in ("two_factor_required", "sms_two_factor_on", "totp_two_factor_on"):
        if key in payload:
            summary[key] = bool(payload.get(key))

    challenge = payload.get("challenge")
    if isinstance(challenge, dict):
        challenge_summary: dict[str, Any] = {}
        for key in ("api_path", "challengeType", "challenge_type_enum_str", "step_name"):
            value = challenge.get(key)
            if value not in (None, "", [], {}):
                challenge_summary[key] = value
        contact_point = masked_contact_hint(challenge.get("contact_point"))
        if contact_point:
            challenge_summary["contact_point"] = contact_point
        navigation = challenge.get("navigation")
        if isinstance(navigation, dict):
            forward = navigation.get("forward")
            if forward:
                challenge_summary["navigation_forward"] = forward
        if challenge_summary:
            summary["challenge"] = challenge_summary

    contact_point = masked_contact_hint(payload.get("contact_point"))
    if contact_point:
        summary["contact_point"] = contact_point

    two_factor_info = payload.get("two_factor_info")
    if isinstance(two_factor_info, dict):
        two_factor_summary: dict[str, Any] = {}
        for key in ("username", "obfuscated_phone_number_2", "two_factor_identifier"):
            if key == "two_factor_identifier":
                continue
            value = two_factor_info.get(key)
            if value:
                two_factor_summary[key] = masked_contact_hint(value) if "phone" in key else value
        if two_factor_summary:
            summary["two_factor_info"] = two_factor_summary

    return summary


def exception_diagnostic_summary(exc: BaseException) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for source in (getattr(exc, "__dict__", None), getattr(getattr(exc, "response", None), "__dict__", None)):
        if isinstance(source, dict):
            payload.update({key: value for key, value in source.items() if key != "response"})
    for key in (
        "message",
        "error_type",
        "error_title",
        "error_body",
        "status",
        "action",
        "type",
        "step_name",
        "bloks_action",
        "challenge",
        "contact_point",
        "two_factor_required",
        "sms_two_factor_on",
        "totp_two_factor_on",
        "two_factor_info",
    ):
        value = getattr(exc, key, None)
        if value not in (None, "", [], {}):
            payload.setdefault(key, value)
    return challenge_payload_summary(payload)


def diagnostic_message_suffix(summary: dict[str, Any]) -> str:
    bits: list[str] = []
    challenge = summary.get("challenge")
    if isinstance(challenge, dict):
        if challenge.get("challengeType"):
            bits.append(f"challengeType={challenge['challengeType']}")
        elif challenge.get("challenge_type_enum_str"):
            bits.append(f"challengeType={challenge['challenge_type_enum_str']}")
        if challenge.get("step_name"):
            bits.append(f"step={challenge['step_name']}")
        if challenge.get("api_path"):
            bits.append(f"apiPath={challenge['api_path']}")
        if challenge.get("navigation_forward"):
            bits.append(f"next={challenge['navigation_forward']}")
        if challenge.get("contact_point"):
            bits.append(f"contact={challenge['contact_point']}")
    if summary.get("bloks_action"):
        bits.append(f"bloksAction={summary['bloks_action']}")
    if summary.get("step_name"):
        bits.append(f"step={summary['step_name']}")
    if summary.get("contact_point"):
        bits.append(f"contact={summary['contact_point']}")
    if summary.get("error_title"):
        bits.append(f"title={summary['error_title']}")
    if summary.get("error_body"):
        bits.append(f"body={summary['error_body']}")
    if summary.get("two_factor_required"):
        bits.append("twoFactorRequired=true")
    two_factor_info = summary.get("two_factor_info")
    if isinstance(two_factor_info, dict) and two_factor_info.get("obfuscated_phone_number_2"):
        bits.append(f"phone={two_factor_info['obfuscated_phone_number_2']}")
    return f" ({', '.join(bits)})" if bits else ""


def raise_if_terminal_error(code: str, message: str, cooldown_seconds: int | None = None) -> None:
    if code in TERMINAL_ERROR_CODES:
        raise InstagramCollectorError(code, message, cooldown_seconds)


def raise_collector_error_from_exception(operation: str, exc: BaseException) -> None:
    code, cooldown = classify_exception(exc)
    summary = exception_diagnostic_summary(exc)
    message = f"{operation} failed: {exc}{diagnostic_message_suffix(summary)}"
    event_data = {"operation": operation, "cooldownSeconds": cooldown}
    if summary:
        event_data["diagnostic"] = summary
    emit_event(CollectorEvent("error", code, message, event_data))
    raise InstagramCollectorError(code, message, cooldown) from exc


def load_config(path: str | None) -> InstagramCollectorConfig:
    data: dict[str, Any] = {}
    if path:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    return InstagramCollectorConfig(
        keywords=list(data.get("keywords") or []),
        hashtags=list(data.get("hashtags") or []),
        countries=[str(item).upper() for item in data.get("countries", data.get("country_codes", ["RU", "KZ"]))],
        excluded_profile_ids=[str(item) for item in data.get("excludedProfileIds", data.get("excluded_profile_ids", []))],
        require_geo_match=bool(data.get("requireGeoMatch", data.get("require_geo_match", False))),
        min_followers=int(data.get("minFollowers", data.get("min_followers", 20_000))),
        max_followers=int(data.get("maxFollowers", data.get("max_followers", 60_000))),
        max_keywords_per_run=int(data.get("maxKeywordsPerRun", data.get("max_keywords_per_run", 3))),
        max_tags_per_keyword=int(data.get("maxTagsPerKeyword", data.get("max_tags_per_keyword", 2))),
        max_medias_per_tag=int(data.get("maxMediasPerTag", data.get("max_medias_per_tag", 12))),
        max_profiles_per_run=int(data.get("maxProfilesPerRun", data.get("max_profiles_per_run", 5))),
        max_profile_checks_per_run=int(data.get("maxProfileChecksPerRun", data.get("max_profile_checks_per_run", 12))),
        recent_media_per_profile=int(data.get("recentMediaPerProfile", data.get("recent_media_per_profile", 0))),
        profile_delay_min_sec=float(data.get("profileDelayMinSec", data.get("profile_delay_min_sec", 45))),
        profile_delay_max_sec=float(data.get("profileDelayMaxSec", data.get("profile_delay_max_sec", 120))),
        media_delay_min_sec=float(data.get("mediaDelayMinSec", data.get("media_delay_min_sec", 30))),
        media_delay_max_sec=float(data.get("mediaDelayMaxSec", data.get("media_delay_max_sec", 90))),
        session_file=str(
            os.environ.get("INSTAGRAM_SESSION_FILE")
            or data.get("sessionFile", data.get("session_file", ".instagram/session.json"))
        ),
        settings_dir=str(data.get("settingsDir", data.get("settings_dir", ".instagram"))),
        proxy_pool=list(data.get("proxyPool", data.get("proxy_pool", [])) or []),
        use_hashtag_search=bool(data.get("useHashtagSearch", data.get("use_hashtag_search", True))),
        use_derived_hashtags=bool(data.get("useDerivedHashtags", data.get("use_derived_hashtags", True))),
        include_recent_posts_fallback=bool(data.get("includeRecentPostsFallback", data.get("include_recent_posts_fallback", True))),
        include_keyword_reels_search=bool(data.get("includeKeywordReelsSearch", data.get("include_keyword_reels_search", True))),
        include_user_search=bool(data.get("includeUserSearch", data.get("include_user_search", True))),
        include_account_serp_search=bool(data.get("includeAccountSerpSearch", data.get("include_account_serp_search", True))),
        include_typeahead_search=bool(data.get("includeTypeaheadSearch", data.get("include_typeahead_search", True))),
        max_user_search_results_per_keyword=int(data.get("maxUserSearchResultsPerKeyword", data.get("max_user_search_results_per_keyword", 2))),
        public_request_retries_count=int(data.get("publicRequestRetriesCount", data.get("public_request_retries_count", 0))),
        public_request_retries_timeout=float(data.get("publicRequestRetriesTimeout", data.get("public_request_retries_timeout", 0))),
    )


def resolve_session_path(config: InstagramCollectorConfig) -> Path:
    session_path = Path(config.session_file)
    if session_path.is_absolute():
        return session_path
    return APP_ROOT / session_path


def load_session_settings_from_env() -> dict[str, Any] | None:
    raw = os.environ.get("INSTAGRAM_SESSION_SETTINGS", "").strip()
    encoded = os.environ.get("INSTAGRAM_SESSION_SETTINGS_B64", "").strip()
    if encoded:
        try:
            raw = base64.b64decode(encoded).decode("utf-8").strip()
        except Exception as exc:
            raise InstagramCollectorError(
                "invalid_session_settings",
                f"Instagram session settings are not valid base64: {exc}",
            ) from exc
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InstagramCollectorError(
            "invalid_session_settings",
            f"Instagram session settings are not valid JSON: {exc}",
        ) from exc
    if not isinstance(parsed, dict):
        raise InstagramCollectorError(
            "invalid_session_settings",
            "Instagram session settings must decode to a JSON object",
        )
    return parsed


def authenticate_client(
    cl: Any,
    username: str | None,
    password: str | None,
    sessionid: str | None,
    session_loaded: bool,
    invalid_session_file: bool,
    verification_code: str,
) -> None:
    """Prefer a persisted mobile session; browser sessionid is recovery only."""
    if session_loaded and cl.user_id:
        try:
            cl.account_info()
            return
        except Exception:
            if sessionid:
                cl.login_by_sessionid(sessionid)
                return
            if username and password:
                cl.login(username, password, relogin=True, verification_code=verification_code)
                return
            raise

    if sessionid:
        try:
            cl.login_by_sessionid(sessionid)
            return
        except Exception:
            if not username or not password:
                raise
            cl.login(username, password, relogin=True, verification_code=verification_code)
            return

    if not username or not password:
        raise InstagramCollectorError(
            "missing_credentials",
            "Instagram password, sessionid, or a valid saved session is required",
        )
    cl.login(username, password, relogin=invalid_session_file, verification_code=verification_code)

def create_client(config: InstagramCollectorConfig, proxy_rotator: ProxyRotator):
    configure_ssl_certificates()
    ensure_instagrapi_import_path()
    from instagrapi import Client

    proxy = proxy_rotator.current()
    cl = Client(
        proxy=proxy,
        public_request_retries_count=config.public_request_retries_count,
        public_request_retries_timeout=config.public_request_retries_timeout,
    )
    def apply_public_request_policy() -> None:
        cl.public_request_retries_count = config.public_request_retries_count
        cl.public_request_retries_timeout = config.public_request_retries_timeout

    session_path = resolve_session_path(config)
    session_path.parent.mkdir(parents=True, exist_ok=True)
    username = os.environ.get("INSTAGRAM_USERNAME") or os.environ.get("IG_USERNAME")
    password = os.environ.get("INSTAGRAM_PASSWORD") or os.environ.get("IG_PASSWORD")
    sessionid = os.environ.get("INSTAGRAM_SESSIONID")
    session_settings = load_session_settings_from_env()
    verification_code = os.environ.get("INSTAGRAM_VERIFICATION_CODE", "").strip()

    try:
        session_loaded = False
        invalid_session_file = False
        if session_settings:
            cl.set_settings(session_settings)
            session_loaded = True
            apply_public_request_policy()
            if proxy:
                cl.set_proxy(proxy)
        elif session_path.exists():
            session_loaded = True
            try:
                cl.load_settings(str(session_path))
            except (OSError, ValueError):
                session_loaded = False
                invalid_session_file = True
            apply_public_request_policy()
            if proxy:
                cl.set_proxy(proxy)

        if verification_code:
            cl.challenge_code_handler = lambda _username, _choice: verification_code

        authenticate_client(
            cl,
            username,
            password,
            sessionid,
            session_loaded,
            invalid_session_file,
            verification_code,
        )

        if username:
            account = cl.account_info()
            active_username = str(getattr(account, "username", "") or "").strip()
            if active_username and active_username.casefold() != username.strip().casefold():
                if not password:
                    raise InstagramCollectorError(
                        "session_account_mismatch",
                        f"Saved Instagram session belongs to another account, not {username}",
                    )
                cl.login(username, password, relogin=True, verification_code=verification_code)
                account = cl.account_info()
                active_username = str(getattr(account, "username", "") or "").strip()
                if active_username.casefold() != username.strip().casefold():
                    raise InstagramCollectorError(
                        "session_account_mismatch",
                        f"Instagram authenticated as {active_username or 'unknown'}, not {username}",
                    )

        apply_public_request_policy()
        cl.dump_settings(str(session_path))
    except InstagramCollectorError:
        raise
    except Exception as exc:
        code, _ = classify_exception(exc)
        if code in {"challenge_required", "login_required"}:
            try:
                cl.dump_settings(str(session_path))
            except Exception:
                pass
        raise_collector_error_from_exception("instagram_login_or_session", exc)
    attach_exception_handler(cl, proxy_rotator)
    return cl


def attach_exception_handler(client: Any, proxy_rotator: ProxyRotator) -> None:
    def handle_exception(cl: Any, exc: BaseException) -> bool:
        code, cooldown = classify_exception(exc)
        next_proxy = proxy_rotator.next()
        if next_proxy:
            cl.set_proxy(next_proxy)
        emit_event(
            CollectorEvent(
                level="warn",
                code=code,
                message=str(exc),
                data={"cooldownSeconds": cooldown, "proxyChanged": bool(next_proxy)},
            )
        )
        raise InstagramCollectorError(code, str(exc), cooldown)

    client.handle_exception = handle_exception


def sleep_between(min_sec: float, max_sec: float) -> None:
    delay = random.uniform(min_sec, max(max_sec, min_sec))
    time.sleep(delay)


def sleep_before_discovery_request(config: InstagramCollectorConfig) -> None:
    sleep_between(config.media_delay_min_sec, config.media_delay_max_sec)


def search_tags_for_keyword(client: Any, keyword: str, config: InstagramCollectorConfig) -> list[str]:
    tags = candidate_tags_for_keyword(keyword) if config.use_derived_hashtags else []
    if config.use_hashtag_search:
        try:
            found = client.search_hashtags(keyword)
            tags.extend(getattr(item, "name", "") for item in found)
        except Exception as exc:
            code, cooldown = classify_exception(exc)
            emit_event(CollectorEvent("warn", code, f"Hashtag search failed for {keyword}: {exc}", {"keyword": keyword, "cooldownSeconds": cooldown}))
            raise_if_terminal_error(code, str(exc), cooldown)
    explicit = [normalize_hashtag(tag) for tag in config.hashtags]
    return unique_non_empty([*explicit, *tags])[: config.max_tags_per_keyword]


def fetch_tag_medias(client: Any, tag: str, config: InstagramCollectorConfig) -> list[Any]:
    try:
        return list(client.hashtag_medias_reels_v1(tag, amount=config.max_medias_per_tag))
    except Exception as exc:
        code, cooldown = classify_exception(exc)
        emit_event(CollectorEvent("warn", code, f"Reels fetch failed for #{tag}: {exc}", {"tag": tag, "cooldownSeconds": cooldown}))
        raise_if_terminal_error(code, str(exc), cooldown)
        if not config.include_recent_posts_fallback:
            return []
    try:
        return list(client.hashtag_medias_recent(tag, amount=config.max_medias_per_tag))
    except Exception as exc:
        code, cooldown = classify_exception(exc)
        emit_event(CollectorEvent("warn", code, f"Recent media fallback failed for #{tag}: {exc}", {"tag": tag, "cooldownSeconds": cooldown}))
        raise_if_terminal_error(code, str(exc), cooldown)
        return []


def object_from_ig_payload(value: Any) -> Any:
    if isinstance(value, dict):
        return SimpleNamespace(**{key: object_from_ig_payload(item) for key, item in value.items()})
    if isinstance(value, list):
        return [object_from_ig_payload(item) for item in value]
    return value


def media_from_reels_payload(payload: dict[str, Any], limit: int) -> list[Any]:
    medias: list[Any] = []
    for module in payload.get("reels_serp_modules", []) or []:
        for clip in module.get("clips", []) or []:
            media = clip.get("media") if isinstance(clip, dict) else None
            if not isinstance(media, dict):
                continue
            medias.append(object_from_ig_payload(media))
            if len(medias) >= limit:
                return medias
    return medias


def fetch_keyword_reels(client: Any, query: str, config: InstagramCollectorConfig) -> list[Any]:
    if not config.include_keyword_reels_search:
        return []
    search_fn = getattr(client, "fbsearch_reels_v2", None)
    if not callable(search_fn):
        return []
    try:
        payload = search_fn(query)
        return media_from_reels_payload(payload if isinstance(payload, dict) else {}, config.max_medias_per_tag)
    except Exception as exc:
        code, cooldown = classify_exception(exc)
        emit_event(CollectorEvent("warn", code, f"Keyword reels search failed for {query}: {exc}", {"query": query, "cooldownSeconds": cooldown}))
        raise_if_terminal_error(code, str(exc), cooldown)
        return []


def search_users_for_keyword(client: Any, keyword: str, config: InstagramCollectorConfig) -> list[Any]:
    if not config.include_user_search:
        return []
    try:
        return list(client.search_users(keyword, count=config.max_user_search_results_per_keyword))
    except TypeError:
        try:
            return list(client.search_users(keyword))
        except Exception as exc:
            code, cooldown = classify_exception(exc)
            emit_event(CollectorEvent("warn", code, f"User search failed for {keyword}: {exc}", {"keyword": keyword, "cooldownSeconds": cooldown}))
            raise_if_terminal_error(code, str(exc), cooldown)
            return []
    except Exception as exc:
        code, cooldown = classify_exception(exc)
        emit_event(CollectorEvent("warn", code, f"User search failed for {keyword}: {exc}", {"keyword": keyword, "cooldownSeconds": cooldown}))
        raise_if_terminal_error(code, str(exc), cooldown)
        return []


def search_accounts_serp_for_keyword(client: Any, keyword: str, config: InstagramCollectorConfig) -> list[Any]:
    if not config.include_user_search or not config.include_account_serp_search:
        return []
    search_fn = getattr(client, "fbsearch_accounts_v2", None)
    if not callable(search_fn):
        return []
    try:
        payload = search_fn(keyword)
        users = payload.get("users", []) if isinstance(payload, dict) else []
        return list(users)[: config.max_user_search_results_per_keyword]
    except Exception as exc:
        code, cooldown = classify_exception(exc)
        emit_event(CollectorEvent("warn", code, f"Account SERP search failed for {keyword}: {exc}", {"keyword": keyword, "cooldownSeconds": cooldown}))
        raise_if_terminal_error(code, str(exc), cooldown)
        return []


def search_typeahead_for_keyword(client: Any, keyword: str, config: InstagramCollectorConfig) -> list[Any]:
    if not config.include_user_search or not config.include_typeahead_search:
        return []
    direct_users = fetch_typeahead_stream_users(client, keyword, config)
    if direct_users:
        return direct_users
    search_fn = getattr(client, "fbsearch_typehead", None)
    if not callable(search_fn):
        return []
    try:
        return list(search_fn(keyword))[: config.max_user_search_results_per_keyword]
    except Exception as exc:
        response = getattr(exc, "response", None)
        raw_text = getattr(response, "text", "")
        if raw_text:
            parsed = parse_typeahead_stream_text(raw_text)
            if parsed:
                emit_event(CollectorEvent("info", "typeahead_stream_recovered", f"Recovered typeahead stream for {keyword}", {"keyword": keyword, "rows": len(raw_text.splitlines()), "users": len(parsed)}))
                return parsed[: config.max_user_search_results_per_keyword]
        code, cooldown = classify_exception(exc)
        emit_event(CollectorEvent("warn", code, f"Typeahead search failed for {keyword}: {exc}", {"keyword": keyword, "cooldownSeconds": cooldown}))
        raise_if_terminal_error(code, str(exc), cooldown)
        return []


def fetch_typeahead_stream_users(client: Any, keyword: str, config: InstagramCollectorConfig) -> list[Any]:
    private = getattr(client, "private", None)
    headers = getattr(private, "headers", None)
    get = getattr(private, "get", None)
    if private is None or headers is None or not callable(get):
        return []
    try:
        ensure_instagrapi_import_path()
        from instagrapi import config as ig_config

        headers.update(getattr(client, "base_headers", {}))
        authorization = getattr(client, "authorization", None)
        if authorization:
            headers.update({"Authorization": authorization})
        params = {
            "search_surface": "typeahead_search_page",
            "timezone_offset": getattr(client, "timezone_offset", 0),
            "query": keyword,
            "context": "blended",
        }
        url = f"https://{ig_config.API_DOMAIN}/api/v1/fbsearch/typeahead_stream/"
        response = get(url, params=params, proxies=getattr(private, "proxies", None))
        response.raise_for_status()
        parsed = parse_typeahead_stream_text(response.text)
        if parsed:
            emit_event(CollectorEvent("info", "typeahead_stream_recovered", f"Recovered typeahead stream for {keyword}", {"keyword": keyword, "rows": len(response.text.splitlines()), "users": len(parsed)}))
        return parsed[: config.max_user_search_results_per_keyword]
    except Exception as exc:
        code, cooldown = classify_exception(exc)
        emit_event(CollectorEvent("warn", code, f"Typeahead stream request failed for {keyword}: {exc}", {"keyword": keyword, "cooldownSeconds": cooldown}))
        raise_if_terminal_error(code, str(exc), cooldown)
        return []


def search_user_sources_for_keyword(client: Any, keyword: str, config: InstagramCollectorConfig) -> list[tuple[str, Any]]:
    results: list[tuple[str, Any]] = []
    layers = [
        ("account_serp_search", search_accounts_serp_for_keyword),
        ("typeahead_search", search_typeahead_for_keyword),
        ("user_search", search_users_for_keyword),
    ]
    for layer, search_fn in layers:
        sleep_before_discovery_request(config)
        users = search_fn(client, keyword, config)
        results.extend((layer, user) for user in users)
    return results


def parse_typeahead_stream_text(text: str) -> list[Any]:
    users: list[Any] = []
    seen: set[str] = set()
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        line_users = payload.get("users", []) if isinstance(payload, dict) else []
        if not line_users and isinstance(payload, dict):
            for row in payload.get("stream_rows", []) or []:
                if isinstance(row, dict):
                    line_users.extend(row.get("users", []) or [])
        for user in line_users:
            user_id = search_user_id(user)
            if not user_id or user_id in seen:
                continue
            seen.add(user_id)
            users.append(user)
    return users


def search_user_id(user_item: Any) -> str:
    if isinstance(user_item, dict):
        nested = user_item.get("user")
        if isinstance(nested, dict):
            return str(nested.get("pk") or nested.get("id") or nested.get("pk_id") or "")
        return str(user_item.get("pk") or user_item.get("id") or user_item.get("pk_id") or "")
    return str(getattr(user_item, "pk", "") or getattr(user_item, "id", "") or "")


def fetch_candidate_for_user(
    client: Any,
    user_id: str,
    keyword: str,
    tag: str,
    source_media: Any | None,
    matched_by: str,
    config: InstagramCollectorConfig,
    stats: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    sleep_between(config.profile_delay_min_sec, config.profile_delay_max_sec)
    try:
        user = client.user_info(user_id)
    except Exception as exc:
        code, cooldown = classify_exception(exc)
        emit_event(CollectorEvent("warn", code, f"Profile fetch failed: {exc}", {"userId": user_id, "cooldownSeconds": cooldown}))
        raise_if_terminal_error(code, str(exc), cooldown)
        increment_skip_reason(stats, "profile_error")
        return None

    followers = safe_int(getattr(user, "follower_count", 0))
    if followers < config.min_followers:
        increment_skip_reason(stats, "followers_too_low")
        return None
    if followers > config.max_followers:
        increment_skip_reason(stats, "followers_too_high")
        return None
    if bool(getattr(user, "is_private", False)):
        increment_skip_reason(stats, "private_profile")
        return None

    recent = []
    if config.recent_media_per_profile > 0:
        sleep_between(config.media_delay_min_sec, config.media_delay_max_sec)
        try:
            recent = list(client.user_medias(user_id, amount=config.recent_media_per_profile))
        except Exception as exc:
            code, cooldown = classify_exception(exc)
            emit_event(CollectorEvent("warn", code, f"Recent media fetch failed: {exc}", {"userId": user_id, "cooldownSeconds": cooldown}))
            raise_if_terminal_error(code, str(exc), cooldown)
    candidate = build_candidate(user, keyword, tag, source_media, recent, matched_by=matched_by)
    allowed_countries = {item.upper() for item in config.countries}
    if config.require_geo_match and candidate.get("geoGuess") not in allowed_countries:
        increment_skip_reason(stats, "geo_mismatch")
        return None
    return candidate


def increment_skip_reason(stats: dict[str, Any] | None, reason: str) -> None:
    if stats is None:
        return
    skipped = stats.setdefault("skipped", {})
    skipped[reason] = int(skipped.get(reason, 0)) + 1


def candidate_reason(tag: str, followers: int, geo: str | None, contacts: dict[str, list[str]]) -> str:
    reason_bits = [f"найден по #{tag}", f"{followers:,}".replace(",", " ") + " подписчиков"]
    if geo:
        reason_bits.append(f"гео похоже на {geo}")
    if contacts["emails"] or contacts["phones"] or contacts["urls"]:
        reason_bits.append("есть контакты")
    return ", ".join(reason_bits)


def build_candidate(
    user: Any,
    keyword: str,
    tag: str,
    source_media: Any | None,
    recent_medias: list[Any],
    matched_by: str = "hashtag_reels",
) -> dict[str, Any]:
    bio = getattr(user, "biography", "") or ""
    external_url = str(getattr(user, "external_url", "") or "")
    caption = source_caption(source_media)
    metrics, posts = media_metric_snapshot(recent_medias)
    public_email = getattr(user, "public_email", None)
    public_phone = getattr(user, "public_phone_number", None) or getattr(user, "contact_phone_number", None)
    contacts = extract_contacts(bio, external_url, public_email, public_phone, caption, *(item.get("caption") for item in posts))
    username = getattr(user, "username", "")
    geo = guess_geo(
        getattr(user, "full_name", "") or username,
        username,
        bio,
        external_url,
        public_email,
        public_phone,
        tag,
        caption,
        *(item.get("caption") for item in posts[:3]),
    )
    followers = safe_int(getattr(user, "follower_count", 0))

    return {
        "platform": "instagram",
        "platformProfileId": str(getattr(user, "pk", "")),
        "username": username,
        "displayName": getattr(user, "full_name", "") or username,
        "profileUrl": f"https://www.instagram.com/{username}/",
        "followers": followers,
        "bio": bio,
        "externalUrl": external_url,
        "contacts": contacts,
        "sourceKeyword": keyword,
        "sourceTag": tag,
        "matchedBy": matched_by,
        "lastPosts": posts,
        "metrics": metrics,
        "geoGuess": geo,
        "reason": candidate_reason(tag, followers, geo, contacts),
        "raw": {
            "sourceMedia": {
                "id": str(getattr(source_media, "pk", "")),
                "code": getattr(source_media, "code", None),
                "url": media_url(getattr(source_media, "code", None)),
                "likeCount": safe_int(getattr(source_media, "like_count", 0)),
                "commentCount": safe_int(getattr(source_media, "comment_count", 0)),
                "viewCount": safe_int(getattr(source_media, "play_count", None) or getattr(source_media, "view_count", 0)),
                "caption": caption,
            },
            "isBusiness": bool(getattr(user, "is_business", False)),
            "isPrivate": bool(getattr(user, "is_private", False)),
            "isVerified": bool(getattr(user, "is_verified", False)),
            "mediaCount": safe_int(getattr(user, "media_count", 0)),
            "category": getattr(user, "category_name", None) or getattr(user, "category", None),
            "publicEmail": public_email,
            "publicPhone": public_phone,
        },
        "collectedAt": now_iso(),
    }


def enabled_discovery_layer_count(config: InstagramCollectorConfig) -> int:
    count = 1
    if config.include_keyword_reels_search:
        count += 1
    if config.include_user_search:
        count += 1
    return count


def discovery_layer_check_budget(config: InstagramCollectorConfig) -> int:
    return max(1, config.max_profile_checks_per_run // enabled_discovery_layer_count(config))


def collect(config: InstagramCollectorConfig) -> int:
    proxy_rotator = ProxyRotator(config.proxy_pool)
    client = create_client(config, proxy_rotator)
    emitted = 0
    profile_checks = 0
    seen_users: set[str] = set()
    excluded_users = {str(item).strip() for item in config.excluded_profile_ids if str(item).strip()}
    keywords = unique_non_empty(config.keywords)[: config.max_keywords_per_run]
    if not keywords and config.hashtags:
        keywords = [" ".join(config.hashtags)]

    emit_event(CollectorEvent("info", "instagram_collector_started", "Instagram collector started", {"keywords": keywords}))
    sleep_before_discovery_request(config)

    for keyword in keywords:
        layer_check_budget = discovery_layer_check_budget(config)
        hashtag_checks = 0
        for tag in search_tags_for_keyword(client, keyword, config):
            if emitted >= config.max_profiles_per_run:
                break
            if profile_checks >= config.max_profile_checks_per_run:
                break
            if hashtag_checks >= layer_check_budget:
                break
            emit_event(CollectorEvent("info", "hashtag_scan_started", f"Scanning #{tag}", {"keyword": keyword, "tag": tag}))
            sleep_before_discovery_request(config)
            medias = fetch_tag_medias(client, tag, config)
            tag_stats: dict[str, Any] = {
                "keyword": keyword,
                "tag": tag,
                "mediaFetched": len(medias),
                "profilesChecked": 0,
                "accepted": 0,
                "duplicates": 0,
                "skipped": {},
            }
            for media in medias:
                if emitted >= config.max_profiles_per_run:
                    break
                if profile_checks >= config.max_profile_checks_per_run:
                    break
                if hashtag_checks >= layer_check_budget:
                    break
                user_short = getattr(media, "user", None)
                user_id = str(getattr(user_short, "pk", "") or "")
                if not user_id:
                    increment_skip_reason(tag_stats, "missing_user_id")
                    continue
                if user_id in excluded_users:
                    tag_stats["duplicates"] += 1
                    increment_skip_reason(tag_stats, "already_known")
                    continue
                if user_id in seen_users:
                    tag_stats["duplicates"] += 1
                    continue
                seen_users.add(user_id)
                profile_checks += 1
                hashtag_checks += 1
                tag_stats["profilesChecked"] += 1
                candidate = fetch_candidate_for_user(client, user_id, keyword, tag, media, "hashtag_reels", config, tag_stats)
                if not candidate:
                    continue
                print(json.dumps(candidate, ensure_ascii=False), flush=True)
                emitted += 1
                tag_stats["accepted"] += 1
            emit_event(CollectorEvent("info", "tag_scan_finished", f"Finished #{tag}", tag_stats))
        if emitted >= config.max_profiles_per_run:
            break
        if profile_checks >= config.max_profile_checks_per_run:
            break
        if config.include_keyword_reels_search:
            keyword_reels_checks = 0
            for reels_query in unique_non_empty([keyword, *candidate_tags_for_keyword(keyword)])[: config.max_tags_per_keyword]:
                if emitted >= config.max_profiles_per_run:
                    break
                if profile_checks >= config.max_profile_checks_per_run:
                    break
                if keyword_reels_checks >= layer_check_budget:
                    break
                sleep_before_discovery_request(config)
                medias = fetch_keyword_reels(client, reels_query, config)
                reels_stats: dict[str, Any] = {
                    "keyword": keyword,
                    "query": reels_query,
                    "mediaFetched": len(medias),
                    "profilesChecked": 0,
                    "accepted": 0,
                    "duplicates": 0,
                    "skipped": {},
                }
                for media in medias:
                    if emitted >= config.max_profiles_per_run:
                        break
                    if profile_checks >= config.max_profile_checks_per_run:
                        break
                    if keyword_reels_checks >= layer_check_budget:
                        break
                    user_short = getattr(media, "user", None)
                    user_id = search_user_id(user_short)
                    if not user_id:
                        increment_skip_reason(reels_stats, "missing_user_id")
                        continue
                    if user_id in excluded_users:
                        reels_stats["duplicates"] += 1
                        increment_skip_reason(reels_stats, "already_known")
                        continue
                    if user_id in seen_users:
                        reels_stats["duplicates"] += 1
                        continue
                    seen_users.add(user_id)
                    profile_checks += 1
                    keyword_reels_checks += 1
                    reels_stats["profilesChecked"] += 1
                    candidate = fetch_candidate_for_user(client, user_id, keyword, reels_query, media, "keyword_reels", config, reels_stats)
                    if not candidate:
                        continue
                    print(json.dumps(candidate, ensure_ascii=False), flush=True)
                    emitted += 1
                    reels_stats["accepted"] += 1
                emit_event(CollectorEvent("info", "keyword_reels_finished", f"Finished reels search {reels_query}", reels_stats))
        if emitted >= config.max_profiles_per_run:
            break
        if profile_checks >= config.max_profile_checks_per_run:
            break
        user_search_stats: dict[str, dict[str, Any]] = {}
        user_search_checks = 0
        for layer, user_short in search_user_sources_for_keyword(client, keyword, config):
            if emitted >= config.max_profiles_per_run:
                break
            if profile_checks >= config.max_profile_checks_per_run:
                break
            if user_search_checks >= layer_check_budget:
                break
            layer_stats = user_search_stats.setdefault(layer, {
                "keyword": keyword,
                "layer": layer,
                "profilesChecked": 0,
                "accepted": 0,
                "duplicates": 0,
                "skipped": {},
            })
            user_id = search_user_id(user_short)
            if not user_id:
                increment_skip_reason(layer_stats, "missing_user_id")
                continue
            if user_id in excluded_users:
                layer_stats["duplicates"] += 1
                increment_skip_reason(layer_stats, "already_known")
                continue
            if user_id in seen_users:
                layer_stats["duplicates"] += 1
                continue
            seen_users.add(user_id)
            profile_checks += 1
            user_search_checks += 1
            layer_stats["profilesChecked"] += 1
            candidate = fetch_candidate_for_user(client, user_id, keyword, keyword, None, layer, config, layer_stats)
            if not candidate:
                continue
            print(json.dumps(candidate, ensure_ascii=False), flush=True)
            emitted += 1
            layer_stats["accepted"] += 1
        for layer_stats in user_search_stats.values():
            emit_event(CollectorEvent("info", "user_search_finished", f"Finished {layer_stats['layer']} for {keyword}", layer_stats))
        if emitted >= config.max_profiles_per_run:
            break

    emit_event(CollectorEvent("info", "instagram_collector_finished", "Instagram collector finished", {"emitted": emitted, "profileChecks": profile_checks}))
    return emitted


def login_check(
    config: InstagramCollectorConfig,
    client_factory=create_client,
    event_emitter=emit_event,
) -> int:
    proxy_rotator = ProxyRotator(config.proxy_pool)
    client = client_factory(config, proxy_rotator)
    session_path = resolve_session_path(config)
    try:
        client.account_info()
    except Exception as exc:
        raise_collector_error_from_exception("instagram_login_check", exc)
    username = os.environ.get("INSTAGRAM_USERNAME") or os.environ.get("IG_USERNAME")
    event_emitter(
        CollectorEvent(
            "info",
            "instagram_login_check_ok",
            "Instagram login/session check succeeded",
            {
                "username": username,
                "proxyConfigured": bool(proxy_rotator.current()),
                "sessionFile": str(session_path),
            },
        )
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect Instagram blogger candidates via instagrapi.")
    parser.add_argument("--config", help="Path to JSON config file")
    parser.add_argument("--keyword", action="append", default=[], help="Keyword to scan. Can be repeated.")
    parser.add_argument("--hashtag", action="append", default=[], help="Hashtag to scan. Can be repeated.")
    parser.add_argument("--country", action="append", default=[], help="Allowed market/country guess such as RU or KZ. Can be repeated.")
    parser.add_argument("--exclude-profile-id", action="append", default=[], help="Instagram platform profile id to skip before profile enrichment. Can be repeated.")
    parser.add_argument("--require-geo-match", action="store_true", help="Skip profiles when language/description does not match configured countries")
    parser.add_argument("--min-followers", type=int)
    parser.add_argument("--max-followers", type=int)
    parser.add_argument("--max-profiles", type=int)
    parser.add_argument("--max-profile-checks", type=int)
    parser.add_argument("--max-medias-per-tag", type=int)
    parser.add_argument("--recent-media-per-profile", type=int)
    parser.add_argument("--profile-delay-min-sec", type=float)
    parser.add_argument("--profile-delay-max-sec", type=float)
    parser.add_argument("--media-delay-min-sec", type=float)
    parser.add_argument("--media-delay-max-sec", type=float)
    parser.add_argument("--no-hashtag-search", action="store_true", help="Only use explicit/derived hashtag names without Instagram hashtag autocomplete")
    parser.add_argument("--no-derived-hashtags", action="store_true", help="Only use explicit hashtag names from config/CLI")
    parser.add_argument("--no-keyword-reels-search", action="store_true", help="Disable direct Instagram reels search by keyword/alias")
    parser.add_argument("--no-user-search", action="store_true", help="Disable direct Instagram user search by keyword")
    parser.add_argument("--no-account-serp-search", action="store_true", help="Disable Instagram Accounts tab search by keyword")
    parser.add_argument("--no-typeahead-search", action="store_true", help="Disable Instagram typeahead account suggestions by keyword")
    parser.add_argument("--max-tags-per-keyword", type=int, help="Max explicit/derived hashtag names per keyword")
    parser.add_argument("--max-user-search-results", type=int, help="Max direct user search results per keyword")
    parser.add_argument("--login-check", action="store_true", help="Login and save/reuse session without scraping profiles")
    parser.add_argument("--self-test", action="store_true", help="Print resolved config and exit without Instagram login")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = load_config(args.config)
    if args.keyword:
        config.keywords.extend(args.keyword)
    if args.hashtag:
        config.hashtags.extend(args.hashtag)
    if args.country:
        config.countries = [item.upper() for item in args.country]
    if args.exclude_profile_id:
        config.excluded_profile_ids.extend(args.exclude_profile_id)
    if args.require_geo_match:
        config.require_geo_match = True
    if args.min_followers is not None:
        config.min_followers = args.min_followers
    if args.max_followers is not None:
        config.max_followers = args.max_followers
    if args.max_profiles is not None:
        config.max_profiles_per_run = args.max_profiles
    if args.max_profile_checks is not None:
        config.max_profile_checks_per_run = args.max_profile_checks
    if args.max_medias_per_tag is not None:
        config.max_medias_per_tag = args.max_medias_per_tag
    if args.recent_media_per_profile is not None:
        config.recent_media_per_profile = args.recent_media_per_profile
    if args.profile_delay_min_sec is not None:
        config.profile_delay_min_sec = args.profile_delay_min_sec
    if args.profile_delay_max_sec is not None:
        config.profile_delay_max_sec = args.profile_delay_max_sec
    if args.media_delay_min_sec is not None:
        config.media_delay_min_sec = args.media_delay_min_sec
    if args.media_delay_max_sec is not None:
        config.media_delay_max_sec = args.media_delay_max_sec
    if args.no_hashtag_search:
        config.use_hashtag_search = False
    if args.no_derived_hashtags:
        config.use_derived_hashtags = False
    if args.no_keyword_reels_search:
        config.include_keyword_reels_search = False
    if args.no_user_search:
        config.include_user_search = False
    if args.no_account_serp_search:
        config.include_account_serp_search = False
    if args.no_typeahead_search:
        config.include_typeahead_search = False
    if args.max_tags_per_keyword is not None:
        config.max_tags_per_keyword = args.max_tags_per_keyword
    if args.max_user_search_results is not None:
        config.max_user_search_results_per_keyword = args.max_user_search_results
    if args.self_test:
        print(json.dumps({"config": asdict(config), "candidateTags": {kw: candidate_tags_for_keyword(kw) for kw in config.keywords}}, ensure_ascii=False, indent=2))
        return 0
    try:
        if args.login_check:
            return login_check(config)
        collect(config)
        return 0
    except InstagramCollectorError as exc:
        emit_event(CollectorEvent("error", exc.code, str(exc), {"cooldownSeconds": exc.cooldown_seconds}))
        return 2
    except KeyboardInterrupt:
        emit_event(CollectorEvent("warn", "interrupted", "Collector interrupted"))
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
