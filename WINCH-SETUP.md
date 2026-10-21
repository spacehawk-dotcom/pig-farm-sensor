# Netlify 육성사 윈치 연결

## 구성

env.html → 같은 사이트의 /.netlify/functions/winch → Tuya 클라우드.
직원에게 Tailscale/HA 토큰은 필요하지 않습니다. HA의 스위치는 별도로 유지됩니다.
브라우저에서는 제어 비밀번호만 메모리에 보관하며 새로고침하면 다시 입력합니다.
공유 비밀번호 방식이므로 개인별 사용자 식별/감사 기능은 없습니다.

## 자동 운전용 온도 (HA)

HA → 기존 Firebase Realtime Database → Netlify `winch-auto` 순서로 사용합니다.
서버가 5분마다 배치별 `sensor_logs/육성_N배치`의 `temp`(섭씨)와 `timestamp`를 읽습니다.
Tuya 온도 속성·보고 기록 API는 호출하지 않습니다. 윈치 제어·출력 조회는 기존 Tuya 연결을 유지합니다.
별도 HA 외부 주소, 포트 개방, HA 토큰이나 신규 Netlify 환경변수는 필요하지 않습니다.

기존 데이터 예: `{"temp":23.7,"humi":77.5,"timestamp":"2026. 10. 20. 오후 9:25:00"}`.
2026-10-20 사용자가 이 timestamp는 **센서의 마지막 수신 시각**임을 확인했습니다.
한국 시간(UTC+9)으로 엄격하게 해석하고, 15분 이상 지연되거나 미래 30초를 넘으면 자동 동작을 보류합니다.
누락·비정상 온도, 잘못된 날짜, 읽기 실패, 명시적인 offline/unavailable 상태도 동작을 보류합니다.
HA 전송 시각이나 서버 조회 시각으로 이 필드를 덮어쓰지 않아야 합니다.
기존 `sensor-handler.cjs`는 Tuya 조회 시각을 기록하는 별도 구형 수집기이므로
자동 운전의 HA 저장 경로를 덮어쓰는 용도로 함께 실행하지 마세요.

이 변경은 온도 데이터 경로만 교체하며 자동 운전을 새로 켜지 않습니다.
현장에서 확인한 현재 단계를 선택하고 사용자가 자동 시작해야 합니다.

## 배치별 장치

| 배치 | Tuya Device ID | 열림 / 닫힘 | 활성화 변수 |
| --- | --- | --- | --- |
| 1 | bfc3bfc544f6c06e35jcn1 | switch_1 / switch_2 | WINCH_1_SAFETY_CONFIRMED |
| 2 | bfb4be1d3b42f4b899zcv2 | switch_3 / switch_2 | WINCH_SAFETY_CONFIRMED |
| 3 | bf28266bf6b5528dc3jagu | switch_1 / switch_2 | WINCH_3_SAFETY_CONFIRMED |
| 4 | bf45e580cdc45371f4oeff | switch_1 / switch_2 | WINCH_4_SAFETY_CONFIRMED |
| 5 | bf5c24b61edbc6750cjw34 | switch_1 / switch_2 | WINCH_5_SAFETY_CONFIRMED |
| 6 | bf4f181985fcdb6b1fkddi | switch_1 / switch_2 | WINCH_6_SAFETY_CONFIRMED |
| 7 | bf2fc7c86f8148ef80xom4 | switch_1 / switch_2 | WINCH_7_SAFETY_CONFIRMED |

HA 엔티티 이름의 숫자로 채널을 추정하지 않습니다. 정지는 해당 배치의 두 출력만 OFF로 보냅니다.
공통 비밀번호 한 번으로 등록된 배치들을 조회하며 각 배치의 동작, 자동 단계, 잠금은 독립적입니다.
새 기기의 활성화 변수는 Production에만 true로 설정합니다.
서버에 검증된 안전 설정 스냅샷이 없으면 활성화 변수가 true여도 올림·내림이 차단됩니다.
연결 진단은 등록된 모든 배치를 읽고 잠금 저장소를 확인하며, 장치 작동 명령을 보내지 않습니다.

2026-10-20 신규 기기 확인:
- 3·4배치: 현장 확인 완료 및 클라우드 스냅샷 수집. 상호잠금 `AA8AAAAAAAA=`, 자동 꺼짐 `AQAFAwAGBAACBgAC`.
- 1배치: 사용자가 열림 5초·닫힘 6초로 수정한 후 2026-10-21 재조회 완료. 상호잠금 `AA8AAAAAAAA=`, 자동 꺼짐 `AQAFAwAGBAACBgAC`로 3·4배치와 일치하며 검증 스냅샷 등록 완료.

