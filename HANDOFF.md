# Toolhub 도구 확장 인수인계 (200개 목표)

**작성 2026-07-21 · 목표: 도구 총 200개 · 현재 완성 77개 (배포됨)**

기존 61개 → 이번 세션에서 신규 12개 완성 + 미등록 4개 수리 등재 = **허브 등재 77개**.
남은 목표까지 **123개** (계획 스펙 127개 중 12개 완성, 나머지 115개 미착수 + 부분빌드 10개).

---

## 1. 이번 세션 결과

### 배포된 것 (허브 등재 완료 — index/sitemap/locales/related 전부 반영)
- **신규 완성 12개** (전부 gate-check PASS, 14언어 패리티):
  `mortgage-calc` `compound-interest-calc` `pregnancy-due-date-calc` `period-calc`
  `tdee-calc` `hours-calc` `height-conv` `calculator`(공학용) `grade-calc`
  `final-grade-calc` `online-notepad` `pace-calc`
- **미등록 4개 수리** (GTM+Consent 주입 + 허브 등재): 이전 커밋 `ba9486b`가 만든
  `ad-copy-limit-check` `barista-fire-calc` `cagr-calc` `coast-fire-calc` — 허브
  locales/카드/sitemap 누락 + GTM 미설치 상태였던 것을 이번에 정상화.

### 부분 빌드 (배포 제외 — services/ 에 디렉터리는 있으나 미완성, git untracked)
세션 토큰 한도로 중단. **대부분 tip-calc 보일러플레이트 + 일부 파일만 존재.** 재개보다
아래 파이프라인으로 처음부터 다시 빌드 권장(부분 상태 신뢰 어려움):

| slug | 부족한 것 (2026-07-21 기준) |
|---|---|
| `typing-test` | app.js 끝단 truncate 미완, index/locales/registry |
| `image-resizer` | locales.js, registry |
| `image-compressor` | locales.js, registry |
| `click-speed-test` | locales.js, registry |
| `lorem-ipsum-gen` | locales.js, registry |
| `macro-calc` | app.js, locales.js, registry |
| `regex-tester` | index.html, locales.js, registry |
| `name-picker` | index.html, locales.js, registry |
| `text-diff` | locales.js, registry |
| `morse-code-translator` | locales.js가 tip-calc 복사본 그대로(콘텐츠 위조), registry |

> ⚠️ 이 10개 디렉터리는 커밋하지 않았다. 다음 세션 첫 작업으로 **삭제 후 재빌드**하거나,
> `factory/pipeline/gate-check.js`로 실제 상태를 재확인하고 부족분만 채워라.

---

## 2. 빌드 파이프라인 (`factory/pipeline/`)

이번 세션에서 확립한 자동화. 다음 세션에 그대로 재사용한다.

