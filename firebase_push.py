"""Home Assistant -> Firebase RTDB. Python standard library only; run once per call."""

import argparse
import errno
import json
import math
import re
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path


KST = timezone(timedelta(hours=9))
FARM_ZONES = {f"이유_{n}배치" for n in range(1, 6)} | {
    f"육성_{n}배치" for n in range(1, 8)
} | {"외부온도"}


class PushError(Exception):
    pass


FIREBASE_AUTH_ERRORS = {
    "OPERATION_NOT_ALLOWED": "Firebase Authentication에서 이메일/비밀번호 제공업체를 활성화하세요.",
    "PASSWORD_LOGIN_DISABLED": "Firebase Authentication에서 이메일/비밀번호 제공업체를 활성화하세요.",
    "INVALID_LOGIN_CREDENTIALS": "해당 Firebase 프로젝트의 사용자 이메일/비밀번호를 확인하세요. Google/HA 로그인 계정과 별도입니다.",
    "INVALID_PASSWORD": "Firebase Authentication 사용자의 비밀번호를 확인하세요.",
    "EMAIL_NOT_FOUND": "이 API 키의 Firebase 프로젝트에 해당 사용자가 없습니다. Authentication 사용자 목록을 확인하세요.",
    "INVALID_EMAIL": "firebase_auth.email에 올바른 이메일 주소를 입력하세요.",
    "MISSING_EMAIL": "firebase_auth.email을 입력하세요.",
    "MISSING_PASSWORD": "firebase_auth.password를 입력하세요.",
    "USER_DISABLED": "Firebase Authentication에서 해당 사용자가 사용 중지되어 있는지 확인하세요.",
    "API_KEY_INVALID": "sungamfarm 프로젝트 설정의 웹 API 키를 확인하세요.",
    "API_KEY_HTTP_REFERRER_BLOCKED": "API 키의 웹사이트 제한으로 서버 로그인이 차단되었습니다. 서버용 키의 제한을 확인하세요.",
    "API_KEY_SERVICE_BLOCKED": "API 키가 Identity Toolkit API를 허용하는지 확인하세요.",
    "API_KEY_IP_ADDRESS_BLOCKED": "API 키의 서버 IP 허용 설정을 확인하세요.",
    "CONFIGURATION_NOT_FOUND": "이 API 키의 프로젝트에서 Firebase Authentication 설정을 확인하세요.",
    "PROJECT_NOT_FOUND": "API 키가 올바른 Firebase 프로젝트에 속하는지 확인하세요.",
    "TOO_MANY_ATTEMPTS_TRY_LATER": "반복 로그인 시도가 제한되었습니다. 자동화를 잠시 중지하고 나중에 다시 시도하세요.",
}


def firebase_auth_error(exc):
    """Return only known public error codes; never echo the server response."""
    try:
        payload = json.loads(exc.read(16384).decode("utf-8"))
        error = payload.get("error") if isinstance(payload, dict) else None
        if not isinstance(error, dict):
            return ""
        message = error.get("message", "")
        candidates = []
        if isinstance(message, str):
            candidates.append(message.split(" : ", 1)[0].strip())
            if message.startswith("API key not valid."):
                candidates.append("API_KEY_INVALID")
        details = error.get("details", [])
        if isinstance(details, list):
            candidates.extend(d.get("reason") for d in details if isinstance(d, dict))
        for code in candidates:
            if isinstance(code, str) and code in FIREBASE_AUTH_ERRORS:
                return f"{code}: {FIREBASE_AUTH_ERRORS[code]}"
    except (OSError, ValueError, UnicodeError):
        pass
    return ""


