# Home Assistant → Firebase → env.html

## 확인된 내용

`env.html`은 최신값을 `sensor_logs/{구역}`, 과거 그래프를 `history_logs/{밀리초 시간}/{구역}`에서 읽습니다. 구역 데이터에는 `temp`, `humi`, 한국어 날짜 형식의 `timestamp`가 필요합니다. 기존 Python 예제는 과거 기록을 쓰지 않았고, Firebase 인증도 없었습니다. 공개 쓰기가 허용된 DB에서는 인증 없이도 성공할 수 있으므로 인증 누락이 현재 오류의 원인이라고 단정할 수는 없습니다.

제공된 `homeassistant.components.shell_command` 로그의 `return code: 1 / NoneType: None`만으로는 실제 실패 지점을 알 수 없습니다. 아래 진단 실행으로 `stderr`를 확인해야 합니다. 파일 에디터는 파일을 편집하고, 실제 실행은 `shell_command`가 맡습니다. 파일을 저장하기만 해서는 실행되지 않습니다.

## 1. Home Assistant에 두 파일 배치

- 이 저장소의 `firebase_push.py`를 File editor에서 **`/config/firebase_push.py`**로 복사합니다. 메시지의 `\`, `&#x20;`, `http\:` 같은 표시 문자가 들어가지 않게 파일 내용을 그대로 복사하세요.
- `firebase_push.config.example.json` 내용을 **Home Assistant의 `/config/firebase_push.config.json`**으로 저장하고 토큰/계정을 채웁니다. 이 설정은 Python이 직접 읽으므로 `!secret` 문법은 쓸 수 없습니다.
- 대화에 붙인 HA 토큰은 노출되었으므로 HA 사용자 프로필의 보안 설정에서 폐기하고 새 장기 액세스 토큰을 발급해 `ha_token`에 입력하세요.
- 실제 비밀번호/토큰이 있는 설정 파일은 **Home Assistant에만** 보관하세요. 웹사이트 폴더나 Netlify 게시 파일에 넣지 마세요. `.gitignore`는 Git 추적만 막으며 정적 사이트 게시를 막지는 않습니다.

설정 예제의 `ha_url`은 `http://127.0.0.1:8123/api/states`이지만 **실제 HA 서버 포트와 일치해야 합니다.** 공식 문서상 HA OS는 2026.8부터 기본 포트가 80이고 Container는 8123입니다. 기존 설치는 설정이 다를 수 있으므로 버전만 보고 판단하지 마세요. 최근 버전은 설정 → 시스템 → 네트워크 → HTTP 서버에서 현재 포트/수신 주소/TLS 설정을 확인하고, 이전 버전은 `configuration.yaml`의 `http:` 설정을 확인합니다. HA 서버 설정 자체를 변경할 필요는 없습니다.

- HA가 HTTP/80으로 수신한다면 `ha_url`을 `http://127.0.0.1:80/api/states`로 설정합니다.
- HTTP/8123이면 `http://127.0.0.1:8123/api/states`를 사용합니다.
- HA가 특정 내부 IP에서만 수신한다면 `127.0.0.1` 대신 해당 IP를 사용합니다.
- HA에 직접 HTTPS를 설정했다면 인증서와 일치하는 호스트 이름을 포함한 HTTPS 주소를 사용합니다. 외부 접속용 프록시의 HTTPS 주소와 HA 자체의 HTTP 설정은 다를 수 있습니다.

별도 Terminal 애드온에서 실행할 때의 localhost는 다를 수 있으므로 동일하게 판단하면 안 됩니다. 이 스크립트는 HA 장기 액세스 토큰을 사용하며 Supervisor 토큰 방식은 사용하지 않습니다. 표준 라이브러리만 사용하므로 pip 설치는 필요하지 않습니다.

## 2. Firebase 전용 쓰기 사용자 설정

Firebase 콘솔 → Authentication에서 **이메일/비밀번호** 제공업체를 활성화하고 이 전송 작업만을 위한 사용자를 추가합니다. 사용자의 이메일/비밀번호를 `firebase_auth`에 입력하고 UID를 복사합니다. `api_key`는 기존 앱의 공개 프로젝트 API 키이며, API 키만으로는 쓰기 권한이 생기지 않습니다. 스크립트가 실행 때마다 로그인해 새 ID 토큰으로 DB에 접근합니다. 브라우저 앱용 **익명 로그인**도 유지하세요.

