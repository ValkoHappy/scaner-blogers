from __future__ import annotations

import argparse
import importlib.util
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


APP_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = APP_ROOT.parent
YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"
SCRAPETUBE_MODULE_PATH = REPO_ROOT / "research" / "repos" / "youtube-scrapetube" / "scrapetube" / "scrapetube.py"


def configure_stdio() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


configure_stdio()


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
class YouTubeCollectorConfig:
    keywords: list[str] = field(default_factory=list)
    countries: list[str] = field(default_factory=lambda: ["RU", "KZ"])
    excluded_profile_ids: list[str] = field(default_factory=list)
    min_followers: int = 20_000
    max_followers: int = 60_000
    max_channels_per_run: int = 100
    max_channel_checks_per_run: int = 300
    search_results_per_query: int = 25
    recent_videos_per_channel: int = 10
    request_delay_min_sec: float = 0.1
    request_delay_max_sec: float = 0.5
    require_geo_match: bool = False
    use_derived_queries: bool = True
    include_channel_search: bool = True
    include_video_search: bool = True
    include_shorts_search: bool = True
    use_web_fallback: bool = False
    max_search_queries_per_keyword: int = 8
    api_key: str | None = None
    relevance_language: str = "ru"


@dataclass
class CollectorEvent:
    level: str
    code: str
    message: str
    data: dict[str, Any] = field(default_factory=dict)


class YouTubeCollectorError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


EMAIL_RE = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+(?![\w.-])", re.I)
EMAIL_AT_RE = re.compile(r"(?<![\w.+-])([\w.+-]+)\s+(?:AT|\[at\]|\(at\))\s+([\w.-]+\.[a-z]{2,})(?![\w.-])", re.I)
PHONE_RE = re.compile(r"(?<!\d)(?:\+7|8|7)[\s(.-]*\d{3}[\s).*-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?!\d)")
URL_RE = re.compile(r"(?:https?://|www\.)[^\s<>()]+", re.I)
CYRILLIC_RE = re.compile(r"[а-яё]", re.I)

RU_MARKERS = [
    "россия",
    "москва",
    "спб",
    "санкт",
    "петербург",
    "екатеринбург",
    "новосибирск",
    "краснодар",
    "сочи",
    ".ru",
]
KZ_MARKERS = ["казахстан", "алматы", "астана", "нур-султан", "шымкент", "караганда", ".kz"]