def connection_hint(exc):
    """Explain transport errors without exposing credential-bearing URLs/messages."""
    reason = exc.reason if isinstance(exc, urllib.error.URLError) else exc
    if isinstance(reason, ssl.SSLCertVerificationError):
        return "TLS 인증서 검증 실패: 인증서 도메인/유효기간/신뢰 체인을 확인하세요."
    if isinstance(reason, ssl.SSLError):
        return "TLS 연결 실패: HA의 HTTP/HTTPS 설정과 URL 프로토콜이 일치하는지 확인하세요."
    if isinstance(reason, socket.gaierror):
        return "DNS 조회 실패: 호스트 이름을 확인하거나 HA 내부 IP 주소를 사용하세요."
    code = getattr(reason, "errno", None)
    if isinstance(reason, ConnectionRefusedError) or code in (errno.ECONNREFUSED, 10061):
        return "연결 거부: 해당 주소/포트에 서버가 응답하지 않습니다. HA 수신 주소와 포트를 확인하세요."
    if isinstance(reason, TimeoutError) or code in (errno.ETIMEDOUT, 10060):
        return "시간 초과: 주소/포트, 방화벽 및 네트워크 경로를 확인하세요."
    if code in (errno.ENETUNREACH, errno.EHOSTUNREACH, 10051, 10065):
        return "네트워크 경로 없음: HA 내부 IP와 실행 환경의 네트워크를 확인하세요."
    if isinstance(reason, (ConnectionResetError, ConnectionAbortedError)):
        return "연결 끊김: 서버 상태와 HTTP/HTTPS 프로토콜 설정을 확인하세요."
    # Only type and numeric errno are shown; raw errors can contain URLs/tokens.
    code_text = f", errno={code}" if isinstance(code, int) else ""
    return f"연결 실패 ({type(reason).__name__}{code_text}): 주소/포트 및 HTTP/HTTPS 설정을 확인하세요."


