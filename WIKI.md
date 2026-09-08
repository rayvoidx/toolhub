# Toolhub — 회원가입 없이 바로 쓰는 무료 웹 도구 모음

> **한 문장 요약**: 가격 비교부터 글자수 세기까지, 생활 속 계산과 변환을 브라우저에서 바로 처리하는 무료 웹 도구 모음. 설치도 회원가입도 필요 없습니다.

| 항목 | 값 |
|------|-----|
| slug | `hub` |
| 아키타입 | pure-static |
| 상태 | launched |
| 배포 | GitHub Pages · https://rayvoidx.github.io/ |
| 최종 갱신 | 2026-07-10 |
| 기준 커밋 | ac47356 |

## 1. 쉽게 이해하기
<!-- 비유 한 개 + "이것은 무엇인가" + "누가, 언제 쓰나" -->
필요할 때마다 쓸만한 무료 웹 도구를 찾아 헤매는 게 번거롭다 — 생활 속 작은 계산과 변환이 필요한 모든 사람가 쓴다.

## 2. 탄생 배경
<!-- 백로그의 어떤 아이디어에서 출발했고, 왜 지금 만들었나. 파생이면 원본과의 차이(기획 방향성) 명시 -->
백로그 `hub` 항목(priority 1)에서 출발. docs/HOSTING.md 의 3계층 구조(실험층 → 허브층 → 승격층) 중
허브층을 채우는 서비스로, unit-price(1호 서비스) 런칭 직후 두 번째로 파이프라인에 태웠다.
콘텐츠(도구 소개 글 + FAQ)가 쌓여야 AdSense 승인이 쉬워지므로, 단순 링크 목록이 아니라
사용법·활용 예시를 갖춘 콘텐츠 페이지로 기획했다.

| 시기 | 사건 | 의미 |
|------|------|------|
| 2026-07-09 | 스탬핑 | 팩토리 파이프라인 시작 |
| 2026-07-09 | 빌드 | 도구 디렉토리(카드 검색) + 사용법 콘텐츠 + FAQ 4개 구현 |

## 3. 도구의 동작
<!-- 핵심 입력 → 처리 → 출력 흐름. 상태는 어디 저장되나(localStorage 키 목록) -->
- 입력: 없음(계산형 도구 아님). 유일한 상호작용은 도구 카드 검색창(`#tool-search`) — 카드의
  `data-name`(이름+키워드)과 부분 일치하는 카드만 남기고 나머지는 `hidden` 처리한다.
- 처리: `ontology/services.yaml` 의 `status: launched` 서비스를 카드로 하드코딩한다
  (빌드타임 정적 HTML — 별도 API 호출·빌드 스텝 없음). 카드 블록은 `index.html` 안
  `<!-- MAINTAIN:CARDS-START -->` ~ `<!-- MAINTAIN:CARDS-END -->` 주석으로 감싸,
  새 도구가 launched 되면 `/maintain` 이 이 블록에 카드를 추가하도록 표시해 두었다.
- 출력: 카드 클릭 시 해당 서비스의 배포 URL로 이동. 검색 결과가 0건이면 `#tool-empty`
  안내 문구("검색 결과가 없습니다...")를 명시적으로 노출한다(조용한 실패 금지).
- 상태 저장: 없음. 검색어는 페이지 새로고침 시 초기화되며 localStorage/URL 파라미터를 쓰지 않는다
  (테마 토글만 셸 공통 로직이 `hub:theme` 키로 저장).
- 콘텐츠: 도구 사용법·활용 예시(단위가격 계산기 실사용 시나리오), "만든 사람의 다른 서비스"
  섹션(외부 링크: isitai.me — AI 생성 이미지/딥페이크 판별 도구).

## 4. 기술 구성
- 템플릿 버전: 1.0 (templates/web-app)
- 스택: 바닐라 HTML/CSS/JS, 빌드 스텝 없음, PWA(설치 가능)
- 외부 의존: 없음 (도구 목록은 빌드 시점에 정적 HTML로 하드코딩, 런타임 API 호출 없음)

## 5. 배포와 운영
- 배포: GitHub Pages (main 브랜치 push = 배포)
- 확인 방법: https://rayvoidx.github.io/ 접속 → 도구 1회 실행 → 콘솔 에러 0 확인
- 롤백: 직전 커밋으로 revert push

