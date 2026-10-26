from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable


APP_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_VK_TOKEN_FILE = APP_ROOT / ".vk" / "token.json"


def configure_stdio() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


configure_stdio()


def ensure_vk_api_import_path() -> None:
    configured_path = os.environ.get("VK_API_REPO_PATH", "").strip()
    if not configured_path:
        return
    repo_path = Path(configured_path).resolve()
    if repo_path.exists() and str(repo_path) not in sys.path:
        sys.path.insert(0, str(repo_path))


def load_local_env() -> None:
    for env_path in (APP_ROOT / ".env.local", APP_ROOT / ".env"):
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
            cleaned = line.strip()
            if not cleaned or cleaned.startswith("#") or "=" not in cleaned:
                continue
            key, value = cleaned.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"'")
            if key and key not in os.environ:
                os.environ[key] = value


load_local_env()


@dataclass
class VkCollectorConfig:
    keywords: list[str] = field(default_factory=list)
    countries: list[str] = field(default_factory=lambda: ["RU", "KZ"])
    excluded_profile_ids: list[str] = field(default_factory=list)
    min_followers: int = 20_000
    max_followers: int = 60_000
    max_groups_per_run: int = 100
    max_group_checks_per_run: int = 300
    search_count_per_keyword: int = 100
    wall_posts_per_group: int = 10
    request_delay_min_sec: float = 0.35
    request_delay_max_sec: float = 1.25
    require_geo_match: bool = False
    use_derived_queries: bool = True
    max_search_queries_per_keyword: int = 8
    api_version: str = "5.199"
    token: str | None = None


@dataclass
class CollectorEvent:
    level: str
    code: str
    message: str
    data: dict[str, Any] = field(default_factory=dict)


class VkCollectorError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


EMAIL_RE = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+(?![\w.-])", re.I)
PHONE_RE = re.compile(r"(?<!\d)(?:\+7|8|7)[\s(.-]*\d{3}[\s).*-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?!\d)")
URL_RE = re.compile(r"(?:https?://|www\.)[^\s<>()]+", re.I)
CYRILLIC_RE = re.compile(r"[а-яё]", re.I)

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
KZ_MARKERS = ["казахстан", "алматы", "астана", "нур-султан", "шымкент", "караганда"]