def request_json(stage, url, *, headers=None, data=None, method="GET"):
    request_headers = {"Content-Type": "application/json; charset=utf-8"}
    request_headers.update(headers or {})
    body = None if data is None else json.dumps(
        data, ensure_ascii=False, allow_nan=False
    ).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    try:
        # Three requests per run, no retry loop: stay within shell_command's 60s limit.
        with urllib.request.urlopen(request, timeout=10) as response:
            raw = response.read().decode("utf-8")
        return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as exc:
        # Never print URLs, credentials, or raw server responses containing tokens.
        hints = {
            "HA 조회": "HA 주소와 장기 액세스 토큰을 확인하세요.",
            "Firebase 로그인": "이메일/비밀번호 제공업체, 전용 사용자, API 키를 확인하세요.",
            "Firebase 저장": "DB URL 및 sensor_logs와 history_logs 양쪽의 쓰기 규칙/사용자 UID를 확인하세요.",
        }
        detail = firebase_auth_error(exc) if stage == "Firebase 로그인" else ""
        raise PushError(f"[{stage}] HTTP {exc.code}. {detail or hints.get(stage, '')}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise PushError(f"[{stage}] {connection_hint(exc)}") from None
    except (ValueError, UnicodeError):
        raise PushError(f"[{stage}] JSON 응답이 아닙니다. API 주소를 확인하세요.") from None


def get_states(config):
    url = config.get("ha_url", "http://127.0.0.1:8123/api/states")
    token = config.get("ha_token")
    if not token:
        raise PushError("[설정] ha_token에 새 HA 장기 액세스 토큰을 입력하세요.")
    states = request_json("HA 조회", url, headers={"Authorization": f"Bearer {token}"})
    if not isinstance(states, list) or any(not isinstance(s, dict) for s in states):
        raise PushError("[HA 조회] 센서 목록 응답이 아닙니다. /api/states 주소를 확인하세요.")
    return states


def metric(entity):
    attrs = entity.get("attributes") or {}
    device_class = attrs.get("device_class")
    if device_class in ("temperature", "humidity"):
        return "temp" if device_class == "temperature" else "humi"
    name = attrs.get("friendly_name", "")
    if re.search(r"(?:온도|temperature)$", name, re.I):
        return "temp"
    if re.search(r"(?:습도|humidity)$", name, re.I):
        return "humi"
    return None


def auto_mapping(states):
    zones = {}
    for entity in states:
        if not entity.get("entity_id", "").startswith("sensor."):
            continue
        field = metric(entity)
        if not field:
            continue
        name = (entity.get("attributes") or {}).get("friendly_name", "").strip()
        zone = name if name in FARM_ZONES else re.sub(
            r"[\s_-]*(?:온도|습도|temperature|humidity)$", "", name, flags=re.I
        ).strip()
        batch = re.fullmatch(r"(이유|육성)[\s_]*(\d+)\s*배치", zone)
        if batch:
            zone = f"{batch[1]}_{int(batch[2])}배치"
        # Only known farm zones are auto-selected; other names need explicit mapping.
        if zone not in FARM_ZONES:
            continue
        mapping = zones.setdefault(zone, {})
        if field in mapping:
            raise PushError(f"[센서 매핑] {zone}의 {field} 센서가 여러 개입니다. zones에 entity_id를 지정하세요.")
        mapping[field] = entity["entity_id"]
    return zones


def sensor_value(entity, field):
    if entity is None:
        return "--"
    try:
        value = float(entity.get("state"))
    except (TypeError, ValueError):
        return "--"
    if not math.isfinite(value):
        return "--"
    unit = (entity.get("attributes") or {}).get("unit_of_measurement", "")
    if field == "temp":
        if unit in ("°F", "F"):
            value = (value - 32) * 5 / 9
        elif unit == "K":
            value -= 273.15
        elif unit not in ("", "°C", "C", "℃"):
            raise PushError("[센서 단위] 지원하지 않는 온도 단위입니다.")
    elif unit not in ("", "%") or not 0 <= value <= 100:
        return "--"
    return round(value, 2)


def build_snapshot(states, zones, now):
    if not zones:
        zones = auto_mapping(states)
    if not isinstance(zones, dict) or not zones:
        raise PushError("[센서 매핑] 농장 센서가 0개입니다. --list-sensors로 확인하고 zones를 설정하세요.")
    by_id = {s.get("entity_id"): s for s in states}
    timestamp = (
        f"{now.year}. {now.month}. {now.day}. {'오후' if now.hour >= 12 else '오전'} "
        f"{now.hour % 12 or 12}:{now.minute:02d}:{now.second:02d}"
    )
    snapshot = {}
    used = set()
    for zone, mapping in zones.items():
        if not zone or re.search(r'[.#$\[\]/\x00-\x1f\x7f<>\'"\\]', zone):
            raise PushError("[센서 매핑] 구역 이름에 Firebase/화면에서 사용할 수 없는 문자가 있습니다.")
        if not isinstance(mapping, dict) or not mapping or set(mapping) - {"temp", "humi"}:
            raise PushError(f"[센서 매핑] {zone}에는 temp/humi와 entity_id를 지정하세요.")
        record = {"timestamp": timestamp, "temp": "--", "humi": "--"}
        for field, entity_id in mapping.items():
            if not isinstance(entity_id, str) or not entity_id.startswith("sensor."):
                raise PushError(f"[센서 매핑] {zone}/{field}에 sensor.로 시작하는 entity_id가 필요합니다.")
            if entity_id in used:
                raise PushError(f"[센서 매핑] {entity_id}가 중복 지정되었습니다.")
            used.add(entity_id)
            entity = by_id.get(entity_id)
            if entity is None:
                print(f"[주의] {entity_id}가 HA에 없습니다. --로 저장합니다.", file=sys.stderr)
            record[field] = sensor_value(entity, field)
        snapshot[zone] = record
    return snapshot


def firebase_token(config):
    settings = config.get("firebase_auth") or {}
    if not isinstance(settings, dict) or not all(
        isinstance(settings.get(key), str) and settings[key].strip()
        for key in ("api_key", "email", "password")
    ):
        raise PushError("[설정] firebase_auth에 api_key/email/password를 입력하세요. HA 토큰과 별도입니다.")
    if any(settings[key].startswith("REPLACE_WITH_") for key in ("api_key", "email", "password")):
        raise PushError("[설정] firebase_auth의 예시 문구를 실제 Firebase 사용자 이메일/비밀번호 및 API 키로 교체하세요.")
    url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?" + urllib.parse.urlencode(
        {"key": settings["api_key"]}
    )
    result = request_json("Firebase 로그인", url, method="POST", data={
        "email": settings["email"], "password": settings["password"], "returnSecureToken": True,
    })
    if not isinstance(result, dict) or not result.get("idToken"):
        raise PushError("[Firebase 로그인] ID 토큰을 받지 못했습니다.")
    return result["idToken"]


