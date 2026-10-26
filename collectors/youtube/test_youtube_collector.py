from __future__ import annotations

import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from unittest.mock import patch

from youtube_collector import (
    YouTubeCollectorConfig,
    YouTubeApiClient,
    build_channel_candidate,
    build_web_channel_candidate,
    channel_ids_from_search,
    collect,
    extract_contacts,
    guess_geo,
    parse_count_text,
    search_queries_for_keyword,
    should_skip_channel,
    should_skip_web_channel,
)


FACE_MASSAGE = "массаж лица"


class FakeYouTubeApi:
    def __init__(self):
        self.calls = []

    def get(self, endpoint, params):
        self.calls.append((endpoint, params))
        if endpoint == "search" and params.get("type") == "channel":
            return {
                "items": [{
                    "id": {"channelId": "UC_FACE"},
                    "snippet": {
                        "channelId": "UC_FACE",
                        "title": "Face Massage Studio",
                        "description": "массаж лица",
                        "channelTitle": "Face Massage Studio",
                    },
                }]
            }
        if endpoint == "search" and params.get("type") == "video":
            return {
                "items": [{
                    "id": {"videoId": "vid1"},
                    "snippet": {
                        "channelId": "UC_FACE_VIDEO",
                        "title": "Самомассаж лица",
                        "description": "урок",
                        "channelTitle": "Face Video",
                    },
                }]
            }
        if endpoint == "search" and params.get("channelId"):
            return {
                "items": [{
                    "id": {"videoId": "recent1"},
                    "snippet": {"channelId": params["channelId"], "title": "recent"},
                }]
            }
        if endpoint == "channels":
            channel_id = params["id"]
            return {
                "items": [{
                    "id": channel_id,
                    "snippet": {
                        "title": f"Channel {channel_id}",
                        "description": "Москва, обучение массажу лица, email test AT example.com",
                        "customUrl": "@facechannel",
                        "country": "RU",
                    },
                    "statistics": {
                        "subscriberCount": "34000",
                        "hiddenSubscriberCount": False,
                        "viewCount": "1000000",
                        "videoCount": "120",
                    },
                    "brandingSettings": {
                        "channel": {
                            "keywords": "face yoga facial massage",
                            "country": "RU",
                        }
                    },
                    "status": {"privacyStatus": "public"},
                }]
            }
        if endpoint == "videos":
            return {
                "items": [{
                    "id": "recent1",
                    "snippet": {
                        "publishedAt": "2026-05-29T08:00:00Z",
                        "title": "Массаж лица",
                    },
                    "statistics": {
                        "viewCount": "12000",
                        "likeCount": "800",
                        "commentCount": "25",
                    },
                    "contentDetails": {"duration": "PT10M"},
                }]
            }
        raise AssertionError((endpoint, params))


class FakeUrlOpenResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return self.payload