2026-10-22 2배치 점검: 연결과 서버 잠금은 정상이지만 이전 자동 꺼짐 스냅샷과 달라 제어가 차단됨.
현재 기기가 보고한 `AAAFAwAGBQAFBgAC`는 채널 3 열림 5초, 채널 2 닫힘 6초 활성 설정이며,
사용자가 확인한 동작 시간과 일치하여 서버 비교 기준을 갱신함. 기기 설정이나 출력을 변경하지 않음.
타이머 형식 참고: https://developer.tuya.com/en/docs/iot/production-development?id=Kbev9zps57vim (DP 19).

2026-10-22 5·6·7배치: 사용자가 세 기기 모두 채널 1 열림 5초·채널 2 닫힘 6초 및 상호잠금을
현장에서 확인함. 읽기 전용 진단에서 세 기기 모두 상호잠금 `AA8AAAAAAAA=`, 자동 꺼짐
`AQAFAwAGBAACBgAC`를 보고하여 검증 기준에 등록하고 Production 활성화 변수를 설정함.
자동 운전은 수동 상태로 유지하며 사용자가 현재 단계를 선택한 후 시작해야 함.

## Netlify 환경변수 (Functions 범위)

- TUYA_ACCESS_ID / TUYA_ACCESS_SECRET: 기존 EU 프로젝트의 인증정보 유지.
- WINCH_CONTROL_PASSWORD: 직원 제어용으로 별도 생성한 무작위 비밀번호(영문과 숫자 모두 포함, 10자 이상).
- WINCH_FIREBASE_SERVICE_ACCOUNT: sungamfarm Firebase 서비스 계정 JSON 전체. 서버의 Firestore 잠금에만 사용하며 브라우저·저장소·채팅에 넣지 않습니다.
- WINCH_SAFETY_CONFIRMED: 처음에는 false. 아래 현장 확인 완료 후에만 true.

서버 잠금 문서는 winch_server_locks/grower_N, 자동 상태는 winch_server_locks/auto_grower_N입니다. Firestore 보안 규칙에서
일반 웹/모바일 사용자의 이 컬렉션 읽기·쓰기가 허용되지 않아야 합니다.
Admin SDK는 IAM 권한으로 접근합니다. 기존 전체 경로 허용 규칙이 있다면 먼저 수정하세요.
배포 전 Netlify 함수 요청 제한도 설정해 공유 비밀번호의 반복 대입을 제한하세요.

정적 폴더 업로드만으로 Functions가 배포되지 않을 수 있습니다. package.json의
의존성과 netlify/functions가 함께 빌드되는 Git 연결 배포 또는 Netlify CLI 배포가 필요합니다.
환경변수 추가/변경 후 재배포하세요. 로컬 python 정적 서버는 함수를 실행하지 않습니다.

## 배포 및 확인 순서

1. 위 환경변수 설정, 제어 활성화는 false 유지.
2. Netlify에 코드/Functions 배포. env.html에서 비밀번호로 상태 조회.
3. 올림·내림 출력과 온라인 상태를 실제 Smart Life 화면과 대조.
4. 현장 담당자가 채널 방향, 상호잠금, 올림 5초/내림 6초 장치 자동 꺼짐,
   끝단 정지 및 전원 복구 동작을 확인. 이 작업에서는 실제 제어를 실행하지 않았습니다.
5. WINCH_SAFETY_CONFIRMED=true로 설정하고 재배포 후 현장에서 한 방향씩 시험.

안전 설정 비교는 사용자가 제공한 기존 클라우드 응답의 아래 원문과 일치하는지 확인합니다.
Raw 값을 임의 해석하거나 변경하지 않습니다. 설정이 달라지면 올림·내림을 차단하며,
정지 명령은 계속 허용합니다. 새 설정 검증 없이 비교 상수를 변경하지 마세요.

- 기존 2배치 switch_interlock: AA8AAAAAAAA=
- 2배치 switch_inching (2026-10-22 조회): AAAFAwAGBQAFBgAC

자동 정지는 장치의 Inching에 의존합니다. 서버나 브라우저 타이머를 안전장치로 쓰지 않습니다.
상태는 클라우드가 마지막 보고한 릴레이 출력이며 실제 위치/동작 확인이 아닙니다.
제어 요청에는 자동 재시도가 없습니다. 시간 초과 시 결과 불확실로 표시합니다.
서버는 Firestore 트랜잭션 잠금으로 이 웹앱의 요청만 직렬화합니다.
Smart Life/HA/물리 버튼 조작은 이 잠금을 따르지 않으므로 장치 상호잠금을 유지해야 합니다.
정지도 통신 지연이나 다른 요청 때문에 지연/실패할 수 있으며 비상 정지 용도가 아닙니다.
중단된 서버 요청의 잠금은 최대 90초 후 만료됩니다.