def push_snapshot(config, snapshot, now):
    base = config.get("firebase_database_url", "").rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.path
            or parsed.query or parsed.fragment or parsed.username):
        raise PushError("[설정] firebase_database_url에는 https://로 시작하는 DB 루트 주소만 입력하세요.")
    token = firebase_token(config)
    # One atomic multi-path PATCH preserves unrelated zones and all existing history.
    updates = {f"sensor_logs/{zone}": value for zone, value in snapshot.items()}
    updates[f"history_logs/{int(now.timestamp() * 1000)}"] = snapshot
    url = base + "/.json?" + urllib.parse.urlencode({"auth": token, "print": "silent"})
    request_json("Firebase 저장", url, method="PATCH", data=updates)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("firebase_push.config.json"))
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--list-sensors", action="store_true", help="HA 센서 목록만 표시 (Firebase 쓰기 없음)")
    modes.add_argument("--dry-run", action="store_true", help="HA 조회/변환 결과만 표시 (Firebase 쓰기 없음)")
    args = parser.parse_args(argv)
    try:
        try:
            config = json.loads(args.config.read_text(encoding="utf-8-sig"))
        except FileNotFoundError:
            raise PushError("[설정] 설정 파일이 없습니다. --config 경로와 firebase_push.config.json 파일 이름을 확인하세요.") from None
        except PermissionError:
            raise PushError("[설정] 설정 파일을 읽을 권한이 없습니다. 파일 읽기 권한을 확인하세요.") from None
        except UnicodeError:
            raise PushError("[설정] 설정 파일 인코딩 오류입니다. UTF-8로 저장하세요.") from None
        except json.JSONDecodeError as exc:
            # Report location, never the configuration text (contains credentials).
            raise PushError(
                f"[설정] JSON 문법 오류: {exc.lineno}행 {exc.colno}열. "
                "해당 위치와 바로 앞부분의 쉼표, 큰따옴표, 중괄호를 확인하세요."
            ) from None
        except OSError:
            raise PushError("[설정] 설정 파일 읽기 실패입니다. --config가 폴더가 아닌 JSON 파일을 가리키는지 확인하세요.") from None
        if not isinstance(config, dict):
            raise PushError("[설정] 설정은 JSON 객체여야 합니다.")
        states = get_states(config)
        if args.list_sensors:
            for entity in states:
                if entity.get("entity_id", "").startswith("sensor."):
                    attrs = entity.get("attributes") or {}
                    print(json.dumps({
                        "entity_id": entity["entity_id"], "name": attrs.get("friendly_name"),
                        "state": entity.get("state"), "device_class": attrs.get("device_class"),
                        "unit": attrs.get("unit_of_measurement"),
                    }, ensure_ascii=False))
            return 0
        now = datetime.now(KST)
        snapshot = build_snapshot(states, config.get("zones"), now)
        if args.dry_run:
            print(json.dumps(snapshot, ensure_ascii=False, indent=2, allow_nan=False))
            return 0
        push_snapshot(config, snapshot, now)
        print(f"Firebase 전송 성공: {len(snapshot)}개 구역 (sensor_logs + history_logs)")
        return 0
    except PushError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
