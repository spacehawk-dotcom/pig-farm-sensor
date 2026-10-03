import contextlib
import errno
import io
import json
import socket
import ssl
import unittest
import urllib.error
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import firebase_push as push


NOW = datetime(2026, 10, 2, 21, 30, tzinfo=push.KST)


def sensor(entity_id, name, value, kind="temperature", unit="°C"):
    return {"entity_id": entity_id, "state": value, "attributes": {
        "friendly_name": name, "device_class": kind, "unit_of_measurement": unit,
    }}


class FirebasePushTests(unittest.TestCase):
    def test_reported_farm_sensors_match_all_13_zones(self):
        # Names, IDs and readings supplied by the farm's HA sensor listing.
        readings = [
            ("이유 1배치", "iyu_1baeci", "iyu_1baeci_2", "26.2", "60.7"),
            ("이유 2배치", "iyu_2baeci", "iyu_2baeci_2", "26.1", "56.2"),
            ("이유 3배치", "iyu_3baeci", "iyu_3baeci_2", "29.1", "99.2"),
            ("이유 4배치", "iyu_4baeci", "iyu_4baeci_2", "19.0", "57.7"),
            ("이유 5배치", "iyu_5baeci", "iyu_5baeci_2", "7.3", "99.9"),
            ("육성 1배치", "yugseong1baeci", "yugseong1baeci_2", "25.6", "74.9"),
            ("육성 2배치", "yugseong_2baeci", "yugseong_2baeci_2", "24.6", "69.4"),
            ("육성 3배치", "yugseong_3bae_yugseong_3baeci", "yugseong_3bae_yugseong_3baeci_2", "23.5", "63.7"),
            ("육성 4배치", "yugseong_4baeci", "yugseong_4baeci_yugseong_4bae", "24.2", "59.7"),
            ("육성 5배치", "yugseong_5baeci", "yugseong_5baeci_2", "24.1", "68.6"),
            ("육성 6배치", "yugseong_6baeci", "yugseong_6baeci_2", "21.6", "75.0"),
            ("육성 7배치", "yugseong_7baeci", "yugseong_7baeci_2", "23.8", "56.5"),
            ("외부온도", "oebuondo", "oebuondo_2", "15.9", "68.2"),
        ]
        states = []
        for name, temp_id, humi_id, temp, humi in readings:
            states.extend([
                sensor("sensor." + temp_id, name, temp),
                sensor("sensor." + humi_id, name, humi, "humidity", "%"),
            ])
        states.append(sensor("sensor.sun_next_dawn", "Sun 다음 새벽", "2026-10-02T21:04:07+00:00", "timestamp", None))
        mapping_path = Path(__file__).resolve().parents[1] / "home-assistant/zones.sungamfarm.json"
        explicit = json.loads(mapping_path.read_text(encoding="utf-8"))["zones"]
        self.assertEqual(push.auto_mapping(states), explicit)
        automatic_snapshot = push.build_snapshot(states, {}, NOW)
        self.assertEqual(set(automatic_snapshot), push.FARM_ZONES)
        self.assertEqual(automatic_snapshot, push.build_snapshot(states, explicit, NOW))
        for name, _, _, temp, humi in readings:
            zone = name.replace(" ", "_")
            self.assertEqual(automatic_snapshot[zone]["temp"], float(temp))
            self.assertEqual(automatic_snapshot[zone]["humi"], float(humi))

    def test_normalization_still_rejects_duplicate_and_unrelated_sensors(self):
        with self.assertRaisesRegex(push.PushError, "여러 개"):
            push.auto_mapping([sensor("sensor.a", "이유_1배치", 20), sensor("sensor.b", "이유 1배치", 21)])
        self.assertEqual(push.auto_mapping([sensor("sensor.c", "이유 10배치", 20)]), {})

    def test_pairing_and_existing_app_schema(self):
        states = [sensor("sensor.t", "이유_1배치온도", "24.6"),
                  sensor("sensor.h", "이유_1배치 습도", "65", "humidity", "%"),
                  sensor("sensor.cpu", "CPU 온도", "70")]
        result = push.build_snapshot(states, {}, NOW)
        self.assertEqual(result, {"이유_1배치": {
            "temp": 24.6, "humi": 65, "timestamp": "2026. 10. 2. 오후 9:30:00",
        }})

    def test_explicit_mapping_and_fahrenheit(self):
        states = [sensor("sensor.t", "English name", "77", unit="°F")]
        result = push.build_snapshot(states, {"외부온도": {"temp": "sensor.t"}}, NOW)
        self.assertEqual(result["외부온도"]["temp"], 25)
        self.assertEqual(result["외부온도"]["humi"], "--")

    def test_outside_name_is_not_truncated(self):
        result = push.build_snapshot([sensor("sensor.t", "외부온도", "0")], {}, NOW)
        self.assertEqual(result["외부온도"]["temp"], 0)

    def test_invalid_readings_are_not_numbers(self):
        for value in ("unknown", "unavailable", "NaN", "inf", "-inf", None, ""):
            with self.subTest(value=value):
                self.assertEqual(push.sensor_value(sensor("sensor.t", "x", value), "temp"), "--")
        self.assertEqual(push.sensor_value(sensor("sensor.h", "x", "650", "humidity", "%"), "humi"), "--")

    def test_missing_entity_overwrites_with_unknown(self):
        with contextlib.redirect_stderr(io.StringIO()):
            result = push.build_snapshot([], {"외부온도": {"temp": "sensor.missing"}}, NOW)
        self.assertEqual(result["외부온도"]["temp"], "--")

    def test_empty_duplicate_and_unsafe_mapping_fail(self):
        with self.assertRaises(push.PushError):
            push.build_snapshot([], {}, NOW)
        with self.assertRaises(push.PushError):
            push.build_snapshot([sensor("sensor.a", "외부온도", 1), sensor("sensor.b", "외부온도", 2)], {}, NOW)
        for name in ("bad/name", "bad.name", "bad'name", "<script>"):
            with self.subTest(name=name), self.assertRaises(push.PushError):
                push.build_snapshot([], {name: {"temp": "sensor.a"}}, NOW)

    @patch("firebase_push.urllib.request.urlopen")
    def test_full_http_flow_and_atomic_history_write(self, urlopen):
        responses = [json.dumps([sensor("sensor.t", "외부온도", "21")]).encode(),
                     b'{"idToken":"fresh-firebase-token"}', b'']
        urlopen.side_effect = [contextlib.closing(io.BytesIO(body)) for body in responses]
        config = {"ha_token": "ha-token", "firebase_database_url": "https://example.firebaseio.com",
                  "firebase_auth": {"api_key": "key", "email": "writer@example.com", "password": "secret"}}
        states = push.get_states(config)
        snapshot = push.build_snapshot(states, {}, NOW)
        push.push_snapshot(config, snapshot, NOW)
        requests = [call.args[0] for call in urlopen.call_args_list]
        self.assertEqual(requests[0].get_header("Authorization"), "Bearer ha-token")
        self.assertEqual(requests[1].method, "POST")
        self.assertEqual(json.loads(requests[1].data)["password"], "secret")
        self.assertEqual(requests[2].method, "PATCH")
        self.assertIn("auth=fresh-firebase-token", requests[2].full_url)
        self.assertIsNone(requests[2].get_header("Authorization"))
        payload = json.loads(requests[2].data)
        self.assertEqual(payload[f"history_logs/{int(NOW.timestamp() * 1000)}"], snapshot)
        self.assertEqual(payload["sensor_logs/외부온도"], snapshot["외부온도"])
        self.assertNotIn("sensor_logs", payload, "do not replace all existing zones")

    @patch("firebase_push.urllib.request.urlopen")
    def test_errors_identify_stage_without_leaking_secrets(self, urlopen):
        url = "https://example.firebaseio.com/.json?auth=SECRET"
        urlopen.side_effect = urllib.error.HTTPError(url, 401, "Unauthorized", {}, io.BytesIO(b"SECRET"))
        with self.assertRaises(push.PushError) as caught:
            push.request_json("Firebase 저장", url)
        self.assertIn("[Firebase 저장] HTTP 401", str(caught.exception))
        self.assertNotIn("SECRET", str(caught.exception))
        urlopen.side_effect = urllib.error.URLError("connection refused SECRET")
        with self.assertRaisesRegex(push.PushError, "HA 조회.*연결 실패"):
            push.request_json("HA 조회", url)

    @patch("firebase_push.push_snapshot")
    @patch("firebase_push.get_states", return_value=[sensor("sensor.t", "외부온도", "21")])
    @patch("firebase_push.Path.read_text", return_value='{"ha_token":"secret"}')
    def test_diagnostic_modes_never_write(self, read, get, write):
        for mode in ("--dry-run", "--list-sensors"):
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(push.main([mode]), 0)
        write.assert_not_called()

    @patch("firebase_push.get_states")
    def test_config_syntax_errors_report_location_without_secrets(self, get_states):
        malformed = [
            '{\n  "ha_token": "SECRET"\n  "zones": {}\n}',
            '{"ha_token": "SECRET", "zones": {"外": {}},}',
            '{"ha_token": "SECRET", "zones": {}',
            '{"ha_token": "SECRET", "zones": {}}}',
        ]
        for content in malformed:
            with self.subTest(content=content):
                output = io.StringIO()
                with patch("firebase_push.Path.read_text", return_value=content), contextlib.redirect_stderr(output):
                    self.assertEqual(push.main([]), 1)
                self.assertRegex(output.getvalue(), r"JSON 문법 오류: \d+행 \d+열")
                self.assertNotIn("SECRET", output.getvalue())
        get_states.assert_not_called()

    @patch("firebase_push.get_states")
    def test_config_file_errors_are_distinct(self, get_states):
        for error, expected in [
            (FileNotFoundError("SECRET"), "설정 파일이 없습니다"),
            (PermissionError("SECRET"), "권한이 없습니다"),
            (UnicodeDecodeError("utf-8", b"\xff", 0, 1, "SECRET"), "인코딩 오류"),
            (IsADirectoryError("SECRET"), "폴더가 아닌 JSON 파일"),
        ]:
            output = io.StringIO()
            with patch("firebase_push.Path.read_text", side_effect=error), contextlib.redirect_stderr(output):
                self.assertEqual(push.main([]), 1)
            self.assertIn(expected, output.getvalue())
            self.assertNotIn("SECRET", output.getvalue())
        get_states.assert_not_called()

    @patch("firebase_push.urllib.request.urlopen")
    def test_firebase_login_reports_known_code_without_response_secrets(self, urlopen):
        bodies = [
            ({"error": {"message": "INVALID_LOGIN_CREDENTIALS", "debug": "SECRET"}}, "INVALID_LOGIN_CREDENTIALS"),
            ({"error": {"message": "OPERATION_NOT_ALLOWED : SECRET"}}, "OPERATION_NOT_ALLOWED"),
            ({"error": {"message": "API key not valid. SECRET"}}, "API_KEY_INVALID"),
            ({"error": {"message": "SECRET", "details": [{"reason": "API_KEY_HTTP_REFERRER_BLOCKED"}]}}, "API_KEY_HTTP_REFERRER_BLOCKED"),
            ({"error": {"message": "SECRET"}}, "전용 사용자"),
            ({"error": ["SECRET"]}, "전용 사용자"),
        ]
        for body, expected in bodies:
            with self.subTest(expected=expected):
                urlopen.side_effect = urllib.error.HTTPError(
                    "https://example.com?key=SECRET", 400, "Bad Request", {},
                    io.BytesIO(json.dumps(body).encode()),
                )
                with self.assertRaises(push.PushError) as caught:
                    push.request_json("Firebase 로그인", "https://example.com")
                self.assertIn(expected, str(caught.exception))
                self.assertNotIn("SECRET", str(caught.exception))

    @patch("firebase_push.request_json")
    def test_example_credentials_fail_before_login(self, request):
        with self.assertRaisesRegex(push.PushError, "예시 문구"):
            push.firebase_token({"firebase_auth": {
                "api_key": "key", "email": "REPLACE_WITH_FIREBASE_WRITER_EMAIL", "password": "password",
            }})
        request.assert_not_called()

    @patch("firebase_push.urllib.request.urlopen")
    def test_transport_errors_are_actionable_and_redacted(self, urlopen):
        cases = [
            (ConnectionRefusedError(errno.ECONNREFUSED, "SECRET"), "연결 거부"),
            (TimeoutError("SECRET"), "시간 초과"),
            (socket.gaierror(-2, "SECRET"), "DNS 조회 실패"),
            (ssl.SSLCertVerificationError(1, "SECRET"), "TLS 인증서 검증 실패"),
            (ssl.SSLError(1, "SECRET"), "TLS 연결 실패"),
            (OSError(errno.ENETUNREACH, "SECRET"), "네트워크 경로 없음"),
            (ConnectionResetError(errno.ECONNRESET, "SECRET"), "연결 끊김"),
        ]
        for reason, expected in cases:
            for wrapped in (False, True):
                with self.subTest(expected=expected, wrapped=wrapped):
                    urlopen.side_effect = urllib.error.URLError(reason) if wrapped else reason
                    with self.assertRaises(push.PushError) as caught:
                        push.request_json("HA 조회", "http://localhost:8123/api/states")
                    self.assertIn(expected, str(caught.exception))
                    self.assertNotIn("SECRET", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
