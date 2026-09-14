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
- **2026-09-09 — 서비스워커가 배포를 삼키고 있었다 (최중대 결함 박제)**: 전수 감사 중 발견. 템플릿
  `templates/web-app/sw.js` 가 **cache-first + 고정 캐시 이름**(`var CACHE = "<slug>-v1"`, 런칭 이후 한 번도
  안 올림, 325종 전부 v1)이었다. `caches.match(req).then(hit => hit || fetch(req))` 는 캐시에 있으면 네트워크를
  아예 보지 않으므로, **한 번이라도 도구를 연 방문자는 그때의 HTML/JS 에 영구 고정**된다. 2026-07 이후의 모든
  수리 — i18n 도입·퍼머링크 토큰 유출 보안수정(8/26)·CSP 강화·디자인 v2~v4·hreflang 제거(9/7)·sunset 301(9/8)
  — 이 재방문자에게 한 번도 닿지 않았다. "배포했으니 됐다"가 거짓이었던 것(철칙 5 조용한 실패의 최악 형태).
  수리: `factory/gen-sw.js` 신설 — HTML 내비게이션 network-first(재방문자가 항상 최신 배포를 봄),
  동일 출처 정적 자산 stale-while-revalidate(빠르면서 스스로 회복), 교차 출처 미개입, 캐시 세대 v2 로 올려
  오염된 v1 캐시를 activate 에서 일괄 삭제. 570파일 재작성 + 스탬프 템플릿 동반 수정(신규 도구 재발 방지)
  + pipeline-post 편입. **교훈: 정적 사이트에서 cache-first 서비스워커는 배포 파이프라인을 무력화한다.
  HTML 은 반드시 network-first, 캐시 이름에 세대를 넣고 전략 변경 시 올린다.**
- **2026-09-09 — 관련도구 JS 97% 감량**: `related.js` 가 링크 4개를 그리려고 CATALOG 전체(325종 × 14언어 이름
  = 142KB)를 325개 파일에 통째로 인라인해 페이지마다 ~200KB 를 받게 하고 있었다. 형제 선택 규칙이
  결정적(알파벳 회전)이라 빌드 시점에 확정 가능 — `gen-link-graph.js` 가 그 도구의 형제 4종만 싣도록 변경.
  200,773 → 5,668 바이트(도구당 −195KB). baked 정적 링크와 런타임 SIBS 가 325/325 완전 일치 실측 검증.
- **2026-09-09 — SERP 스니펫 절단 정합화**: meta description 이 165자를 넘는 도구 104종(최대 464자),
  `csv-diff` 는 `<title>` 이 130자("제목 — 설명"이 통째로 title 에 들어간 스탬핑 사고). 구글이 문장 중간에서
  자르게 두지 않고 `factory/gen-meta-fit.js` 가 160자 이내 마지막 문장 경계에서 끊는다(title 62자, " — "
  조각 단위). og/twitter 설명·locales `en` 블록까지 쌍 갱신(철칙 2). 200파일 description·2파일 title 정리.
  한계 박제: 비영어 로케일은 건드리지 않는다 — 크롤러가 보는 건 baked EN 이고 CJK 는 문장 경계 규칙이 달라
  기계 절단이 번역을 훼손한다.

- **2026-09-14 — 전면 개선 패스: 성능·AdSense 준비·UX 결함 (Lighthouse 실측 기반)**: 사용자 지시("전체 개선 + AdSense 등록되도록 SEO").
  진단(모바일 LH, 라이브): 홈 perf 57 (LCP 9.1s) · 도구 83 (LCP 3.9s). 원인 ① 홈 `js/locales.js` 14언어×325도구 = 933KB(br 247KB)
  렌더 차단(1,060ms) ② 홈 AdSense 로더가 미승인 상태에서 ~250KB 서드파티 JS(adsbygoogle·show_ads_impl·sodar) + 3rd-party 쿠키 +
  doubleclick 403 ③ body 끝 동기 스크립트 6종 파서 차단(460ms) ④ `<meta charset>` 이 동의모드/GTM 인라인 뒤(첫 1024바이트 위반)
  ⑤ 도구 171페이지 ca-pub-0000000000000000 플레이스홀더(스탬핑 잔재) ⑥ 홈 `data-theme="dark"` 강제(도구 321종은 auto) → 다크에서
  액센트 링크 3:1, 라이트에서 카테고리색 "View all" 3:1 (WCAG FAIL) ⑦ 도구 푸터가 도구별 privacy.html(10종 한국어 잔존)만 링크 —
  About/Contact/Terms 는 홈 한 단계 뒤 ⑧ state 8종 `stage: qa` 잔존(레지스트리 launched·배포 존재).
  수리: `gen-hub-locales.js`(진본 카탈로그 → `js/locales/<lang>.js` 14분할, i18n.js 허브 변형이 en 동기 + 나머지 lazy) ·
  `gen-html-fit.js`(charset 첫 자식·`<meta name="google-adsense-account">` 1,724페이지·플레이스홀더 256 치환·로더 config
  `adsense_loader` 토글 OFF·셸 스크립트 defer 571) · `gen-footer-nav.js`(푸터 About·Contact·Terms·Privacy 허브 1벌 570파일 +
  locales 14언어 키 557파일) · `--link` 토큰(라이트 액센트 55%+잉크, 다크 45%+화이트 — 82액센트 최악 4.95:1) · 홈 auto 테마 ·
  "View all" 에 sr-only 카테고리명. 세 생성기 pipeline-post 편입(15→18단계), deploy-tools/gen-category-pages 는 GTM 블록을
  마커로 추출(charset 앞 슬라이스 의존 제거). 검증: 표준 15/15 샘플·심층 전수 325/325, i18n 게이트 552/556(FAIL 2쌍 csv-diff·dividend-calc 는
  기존 죽은 마크업 64키 — 별건), 로컬·라이브 실브라우저(ja/ar lazy 로드·RTL·검색·계산·푸터·콘솔 0), 정합성 OK.
  결과(라이브 LH 모바일): 홈 perf 57→89 · SEO 92→100 · a11y 95→100 · BP 71→96, LCP 9.1→3.3s, 전송 829→345KB;
  도구 perf 83→90 · a11y 96→100, LCP 3.9→3.4s. hub 6a31c092.
  **남은 병목 = GTM(gtm.js+게이트웨이 253KB)**. **별건 발견(레포 밖)**: GTM Google 태그 ID 가 "G-S9LBSQR5W9, GT-MKP9B7GT" 두 개 병기 →
  게이트웨이 `/9xr5/` 400 (단일 ID 는 200 실측) → 전 페이지 콘솔 에러 2 + GA4 수집 hit 400. **GTM 콘솔에서 태그 ID 하나로 수정 필요(사용자).**
  AdSense 승인 후: config `adsense_loader: true` → pipeline-post 가 전 페이지 로더 ON.

## 7. 연관 문서
- [팩토리 파이프라인](../../docs/PIPELINE.md)
- [서비스 레지스트리](../../ontology/services.yaml)
<!-- 파생/원본 서비스 링크 -->