class YouTubeCollectorTests(unittest.TestCase):
    def test_derived_queries_expand_core_niche_keywords(self):
        queries = search_queries_for_keyword(FACE_MASSAGE, YouTubeCollectorConfig())
        self.assertIn(FACE_MASSAGE, queries)
        self.assertIn("face yoga", queries)
        self.assertIn("facial massage", queries)

    def test_extract_contacts_normalizes_spelled_email(self):
        contacts = extract_contacts("write me test AT example.com or https://example.com")
        self.assertEqual(contacts["emails"], ["test@example.com"])
        self.assertEqual(contacts["urls"], ["https://example.com"])

    def test_channel_ids_from_video_search_uses_snippet_channel_id(self):
        rows = channel_ids_from_search([{
            "id": {"videoId": "v1"},
            "snippet": {"channelId": "UC1"},
        }], "video")
        self.assertEqual(rows[0][0], "UC1")

    def test_skip_filters_hidden_subscribers_and_known_channels(self):
        channel = {
            "id": "UC1",
            "snippet": {"title": "Face"},
            "statistics": {"subscriberCount": "34000", "hiddenSubscriberCount": True},
        }
        self.assertEqual(should_skip_channel(channel, YouTubeCollectorConfig()), "hidden_subscribers")
        channel["statistics"]["hiddenSubscriberCount"] = False
        self.assertEqual(should_skip_channel(channel, YouTubeCollectorConfig(excluded_profile_ids=["channel:UC1"])), "already_known")

    def test_build_candidate_maps_youtube_fields_to_common_contract(self):
        channel = {
            "id": "UC1",
            "snippet": {
                "title": "Face Studio",
                "description": "Москва, test@example.com",
                "customUrl": "@facestudio",
            },
            "statistics": {"subscriberCount": "34000", "hiddenSubscriberCount": False},
            "brandingSettings": {"channel": {"keywords": "face yoga"}},
        }
        candidate = build_channel_candidate(channel, FACE_MASSAGE, "youtube_channel_search", {"query": FACE_MASSAGE}, [])
        self.assertEqual(candidate["platform"], "youtube")
        self.assertEqual(candidate["platformProfileId"], "channel:UC1")
        self.assertEqual(candidate["followers"], 34000)
        self.assertEqual(candidate["contacts"]["emails"], ["test@example.com"])
        self.assertEqual(candidate["geoGuess"], "RU")

    def test_collect_uses_channel_and_video_search_then_emits_candidates(self):
        api = FakeYouTubeApi()
        config = YouTubeCollectorConfig(
            keywords=[FACE_MASSAGE],
            countries=["RU"],
            min_followers=20_000,
            max_followers=60_000,
            max_channels_per_run=2,
            max_channel_checks_per_run=4,
            search_results_per_query=1,
            recent_videos_per_channel=1,
            request_delay_min_sec=0,
            request_delay_max_sec=0,
            use_derived_queries=False,
            include_shorts_search=False,
        )
        with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
            self.assertEqual(collect(config, api), 0)
        endpoints = [call[0] for call in api.calls]
        self.assertIn("channels", endpoints)
        self.assertIn("videos", endpoints)

    def test_guess_geo_accepts_kazakhstan_markers(self):
        self.assertEqual(guess_geo({"snippet": {}}, "Алматы косметолог example.kz"), "KZ")

    def test_api_client_retries_transient_network_errors(self):
        calls = {"count": 0}

        def flaky_urlopen(_url, timeout):
            calls["count"] += 1
            if calls["count"] == 1:
                raise OSError("temporary EOF")
            return FakeUrlOpenResponse(b'{"items": [{"id": "ok"}]}')

        client = YouTubeApiClient("test-key", max_retries=1, retry_backoff_sec=0)
        with patch("urllib.request.urlopen", flaky_urlopen):
            response = client.get("channels", {"part": "snippet", "id": "UC1"})

        self.assertEqual(calls["count"], 2)
        self.assertEqual(response["items"][0]["id"], "ok")

    def test_collect_can_run_shorts_search_as_a_dedicated_source(self):
        api = FakeYouTubeApi()
        config = YouTubeCollectorConfig(
            keywords=[FACE_MASSAGE],
            countries=["RU"],
            min_followers=20_000,
            max_followers=60_000,
            max_channels_per_run=1,
            max_channel_checks_per_run=2,
            search_results_per_query=1,
            recent_videos_per_channel=0,
            request_delay_min_sec=0,
            request_delay_max_sec=0,
            use_derived_queries=False,
            include_channel_search=False,
            include_video_search=False,
            include_shorts_search=True,
        )
        with redirect_stdout(StringIO()) as stdout, redirect_stderr(StringIO()):
            self.assertEqual(collect(config, api), 0)
        candidate = json.loads(stdout.getvalue().strip())
        self.assertEqual(candidate["matchedBy"], "youtube_shorts_search")
        self.assertTrue(any(call[1].get("videoDuration") == "short" for call in api.calls))

    def test_collect_distributes_channel_check_budget_across_keywords(self):
        class ManyChannelsApi(FakeYouTubeApi):
            def get(self, endpoint, params):
                self.calls.append((endpoint, params))
                if endpoint == "search" and params.get("type") == "channel":
                    query = params["q"]
                    return {
                        "items": [
                            {
                                "id": {"channelId": f"{query}_A"},
                                "snippet": {"channelId": f"{query}_A", "title": f"{query} A"},
                            },
                            {
                                "id": {"channelId": f"{query}_B"},
                                "snippet": {"channelId": f"{query}_B", "title": f"{query} B"},
                            },
                        ]
                    }
                if endpoint == "channels":
                    return {
                        "items": [
                            {
                                "id": channel_id,
                                "snippet": {"title": channel_id, "description": ""},
                                "statistics": {"subscriberCount": "30000", "hiddenSubscriberCount": False},
                                "brandingSettings": {"channel": {}},
                            }
                            for channel_id in params["id"].split(",")
                        ]
                    }
                return super().get(endpoint, params)

        api = ManyChannelsApi()
        config = YouTubeCollectorConfig(
            keywords=["one", "two"],
            countries=["RU"],
            min_followers=20_000,
            max_followers=60_000,
            max_channels_per_run=4,
            max_channel_checks_per_run=2,
            search_results_per_query=2,
            recent_videos_per_channel=0,
            request_delay_min_sec=0,
            request_delay_max_sec=0,
            use_derived_queries=False,
            include_channel_search=True,
            include_video_search=False,
            include_shorts_search=False,
        )
        with redirect_stdout(StringIO()) as stdout, redirect_stderr(StringIO()):
            self.assertEqual(collect(config, api), 0)
        rows = [json.loads(line) for line in stdout.getvalue().splitlines() if line.strip()]
        self.assertEqual([row["sourceKeyword"] for row in rows], ["one", "two"])

    def test_parse_count_text_handles_web_subscriber_strings(self):
        self.assertEqual(parse_count_text("45.4K subscribers"), 45_400)
        self.assertEqual(parse_count_text("1,234 subscribers"), 1_234)
        self.assertEqual(parse_count_text("2.5M subscribers"), 2_500_000)

    def test_build_web_channel_candidate_maps_scrapetube_channel_result(self):
        item = {
            "channelId": "UC_WEB",
            "title": {"simpleText": "Face Yoga Studio"},
            "descriptionSnippet": {
                "runs": [
                    {"text": "FACE YOGA "},
                    {"text": "Москва, уход за лицом, hello AT example.com"},
                ]
            },
            "subscriberCountText": {"simpleText": "@faceyoga"},
            "videoCountText": {"simpleText": "45.4K subscribers"},
            "navigationEndpoint": {
                "commandMetadata": {"webCommandMetadata": {"url": "/@faceyoga"}}
            },
        }
        candidate = build_web_channel_candidate(item, "face yoga", "face yoga", "youtube_web_channel_search")
        self.assertEqual(candidate["platform"], "youtube")
        self.assertEqual(candidate["platformProfileId"], "channel:UC_WEB")
        self.assertEqual(candidate["username"], "@faceyoga")
        self.assertEqual(candidate["followers"], 45_400)
        self.assertEqual(candidate["contacts"]["emails"], ["hello@example.com"])
        self.assertEqual(candidate["matchedBy"], "youtube_web_channel_search")

    def test_should_skip_web_channel_filters_range_and_known_channels(self):
        item = {"channelId": "UC_WEB", "videoCountText": {"simpleText": "45.4K subscribers"}}
        config = YouTubeCollectorConfig(min_followers=20_000, max_followers=60_000)
        self.assertIsNone(should_skip_web_channel(item, config))
        self.assertEqual(should_skip_web_channel(item, YouTubeCollectorConfig(excluded_profile_ids=["channel:UC_WEB"])), "already_known")
        self.assertEqual(should_skip_web_channel(item, YouTubeCollectorConfig(min_followers=50_000)), "followers_too_low")


if __name__ == "__main__":
    unittest.main()