| 파일 | 역할 |
|---|---|
| `BUILD-GUIDE.md` | **도구 1개 빌드 계약.** 빌더 에이전트에게 이 파일 경로를 먼저 읽게 한다. 파일 구조, 14언어 i18n 패리티, GTM/Consent, JSON-LD 3종, 보일러플레이트 복사 규칙, 자가검증. |
| `SPECS.json` | **139개 신규 도구 스펙** (slug/name/cat/emoji/color/brief/keywords). 검색량 큰 글로벌 도구 위주. 완성 12개도 포함돼 있으니 재빌드 시 완성분은 건너뛴다. |
| `SHELL-LOCALES.json` | 14언어 셸 공통 번역 10키 (빌더가 locales.js에 복사). |
| `gate-check.js` | **게이트 검증.** `node gate-check.js <slug>...` → 필수파일/JS문법/locales 14언어 패리티/GTM×2/Consent/canonical/JSON-LD·FAQ 개수 일치/config·sw 일관성/레지스트리 JSON/**콘텐츠 진위(모든 data-i18n 키가 locales.en에 실재 + tip-calc 위조 복사본 차단)** 검사. |
| `merge-registry.js` | **허브 병합.** `registry/*.json`(각 도구가 생성)을 읽어 허브 `js/locales.js` 14언어 블록 + `index.html` 카테고리 카드 + `sitemap.xml` + 전 도구 `related.js`(카테고리 회전 윈도우) 재생성 + `sw.js` 캐시 버전 범프. 멱등(이미 등재분 skip). `--dry`로 미리보기. **허브 locales.en에 이름 있는 slug만 등재**하므로 미완성 도구는 자동 배제. |
| `registry-archive/` | 완성 16개 도구의 레지스트리 JSON 백업(14언어 names/descs). |

### ⚠️ 경로 상수 (다음 세션에 반드시 조정)
`gate-check.js`, `merge-registry.js` 상단의 `REPO` 절대경로와, 레지스트리 위치
(`REGISTRY = path.dirname(__dirname)+"/registry"`)는 **이번 세션 스크래치패드 기준**이다.
다음 세션에서는:
1. `factory/pipeline/*` 를 그 세션의 스크래치패드로 복사하고,
2. `registry/` 디렉터리를 스크래치패드에 새로 만들어(각 빌더가 여기에 `<slug>.json` 기록),
3. 스크립트의 `REPO` 를 현재 리포 절대경로로 확인/수정한 뒤 사용한다.

---

## 3. 재개 절차 (권장)

```
1) 부분빌드 10개 정리: services/{typing-test,image-resizer,image-compressor,
   click-speed-test,lorem-ipsum-gen,macro-calc,regex-tester,name-picker,
   text-diff,morse-code-translator} 삭제 (또는 gate로 재점검 후 결정)
2) 파이프라인 복사 + 경로 조정 (§2 경고 참조)
3) SPECS.json 에서 미완성/미착수 슬러그를 배치(~8~10개)로 나눠
   general-purpose 에이전트에 할당. 프롬프트 형식은 이번 세션과 동일:
   "BUILD-GUIDE.md 읽어라 → 스펙 → gate-check PASS까지 → 한 줄 보고"
   (sonnet 모델, 배치당 동시 10~12개가 안정적. 세션 한도 걸리면 SendMessage로 재개)
4) 배치마다 gate-check 로 검증, 전부 PASS면 다음 배치
5) 전 배치 완료 후 merge-registry.js 1회 실행 → 허브 병합
6) 배포(§4)
```

**남은 스펙 카테고리 분포** (SPECS.json, 완성 12 제외 127개):
finance 20 · dev 18 · utility 26 · text 13 · health 14 · units 10 · date 9 · life 11 · random 6

---

## 4. 배포 방법

정적 사이트(GitHub Pages, `rayvoidx/rayvoidx.github.io`, 커스텀 도메인 tool-hub.me).
푸시하면 자동 배포. **커밋/푸시는 사용자 셸에서 실행**(클로드 직접 금지 규칙).
이번 세션 배포 명령은 대화 로그의 마지막 박제 블록 참조 — 완성분만 add하고
미완성 10개(untracked)는 제외하는 방식.

배포 후 확인: `https://tool-hub.me/<slug>/` 각 도구, `https://tool-hub.me/sitemap.xml`,
허브 첫 화면 카드 + 검색 필터.

---

## 5. 품질 기준 (게이트가 강제)
- 순수 정적, 외부 CDN/API 0 (GTM/AdSense 주석 제외), 계산은 브라우저 내에서만.
- 14언어(en zh hi es ar fr bn pt ru ur id de ja ko) locales 키 **완전 동일**.
- GTM-TFBT774X + Consent Mode v2 (index/404/privacy).
- JSON-LD 3종(WebApplication/BreadcrumbList/FAQPage), FAQ 원문과 스키마 일치.
- 건강/금융 도구는 면책 고지 필수.
- AdSense는 `config.js` 에서 계속 `enabled:false` (승인 전).
