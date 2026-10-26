import unittest
import json
from unittest.mock import patch

from instagram_collector import (
    InstagramCollectorError,
    InstagramCollectorConfig,
    build_candidate,
    candidate_reason,
    candidate_tags_for_keyword,
    challenge_payload_summary,
    classify_exception,
    configure_ssl_certificates,
    discovery_layer_check_budget,
    enabled_discovery_layer_count,
    exception_diagnostic_summary,
    extract_contacts,
    guess_geo,
    normalize_hashtag,
    raise_collector_error_from_exception,
    raise_if_terminal_error,
    login_check,
    resolve_session_path,
    fetch_candidate_for_user,
    fetch_keyword_reels,
    load_session_settings_from_env,
    media_from_reels_payload,
    parse_typeahead_stream_text,
    search_accounts_serp_for_keyword,
    search_typeahead_for_keyword,
    search_user_id,
    search_users_for_keyword,
    APP_ROOT,
    authenticate_client,
    load_config,
)


class InstagramCollectorHelpersTest(unittest.TestCase):
    def test_default_collector_config_is_human_safe(self):
        config = load_config(None)
        self.assertEqual(config.max_profiles_per_run, 5)
        self.assertEqual(config.max_profile_checks_per_run, 12)
        self.assertEqual(config.max_medias_per_tag, 12)
        self.assertEqual(config.max_user_search_results_per_keyword, 2)
        self.assertEqual(config.recent_media_per_profile, 0)
        self.assertEqual(config.profile_delay_min_sec, 45)
        self.assertEqual(config.profile_delay_max_sec, 120)
        self.assertEqual(config.media_delay_min_sec, 30)
        self.assertEqual(config.media_delay_max_sec, 90)

    def test_normalize_hashtag_removes_hash_and_spaces(self):
        self.assertEqual(normalize_hashtag(" #массаж лица "), "массажлица")

    def test_candidate_tags_for_keyword_derives_compact_hashtag(self):
        self.assertEqual(candidate_tags_for_keyword("unknown topic"), ["unknowntopic"])

    def test_candidate_tags_for_keyword_adds_topic_aliases(self):
        tags = candidate_tags_for_keyword("массаж лица")
        self.assertIn("массажлица", tags)
        self.assertIn("фейсмассаж", tags)
        self.assertIn("facialmassage", tags)

    def test_extract_contacts_from_bio(self):
        contacts = extract_contacts("Запись: test@example.com, +7 (999) 111-22-33, https://site.ru")
        self.assertEqual(contacts["emails"], ["test@example.com"])
        self.assertEqual(contacts["phones"], ["+7 (999) 111-22-33"])
        self.assertEqual(contacts["urls"], ["https://site.ru"])

    def test_guess_geo_prefers_kazakhstan_marker(self):
        self.assertEqual(guess_geo("Алматы, фейсфитнес"), "KZ")

    def test_guess_geo_uses_kazakhstan_domain_marker(self):
        self.assertEqual(guess_geo("mail@beauty.kz"), "KZ")

    def test_guess_geo_uses_cyrillic_as_ru_fallback(self):
        self.assertEqual(guess_geo("массаж лица онлайн"), "RU")

    def test_candidate_reason_is_human_readable(self):
        reason = candidate_reason("массажлица", 34_500, "RU", {"emails": ["a@example.com"], "phones": [], "urls": []})
        self.assertEqual(reason, "найден по #массажлица, 34 500 подписчиков, гео похоже на RU, есть контакты")

    def test_user_search_can_be_disabled(self):
        class Client:
            def search_users(self, keyword, count=50):
                raise AssertionError("search_users should not be called")

        config = InstagramCollectorConfig(include_user_search=False)
        self.assertEqual(search_users_for_keyword(Client(), "массаж лица", config), [])

    def test_user_search_uses_configured_result_limit(self):
        class Client:
            def __init__(self):
                self.calls = []

            def search_users(self, keyword, count=50):
                self.calls.append((keyword, count))
                return ["user"]

        client = Client()
        config = InstagramCollectorConfig(max_user_search_results_per_keyword=12)
        self.assertEqual(search_users_for_keyword(client, "face yoga", config), ["user"])
        self.assertEqual(client.calls, [("face yoga", 12)])

    def test_account_serp_search_uses_accounts_tab_endpoint(self):
        class Client:
            def fbsearch_accounts_v2(self, keyword):
                self.keyword = keyword
                return {"users": [{"user": {"pk": "101"}}, {"pk": "102"}]}

        client = Client()
        config = InstagramCollectorConfig(max_user_search_results_per_keyword=1)
        self.assertEqual(search_accounts_serp_for_keyword(client, "face yoga", config), [{"user": {"pk": "101"}}])
        self.assertEqual(client.keyword, "face yoga")

    def test_typeahead_search_uses_stream_endpoint(self):
        class Client:
            def fbsearch_typehead(self, keyword):
                self.keyword = keyword
                return [{"pk": "201"}, {"pk": "202"}]

        client = Client()
        config = InstagramCollectorConfig(include_typeahead_search=True, max_user_search_results_per_keyword=1)
        self.assertEqual(search_typeahead_for_keyword(client, "face yoga", config), [{"pk": "201"}])
        self.assertEqual(client.keyword, "face yoga")

    def test_search_user_id_reads_raw_and_nested_users(self):
        self.assertEqual(search_user_id({"user": {"pk": "101"}}), "101")
        self.assertEqual(search_user_id({"id": "102"}), "102")
        self.assertEqual(search_user_id(type("User", (), {"pk": "103"})()), "103")

    def test_parse_typeahead_stream_text_recovers_line_delimited_json(self):
        text = "\n".join([
            '{"users":[{"pk":"101"},{"pk":"102"}]}',
            '{"users":[{"pk":"101"},{"pk":"103"}]}',
        ])
        self.assertEqual([search_user_id(user) for user in parse_typeahead_stream_text(text)], ["101", "102", "103"])

    def test_media_from_reels_payload_extracts_clip_media(self):
        payload = {"reels_serp_modules": [{"clips": [{"media": {"pk": "m1", "user": {"pk": "u1"}, "caption_text": "caption"}}]}]}
        medias = media_from_reels_payload(payload, 5)
        self.assertEqual(medias[0].pk, "m1")
        self.assertEqual(medias[0].user.pk, "u1")

    def test_keyword_reels_search_uses_reels_serp_endpoint(self):
        class Client:
            def fbsearch_reels_v2(self, keyword):
                self.keyword = keyword
                return {"reels_serp_modules": [{"clips": [{"media": {"pk": "m1", "user": {"pk": "u1"}}}]}]}

        client = Client()
        medias = fetch_keyword_reels(client, "face yoga", InstagramCollectorConfig(max_medias_per_tag=1))
        self.assertEqual(client.keyword, "face yoga")
        self.assertEqual(medias[0].user.pk, "u1")

    def test_discovery_layer_budget_splits_profile_checks_between_enabled_layers(self):
        config = InstagramCollectorConfig(max_profile_checks_per_run=35)
        self.assertEqual(enabled_discovery_layer_count(config), 3)
        self.assertEqual(discovery_layer_check_budget(config), 11)

    def test_discovery_layer_budget_respects_disabled_layers(self):
        config = InstagramCollectorConfig(max_profile_checks_per_run=35, include_keyword_reels_search=False, include_user_search=False)
        self.assertEqual(enabled_discovery_layer_count(config), 1)
        self.assertEqual(discovery_layer_check_budget(config), 35)

    def test_classify_challenge_by_class_name(self):
        ChallengeRequired = type("ChallengeRequired", (Exception,), {})
        code, cooldown = classify_exception(ChallengeRequired("challenge"))
        self.assertEqual(code, "challenge_required")
        self.assertEqual(cooldown, 24 * 60 * 60)

    def test_terminal_instagram_errors_stop_collection(self):
        with self.assertRaises(InstagramCollectorError) as raised:
            raise_if_terminal_error("rate_limited", "wait a few minutes", 3600)
        self.assertEqual(raised.exception.code, "rate_limited")
        self.assertEqual(raised.exception.cooldown_seconds, 3600)

    def test_nested_terminal_instagram_error_keeps_original_code(self):
        code, cooldown = classify_exception(InstagramCollectorError("login_required", "login_required", 1800))
        self.assertEqual(code, "login_required")
        self.assertEqual(cooldown, 1800)

    def test_login_required_text_is_terminal(self):
        code, cooldown = classify_exception(Exception("login_required"))
        self.assertEqual(code, "login_required")
        self.assertEqual(cooldown, 6 * 60 * 60)

    def test_automation_warning_text_pauses_for_a_full_day(self):
        code, cooldown = classify_exception(Exception("Instagram warned about automated behavior"))
        self.assertEqual(code, "automation_warning")
        self.assertEqual(cooldown, 24 * 60 * 60)

    def test_rate_limit_text_uses_long_cooldown(self):
        code, cooldown = classify_exception(Exception("Please wait a few minutes"))
        self.assertEqual(code, "rate_limited")
        self.assertEqual(cooldown, 12 * 60 * 60)

    def test_login_session_errors_are_wrapped_with_classifier_code(self):
        ChallengeRequired = type("ChallengeRequired", (Exception,), {})
        with self.assertRaises(InstagramCollectorError) as raised:
            raise_collector_error_from_exception("instagram_login_or_session", ChallengeRequired("checkpoint"))
        self.assertEqual(raised.exception.code, "challenge_required")
        self.assertIn("instagram_login_or_session failed", str(raised.exception))

    def test_challenge_payload_summary_keeps_safe_fields_only(self):
        summary = challenge_payload_summary({
            "message": "challenge_required",
            "challenge": {
                "api_path": "/challenge/123/abc/",
                "challengeType": "SelectContactPointRecoveryForm",
                "contact_point": "a***@mail.com",
                "challenge_context": "secret-context"
            },
            "password": "secret-password"
        })
        self.assertEqual(summary["message"], "challenge_required")
        self.assertEqual(summary["challenge"]["api_path"], "/challenge/123/abc/")
        self.assertEqual(summary["challenge"]["challengeType"], "SelectContactPointRecoveryForm")
        self.assertEqual(summary["challenge"]["contact_point"], "a***@mail.com")
        self.assertNotIn("password", summary)
        self.assertNotIn("challenge_context", summary["challenge"])

    def test_exception_diagnostic_summary_extracts_masked_contacts(self):
        exc = type("ChallengeRequired", (Exception,), {
            "challenge": {"api_path": "/challenge/123/abc/", "contact_point": "+7 *** ** 42"},
            "bloks_action": "com.bloks.www.ig.challenge.redirect.async",
            "message": "challenge_required"
        })("checkpoint")
        summary = exception_diagnostic_summary(exc)
        self.assertEqual(summary["challenge"]["contact_point"], "+7 *** ** 42")
        self.assertEqual(summary["bloks_action"], "com.bloks.www.ig.challenge.redirect.async")

    def test_login_session_errors_include_challenge_context_in_message(self):
        exc = type("ChallengeRequired", (Exception,), {
            "challenge": {
                "api_path": "/challenge/123/abc/",
                "challengeType": "SelectContactPointRecoveryForm",
                "contact_point": "a***@mail.com",
            },
            "message": "challenge_required"
        })("checkpoint")
        with self.assertRaises(InstagramCollectorError) as raised:
            raise_collector_error_from_exception("instagram_login_or_session", exc)
        self.assertIn("challengeType=SelectContactPointRecoveryForm", str(raised.exception))
        self.assertIn("apiPath=/challenge/123/abc/", str(raised.exception))
        self.assertIn("contact=a***@mail.com", str(raised.exception))

    def test_non_terminal_instagram_errors_can_be_skipped(self):
        self.assertIsNone(raise_if_terminal_error("unknown_instagram_error", "temporary media issue"))

    def test_build_candidate_promotes_public_contacts(self):
        user = type("User", (), {
            "pk": "1",
            "username": "face_pro",
            "full_name": "Face Pro",
            "follower_count": 34_000,
            "biography": "Face yoga",
            "external_url": "",
            "public_email": "face@example.com",
            "public_phone_number": "+7 999 111-22-33",
            "contact_phone_number": "",
            "is_business": True,
            "is_private": False,
            "is_verified": False,
            "media_count": 10,
            "category_name": "Health/beauty",
        })()

        from instagram_collector import build_candidate

        candidate = build_candidate(user, "face yoga", "faceyoga", None, [])
        self.assertEqual(candidate["contacts"]["emails"], ["face@example.com"])
        self.assertEqual(candidate["contacts"]["phones"], ["+7 999 111-22-33"])

    def test_build_candidate_uses_source_tag_and_caption_for_geo_and_contacts(self):
        user = type("User", (), {
            "pk": "2",
            "username": "face_ru",
            "full_name": "Face RU",
            "follower_count": 34_000,
            "biography": "",
            "external_url": "",
            "public_email": "",
            "public_phone_number": "",
            "contact_phone_number": "",
            "is_business": False,
            "is_private": False,
            "is_verified": False,
            "media_count": 1,
            "category_name": "",
        })()
        media = type("Media", (), {
            "pk": "m1",
            "code": "abc",
            "like_count": 10,
            "comment_count": 1,
            "play_count": 100,
            "caption_text": "Запись на массаж лица: +7 999 111-22-33",
        })()

        candidate = build_candidate(user, "массаж лица", "массажлица", media, [])
        self.assertEqual(candidate["geoGuess"], "RU")
        self.assertEqual(candidate["contacts"]["phones"], ["+7 999 111-22-33"])

    def test_build_candidate_uses_display_name_and_public_email_for_geo(self):
        user = type("User", (), {
            "pk": "3",
            "username": "beauty_almaty",
            "full_name": "САЛОН КРАСОТЫ АЛМАТЫ",
            "follower_count": 34_000,
            "biography": "Beauty studio",
            "external_url": "",
            "public_email": "hello@beauty.kz",
            "public_phone_number": "",
            "contact_phone_number": "",
            "is_business": True,
            "is_private": False,
            "is_verified": False,
            "media_count": 10,
            "category_name": "Beauty/Salon",
        })()

        candidate = build_candidate(user, "массаж лица", "массажлица", None, [])
        self.assertEqual(candidate["geoGuess"], "KZ")

    def test_fetch_candidate_records_skip_reason_for_follower_range(self):
        user = type("User", (), {
            "pk": "1",
            "username": "small_profile",
            "full_name": "Small Profile",
            "follower_count": 10,
            "biography": "",
            "external_url": "",
            "is_private": False,
        })()

        class Client:
            def user_info(self, user_id):
                return user

        stats = {"skipped": {}}
        candidate = fetch_candidate_for_user(Client(), "1", "face yoga", "faceyoga", None, "hashtag_reels", InstagramCollectorConfig(min_followers=20_000), stats)
        self.assertIsNone(candidate)
        self.assertEqual(stats["skipped"], {"followers_too_low": 1})

    def test_config_loads_excluded_profile_ids(self):
        config = InstagramCollectorConfig(excluded_profile_ids=["1", "2"])
        self.assertEqual(config.excluded_profile_ids, ["1", "2"])

    def test_login_check_creates_client_and_emits_success_event(self):
        calls = []
        emitted = []

        class Client:
            def __init__(self):
                self.account_info_called = False

            def account_info(self):
                self.account_info_called = True
                return object()

        client = Client()

        def fake_client_factory(config, proxy_rotator):
            calls.append((config, proxy_rotator.current()))
            return client

        def fake_emit_event(event):
            emitted.append(event)

        config = InstagramCollectorConfig(proxy_pool=["http://proxy.local:8080"])
        self.assertEqual(login_check(config, fake_client_factory, fake_emit_event), 0)
        self.assertEqual(calls, [(config, "http://proxy.local:8080")])
        self.assertTrue(client.account_info_called)
        self.assertEqual(emitted[0].code, "instagram_login_check_ok")
        self.assertEqual(emitted[0].level, "info")

    def test_persisted_mobile_session_is_preferred_over_browser_sessionid(self):
        class Client:
            user_id = "42"

            def __init__(self):
                self.account_info_calls = 0
                self.sessionid_calls = 0

            def account_info(self):
                self.account_info_calls += 1
                return object()

            def login_by_sessionid(self, _sessionid):
                self.sessionid_calls += 1

        client = Client()
        authenticate_client(client, "user", None, "42%3Atest-session-placeholder", True, False, "")

        self.assertEqual(client.account_info_calls, 1)
        self.assertEqual(client.sessionid_calls, 0)

    def test_browser_sessionid_is_only_used_when_saved_mobile_session_is_invalid(self):
        class Client:
            user_id = "42"

            def __init__(self):
                self.sessionids = []

            def account_info(self):
                raise RuntimeError("login_required")

            def login_by_sessionid(self, sessionid):
                self.sessionids.append(sessionid)

        client = Client()
        authenticate_client(client, "user", None, "42%3Atest-session-placeholder", True, False, "")

        self.assertEqual(client.sessionids, ["42%3Atest-session-placeholder"])
    def test_login_check_fails_when_authenticated_probe_fails(self):
        class Client:
            def account_info(self):
                raise TimeoutError("probe timeout")

        def fake_client_factory(config, proxy_rotator):
            return Client()

        with self.assertRaises(InstagramCollectorError) as raised:
            login_check(InstagramCollectorConfig(), fake_client_factory, lambda event: None)
        self.assertEqual(raised.exception.code, "network_or_proxy")

    def test_ssl_certificate_errors_are_classified_as_network_or_proxy(self):
        code, cooldown = classify_exception(Exception("SSLCertVerificationError certificate verify failed"))
        self.assertEqual(code, "network_or_proxy")
        self.assertEqual(cooldown, 10 * 60)

    def test_relative_session_path_is_stable_from_app_root(self):
        self.assertEqual(resolve_session_path(InstagramCollectorConfig()).parent, APP_ROOT / ".instagram")

    def test_environment_session_file_overrides_config_file(self):
        with patch.dict("os.environ", {"INSTAGRAM_SESSION_FILE": ".instagram/account-specific.json"}):
            config = load_config(str(APP_ROOT / "collectors" / "instagram" / "config.example.json"))
        self.assertEqual(config.session_file, ".instagram/account-specific.json")

    def test_session_settings_can_be_loaded_from_plain_json_env(self):
        payload = {"uuids": {"phone_id": "phone-id-placeholder"}}
        with patch.dict("os.environ", {"INSTAGRAM_SESSION_SETTINGS": json.dumps(payload)}, clear=False):
            self.assertEqual(load_session_settings_from_env(), payload)

    def test_session_settings_can_be_loaded_from_base64_env(self):
        payload = {"uuids": {"phone_id": "phone-id-placeholder"}}
        encoded = "eyJ1dWlkcyI6IHsicGhvbmVfaWQiOiAicGhvbmUtaWQtcGxhY2Vob2xkZXIifX0="
        with patch.dict("os.environ", {"INSTAGRAM_SESSION_SETTINGS_B64": encoded}, clear=False):
            self.assertEqual(load_session_settings_from_env(), payload)

    def test_configure_ssl_certificates_uses_certifi_when_system_bundle_is_missing(self):
        env = {}
        certifi_path = configure_ssl_certificates(env, lambda: "C:/certifi/cacert.pem")
        self.assertEqual(certifi_path, "C:/certifi/cacert.pem")
        self.assertEqual(env["SSL_CERT_FILE"], "C:/certifi/cacert.pem")
        self.assertEqual(env["REQUESTS_CA_BUNDLE"], "C:/certifi/cacert.pem")

    def test_configure_ssl_certificates_keeps_existing_operator_bundle(self):
        env = {"SSL_CERT_FILE": "C:/custom/root.pem"}
        certifi_path = configure_ssl_certificates(env, lambda: "C:/certifi/cacert.pem")
        self.assertIsNone(certifi_path)
        self.assertEqual(env, {"SSL_CERT_FILE": "C:/custom/root.pem"})


if __name__ == "__main__":
    unittest.main()
