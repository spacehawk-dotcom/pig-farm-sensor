# 성암농장 윈치 제어

온도앱의 수동 버튼과 서버의 5분 자동 운전은 같은 함수로 명령을 보낸다. Netlify는 명령을 Firestore의 서버 전용 `winch_server_locks`에 저장한다. 농장 HA의 `sungam_winch` 통합이 외부로 연결해 명령을 받아 LocalTuya의 스위치를 조작한다. 브라우저는 HA 토큰이나 기기 로컬 키를 받지 않는다.

| 육성 배치 | 올림 5초 | 내림 6초 |
| --- | --- | --- |
| 2 | 채널 3 | 채널 2 |
| 1, 3, 4, 5, 6, 7 | 채널 1 | 채널 2 |

HA는 기기 ID와 채널의 LocalTuya 고유 ID로 스위치를 찾는다. 출력은 릴레이 상태이며 윈치 위치와는 별개다. 배치 활성화 변수, 하드웨어 타이머 및 상호잠금 검사, 방향 전환 전 OFF와 600ms 대기, 서버의 배치별 동시 제어 잠금을 사용한다. 장치가 안전 설정을 보고하지 않으면 올림·내림은 잠긴다. 정지는 두 채널에 OFF만 요청한다.

## HA 설치 및 복구

1. LocalTuya 2026.10.0에 각 기기의 올림·내림 스위치를 등록한다. 복구 시 HA의 기기 등록 정보와 LocalTuya를 함께 복원한다.
2. 이 저장소의 `homeassistant/custom_components/sungam_winch` 폴더를 HA의 `/config/custom_components/`에 설치한다. `configuration.yaml`에 `sungam_winch:`를 추가하고 변경 전 설정을 백업한다.
3. HA 전용 연결 키는 `/config/.storage/sungam_winch.secret`에만 보관한다(권한 600). 교체 시 48바이트 이상의 난수로 생성하고 `winch-local.cjs`의 SHA-256 검증 지문만 갱신한다. Git에는 키 원문을 넣지 않는다.
4. `ha core check` 후 재시작한다. HA 상태 `sensor.sungam_winch_bridge`로 연결 수와 안전 설정 확인 결과를 볼 수 있다.
5. Netlify Git 배포 후 앱에서 ‘등록된 윈치 연결 진단’을 실행한다. 이 검사는 실제 명령 경로로 읽기 전용 요청을 보내고 HA 응답을 확인한다.

### Smart Life 상호잠금 읽기 진단

HA 개발자 도구의 동작에서 `sungam_winch.check_smartlife_interlock`을 실행하면,
`sensor.sungam_smartlife_interlock_check`의 `results`와 `checked_at`에 조회 결과와 시각이 기록된다.
기존 HA Tuya 연동으로 장치 상세 상태를 새로 요청해 온라인인 장치의 실제 `switch_interlock` 값만 비교한다.
‘응답 없음’은 값이 제공되지 않았다는 뜻이며 상호잠금이 꺼졌다는 뜻이 아니다.
진단 결과는 앱의 제어 허용 조건에 사용하지 않으며, 어떤 릴레이도 조작하지 않는다.

운전용 보조 조회 옵션 `sungam_winch.smartlife_interlock`의 기본값은 꺼짐이다.
이를 HA YAML에서 명시적으로 `true`로 바꿔 적용하면 로컬 상호잠금 응답이 없을 때만 Smart Life를 조회한다.
표시용 결과와 별도로, 실제 올림·내림 직전에 해당 장치를 다시 조회한다. 조회 실패·시간 초과·설정 불일치 시 구동하지 않는다.
정지와 모터 출력은 항상 LocalTuya를 사용한다.

## 서버와 자동 운전

- 운영 환경에는 기존 `WINCH_CONTROL_PASSWORD`, `WINCH_FIREBASE_SERVICE_ACCOUNT`, 배치별 `WINCH_*SAFETY_CONFIRMED`가 필요하다. 2배치는 `WINCH_SAFETY_CONFIRMED`, 나머지는 `WINCH_N_SAFETY_CONFIRMED`다.
- Firestore의 `winch_server_locks`와 그 하위 경로는 클라이언트 읽기·쓰기를 차단해야 한다. 공개 RTDB의 `winch_local_wakeup`에는 일회성 알림만 올라간다. HA는 세션 서명을 검증한 후 전용 HTTPS 함수에서 명령을 한 번만 수령한다. 10초가 지난 명령은 실행하지 않으며 결과가 불확실한 명령은 재전송하지 않는다. 90초가 지난 HA 상태는 오프라인이다.
- 설정 온도는 각 배치 1그룹 값, 편차는 서버에 저장한 올림 3개·내림 3개를 사용한다. HA가 올린 온도는 센서 수신 시각이 15분 이상 지나면 사용하지 않는다. 시작·재개와 제어 경로 전환 후 첫 정상 측정은 기준 온도로만 기록한다.
- 자동 운전 중 수동 올림·내림을 하면 5분 후 온도 판단을 재개한다. 수동 정지는 자동 운전을 보류한다. 브라우저를 닫아도 서버에서 5분마다 확인한다. 명령 결과가 불확실하면 보류 후 현장 확인이 필요하다.
