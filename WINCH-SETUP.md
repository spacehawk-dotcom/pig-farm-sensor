# Netlify 육성2 윈치 연결

## 구성

env.html → 같은 사이트의 /.netlify/functions/winch → Tuya 클라우드.
직원에게 Tailscale/HA 토큰은 필요하지 않습니다. HA의 스위치는 별도로 유지됩니다.
브라우저에서는 제어 비밀번호만 메모리에 보관하며 새로고침하면 다시 입력합니다.
공유 비밀번호 방식이므로 개인별 사용자 식별/감사 기능은 없습니다.

장치: bfb4be1d3b42f4b899zcv2, 육성2만 허용.
Tuya switch_3 = 올림, switch_2 = 내림. HA 엔티티 이름의 숫자로 바꾸지 않습니다.
정지는 두 출력 모두 OFF. 1·4번 채널에는 명령을 보내지 않습니다.

## Netlify 환경변수 (Functions 범위)

- TUYA_ACCESS_ID / TUYA_ACCESS_SECRET: 기존 EU 프로젝트의 인증정보 유지.
- WINCH_CONTROL_PASSWORD: 직원 제어용으로 별도 생성한 무작위 비밀번호(영문과 숫자 모두 포함, 10자 이상).
- WINCH_FIREBASE_SERVICE_ACCOUNT: sungamfarm Firebase 서비스 계정 JSON 전체. 서버의 Firestore 잠금에만 사용하며 브라우저·저장소·채팅에 넣지 않습니다.
- WINCH_SAFETY_CONFIRMED: 처음에는 false. 아래 현장 확인 완료 후에만 true.

서버 잠금 문서는 winch_server_locks/grower_2입니다. Firestore 보안 규칙에서
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

- switch_interlock: AA8AAAAAAAA=
- switch_inching: AAACAwAHBQAIBgAC

자동 정지는 장치의 Inching에 의존합니다. 서버나 브라우저 타이머를 안전장치로 쓰지 않습니다.
상태는 클라우드가 마지막 보고한 릴레이 출력이며 실제 위치/동작 확인이 아닙니다.
제어 요청에는 자동 재시도가 없습니다. 시간 초과 시 결과 불확실로 표시합니다.
서버는 Firestore 트랜잭션 잠금으로 이 웹앱의 요청만 직렬화합니다.
Smart Life/HA/물리 버튼 조작은 이 잠금을 따르지 않으므로 장치 상호잠금을 유지해야 합니다.
정지도 통신 지연이나 다른 요청 때문에 지연/실패할 수 있으며 비상 정지 용도가 아닙니다.
중단된 서버 요청의 잠금은 최대 90초 후 만료됩니다.
