# Home Assistant 회차 자동 기록 적용

Firebase 함수/Blaze 전환 대신 기존 Home Assistant에서 실행합니다. Python 표준 라이브러리만 사용하므로 pip 설치는 필요 없습니다.

## 1. 파일 두 개 복사
Home Assistant File editor에서 아래 파일을 각각 같은 이름으로 /config 안에 저장하세요.

- firebase_push.py: 기존 파일을 이 버전으로 교체합니다.
- firebase_cycle_archive.py: 새 파일을 추가합니다.

파일 맨 위부터 맨 아래까지 전부 복사하세요. 웹브라우저에서 다른 확장 프로그램의 함수나 개발자 도구 내용을 복사하지 마세요.

## 2. 기존 설정 JSON에 추가
/config/firebase_push.config.json을 엽니다. 기존 HA 토큰·Firebase 계정·zones는 유지합니다.
첫 번째 여는 중괄호 `{` 바로 다음 줄에 다음 내용을 추가하세요. 마지막 쉼표는 그 다음 기존 ha_url 항목과 연결하는 쉼표입니다.

```json
  "cycle_archive": {
    "enabled": true,
    "project_id": "sungamfarm"
  },
```

같은 cycle_archive 항목이 이미 있으면 중복 추가하지 말고 enabled를 true로 변경합니다.

## 3. 기존 전송 실행
기존 shell_command가 다음과 같다면 변경할 필요 없습니다.

```yaml
shell_command:
  firebase_push: "python3 /config/firebase_push.py --config /config/firebase_push.config.json"
```

개발자 도구 → 작업에서 shell_command.firebase_push를 한 번 실행합니다. 기존 '농장 Firebase 최근 실행 결과' 스크립트를 사용해도 됩니다.
성공 시 종료 코드 0과 다음 두 종류의 메시지가 나옵니다(숫자는 실제 결과).

```
Firebase 전송 성공: 13개 구역 (sensor_logs + history_logs)
회차 기록 성공: 사육 중 7개 / 0두 종료 0개 / 온도 7개
```

기존 5분 주기 전송 자동화를 계속 켜 두세요. 중복 자동화를 추가하지 마세요. 자동화가 없다면 함께 제공한 automation.example.yaml을 참고하세요. mode: single을 유지합니다.
Python 파일만 교체한 경우 HA 전체 재시작은 필요 없습니다. shell_command 설정을 새로 추가했다면 해당 설정을 HA에 다시 적용해야 합니다.

## 4. 앱에서 확인
simu → 배치 선택 → 입식 회차별 설정·온도 기록 → 회차 목록 새로고침.
'Home Assistant 마지막 회차 확인' 시각이 갱신되어야 자동 수집이 실제로 실행된 것입니다. '등록 전' 문구가 없어지고 '회차 기록 보기'에서 기간별 온도와 실제 설정 기록을 확인할 수 있습니다.
현재 로컬 simu 화면에 적용되어 있으며 공개 Netlify 사이트에는 이 화면 파일을 별도로 배포해야 합니다.

## 동작과 한계
- 사육현황의 growerInDate와 pigs(0 포함)를 읽습니다. 실제 사육 두수나 입식일을 이 스크립트가 수정하지는 않습니다.
- 0두 종료 시각은 HA가 처음 0두를 관측한 실행 시각입니다. 5분 사이의 정확한 시각은 알 수 없습니다. 마지막 양수 두수 확인 시각도 보관합니다.
- HA가 중지된 사이에 0두→재입식이 모두 일어나면 그 종료를 확정할 수 없습니다. 입식일 변경을 발견하면 해당 돈방 보관을 보류하고 경고합니다. 임의로 이전 회차와 합치지 않습니다. 올바른 회차 경계 확인 후 처리해야 합니다.
- 센서 이상/두수 필드 누락을 0두로 해석하지 않습니다. 빈 방에 온도를 계속 붙이지 않습니다.
- 설정 변경은 HA가 확인한 앱 공유 수정 설정입니다. 실제 컨트롤러 적용값을 증명하지 않습니다. 실제 설정 기록 화면에서 확인한 값과 관찰 기간을 따로 저장하세요.
- RTDB 기본 전송 성공 후 회차 저장이 실패할 수 있습니다. 이 경우 '온습도 기본 전송 성공 / 회차 보관 실패'를 구분해 표시합니다. 다음 실행 때 다시 확인하며, 기존 기본 온도 기록은 유지됩니다.
- HTTP 403: 같은 Firebase 전송용 사용자의 Firestore 읽기/쓰기 규칙 및 API 키 제한을 확인하세요. grower는 읽기만, ventilation_cycles/하위 컬렉션 및 ventilation_cycle_state는 읽기·쓰기 권한이 필요합니다. 규칙을 전체 공개로 바꾸지 마세요.
- HTTP 409/412 또는 동시 변경: 이번 회차 보관은 취소되고 다음 주기에 재확인합니다. 사육현황과 회차 읽기를 하나의 Firestore 트랜잭션으로 묶습니다.
- 기기 시계는 올바르게 동기화되어 있어야 합니다. 50초 작업 제한을 적용해 shell_command 제한 내에 종료하도록 했습니다.
- 기존 Firestore/RTDB 저장소 사용량과 무료 할당량은 계속 적용됩니다. 사용량이 무제한이라는 뜻은 아닙니다.

## 기술 참고
- https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit
- https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/list
