# Toolhub 신규 도구 빌드 계약 (BUILD-GUIDE)

당신은 tool-hub.me(GitHub Pages 정적 사이트)의 신규 도구 1개를 빌드하는 에이전트다.
**이 문서의 계약을 벗어나면 게이트에서 FAIL 처리된다.** 절대 공유 파일(허브 루트의
index.html / js/* / sitemap.xml / 다른 도구 디렉터리)을 수정하지 마라 — 당신의 산출물은
`services/<slug>/` 디렉터리 하나와 레지스트리 JSON 하나뿐이다.

## 경로

- 리포 루트: `/Users/jaehyun/Library/Mobile Documents/com~apple~CloudDocs/toolhub`
- 골든 템플릿(보일러플레이트 원본): `<리포>/services/tip-calc/`
- 산출물 디렉터리: `<리포>/services/<slug>/`
- 레지스트리 JSON: `/private/tmp/claude-501/-Users-jaehyun-Library-Mobile-Documents-com-apple-CloudDocs-toolhub/19486204-6174-46f2-b710-06523f14fbc3/scratchpad/registry/<slug>.json`
- 셸 공통 번역(복사용): `<스크래치패드>/SHELL-LOCALES.json`

## 절대 규칙

1. **순수 정적**: 외부 CDN·라이브러리·API 호출 금지(GTM/AdSense 주석 제외). 모든 계산은
   브라우저 안에서. 저장은 localStorage만. 예외 없음.
2. **i18n 14언어 패리티**: `en zh hi es ar fr bn pt ru ur id de ja ko` — locales.js의
   14개 언어 블록이 **완전히 동일한 키 집합**을 가져야 한다. 한 키라도 빠지면 FAIL.
   번역은 기계적 직역이 아니라 해당 언어 사용자가 검색할 자연스러운 표현으로.
3. **baked 기본 언어는 영어**: HTML 원문(하드코딩된 텍스트)은 전부 영어. `<html lang="en">`.
4. **GTM + Consent Mode v2**: index.html / 404.html / privacy.html 세 파일 모두
   tip-calc와 동일한 블록(head 최상단 consent+GTM 로더, body 직후 noscript)을 유지.
   404.html/privacy.html은 tip-calc 것을 그대로 복사하므로 자동 충족된다.
5. **면책 고지**: 건강/금융 도구는 결과 하단에 "교육적 정보이며 의료/투자/세무 조언이
   아님" 취지의 고지 + privacy 고지("모든 계산은 브라우저에서 실행")를 data-i18n으로 넣는다.
6. **사용자에게 보이는 모든 문구**는 `data-i18n` (텍스트) / `data-i18n-placeholder` /
   `data-i18n-title` / `data-i18n-aria-label` (속성) 훅을 달고 locales.js 전 언어에 키를 만든다.
   JS 동적 문구는 `window.I18N.t("key")`로 조회하고, 언어 전환 갱신이 필요하면
   `document`의 `"i18n:change"` 이벤트를 구독한다(치환 변수는 `{name}` 스타일로 넣고
   `String.replace`로 채운다 — tip-calc/cagr-calc app.js 참고).

## 파일별 제작 방법

`services/tip-calc/`에서 복사 후 필요한 부분만 수정한다.

| 파일 | 방법 |
|---|---|
| `404.html` | tip-calc 것 그대로 복사 (수정 없음) |
| `privacy.html` | 그대로 복사 (수정 없음) |
| `js/i18n.js` | 그대로 복사 (수정 없음) |
| `js/related.js` | 그대로 복사 (수정 없음 — 카탈로그는 오케스트레이터가 나중에 일괄 재생성) |
| `sw.js` | 복사 후 1행 캐시 이름만 `"<slug>-v1"`로 변경 |
| `manifest.webmanifest` | 복사 후 `name`/`short_name`(영문 도구명), `description`(영문 meta description과 동일), `theme_color`(스펙의 color) 수정 |
| `css/style.css` | 복사 후 `:root`의 `--accent`를 스펙 color로, `--accent-strong`을 스펙 colorStrong으로 수정 (그 외 수정 금지) |
| `js/config.js` | 복사 후 `slug`, `name`만 수정 |
| `icons/icon.svg` | 새로 작성: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="<color>"/><text x="32" y="42" font-family="-apple-system, 'Segoe UI', sans-serif" font-size="30" font-weight="800" fill="#ffffff" text-anchor="middle">글리프</text></svg>` — 글리프는 도구를 상징하는 1-2자(문자/이모지) |
| `js/app.js` | tip-calc app.js의 **셸 영역(파일 처음부터 `TOOL MODULE` 마커 주석까지)을 그대로 복사**하고, 그 아래 TOOL MODULE 영역만 새로 작성 |
| `js/locales.js` | 새로 작성 (아래 상세) |
| `index.html` | 새로 작성 (아래 상세) |

`og-image.png`, `icons/icon-192.png`는 만들지 않는다(현행 컨벤션 — 참조만 존재).

### index.html 상세

tip-calc index.html을 뼈대로 사용. 유지할 것: head 최상단의 Consent Mode v2 스크립트 +
GTM 로더(GTM-TFBT774X), body 직후 GTM noscript, header/footer 마크업, ad-slot 및
related-tools 섹션, 스크립트 로드 순서(config→locales→i18n→app→related).

교체할 것:
1. `<title>`: `<영문 도구명> — <핵심 베네핏 짧게>` (검색 키워드 포함, ~60자)
2. `<meta name="description">`: 기능+입력+출력+무료/브라우저 처리 명시, 140-160자 (영문)
3. `<meta name="keywords">`: 스펙의 keywords + 필요시 추가 (한국어 키워드 1-2개 포함 가능)
4. `<link rel="canonical" href="https://tool-hub.me/<slug>/">`, og:url/og:image 동일 slug로
5. `<meta name="theme-color">`: 스펙 color
6. JSON-LD 3종:
   - WebApplication (name/description/url — meta와 일치)
   - BreadcrumbList (Toolhub → 도구)
   - FAQPage — **본문 FAQ의 영어 원문과 문구가 정확히 일치해야 함** (Google 요건)
7. hero: `<h1>영문 도구명</h1>` + `<p class="lede" data-i18n="hero.lede">…</p>`
8. TOOL 섹션 (`<section class="tool-card" id="tool" aria-live="polite">`): 도구 UI.
   섹션 안 `<style>`로 도구 전용 스타일(`#tool` 스코프, CSS 변수 var(--line), var(--accent),
   var(--ink), var(--muted), var(--bg), var(--surface) 활용). 모바일 375px에서 가로 스크롤 금지
   (`@media(max-width:420px)` 대응). 결과 영역은 계산 전 hidden.
9. FAQ 섹션: `<details><summary data-i18n="faq.qN">…</summary><p data-i18n="faq.aN">…</p></details>`
   ×4~5개. SEO 타깃 질문(검색 롱테일)으로: 공식/워크드 예제 1개 이상, 엣지 케이스,
   개인정보(브라우저 내 처리), 해당 시 면책. 각 답변 3-5문장의 실질 콘텐츠.

### js/locales.js 상세

구조는 cagr-calc/js/locales.js와 동일:

```js
/* (주석 헤더 — cagr-calc 것 참고해 유지) */
window.I18N_LOCALES = {
  en: { ...셸 공통 10키..., "meta.title": …, "meta.description": …, "hero.lede": …,
        "tool.*": …, "faq.q1..a5": … },
  zh: { … }, hi: { … }, es: { … }, ar: { … }, fr: { … }, bn: { … },
  pt: { … }, ru: { … }, ur: { … }, id: { … }, de: { … }, ja: { … }, ko: { … }
};
```

- 셸 공통 10키(`_label`, `nav.theme/share/language/home`, `faq.heading`,
  `footer.privacy/more/credit/coffee`)는 `SHELL-LOCALES.json`에서 **그대로 복사**.
- `meta.title`/`meta.description`: index.html의 것과 en이 동일해야 하고, 각 언어로 번역.
- `hero.lede`, TOOL UI의 모든 라벨/플레이스홀더/버튼/결과 라벨/오류 문구, `faq.q1~aN`
  전부 14언어로.
- en 블록의 값 = HTML 원문과 동일 (i18n 폴백 일관성).

### js/app.js TOOL MODULE 상세

- IIFE로 작성, `"use strict"`.
- 입력 검증 + 명확한 오류 문구(`tool.err.*` 키), 엣지 케이스(0, 음수, 빈 값, 극단값 캡).
- 숫자 표시는 `Intl.NumberFormat`(로케일 존중), 통화가 필요한 도구는 cagr-calc처럼
  currency-select(사용자 선택, localStorage 저장) 패턴 사용 가능.
- 마지막 입력값 localStorage 저장/복원 (`cfg.slug + ":state"` 키, try/catch로 감싸기).
- Enter 키로 계산 실행, 결과는 `aria-live` 영역에.
- ES5 스타일(var, function) 유지 — 기존 코드베이스와 일관.

## 레지스트리 JSON (필수 산출물)

`<스크래치패드>/registry/<slug>.json`:

```json
{
  "slug": "…",
  "cat": "finance|date|health|units|text|dev|random|life|utility",
  "emoji": "🏠",
  "color": "#0f766e",
  "dataName": "허브 카드 검색용 키워드 문자열 (영문 명칭+검색어+slug+한국어 키워드 병기)",
  "names": { "en": "...", "zh": "...", "hi": "...", "es": "...", "ar": "...", "fr": "...", "bn": "...", "pt": "...", "ru": "...", "ur": "...", "id": "...", "de": "...", "ja": "...", "ko": "..." },
  "descs": { "en": "...", … 14언어 … }
}
```

- `names`: 허브 목록에 뜨는 짧은 도구명 (기존 예: "Loan Calculator"/"대출 계산기").
- `descs`: 1-2문장 요약 (허브 locales의 `tool.<slug>.desc`용). 14언어 모두.
- `emoji`/`cat`/`color`는 스펙에 준 값 그대로.

## 자가 검증 (완료 전 필수 실행)

```bash
cd "<리포>/services/<slug>"
node --check js/app.js && node --check js/locales.js && node --check js/config.js && node --check js/i18n.js && node --check js/related.js && node --check sw.js
node -e 'const f=new Function(require("fs").readFileSync("js/locales.js","utf8").replace("window.I18N_LOCALES","var L")+";return L;");const L=f();const langs=Object.keys(L);if(langs.length!==14)throw new Error("langs "+langs.length);const ref=Object.keys(L.en).sort().join("|");for(const g of langs){const k=Object.keys(L[g]).sort().join("|");if(k!==ref)throw new Error(g+" key mismatch");}console.log("locales OK:",Object.keys(L.en).length,"keys x14")'
grep -c "GTM-TFBT774X" index.html   # 반드시 2
node -e 'const h=require("fs").readFileSync("index.html","utf8");const m=[...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];if(m.length<3)throw new Error("ld+json "+m.length);m.forEach(x=>JSON.parse(x[1]));console.log("JSON-LD OK",m.length)'
```

레지스트리 JSON도 `JSON.parse` + names/descs 14키 확인 후 종료.

## 반환 형식

최종 텍스트로 다음만 보고: `<slug> DONE — files:<개수>, locales keys:<N>x14, faq:<N>, gate:PASS`
(실패 시 무엇이 실패했는지 한 줄). 파일 내용을 반환하지 마라.