## 6. 사건 파일
<!-- 런칭 후 발생한 문제와 해결을 날짜와 함께 박제. "사고가 아키텍처를 만든다" -->
- **2026-07-10 — 글로벌 i18n 도입 (반전 결정)**: 사용자 지시("toolhub 는 글로벌 겨냥,
  세계 인구 70%가 쓰는 모든 언어")로 기본 언어를 ko → en 으로 전환하고 14개 언어
  스위처(js/i18n.js + js/locales.js, 세계 인구 ~75% 커버)를 탑재했다. ar·ur 은 RTL 렌더.
  언어 결정: `?lang=` → localStorage(`hub:lang`) → 브라우저 언어 → en.
  카드 검색은 data-name(영·한) + 표시 언어 textContent 를 함께 매칭하도록 변경.
  이후 새 도구 등재 시 locales.js 전 언어에 `tool.<slug>.*` 키를 같은 커밋에서
  추가해야 한다(게이트 F-4, docs/I18N.md). 한국어 baked SEO 를 잃는 대신 글로벌
  기본을 얻는 트레이드오프 — 언어별 정적 페이지 + hreflang 은 지표 검증 후 승격 과제.
- **2026-07-10 — tool-hub.me 도구 경로 전면 404 장애 (원인·수리 박제)**: 커스텀 도메인
  연결이 'DNS → GitHub Pages'가 아니라 'Workers 커스텀 도메인 → toolhub Worker'로
  구성됐는데, Worker 가 허브 자산만 서빙해 `/​<slug>/` 가 전부 404. 동시에 허브 레포의
  CNAME 파일 때문에 github.io 쪽은 301 → tool-hub.me 로 회송 = **모든 도구가 외부에서
  접속 불가**. 수리(d8741cc): ① worker/index.js — 자산에 없는 경로를 rayvoidx.github.io
  로 프록시(새 도구 자동 편입, 재배포 불필요) ② CNAME 제거(301 루프 해소) ③ .assetsignore
  신설 — 기존 배포가 `/.git/config` 를 200 으로 노출하던 문제 차단. 수리 후 10개 도구
  전부 200 실측. **재발 방지: CNAME 파일을 절대 되살리지 말 것, 서비스 레포는 공개 유지.**
- **2026-09-07 — AdSense "가치가 별로 없는 콘텐츠" 정책 위반 (원인·수리 박제)**: 사이트 검토가
  저가치 콘텐츠로 반려됐다. 진단: ① 8/27~30 도입한 언어별 정적 페이지 /<slug>/{ko,ja,es}/ 966종이
  <title>·meta 만 번역되고 정적 HTML 본문(UI 라벨·가이드·FAQ)은 영어 원문 — 번역은 런타임 JS
  (locales.js + lazy guide-i18n.js)로만 일어난다. 사이트맵 1308 URL 중 984 개가 영어 페이지의 중복이면서
  `<html lang>` 선언만 다른 상태. 번역 자체도 에이전트 자동 번역(사람 검수 없음)이라 구글 스팸 정책의
  "검수 없는 자동 번역 콘텐츠"에 해당. ② hreflang 이 13언어 `?lang=` URL 을 언어 버전으로 선언 — 같은 HTML
  이고 robots.txt 가 차단하는 URL. ③ macOS 복사 잔재("index 2.html"·"privacy 2.html"·"sw 2.js" 등) 159파일
  (35종 도구)이 배포 트리에 커밋돼 라이브 노출 — 정합성 게이트가 hub 루트만 검사하던 사각. ④ 홈 ItemList
  스키마 numberOfItems 109 (실제 328). 수리(hub 7a2f723c): 언어 하위 페이지 전량 삭제 +
  STATIC_LANGS=[] · hreflang 전면 제거(도구·홈·카테고리 — gen-hreflang/gen-lang-pages/gen-category-pages
  동일 규칙) · 잔재 159 삭제 + check-consistency 가 도구 디렉터리 잔재·폐기 언어 디렉터리까지 검출 ·
  worker 301 /<slug>/(ko|ja|es)/ → /<slug>/?lang=xx · ItemList 328. 사이트맵 1308 → 342.
  **재발 방지: 색인 대상 페이지는 정적 HTML 본문이 그 언어여야 한다 — JS 스왑 의존 페이지를 언어 버전으로
  내지 않는다. 자동 번역은 런타임 스위처 UX 로만 쓴다. 배포 전 check-consistency 필수.**
  잔여 후보: H1 중복 쌍 3(binary-text-conv/binary-translator · hourly-to-salary-calc/hourly-to-salary ·
  protein-calc/protein-intake-calc) — /maintain 에서 통합(sunset+301) 판정. AdSense 재검토 요청은 콘솔 수동.
- **2026-09-08 — 중복 도구 쌍 3 통합(sunset)**: 9/7 저가치 판정 수리의 잔여 후보. H1·검색 의도가 완전히 같은
  쌍 — hourly-to-salary → hourly-to-salary-calc(본문 665→1035단어) · protein-calc → protein-intake-calc(키워드
  slug·선런칭) · binary-translator → binary-text-conv(2진 전용 → 2진·16진·10진 상위집합). 배포 트리 3종 제거,
  홈 타일·ItemList·locales 14언어 키 42개 제거, worker SUNSET 맵 301(하위 경로·쿼리 보존), 레지스트리
  status: sunset + sunset_redirect(SCHEMA 명문화), 소스·SERVICE.yaml·WIKI 보존. check-consistency 가 sunset 을
  "배포 없음 정상 / 배포 잔존 🔴" 로 판정. 도구 328 → 325. **이후 sunset 은 이 절차 그대로**(maintenance.md §Sunset).

## 7. 연관 문서
- [팩토리 파이프라인](../../docs/PIPELINE.md)
- [서비스 레지스트리](../../ontology/services.yaml)
<!-- 파생/원본 서비스 링크 -->
