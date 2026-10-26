import unittest
from unittest.mock import patch

from vk_collector import (
    VkCollectorConfig,
    build_group_candidate,
    candidate_reason,
    extract_contacts,
    guess_geo,
    get_api_token,
    normalize_vk_response_items,
    search_queries_for_keyword,
    should_skip_group,
    token_from_cache,
    VkCollectorError,
)


class VkCollectorHelpersTest(unittest.TestCase):
    def test_service_token_is_rejected_for_groups_search(self):
        with patch.dict("os.environ", {
            "VK_ACCESS_TOKEN": "",
            "VK_SERVICE_TOKEN": "vk_service_token_placeholder",
            "VK_SERVER_TOKEN": "",
            "VK_TOKEN_FILE": "missing-vk-token-cache.json",
        }, clear=False):
            with self.assertRaises(VkCollectorError) as raised:
                get_api_token(VkCollectorConfig())
        self.assertEqual(raised.exception.code, "vk_user_token_required")

    def test_extract_contacts_from_group_text(self):
        contacts = extract_contacts("Запись test@example.com +7 (999) 111-22-33 https://site.ru")
        self.assertEqual(contacts["emails"], ["test@example.com"])
        self.assertEqual(contacts["phones"], ["+7 (999) 111-22-33"])
        self.assertEqual(contacts["urls"], ["https://site.ru"])

    def test_extract_contacts_does_not_treat_plain_10_digit_ids_as_phone(self):
        contacts = extract_contacts("Заявление в РКН № 7010255152")
        self.assertEqual(contacts["phones"], [])

    def test_guess_geo_prefers_kazakhstan_marker(self):
        self.assertEqual(guess_geo("фейсфитнес Алматы Казахстан"), "KZ")

    def test_guess_geo_uses_cyrillic_as_ru_fallback(self):
        self.assertEqual(guess_geo("массаж лица онлайн"), "RU")

    def test_normalize_vk_response_items_supports_new_and_old_shapes(self):
        self.assertEqual(normalize_vk_response_items({"items": [{"id": 1}]}), [{"id": 1}])
        self.assertEqual(normalize_vk_response_items({"groups": [{"id": 2}]}, "groups"), [{"id": 2}])
        self.assertEqual(normalize_vk_response_items([{"id": 3}]), [{"id": 3}])

    def test_search_queries_for_keyword_adds_topic_aliases(self):
        queries = search_queries_for_keyword("массаж лица", VkCollectorConfig(max_search_queries_per_keyword=5))
        self.assertEqual(queries[0], "массаж лица")
        self.assertIn("фейсмассаж", queries)
        self.assertIn("фейсфитнес", queries)

    def test_search_queries_can_be_literal_only(self):
        queries = search_queries_for_keyword("массаж лица", VkCollectorConfig(use_derived_queries=False))
        self.assertEqual(queries, ["массаж лица"])

    def test_should_skip_group_uses_range_and_known_ids(self):
        config = VkCollectorConfig(excluded_profile_ids=["group:1"], min_followers=20_000, max_followers=60_000)
        self.assertEqual(should_skip_group({"id": 1, "members_count": 30_000}, config), "already_known")
        self.assertEqual(should_skip_group({"id": 2, "members_count": 1_000}, config), "followers_too_low")
        self.assertEqual(should_skip_group({"id": 3, "members_count": 100_000}, config), "followers_too_high")

    def test_build_group_candidate_maps_vk_fields_to_common_schema(self):
        group = {
            "id": 10,
            "screen_name": "faceclub",
            "name": "Face Club",
            "members_count": 34_000,
            "description": "Массаж лица, запись test@example.com",
            "site": "https://face.example",
        }
        posts = [{
            "id": 101,
            "date": 1_700_000_000,
            "text": "новый пост",
            "likes": {"count": 10},
            "comments": {"count": 2},
            "views": {"count": 100},
        }]
        candidate = build_group_candidate(group, "массаж лица", posts)
        self.assertEqual(candidate["platform"], "vk")
        self.assertEqual(candidate["platformProfileId"], "group:10")
        self.assertEqual(candidate["profileUrl"], "https://vk.com/faceclub")
        self.assertEqual(candidate["followers"], 34_000)
        self.assertEqual(candidate["contacts"]["emails"], ["test@example.com"])
        self.assertEqual(candidate["metrics"]["avgViews"], 100)
        self.assertEqual(candidate["lastPosts"][0]["url"], "https://vk.com/wall-10_101")

    def test_candidate_reason_mentions_why_profile_is_useful(self):
        reason = candidate_reason("массаж лица", 34_500, "RU", {"emails": ["a@example.com"], "phones": [], "urls": []}, 10)
        self.assertIn("массаж лица", reason)
        self.assertIn("34 500", reason)
        self.assertIn("есть контакты", reason)

    def test_token_from_cache_uses_unexpired_token_file(self):
        import json
        import os
        import tempfile
        from datetime import datetime, timedelta, timezone

        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as handle:
            json.dump({
                "accessToken": "cached-token",
                "expiresAt": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
            }, handle)
            path = handle.name
        previous = os.environ.get("VK_TOKEN_FILE")
        os.environ["VK_TOKEN_FILE"] = path
        try:
            self.assertEqual(token_from_cache(), "cached-token")
        finally:
            if previous is None:
                os.environ.pop("VK_TOKEN_FILE", None)
            else:
                os.environ["VK_TOKEN_FILE"] = previous
            os.unlink(path)


if __name__ == "__main__":
    unittest.main()