TOPIC_QUERY_ALIASES = {
    "массаж лица": [
        "массаж лица",
        "фейсмассаж",
        "фейсфитнес",
        "самомассаж лица",
        "лимфодренаж лица",
        "face massage",
        "facial massage",
        "face yoga",
    ],
    "фейсфитнес": ["фейсфитнес", "фейсмассаж", "face fitness", "face yoga", "самомассаж лица"],
    "косметолог": ["косметолог", "косметология", "уход за лицом", "аппаратная косметология", "омоложение лица"],
    "уход за лицом": ["уход за лицом", "домашний уход за лицом", "косметолог", "skin care"],
    "естественное омоложение": ["естественное омоложение", "омоложение лица", "фейсфитнес", "фейсмассаж"],
    "anti-age": ["anti-age", "antiage", "anti aging", "омоложение лица", "косметолог"],
    "лимфодренаж лица": ["лимфодренаж лица", "лимфодренажный массаж", "массаж лица", "фейсмассаж"],
    "тейпирование лица": ["тейпирование лица", "кинезиотейпирование лица", "face taping", "фейсфитнес"],
    "аппаратная косметология": ["аппаратная косметология", "косметолог", "rf лифтинг", "микротоки"],
    "домашний уход за лицом": ["домашний уход за лицом", "домашний уход", "уход за лицом", "косметолог"],
    "микротоки": ["микротоки", "микротоки лица", "аппаратная косметология", "косметолог"],
    "face yoga": ["face yoga", "face fitness", "фейсфитнес", "фейсмассаж"],
    "facial massage": ["facial massage", "face massage", "фейсмассаж", "массаж лица"],
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


def int_value(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def search_queries_for_keyword(keyword: str, config: YouTubeCollectorConfig) -> list[str]:
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
    spelled = [f"{match.group(1)}@{match.group(2)}" for match in EMAIL_AT_RE.finditer(joined)]
    return {
        "emails": unique_non_empty([*EMAIL_RE.findall(joined), *spelled]),
        "phones": unique_non_empty(PHONE_RE.findall(joined)),
        "urls": unique_non_empty(URL_RE.findall(joined)),
    }


def guess_geo(channel: dict[str, Any], *texts: str | None) -> str | None:
    snippet = channel.get("snippet") if isinstance(channel.get("snippet"), dict) else {}
    branding = channel.get("brandingSettings") if isinstance(channel.get("brandingSettings"), dict) else {}
    branding_channel = branding.get("channel") if isinstance(branding.get("channel"), dict) else {}
    country = str(snippet.get("country") or branding_channel.get("country") or "").upper()
    if country in {"RU", "KZ"}:
        return country
    joined = " ".join(item.lower() for item in texts if item)
    if any(marker in joined for marker in KZ_MARKERS):
        return "KZ"
    if any(marker in joined for marker in RU_MARKERS):
        return "RU"
    if CYRILLIC_RE.search(joined):
        return "RU"
    return None


class YouTubeApiClient:
    def __init__(self, api_key: str, timeout: int = 30, max_retries: int = 3, retry_backoff_sec: float = 0.75):
        self.api_key = api_key
        self.timeout = timeout
        self.max_retries = max(0, max_retries)
        self.retry_backoff_sec = max(0, retry_backoff_sec)

    def get(self, endpoint: str, params: dict[str, Any]) -> dict[str, Any]:
        query = {**params, "key": self.api_key}
        url = f"{YOUTUBE_API_BASE}/{endpoint.lstrip('/')}?{urllib.parse.urlencode(query)}"
        payload = ""
        for attempt in range(self.max_retries + 1):
            try:
                with urllib.request.urlopen(url, timeout=self.timeout) as response:
                    payload = response.read().decode("utf-8", errors="replace")
                break
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace")
                if exc.code in (500, 502, 503, 504) and attempt < self.max_retries:
                    time.sleep(self.retry_backoff_sec * (attempt + 1))
                    continue
                code = "youtube_api_http_error"
                if exc.code == 403 and re.search(r"quota|dailyLimit|rateLimit", body, re.I):
                    code = "youtube_quota_exceeded"
                if exc.code in (400, 401, 403) and re.search(r"key|apiKey|forbidden|access", body, re.I):
                    code = "youtube_api_key_rejected"
                raise YouTubeCollectorError(code, f"YouTube API HTTP {exc.code}: {body[:500]}") from exc
            except Exception as exc:
                if attempt < self.max_retries:
                    time.sleep(self.retry_backoff_sec * (attempt + 1))
                    continue
                raise YouTubeCollectorError("youtube_network_error", str(exc)) from exc
        try:
            return json.loads(payload)
        except json.JSONDecodeError as exc:
            raise YouTubeCollectorError("youtube_bad_json", str(exc)) from exc


def get_api_key(config: YouTubeCollectorConfig) -> str:
    api_key = config.api_key or os.environ.get("YOUTUBE_API_KEY", "")
    if not api_key.strip():
        raise YouTubeCollectorError("youtube_missing_api_key", "YOUTUBE_API_KEY is not configured")
    return api_key.strip()


def delay(config: YouTubeCollectorConfig) -> None:
    max_delay = max(config.request_delay_max_sec, config.request_delay_min_sec)
    if max_delay <= 0:
        return
    time.sleep(random.uniform(max(0, config.request_delay_min_sec), max_delay))


def search(api: Any, query: str, result_type: str, region_code: str, config: YouTubeCollectorConfig, video_duration: str | None = None) -> list[dict[str, Any]]:
    params = {
        "part": "snippet",
        "q": query,
        "type": result_type,
        "maxResults": min(50, max(1, config.search_results_per_query)),
        "regionCode": region_code,
        "relevanceLanguage": config.relevance_language,
        "safeSearch": "none",
        "order": "relevance",
    }
    if video_duration:
        params["videoDuration"] = video_duration
    response = api.get("search", params)
    items = [item for item in response.get("items", []) if isinstance(item, dict)]
    emit_event(CollectorEvent("info", "youtube_search_finished", "YouTube search.list finished", {
        "query": query,
        "type": result_type,
        "regionCode": region_code,
        "videoDuration": video_duration or "any",
        "itemsFound": len(items),
    }))
    return items


def fetch_channels(api: Any, channel_ids: list[str]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for index in range(0, len(channel_ids), 50):
        batch = channel_ids[index:index + 50]
        response = api.get("channels", {
            "part": "snippet,statistics,contentDetails,brandingSettings,status",
            "id": ",".join(batch),
            "maxResults": 50,
        })
        for item in response.get("items", []):
            if isinstance(item, dict) and item.get("id"):
                result[str(item["id"])] = item
    return result


def fetch_recent_video_refs(api: Any, channel_id: str, config: YouTubeCollectorConfig) -> list[dict[str, Any]]:
    if config.recent_videos_per_channel <= 0:
        return []
    response = api.get("search", {
        "part": "snippet",
        "channelId": channel_id,
        "type": "video",
        "order": "date",
        "maxResults": min(50, max(1, config.recent_videos_per_channel)),
    })
    return [item for item in response.get("items", []) if isinstance(item, dict)]


def fetch_videos(api: Any, video_ids: list[str]) -> list[dict[str, Any]]:
    if not video_ids:
        return []
    response = api.get("videos", {
        "part": "snippet,statistics,contentDetails",
        "id": ",".join(video_ids[:50]),
        "maxResults": 50,
    })
    return [item for item in response.get("items", []) if isinstance(item, dict)]


def engagement_metrics(videos: list[dict[str, Any]]) -> dict[str, float | int]:
    if not videos:
        return {"avgLikes": 0, "avgComments": 0, "avgViews": 0, "postsChecked": 0}
    likes = [int_value(video.get("statistics", {}).get("likeCount")) for video in videos if isinstance(video.get("statistics"), dict)]
    comments = [int_value(video.get("statistics", {}).get("commentCount")) for video in videos if isinstance(video.get("statistics"), dict)]
    views = [int_value(video.get("statistics", {}).get("viewCount")) for video in videos if isinstance(video.get("statistics"), dict)]
    count = len(videos)
    return {
        "avgLikes": round(sum(likes) / count, 2),
        "avgComments": round(sum(comments) / count, 2),
        "avgViews": round(sum(views) / count, 2),
        "postsChecked": count,
    }


def video_snapshots(videos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    snapshots = []
    for video in videos:
        video_id = str(video.get("id") or "")
        snippet = video.get("snippet") if isinstance(video.get("snippet"), dict) else {}
        statistics = video.get("statistics") if isinstance(video.get("statistics"), dict) else {}
        if not video_id:
            continue
        snapshots.append({
            "id": video_id,
            "code": video_id,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "takenAt": snippet.get("publishedAt"),
            "caption": str(snippet.get("title") or "")[:1000],
            "likeCount": int_value(statistics.get("likeCount")),
            "commentCount": int_value(statistics.get("commentCount")),
            "viewCount": int_value(statistics.get("viewCount")),
            "productType": "youtube_video",
        })
    return snapshots


def candidate_reason(keyword: str, followers: int, geo: str | None, contacts: dict[str, list[str]], posts_checked: int, matched_by: str) -> str:
    source_labels = {
        "youtube_channel_search": "поиск каналов",
        "youtube_shorts_search": "поиск Shorts",
        "youtube_video_search": "поиск видео",
    }
    source = source_labels.get(matched_by, "поиск")
    parts = [f"найдено в YouTube через {source} по запросу «{keyword}»", f"{followers:,}".replace(",", " ") + " подписчиков"]
    if geo:
        parts.append(f"гео похоже на {geo}")
    if posts_checked:
        parts.append(f"проверено видео: {posts_checked}")
    if contacts["emails"] or contacts["phones"] or contacts["urls"]:
        parts.append("есть контакты")
    return ", ".join(parts)


def channel_username(channel: dict[str, Any]) -> str:
    snippet = channel.get("snippet") if isinstance(channel.get("snippet"), dict) else {}
    custom_url = str(snippet.get("customUrl") or "").strip().lstrip("/")
    return custom_url or str(channel.get("id") or "")


def text_from_runs(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        simple = value.get("simpleText")
        if isinstance(simple, str):
            return simple
        runs = value.get("runs")
        if isinstance(runs, list):
            return "".join(str(run.get("text") or "") for run in runs if isinstance(run, dict)).strip()
    return ""


def parse_count_text(value: Any) -> int:
    text = text_from_runs(value) if isinstance(value, dict) else str(value or "")
    text = text.replace("\u00a0", " ").strip().lower()
    if not text:
        return 0
    multiplier = 1
    if re.search(r"\d\s*[kк]|тыс", text, re.I):
        multiplier = 1_000
    elif re.search(r"\d\s*[mм]|млн", text, re.I):
        multiplier = 1_000_000
    elif re.search(r"\d\s*b|млрд", text, re.I):
        multiplier = 1_000_000_000
    match = re.search(r"(\d+(?:[.,]\d+)?(?:[\s,]\d{3})*)", text)
    if not match:
        return 0
    number_text = match.group(1).strip()
    if multiplier == 1:
        number_text = re.sub(r"[\s,]", "", number_text)
    else:
        number_text = number_text.replace(" ", "").replace(",", ".")
    try:
        return int(float(number_text) * multiplier)
    except ValueError:
        return 0


def web_channel_id(item: dict[str, Any]) -> str:
    channel_id = item.get("channelId") or item.get("channel_id")
    if channel_id:
        return str(channel_id)
    endpoint = item.get("navigationEndpoint") if isinstance(item.get("navigationEndpoint"), dict) else {}
    browse = endpoint.get("browseEndpoint") if isinstance(endpoint.get("browseEndpoint"), dict) else {}
    return str(browse.get("browseId") or "")


def web_channel_url(item: dict[str, Any], channel_id: str) -> str:
    endpoint = item.get("navigationEndpoint") if isinstance(item.get("navigationEndpoint"), dict) else {}
    metadata = endpoint.get("commandMetadata") if isinstance(endpoint.get("commandMetadata"), dict) else {}
    web = metadata.get("webCommandMetadata") if isinstance(metadata.get("webCommandMetadata"), dict) else {}
    url = str(web.get("url") or "").strip()
    if url.startswith("http"):
        return url
    if url.startswith("/"):
        return f"https://www.youtube.com{url}"
    return f"https://www.youtube.com/channel/{channel_id}"


def web_channel_username(item: dict[str, Any], channel_id: str) -> str:
    subscriber_text = text_from_runs(item.get("subscriberCountText")).strip()
    if subscriber_text.startswith("@"):
        return subscriber_text
    match = re.search(r"youtube\.com/(@[^/?#]+)", web_channel_url(item, channel_id))
    if match:
        return match.group(1)
    return channel_id


def web_channel_followers(item: dict[str, Any]) -> int:
    for key in ("videoCountText", "subscriberCountText"):
        count = parse_count_text(item.get(key))
        if count > 0:
            return count
    return 0


def web_description(item: dict[str, Any]) -> str:
    return text_from_runs(item.get("descriptionSnippet") or item.get("description") or item.get("longBylineText"))


def load_scrapetube_module() -> Any:
    try:
        import scrapetube  # type: ignore
        return scrapetube
    except Exception:
        pass
    if not SCRAPETUBE_MODULE_PATH.exists():
        raise YouTubeCollectorError("youtube_web_fallback_missing", f"scrapetube repo not found: {SCRAPETUBE_MODULE_PATH}")
    spec = importlib.util.spec_from_file_location("scaner_scrapetube", SCRAPETUBE_MODULE_PATH)
    if spec is None or spec.loader is None:
        raise YouTubeCollectorError("youtube_web_fallback_missing", f"cannot load scrapetube from {SCRAPETUBE_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def should_skip_web_channel(item: dict[str, Any], config: YouTubeCollectorConfig) -> str | None:
    channel_id = web_channel_id(item)
    platform_id = f"channel:{channel_id}"
    excluded = set(config.excluded_profile_ids)
    if channel_id in excluded or platform_id in excluded:
        return "already_known"
    followers = web_channel_followers(item)
    if followers <= 0:
        return "missing_subscribers"
    if followers < config.min_followers:
        return "followers_too_low"
    if followers > config.max_followers:
        return "followers_too_high"
    if config.require_geo_match:
        geo = guess_geo({"snippet": {}}, text_from_runs(item.get("title")), web_description(item))
        if config.countries and geo not in set(config.countries):
            return "geo_mismatch"
    return None


def build_web_channel_candidate(
    item: dict[str, Any],
    keyword: str,
    query: str,
    matched_by: str,
) -> dict[str, Any]:
    channel_id = web_channel_id(item)
    title = text_from_runs(item.get("title")) or web_channel_username(item, channel_id)
    description = web_description(item)
    followers = web_channel_followers(item)
    contacts = extract_contacts(description)
    geo = guess_geo({"snippet": {}}, title, description)
    metrics = {"avgLikes": 0, "avgComments": 0, "avgViews": 0, "postsChecked": 0}
    return {
        "platform": "youtube",
        "platformProfileId": f"channel:{channel_id}",
        "username": web_channel_username(item, channel_id),
        "displayName": title,
        "profileUrl": web_channel_url(item, channel_id),
        "followers": followers,
        "bio": description,
        "externalUrl": contacts["urls"][0] if contacts["urls"] else None,
        "contacts": contacts,
        "sourceKeyword": keyword,
        "sourceTag": query,
        "matchedBy": matched_by,
        "lastPosts": [],
        "metrics": metrics,
        "geoGuess": geo,
        "reason": candidate_reason(keyword, followers, geo, contacts, 0, matched_by),
        "raw": {"webChannel": item, "query": query},
        "collectedAt": now_iso(),
    }


def build_channel_candidate(
    channel: dict[str, Any],
    keyword: str,
    matched_by: str,
    source: dict[str, Any],
    videos: list[dict[str, Any]],
) -> dict[str, Any]:
    channel_id = str(channel.get("id") or "")
    snippet = channel.get("snippet") if isinstance(channel.get("snippet"), dict) else {}
    statistics = channel.get("statistics") if isinstance(channel.get("statistics"), dict) else {}
    branding = channel.get("brandingSettings") if isinstance(channel.get("brandingSettings"), dict) else {}
    branding_channel = branding.get("channel") if isinstance(branding.get("channel"), dict) else {}
    description = str(snippet.get("description") or branding_channel.get("description") or "")
    title = str(snippet.get("title") or branding_channel.get("title") or channel_id)
    keywords = str(branding_channel.get("keywords") or "")
    contacts = extract_contacts(description, keywords)
    metrics = engagement_metrics(videos)
    geo = guess_geo(channel, title, description, keywords, " ".join(source_text(source)))
    username = channel_username(channel)
    followers = int_value(statistics.get("subscriberCount"))
    profile_url = f"https://www.youtube.com/channel/{channel_id}"
    external_url = contacts["urls"][0] if contacts["urls"] else None
    return {
        "platform": "youtube",
        "platformProfileId": f"channel:{channel_id}",
        "username": username,
        "displayName": title,
        "profileUrl": profile_url,
        "followers": followers,
        "bio": description,
        "externalUrl": external_url,
        "contacts": contacts,
        "sourceKeyword": keyword,
        "sourceTag": source.get("query") or keyword,
        "matchedBy": matched_by,
        "lastPosts": video_snapshots(videos),
        "metrics": metrics,
        "geoGuess": geo,
        "reason": candidate_reason(keyword, followers, geo, contacts, int(metrics["postsChecked"]), matched_by),
        "raw": {"channel": channel, "source": source},
        "collectedAt": now_iso(),
    }


def source_text(source: dict[str, Any]) -> list[str]:
    values = [str(source.get("query") or ""), str(source.get("regionCode") or "")]
    search_item = source.get("searchItem")
    if isinstance(search_item, dict):
        snippet = search_item.get("snippet")
        if isinstance(snippet, dict):
            values.extend([str(snippet.get("title") or ""), str(snippet.get("description") or ""), str(snippet.get("channelTitle") or "")])
    return values


def should_skip_channel(channel: dict[str, Any], config: YouTubeCollectorConfig) -> str | None:
    channel_id = str(channel.get("id") or "")
    platform_id = f"channel:{channel_id}"
    excluded = set(config.excluded_profile_ids)
    if channel_id in excluded or platform_id in excluded:
        return "already_known"
    statistics = channel.get("statistics") if isinstance(channel.get("statistics"), dict) else {}
    if statistics.get("hiddenSubscriberCount") is True or "subscriberCount" not in statistics:
        return "hidden_subscribers"
    followers = int_value(statistics.get("subscriberCount"))
    if followers < config.min_followers:
        return "followers_too_low"
    if followers > config.max_followers:
        return "followers_too_high"
    if config.require_geo_match:
        snippet = channel.get("snippet") if isinstance(channel.get("snippet"), dict) else {}
        branding = channel.get("brandingSettings") if isinstance(channel.get("brandingSettings"), dict) else {}
        branding_channel = branding.get("channel") if isinstance(branding.get("channel"), dict) else {}
        geo = guess_geo(channel, str(snippet.get("title") or ""), str(snippet.get("description") or ""), str(branding_channel.get("keywords") or ""))
        if config.countries and geo not in set(config.countries):
            return "geo_mismatch"
    return None


def channel_ids_from_search(items: list[dict[str, Any]], result_type: str) -> list[tuple[str, dict[str, Any]]]:
    result = []
    for item in items:
        item_id = item.get("id") if isinstance(item.get("id"), dict) else {}
        snippet = item.get("snippet") if isinstance(item.get("snippet"), dict) else {}
        channel_id = item_id.get("channelId") if result_type == "channel" else snippet.get("channelId")
        if channel_id:
            result.append((str(channel_id), item))
    return result


def collect_web_fallback(config: YouTubeCollectorConfig) -> int:
    scrapetube = load_scrapetube_module()
    emitted = 0
    channel_checks = 0
    seen_channel_ids: set[str] = set()
    skipped: dict[str, int] = {}
    keyword_count = max(1, len(config.keywords))
    max_checks_per_keyword = max(1, (config.max_channel_checks_per_run + keyword_count - 1) // keyword_count)
    max_emits_per_keyword = max(1, (config.max_channels_per_run + keyword_count - 1) // keyword_count)
    emit_event(CollectorEvent("info", "youtube_collector_started", "YouTube web fallback collector started", {
        "keywords": config.keywords,
        "countries": config.countries,
        "minFollowers": config.min_followers,
        "maxFollowers": config.max_followers,
        "maxChannels": config.max_channels_per_run,
        "maxChannelChecks": config.max_channel_checks_per_run,
        "useWebFallback": True,
        "maxChecksPerKeyword": max_checks_per_keyword,
        "maxChannelsPerKeyword": max_emits_per_keyword,
    }))

    for keyword in config.keywords:
        keyword_checks = 0
        keyword_emitted = 0
        if emitted >= config.max_channels_per_run or channel_checks >= config.max_channel_checks_per_run:
            break
        for query in search_queries_for_keyword(keyword, config):
            if (
                emitted >= config.max_channels_per_run
                or channel_checks >= config.max_channel_checks_per_run
                or keyword_checks >= max_checks_per_keyword
                or keyword_emitted >= max_emits_per_keyword
            ):
                break
            delay(config)
            try:
                items = list(scrapetube.get_search(
                    query,
                    limit=min(100, max(1, config.search_results_per_query)),
                    sleep=max(1, int(config.request_delay_min_sec)),
                    results_type="channel",
                ))
            except Exception as exc:
                emit_event(CollectorEvent("warn", "youtube_web_search_failed", f"YouTube web search failed for {query}: {exc}", {"query": query}))
                skipped["web_search_failed"] = skipped.get("web_search_failed", 0) + 1
                continue
            emit_event(CollectorEvent("info", "youtube_web_search_finished", "YouTube web channel search finished", {
                "keyword": keyword,
                "query": query,
                "itemsFound": len(items),
            }))
            for item in items:
                if (
                    emitted >= config.max_channels_per_run
                    or channel_checks >= config.max_channel_checks_per_run
                    or keyword_checks >= max_checks_per_keyword
                    or keyword_emitted >= max_emits_per_keyword
                ):
                    break
                if not isinstance(item, dict):
                    continue
                channel_id = web_channel_id(item)
                if not channel_id:
                    skipped["missing_channel_id"] = skipped.get("missing_channel_id", 0) + 1
                    continue
                if channel_id in seen_channel_ids:
                    skipped["duplicate"] = skipped.get("duplicate", 0) + 1
                    continue
                seen_channel_ids.add(channel_id)
                channel_checks += 1
                keyword_checks += 1
                skip_reason = should_skip_web_channel(item, config)
                if skip_reason:
                    skipped[skip_reason] = skipped.get(skip_reason, 0) + 1
                    continue
                candidate = build_web_channel_candidate(item, keyword, query, "youtube_web_channel_search")
                print(json.dumps(candidate, ensure_ascii=False), flush=True)
                emitted += 1
                keyword_emitted += 1

    emit_event(CollectorEvent("info", "youtube_collector_finished", "YouTube collector finished", {
        "emitted": emitted,
        "profileChecks": channel_checks,
        "uniqueChannelsSeen": len(seen_channel_ids),
        "skipped": skipped,
        "useWebFallback": True,
    }))
    return 0


def collect(config: YouTubeCollectorConfig, api: Any | None = None) -> int:
    if config.use_web_fallback:
        return collect_web_fallback(config)
    api = api or YouTubeApiClient(get_api_key(config))
    emitted = 0
    channel_checks = 0
    seen_channel_ids: set[str] = set()
    skipped: dict[str, int] = {}
    keyword_count = max(1, len(config.keywords))
    max_checks_per_keyword = max(1, (config.max_channel_checks_per_run + keyword_count - 1) // keyword_count)
    max_emits_per_keyword = max(1, (config.max_channels_per_run + keyword_count - 1) // keyword_count)
    emit_event(CollectorEvent("info", "youtube_collector_started", "YouTube collector started", {
        "keywords": config.keywords,
        "countries": config.countries,
        "minFollowers": config.min_followers,
        "maxFollowers": config.max_followers,
        "maxChannels": config.max_channels_per_run,
        "maxChannelChecks": config.max_channel_checks_per_run,
        "maxChecksPerKeyword": max_checks_per_keyword,
        "maxChannelsPerKeyword": max_emits_per_keyword,
        "includeChannelSearch": config.include_channel_search,
        "includeVideoSearch": config.include_video_search,
        "includeShortsSearch": config.include_shorts_search,
    }))

    for keyword in config.keywords:
        keyword_checks = 0
        keyword_emitted = 0
        if emitted >= config.max_channels_per_run or channel_checks >= config.max_channel_checks_per_run:
            break
        for query in search_queries_for_keyword(keyword, config):
            if (
                emitted >= config.max_channels_per_run
                or channel_checks >= config.max_channel_checks_per_run
                or keyword_checks >= max_checks_per_keyword
                or keyword_emitted >= max_emits_per_keyword
            ):
                break
            for region_code in (config.countries or ["RU", "KZ"]):
                if (
                    emitted >= config.max_channels_per_run
                    or channel_checks >= config.max_channel_checks_per_run
                    or keyword_checks >= max_checks_per_keyword
                    or keyword_emitted >= max_emits_per_keyword
                ):
                    break
                search_modes: list[tuple[str, str, str | None]] = []
                if config.include_channel_search:
                    search_modes.append(("channel", "youtube_channel_search", None))
                if config.include_shorts_search:
                    search_modes.append(("video", "youtube_shorts_search", "short"))
                if config.include_video_search:
                    search_modes.append(("video", "youtube_video_search", None))
                for result_type, matched_by, video_duration in search_modes:
                    if (
                        emitted >= config.max_channels_per_run
                        or channel_checks >= config.max_channel_checks_per_run
                        or keyword_checks >= max_checks_per_keyword
                        or keyword_emitted >= max_emits_per_keyword
                    ):
                        break
                    delay(config)
                    items = search(api, query, result_type, region_code, config, video_duration)
                    for channel_id, search_item in channel_ids_from_search(items, result_type):
                        if (
                            emitted >= config.max_channels_per_run
                            or channel_checks >= config.max_channel_checks_per_run
                            or keyword_checks >= max_checks_per_keyword
                            or keyword_emitted >= max_emits_per_keyword
                        ):
                            break
                        if channel_id in seen_channel_ids:
                            continue
                        seen_channel_ids.add(channel_id)
                        channel_checks += 1
                        keyword_checks += 1
                        delay(config)
                        channels = fetch_channels(api, [channel_id])
                        channel = channels.get(channel_id)
                        if not channel:
                            skipped["channel_not_found"] = skipped.get("channel_not_found", 0) + 1
                            continue
                        skip_reason = should_skip_channel(channel, config)
                        if skip_reason:
                            skipped[skip_reason] = skipped.get(skip_reason, 0) + 1
                            continue
                        delay(config)
                        refs = fetch_recent_video_refs(api, channel_id, config)
                        video_ids = [
                            str(ref.get("id", {}).get("videoId"))
                            for ref in refs
                            if isinstance(ref.get("id"), dict) and ref.get("id", {}).get("videoId")
                        ]
                        videos = fetch_videos(api, video_ids)
                        candidate = build_channel_candidate(channel, keyword, matched_by, {
                            "keyword": keyword,
                            "query": query,
                            "regionCode": region_code,
                            "resultType": result_type,
                            "videoDuration": video_duration or "any",
                            "searchItem": search_item,
                        }, videos)
                        print(json.dumps(candidate, ensure_ascii=False), flush=True)
                        emitted += 1
                        keyword_emitted += 1

    emit_event(CollectorEvent("info", "youtube_collector_finished", "YouTube collector finished", {
        "emitted": emitted,
        "profileChecks": channel_checks,
        "uniqueChannelsSeen": len(seen_channel_ids),
        "skipped": skipped,
    }))
    return 0


def login_check(config: YouTubeCollectorConfig) -> int:
    api = YouTubeApiClient(get_api_key(config))
    response = api.get("channels", {
        "part": "snippet,statistics",
        "id": "UC_x5XG1OV2P6uZZ5FSM9Ttw",
    })
    emit_event(CollectorEvent("info", "youtube_api_key_check_ok", "YouTube API key check succeeded", {
        "channelsFound": len(response.get("items", [])),
    }))
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect YouTube blogger/channel candidates by keywords")
    parser.add_argument("--login-check", action="store_true")
    parser.add_argument("--keyword", action="append", default=[])
    parser.add_argument("--country", action="append", default=[])
    parser.add_argument("--exclude-profile-id", action="append", default=[])
    parser.add_argument("--min-followers", type=int, default=20_000)
    parser.add_argument("--max-followers", type=int, default=60_000)
    parser.add_argument("--max-channels", type=int, default=100)
    parser.add_argument("--max-channel-checks", type=int, default=300)
    parser.add_argument("--search-results-per-query", type=int, default=25)
    parser.add_argument("--recent-videos-per-channel", type=int, default=10)
    parser.add_argument("--request-delay-min-sec", type=float, default=0.1)
    parser.add_argument("--request-delay-max-sec", type=float, default=0.5)
    parser.add_argument("--require-geo-match", action="store_true")
    parser.add_argument("--no-derived-queries", action="store_true")
    parser.add_argument("--no-channel-search", action="store_true")
    parser.add_argument("--no-video-search", action="store_true")
    parser.add_argument("--no-shorts-search", action="store_true")
    parser.add_argument("--use-web-fallback", action="store_true")
    parser.add_argument("--max-search-queries-per-keyword", type=int, default=8)
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--relevance-language", default="ru")
    return parser.parse_args(argv)


def config_from_args(args: argparse.Namespace) -> YouTubeCollectorConfig:
    return YouTubeCollectorConfig(
        keywords=unique_non_empty(args.keyword),
        countries=unique_non_empty(args.country) or ["RU", "KZ"],
        excluded_profile_ids=unique_non_empty(args.exclude_profile_id),
        min_followers=args.min_followers,
        max_followers=args.max_followers,
        max_channels_per_run=args.max_channels,
        max_channel_checks_per_run=args.max_channel_checks,
        search_results_per_query=args.search_results_per_query,
        recent_videos_per_channel=args.recent_videos_per_channel,
        request_delay_min_sec=args.request_delay_min_sec,
        request_delay_max_sec=args.request_delay_max_sec,
        require_geo_match=args.require_geo_match,
        use_derived_queries=not args.no_derived_queries,
        include_channel_search=not args.no_channel_search,
        include_video_search=not args.no_video_search,
        include_shorts_search=not args.no_shorts_search,
        use_web_fallback=args.use_web_fallback,
        max_search_queries_per_keyword=args.max_search_queries_per_keyword,
        api_key=args.api_key,
        relevance_language=args.relevance_language,
    )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    config = config_from_args(args)
    try:
        if args.login_check:
            return login_check(config)
        if not config.keywords:
            raise YouTubeCollectorError("youtube_empty_input", "No YouTube keywords were provided")
        if not config.use_web_fallback and not config.include_channel_search and not config.include_video_search and not config.include_shorts_search:
            raise YouTubeCollectorError("youtube_empty_search_modes", "At least one YouTube search mode must be enabled")
        return collect(config)
    except YouTubeCollectorError as exc:
        emit_event(CollectorEvent("error", exc.code, str(exc)))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