Realtime Database 규칙의 관련 두 경로를 다음처럼 설정할 수 있습니다. `REPLACE_WITH_WRITER_UID` 두 곳을 전용 사용자의 UID로 바꾸세요. 기존 다른 경로의 규칙은 보존하고, 루트 또는 상위 경로에 `.write: true`가 있으면 이 제한을 무효화하므로 해당 공개 쓰기 권한을 제거해야 합니다. 아래 예시는 로그인한 사용자(익명 포함)의 조회를 허용합니다. 농장 멤버만 조회해야 한다면 읽기 규칙도 별도로 제한해야 합니다.

```json
{
  "rules": {
    "sensor_logs": {
      ".read": "auth != null",
      ".write": "auth != null && auth.uid === 'REPLACE_WITH_WRITER_UID'"
    },
    "history_logs": {
      ".read": "auth != null",
      ".write": "auth != null && auth.uid === 'REPLACE_WITH_WRITER_UID'"
    }
  }
}
```

두 경로를 한 번의 PATCH로 저장하므로 **양쪽 모두** 쓰기 권한이 필요합니다. 규칙을 바꾸기 전 수정된 `env.html`도 배포해 로그인 후에 구독하도록 적용하세요. 다른 화면의 인증 방식도 확인한 후 읽기 규칙을 적용하세요. 이 작업에서 실제 클라우드 규칙/배포는 변경하지 않았습니다.

## 3. HA 실행 명령 등록과 진단

`configuration.fragment.yaml`의 `shell_command` 항목을 HA `configuration.yaml`에 병합합니다. 같은 최상위 키를 중복으로 만들지 마세요. 설정 검사 후 HA를 재시작하거나 이미 사용 중인 Shell Command 통합을 다시 로드합니다.

새 HA 스크립트를 만들고 YAML 편집기에 `diagnose.sequence.yaml` 내용을 붙여 넣어 실행합니다. **이 실행은 HA만 조회하며 Firebase에 쓰지 않습니다.** 알림에 종료 코드와 변환 결과/실제 오류가 표시됩니다.

- `[HA 조회] 연결 거부`: HA의 실제 서버 포트(80/8123/사용자 지정) 및 수신 주소 확인.
- `[HA 조회] 시간 초과` / `네트워크 경로 없음`: 주소, 방화벽 및 네트워크 확인.
- `[HA 조회] DNS 조회 실패`: 호스트 이름 또는 HA 내부 IP 확인.
- `[HA 조회] TLS 인증서 검증 실패` / `TLS 연결 실패`: HTTP/HTTPS 설정, 인증서 호스트/유효기간/신뢰 체인 확인. 인증서 검증을 끄지 마세요.
- `[HA 조회] HTTP 401`: HA 장기 액세스 토큰 확인.
- `[센서 매핑] 농장 센서가 0개`: 아래 entity_id 매핑 필요.
- Python `SyntaxError`: 복사한 파일의 들여쓰기/이스케이프 문자 확인.
- `No such file` / `can't open file`: `/config`의 파일 경로 확인.

## 4. 실제 센서 연결

`zones: {}`이면 이름에서 `온도`, `습도`, `temperature`, `humidity` 접미사를 떼어 **이유_1배치~이유_5배치, 육성_1배치~육성_7배치, 외부온도**에 해당하는 센서만 찾습니다. `이유 1배치`처럼 공백을 쓰거나 `육성1배치`처럼 붙여 쓴 이름도 기존 DB 구역 이름으로 변환합니다. `device_class`가 있으면 온도/습도 종류를 우선 판별합니다. 같은 구역에 같은 종류의 센서가 여러 개 있으면 임의로 선택하지 않고 오류를 냅니다.

2026-10-02에 확인한 실제 농장 센서 26개의 명시적 연결 설정은 `zones.sungamfarm.json`에 있습니다. HA의 `/config/firebase_push.config.json`에서 **zones 항목만** 이 파일의 zones 값으로 교체하면 됩니다. 기존 HA 주소/토큰 및 Firebase 인증 정보는 유지하세요. 이 파일 자체를 전체 설정 파일 대신 사용하면 인증 설정이 없어 실행되지 않습니다. 명시적 매핑은 이전 전송 스크립트에서도 사용할 수 있어 Python 파일을 다시 복사하지 않아도 적용됩니다.

이름이 다르면 진단 스크립트의 action을 `shell_command.firebase_push_list`로 바꿔 센서 목록을 확인합니다. 그 목록의 실제 `entity_id`를 사용해 설정 JSON의 `zones`를 채우세요. 다음 ID는 예시이므로 그대로 사용하면 안 됩니다.