TOPIC_QUERY_ALIASES = {
    "массаж лица": [
        "массаж лица",
        "фейсмассаж",
        "фейсфитнес",
        "face fitness",
        "face yoga",
        "самомассаж лица",
        "лимфодренаж лица",
        "омоложение лица",
        "косметолог",
    ],
    "фейсфитнес": ["фейсфитнес", "фейсмассаж", "face fitness", "face yoga", "самомассаж лица"],
    "face yoga": ["face yoga", "face fitness", "фейсфитнес", "фейсмассаж"],
    "facial massage": ["facial massage", "face massage", "фейсмассаж", "массаж лица"],
    "косметолог": ["косметолог", "косметология", "уход за лицом", "омоложение лица", "аппаратная косметология"],
    "уход за лицом": ["уход за лицом", "домашний уход", "косметолог", "косметология", "skin care"],
    "естественное омоложение": ["естественное омоложение", "омоложение лица", "фейсфитнес", "фейсмассаж"],
    "anti-age": ["anti-age", "antiage", "anti aging", "омоложение лица", "косметолог"],
    "лимфодренаж лица": ["лимфодренаж лица", "лимфодренажный массаж", "массаж лица", "фейсмассаж"],
    "тейпирование лица": ["тейпирование лица", "кинезиотейпирование лица", "face taping", "фейсфитнес"],
    "аппаратная косметология": ["аппаратная косметология", "косметолог", "rf лифтинг", "микротоки"],
    "домашний уход за лицом": ["домашний уход за лицом", "домашний уход", "уход за лицом", "косметолог"],
    "микротоки": ["микротоки", "микротоки лица", "аппаратная косметология", "косметолог"],
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def emit_event(event: CollectorEvent) -> None:
    print(json.dumps({"event": asdict(event), "collectedAt": now_iso()}, ensure_ascii=False), file=sys.stderr, flush=True)


def unique_non_empty(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        cleaned = str(value).strip().strip(".,;:)")
        key = cleaned.lower()
        if not cleaned or key in seen:
            continue
        seen.add(key)
        result.append(cleaned)
    return result


def search_queries_for_keyword(keyword: str, config: VkCollectorConfig) -> list[str]:
    base = keyword.strip()
    if not base:
        return []
    queries = [base]
    if config.use_derived_queries:
        lowered = base.lower().replace("ё", "е")
        for trigger, aliases in TOPIC_QUERY_ALIASES.items():
            if trigger.replace("ё", "е") in lowered:
                queries.extend(aliases)
    return unique_non_empty(queries)[: max(1, config.max_search_queries_per_keyword)]


def extract_contacts(*texts: str | None) -> dict[str, list[str]]:
    joined = "\n".join(item for item in texts if item)
    return {
        "emails": unique_non_empty(EMAIL_RE.findall(joined)),
        "phones": unique_non_empty(PHONE_RE.findall(joined)),
        "urls": unique_non_empty(URL_RE.findall(joined)),
    }


def group_text(group: dict[str, Any]) -> str:
    parts = [
        group.get("name"),
        group.get("screen_name"),
        group.get("description"),
        group.get("status"),
        group.get("activity"),
        group.get("site"),
    ]
    city = group.get("city")
    country = group.get("country")
    if isinstance(city, dict):
        parts.append(city.get("title"))
    if isinstance(country, dict):
        parts.append(country.get("title"))
        parts.append(country.get("code"))
    for contact in group.get("contacts") or []:
        if isinstance(contact, dict):
            parts.extend([contact.get("desc"), contact.get("email"), contact.get("phone")])
    return " ".join(str(item) for item in parts if item)


def guess_geo(*texts: str | None) -> str | None:
    joined = " ".join(item.lower() for item in texts if item)
    if any(marker in joined for marker in KZ_MARKERS) or "kz" in joined:
        return "KZ"
    if any(marker in joined for marker in RU_MARKERS) or ".ru" in joined:
        return "RU"
    if CYRILLIC_RE.search(joined):
        return "RU"
    return None


def normalize_vk_response_items(response: Any, key: str | None = None) -> list[dict[str, Any]]:
    if isinstance(response, dict):
        if key and isinstance(response.get(key), list):
            return [item for item in response[key] if isinstance(item, dict)]
        if isinstance(response.get("items"), list):
            return [item for item in response["items"] if isinstance(item, dict)]
        if isinstance(response.get("groups"), list):
            return [item for item in response["groups"] if isinstance(item, dict)]
    if isinstance(response, list):
        return [item for item in response if isinstance(item, dict)]
    return []


def get_api_token(config: VkCollectorConfig) -> str:
    token = (
        config.token
        or os.environ.get("VK_ACCESS_TOKEN", "")
        or token_from_cache()
    )
    if not token.strip():
        unsupported = os.environ.get("VK_SERVICE_TOKEN", "") or os.environ.get("VK_SERVER_TOKEN", "")
        if unsupported.strip():
            raise VkCollectorError(
                "vk_user_token_required",
                "VK groups.search requires a user access token; service/server tokens are not supported"
            )
        raise VkCollectorError(
            "vk_missing_token",
            "VK_ACCESS_TOKEN is not configured and .vk/token.json is missing"
        )
    return token.strip()


def token_from_cache() -> str:
    token_file = Path(os.environ.get("VK_TOKEN_FILE", DEFAULT_VK_TOKEN_FILE))
    if not token_file.exists():
        return ""
    try:
        payload = json.loads(token_file.read_text(encoding="utf-8"))
    except Exception:
        return ""
    token = str(payload.get("accessToken") or payload.get("access_token") or "")
    expires_at = payload.get("expiresAt") or payload.get("expires_at")
    if expires_at:
        try:
            parsed = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
            if parsed <= datetime.now(timezone.utc) + timedelta(minutes=5):
                return ""
        except Exception:
            return ""
    return token


def create_vk_api(config: VkCollectorConfig):
    ensure_vk_api_import_path()
    try:
        import vk_api  # type: ignore
    except Exception as exc:  # pragma: no cover
        raise VkCollectorError("vk_api_import_failed", f"Could not import the configured vk_api package: {exc}") from exc
    return vk_api.VkApi(token=get_api_token(config), api_version=config.api_version).get_api()


def safe_api_call(callable_obj, **kwargs):
    try:
        return callable_obj(**kwargs)
    except Exception as exc:
        raise VkCollectorError("vk_api_request_failed", str(exc)) from exc


def delay(config: VkCollectorConfig) -> None:
    max_delay = max(config.request_delay_max_sec, config.request_delay_min_sec)
    if max_delay <= 0:
        return
    time.sleep(random.uniform(max(0, config.request_delay_min_sec), max_delay))


def search_groups(vk: Any, keyword: str, config: VkCollectorConfig) -> list[dict[str, Any]]:
    collected: list[dict[str, Any]] = []
    page_size = min(1000, max(1, config.search_count_per_keyword))
    offset = 0
    while len(collected) < config.search_count_per_keyword:
        count = min(page_size, config.search_count_per_keyword - len(collected))
        response = safe_api_call(vk.groups.search, q=keyword, count=count, offset=offset)
        items = normalize_vk_response_items(response)
        if not items:
            break
        collected.extend(items)
        offset += len(items)
        if len(items) < count:
            break
        delay(config)
    emit_event(CollectorEvent("info", "vk_groups_search_finished", "VK groups.search finished", {
        "keyword": keyword,
        "groupsFound": len(collected),
    }))
    return collected


def get_group_details(vk: Any, group_id: str, config: VkCollectorConfig) -> dict[str, Any] | None:
    fields = ",".join([
        "members_count",
        "description",
        "status",
        "activity",
        "site",
        "contacts",
        "city",
        "country",
        "links",
        "verified",
        "is_closed",
    ])
    response = safe_api_call(vk.groups.getById, group_ids=group_id, fields=fields)
    items = normalize_vk_response_items(response, "groups")
    return items[0] if items else None


def get_group_wall_posts(vk: Any, group_id: str, config: VkCollectorConfig) -> list[dict[str, Any]]:
    if config.wall_posts_per_group <= 0:
        return []
    response = safe_api_call(vk.wall.get, owner_id=-int(group_id), count=min(config.wall_posts_per_group, 100), filter="owner")
    return normalize_vk_response_items(response)


def post_url(group_id: str, post: dict[str, Any]) -> str:
    post_id = post.get("id")
    return f"https://vk.com/wall-{group_id}_{post_id}" if post_id is not None else f"https://vk.com/club{group_id}"


def post_view_count(post: dict[str, Any]) -> int:
    views = post.get("views")
    if isinstance(views, dict) and isinstance(views.get("count"), int):
        return views["count"]
    return 0


def engagement_metrics(posts: list[dict[str, Any]]) -> dict[str, float | int]:
    if not posts:
        return {"avgLikes": 0, "avgComments": 0, "avgViews": 0, "postsChecked": 0}
    likes = [post.get("likes", {}).get("count", 0) if isinstance(post.get("likes"), dict) else 0 for post in posts]
    comments = [post.get("comments", {}).get("count", 0) if isinstance(post.get("comments"), dict) else 0 for post in posts]
    views = [post_view_count(post) for post in posts]
    count = len(posts)
    return {
        "avgLikes": round(sum(likes) / count, 2),
        "avgComments": round(sum(comments) / count, 2),
        "avgViews": round(sum(views) / count, 2),
        "postsChecked": count,
    }


def last_post_snapshots(group_id: str, posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    snapshots = []
    for post in posts:
        post_id = str(post.get("id") or "")
        if not post_id:
            continue
        snapshots.append({
            "id": post_id,
            "url": post_url(group_id, post),
            "takenAt": datetime.fromtimestamp(post.get("date", 0), timezone.utc).isoformat() if post.get("date") else None,
            "caption": str(post.get("text") or "")[:1000],
            "likeCount": post.get("likes", {}).get("count", 0) if isinstance(post.get("likes"), dict) else 0,
            "commentCount": post.get("comments", {}).get("count", 0) if isinstance(post.get("comments"), dict) else 0,
            "viewCount": post_view_count(post),
            "productType": "vk_wall_post",
        })
    return snapshots


def candidate_reason(keyword: str, followers: int, geo: str | None, contacts: dict[str, list[str]], posts_checked: int) -> str:
    parts = [f"найдено в VK по запросу «{keyword}»", f"{followers:,}".replace(",", " ") + " подписчиков"]
    if geo:
        parts.append(f"гео похоже на {geo}")
    if posts_checked:
        parts.append(f"проверено постов: {posts_checked}")
    if contacts["emails"] or contacts["phones"] or contacts["urls"]:
        parts.append("есть контакты")
    return ", ".join(parts)


def build_group_candidate(group: dict[str, Any], keyword: str, posts: list[dict[str, Any]]) -> dict[str, Any]:
    group_id = str(group.get("id") or "")
    screen_name = str(group.get("screen_name") or f"club{group_id}")
    description = str(group.get("description") or group.get("status") or group.get("activity") or "")
    full_text = group_text(group)
    contacts = extract_contacts(full_text)
    metrics = engagement_metrics(posts)
    geo = guess_geo(full_text)
    followers = int(group.get("members_count") or 0)
    profile_url = f"https://vk.com/{screen_name}"
    return {
        "platform": "vk",
        "platformProfileId": f"group:{group_id}",
        "username": screen_name,
        "displayName": str(group.get("name") or screen_name),
        "profileUrl": profile_url,
        "followers": followers,
        "bio": description,
        "externalUrl": str(group.get("site") or "") or None,
        "contacts": contacts,
        "sourceKeyword": keyword,
        "sourceTag": keyword,
        "matchedBy": "vk_groups_search",
        "lastPosts": last_post_snapshots(group_id, posts),
        "metrics": metrics,
        "geoGuess": geo,
        "reason": candidate_reason(keyword, followers, geo, contacts, int(metrics["postsChecked"])),
        "raw": {"group": group, "source": {"keyword": keyword, "method": "groups.search"}},
        "collectedAt": now_iso(),
    }


def should_skip_group(group: dict[str, Any], config: VkCollectorConfig) -> str | None:
    group_id = str(group.get("id") or "")
    platform_id = f"group:{group_id}"
    excluded = set(config.excluded_profile_ids)
    if group_id in excluded or platform_id in excluded:
        return "already_known"
    if group.get("is_closed") in (1, 2):
        return "closed_group"
    followers = int(group.get("members_count") or 0)
    if followers < config.min_followers:
        return "followers_too_low"
    if followers > config.max_followers:
        return "followers_too_high"
    if config.require_geo_match:
        geo = guess_geo(group_text(group))
        if config.countries and geo not in set(config.countries):
            return "geo_mismatch"
    return None


def login_check(config: VkCollectorConfig) -> int:
    vk = create_vk_api(config)
    response = safe_api_call(vk.groups.search, q="массаж лица", count=1)
    emit_event(CollectorEvent("info", "vk_token_check_ok", "VK token check succeeded", {
        "groupsFound": len(normalize_vk_response_items(response)),
    }))
    return 0


def collect(config: VkCollectorConfig) -> int:
    vk = create_vk_api(config)
    emitted = 0
    group_checks = 0
    seen_group_ids: set[str] = set()
    skipped: dict[str, int] = {}
    emit_event(CollectorEvent("info", "vk_collector_started", "VK collector started", {
        "keywords": config.keywords,
        "minFollowers": config.min_followers,
        "maxFollowers": config.max_followers,
        "maxGroups": config.max_groups_per_run,
        "maxGroupChecks": config.max_group_checks_per_run,
    }))

    for keyword in config.keywords:
        if emitted >= config.max_groups_per_run or group_checks >= config.max_group_checks_per_run:
            break
        for search_query in search_queries_for_keyword(keyword, config):
            if emitted >= config.max_groups_per_run or group_checks >= config.max_group_checks_per_run:
                break
            for group_ref in search_groups(vk, search_query, config):
                if emitted >= config.max_groups_per_run or group_checks >= config.max_group_checks_per_run:
                    break
                group_id = str(group_ref.get("id") or "")
                if not group_id or group_id in seen_group_ids:
                    continue
                seen_group_ids.add(group_id)
                group_checks += 1
                delay(config)
                try:
                    group = get_group_details(vk, group_id, config)
                    if not group:
                        skipped["group_not_found"] = skipped.get("group_not_found", 0) + 1
                        continue
                    skip_reason = should_skip_group(group, config)
                    if skip_reason:
                        skipped[skip_reason] = skipped.get(skip_reason, 0) + 1
                        continue
                    delay(config)
                    posts = get_group_wall_posts(vk, group_id, config)
                    candidate = build_group_candidate(group, keyword, posts)
                    candidate["raw"]["source"]["searchQuery"] = search_query
                    print(json.dumps(candidate, ensure_ascii=False), flush=True)
                    emitted += 1
                except VkCollectorError as exc:
                    skipped[exc.code] = skipped.get(exc.code, 0) + 1
                    emit_event(CollectorEvent("warn", exc.code, str(exc), {"groupId": group_id, "keyword": keyword, "searchQuery": search_query}))

    emit_event(CollectorEvent("info", "vk_collector_finished", "VK collector finished", {
        "emitted": emitted,
        "profileChecks": group_checks,
        "uniqueGroupsSeen": len(seen_group_ids),
        "skipped": skipped,
    }))
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect VK blogger/community candidates by keywords")
    parser.add_argument("--login-check", action="store_true")
    parser.add_argument("--keyword", action="append", default=[])
    parser.add_argument("--country", action="append", default=[])
    parser.add_argument("--exclude-profile-id", action="append", default=[])
    parser.add_argument("--min-followers", type=int, default=20_000)
    parser.add_argument("--max-followers", type=int, default=60_000)
    parser.add_argument("--max-groups", type=int, default=100)
    parser.add_argument("--max-group-checks", type=int, default=300)
    parser.add_argument("--search-count-per-keyword", type=int, default=100)
    parser.add_argument("--wall-posts-per-group", type=int, default=10)
    parser.add_argument("--request-delay-min-sec", type=float, default=0.35)
    parser.add_argument("--request-delay-max-sec", type=float, default=1.25)
    parser.add_argument("--require-geo-match", action="store_true")
    parser.add_argument("--no-derived-queries", action="store_true")
    parser.add_argument("--max-search-queries-per-keyword", type=int, default=8)
    parser.add_argument("--api-version", default=os.environ.get("VK_API_VERSION", "5.199"))
    return parser.parse_args(argv)


def config_from_args(args: argparse.Namespace) -> VkCollectorConfig:
    return VkCollectorConfig(
        keywords=unique_non_empty(args.keyword),
        countries=unique_non_empty(args.country) or ["RU", "KZ"],
        excluded_profile_ids=unique_non_empty(args.exclude_profile_id),
        min_followers=args.min_followers,
        max_followers=args.max_followers,
        max_groups_per_run=args.max_groups,
        max_group_checks_per_run=args.max_group_checks,
        search_count_per_keyword=args.search_count_per_keyword,
        wall_posts_per_group=args.wall_posts_per_group,
        request_delay_min_sec=args.request_delay_min_sec,
        request_delay_max_sec=args.request_delay_max_sec,
        require_geo_match=args.require_geo_match,
        use_derived_queries=not args.no_derived_queries,
        max_search_queries_per_keyword=args.max_search_queries_per_keyword,
        api_version=args.api_version,
    )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    config = config_from_args(args)
    try:
        if args.login_check:
            return login_check(config)
        if not config.keywords:
            raise VkCollectorError("vk_empty_input", "No VK keywords were provided")
        return collect(config)
    except VkCollectorError as exc:
        emit_event(CollectorEvent("error", exc.code, str(exc)))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