```json
"zones": {
  "이유_1배치": {
    "temp": "sensor.example_weaning_1_temperature",
    "humi": "sensor.example_weaning_1_humidity"
  },
  "외부온도": {
    "temp": "sensor.example_outside_temperature"
  }
}
```

`zones`가 채워져 있으면 지정한 구역만 전송합니다. 모든 농장 구역을 등록하세요. 지정한 엔티티가 없거나 `unknown/unavailable/NaN`이면 값을 `--`로 기록합니다. 온도는 °C로 변환하며 습도는 HA의 % 값을 사용합니다. 수집 시간은 `timestamp`에 들어가며 센서의 실제 측정 시간이 아닙니다. HA가 오래된 숫자 상태를 계속 제공하는 상황까지 감지하는 코드는 아닙니다.

## 5. 실제 전송과 주기 실행

진단 결과가 맞으면 진단 스크립트 action을 `shell_command.firebase_push`로 바꾸어 한 번 실행하세요. 알림에 `Firebase 전송 성공: N개 구역 (sensor_logs + history_logs)`가 표시되고 두 DB 경로가 갱신되는지 확인합니다.

- `[Firebase 로그인] HTTP 400/403`: 제공업체 활성화, 이메일/비밀번호, API 키 제한 확인.
- `OPERATION_NOT_ALLOWED`: Authentication → 로그인 방법에서 **이메일/비밀번호**를 활성화합니다. 익명 로그인만 활성화한 상태로는 이 스크립트의 로그인이 되지 않습니다.
- `INVALID_LOGIN_CREDENTIALS` / `EMAIL_NOT_FOUND` / `INVALID_PASSWORD`: **sungamfarm 프로젝트의 Authentication → 사용자**에 등록한 이메일/비밀번호인지 확인합니다. Firebase 콘솔을 여는 Google 계정이나 HA 로그인 계정을 그대로 넣는 것이 아닙니다. 전송 전용 사용자를 추가하고 해당 계정을 설정 JSON에 입력하세요.
- `API_KEY_INVALID`: 프로젝트 설정의 웹 API 키를 확인합니다. `API_KEY_HTTP_REFERRER_BLOCKED` 등이면 API 키 제한이 HA 서버에서의 로그인 요청을 허용하는지 확인합니다.
- `TOO_MANY_ATTEMPTS_TRY_LATER`: 자동화를 잠시 중지해 재시도를 멈추고, 계정 설정을 확인한 뒤 나중에 실행합니다.
- `[Firebase 저장] HTTP 401/403`: DB 주소, 전용 사용자 UID 및 두 경로의 규칙 확인.
- 전송 성공인데 화면이 그대로면 수정된 `env.html` 배포 여부와 브라우저 로그인/읽기 권한을 확인하세요.

성공한 뒤 `automation.example.yaml`을 기존 `automations.yaml` 목록에 추가하고 자동화를 다시 로드합니다. 5분 간격으로 한 번씩 실행하며 실패하면 HA 내부 알림을 남깁니다. HA 스크립트는 `python_script` 통합으로 실행하지 마세요. 해당 통합의 샌드박스는 이 코드의 import를 지원하지 않습니다.

기존 Tuya Netlify 함수(`netlify/functions/app.js`)를 부르는 외부 스케줄러/자동화가 있다면 중지하세요. 기존 함수는 같은 `sensor_logs`를 덮어씁니다. 수정 스크립트는 수집한 구역만 갱신하며 과거 데이터와 미지정 구역을 삭제하지 않습니다. 따라서 옛 구역 카드가 남을 수 있고, 이력은 계속 누적되므로 별도의 보존 기간 운영이 필요합니다. 기존 Tuya 이력의 `count`/`dateRange`는 HA 센서 API에 없으므로 새 이력에는 저장하지 않습니다. 과거 화면의 사육 마리수 기록은 추가 데이터 연동 없이는 복원되지 않습니다.

## 공식 문서

- [Home Assistant shell_command 실행 환경과 응답](https://www.home-assistant.io/integrations/shell_command/)
- [Home Assistant REST API](https://developers.home-assistant.io/docs/api/rest/)
- [Home Assistant HTTP 서버 포트와 설정](https://www.home-assistant.io/integrations/http/)
- [Firebase REST 인증](https://firebase.google.com/docs/database/rest/auth)
- [Firebase 이메일/비밀번호 로그인](https://firebase.google.com/docs/reference/rest/auth#section-sign-in-email-password)
- [Firebase 다중 경로 업데이트](https://firebase.google.com/docs/database/rest/save-data)
