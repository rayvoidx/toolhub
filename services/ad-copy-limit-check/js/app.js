/* ============================================================
   앱 셸 공통 로직 — 원칙적으로 수정하지 않는다.
   서비스 고유 로직은 아래 "TOOL MODULE" 영역에만 작성한다.
   ============================================================ */
(function shell() {
  "use strict";
  var cfg = window.APP_CONFIG || {};

  // 연도
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // 테마 토글: auto → light → dark → auto
  var themeBtn = document.getElementById("theme-toggle");
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(cfg.slug + ":theme"); } catch (e) { /* private mode */ }
  if (saved) root.setAttribute("data-theme", saved);
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var order = ["auto", "light", "dark"];
      var cur = root.getAttribute("data-theme") || "auto";
      var next = order[(order.indexOf(cur) + 1) % order.length];
      root.setAttribute("data-theme", next);
      try { localStorage.setItem(cfg.slug + ":theme", next); } catch (e) { /* noop */ }
    });
  }

  // 공유
  var shareBtn = document.getElementById("share-btn");
  if (shareBtn) {
    shareBtn.addEventListener("click", function () {
      var data = { title: document.title, url: location.href };
      if (navigator.share) {
        navigator.share(data).catch(function () { /* 사용자가 취소 */ });
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(location.href).then(function () {
          shareBtn.textContent = "✓";
          setTimeout(function () { shareBtn.textContent = "↗"; }, 1200);
        });
      }
    });
  }

  // PWA 서비스워커
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () { /* 오프라인 미지원 환경 */ });
  }

  // AdSense — 게이트 통과 전에는 enabled=false 라 아무것도 하지 않는다
  if (cfg.adsense && cfg.adsense.enabled && cfg.adsense.client && cfg.adsense.slot) {
    var slotEl = document.getElementById("ad-slot");
    if (slotEl) {
      slotEl.hidden = false;
      var ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.display = "block";
      ins.setAttribute("data-ad-client", cfg.adsense.client);
      ins.setAttribute("data-ad-slot", cfg.adsense.slot);
      ins.setAttribute("data-ad-format", "auto");
      ins.setAttribute("data-full-width-responsive", "true");
      slotEl.appendChild(ins);
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    }
  }

  // GA4 — 설정 시에만 로드, 실패해도 본 기능에 영향 없게 격리 (safeTrack 원칙)
  if (cfg.analytics && cfg.analytics.ga4) {
    try {
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + cfg.analytics.ga4;
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", cfg.analytics.ga4);
    } catch (e) { /* 분석 실패는 조용히 무시 */ }
  }
})();

/* ============================================================
   TOOL MODULE — 빌더 에이전트가 이 영역을 서비스 로직으로 교체한다.
   규칙:
   - 상태는 localStorage(키 prefix: cfg.slug + ":") 또는 URL 파라미터에만 저장
   - 외부 API 호출 시 실패 UI(.result에 오류 문구) 필수
   - 빈 입력/공집합도 명시적으로 처리 (조용한 실패 금지)
   ============================================================ */
(function tool() {
  "use strict";
  // TOOLJS:START
  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "ad-copy-limit-check";
  var PREFS_KEY = SLUG + ":prefs";

  var MAX_BYTES = 20 * 1024 * 1024;      // 이 이상은 소재 표가 아니다 → 명시적 거부
  var BIG_BYTES = 5 * 1024 * 1024;       // 이 이상은 경고 후 진행
  var WORKER_CELLS = 20000;              // 이 이상만 Worker (그 아래는 메인스레드가 더 빠르다)
  var RENDER_ROWS = 200;                 // DOM 폭발 방지 — 나머지는 CSV 로 내보낸다
  var TXT_CLIP = 160;                    // 그리드 셀 표시 길이

  function t(key, vars) {
    var s = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    if (s == null) s = key;
    if (vars) {
      for (var k in vars) {
        if (vars.hasOwnProperty(k)) s = s.split("{" + k + "}").join(String(vars[k]));
      }
    }
    return s;
  }

  /* ============================================================
     [specs] 플랫폼 규격표 — 정책이 바뀌면 이 상수만 고친다 (연 1회 이하).
     max: 하드 상한 / min: 하한(미달도 반려) / hard: 소프트 권장치의 실제 상한
     soft: true 면 max 초과가 '반려'가 아니라 '잘림 예상'
     match: 헤더 자동 인식 패턴 (정규화 = 소문자 + 공백/언더바/하이픈 제거)
     ============================================================ */
  var RE_H = /^h(eadline)?\d*$/;
  var RE_D = /^d(esc(ription)?)?\d*$/;
  var F_HEADLINE_KO_JA = [/^(광고)?(제목|헤드라인)\d*$/, /^見出し\d*$/, /^广告标题\d*$/, /^标题\d*$/];
  var F_DESC_KO_JA = [/^설명(문구)?\d*$/, /^説明(文)?\d*$/, /^描述\d*$/];

  var PLATFORMS = [
    {
      id: "google-rsa", labelKey: "tool.pf.googleRsa", cjkDouble: true,
      rowRule: { headline: 3, description: 2 },
      fields: [
        { id: "headline", labelKey: "tool.f.headline", max: 30, match: [RE_H].concat(F_HEADLINE_KO_JA) },
        { id: "description", labelKey: "tool.f.description", max: 90, match: [RE_D].concat(F_DESC_KO_JA) },
        { id: "path", labelKey: "tool.f.path", max: 15, match: [/^path\d*$/, /^(표시)?경로\d*$/, /^パス\d*$/, /^路径\d*$/] },
        { id: "callout", labelKey: "tool.f.callout", max: 25, match: [/^callout(text)?\d*$/, /^콜아웃\d*$/, /^コールアウト\d*$/] },
        { id: "sitelink", labelKey: "tool.f.sitelink", max: 25, match: [/^sitelink(text|link)?\d*$/, /^사이트링크\d*$/, /^サイトリンク\d*$/] }
      ]
    },
    {
      id: "microsoft", labelKey: "tool.pf.microsoft", cjkDouble: true,
      fields: [
        { id: "headline", labelKey: "tool.f.headline", max: 30, match: [RE_H].concat(F_HEADLINE_KO_JA) },
        { id: "description", labelKey: "tool.f.description", max: 90, match: [RE_D].concat(F_DESC_KO_JA) },
        { id: "path", labelKey: "tool.f.path", max: 15, match: [/^path\d*$/, /^(표시)?경로\d*$/, /^パス\d*$/, /^路径\d*$/] }
      ]
    },
    {
      id: "google-pmax", labelKey: "tool.pf.googlePmax", cjkDouble: true,
      fields: [
        { id: "shortHeadline", labelKey: "tool.f.shortHeadline", max: 30, match: [/^shortheadline\d*$/, RE_H, /^(짧은|단문)제목\d*$/] },
        { id: "longHeadline", labelKey: "tool.f.longHeadline", max: 90, match: [/^longheadline\d*$/, /^(긴|장문)제목\d*$/] },
        { id: "description", labelKey: "tool.f.description", max: 90, match: [RE_D].concat(F_DESC_KO_JA) }
      ]
    },
    {
      id: "naver", labelKey: "tool.pf.naver", cjkDouble: false,
      fields: [
        { id: "title", labelKey: "tool.f.title", max: 15, match: [/^t(itle)?\d*$/, RE_H].concat(F_HEADLINE_KO_JA) },
        { id: "description", labelKey: "tool.f.description", min: 20, max: 45, match: [RE_D].concat(F_DESC_KO_JA) }
      ]
    },
    {
      id: "kakao", labelKey: "tool.pf.kakao", cjkDouble: false,
      fields: [
        { id: "title", labelKey: "tool.f.title", max: 15, match: [/^t(itle)?\d*$/, RE_H].concat(F_HEADLINE_KO_JA) },
        { id: "description", labelKey: "tool.f.description", max: 45, match: [RE_D].concat(F_DESC_KO_JA) }
      ]
    },
    {
      id: "meta", labelKey: "tool.pf.meta", cjkDouble: false, soft: true,
      fields: [
        { id: "primary", labelKey: "tool.f.primary", max: 125, hard: 500, soft: true,
          match: [/^primary(text)?\d*$/, /^(기본)?(본문|텍스트)\d*$/, /^メインテキスト\d*$/] },
        { id: "headline", labelKey: "tool.f.headline", max: 40, hard: 255, soft: true, match: [RE_H].concat(F_HEADLINE_KO_JA) },
        { id: "description", labelKey: "tool.f.description", max: 25, soft: true, match: [RE_D].concat(F_DESC_KO_JA) }
      ]
    }
  ];
  // 검사 대상이 아니라 요약을 묶는 열
  var GROUP_MATCH = [/^adgroup(name)?\d*$/, /^광고그룹(명|이름)?$/, /^広告グループ(名)?$/, /^广告组$/];

  function platformById(id) {
    for (var i = 0; i < PLATFORMS.length; i++) if (PLATFORMS[i].id === id) return PLATFORMS[i];
    return PLATFORMS[0];
  }
  function fieldById(pf, id) {
    for (var i = 0; i < pf.fields.length; i++) if (pf.fields[i].id === id) return pf.fields[i];
    return null;
  }

  /* ============================================================
     [count] 계수 엔진 — 이 도구의 핵심.
     Unicode East Asian Width 가 W(Wide) 또는 F(Fullwidth) 인 문자는 2자로 센다.
     구글/MS 의 "double-width language 는 1자당 2자" 규칙을 문자 단위로 구현한 것.
     표는 Unicode EastAsianWidth.txt 에서 추출한 자체 호스팅 배열 (CDN·외부 의존 0).
     ============================================================ */
  // EastAsianWidth 16.0.0 — W(Wide)/F(Fullwidth) 범위. 이 범위의 문자는 플랫폼이 2자로 센다.
  var EAW_WF = [
    0x1100,0x115F,0x231A,0x231B,0x2329,0x232A,0x23E9,0x23EC,0x23F0,0x23F0,0x23F3,0x23F3,
    0x25FD,0x25FE,0x2614,0x2615,0x2630,0x2637,0x2648,0x2653,0x267F,0x267F,0x268A,0x268F,
    0x2693,0x2693,0x26A1,0x26A1,0x26AA,0x26AB,0x26BD,0x26BE,0x26C4,0x26C5,0x26CE,0x26CE,
    0x26D4,0x26D4,0x26EA,0x26EA,0x26F2,0x26F3,0x26F5,0x26F5,0x26FA,0x26FA,0x26FD,0x26FD,
    0x2705,0x2705,0x270A,0x270B,0x2728,0x2728,0x274C,0x274C,0x274E,0x274E,0x2753,0x2755,
    0x2757,0x2757,0x2795,0x2797,0x27B0,0x27B0,0x27BF,0x27BF,0x2B1B,0x2B1C,0x2B50,0x2B50,
    0x2B55,0x2B55,0x2E80,0x2E99,0x2E9B,0x2EF3,0x2F00,0x2FD5,0x2FF0,0x303E,0x3041,0x3096,
    0x3099,0x30FF,0x3105,0x312F,0x3131,0x318E,0x3190,0x31E5,0x31EF,0x321E,0x3220,0x3247,
    0x3250,0xA48C,0xA490,0xA4C6,0xA960,0xA97C,0xAC00,0xD7A3,0xF900,0xFAFF,0xFE10,0xFE19,
    0xFE30,0xFE52,0xFE54,0xFE66,0xFE68,0xFE6B,0xFF01,0xFF60,0xFFE0,0xFFE6,0x16FE0,0x16FE4,
    0x16FF0,0x16FF1,0x17000,0x187F7,0x18800,0x18CD5,0x18CFF,0x18D08,0x1AFF0,0x1AFF3,0x1AFF5,0x1AFFB,
    0x1AFFD,0x1AFFE,0x1B000,0x1B122,0x1B132,0x1B132,0x1B150,0x1B152,0x1B155,0x1B155,0x1B164,0x1B167,
    0x1B170,0x1B2FB,0x1D300,0x1D356,0x1D360,0x1D376,0x1F004,0x1F004,0x1F0CF,0x1F0CF,0x1F18E,0x1F18E,
    0x1F191,0x1F19A,0x1F200,0x1F202,0x1F210,0x1F23B,0x1F240,0x1F248,0x1F250,0x1F251,0x1F260,0x1F265,
    0x1F300,0x1F320,0x1F32D,0x1F335,0x1F337,0x1F37C,0x1F37E,0x1F393,0x1F3A0,0x1F3CA,0x1F3CF,0x1F3D3,
    0x1F3E0,0x1F3F0,0x1F3F4,0x1F3F4,0x1F3F8,0x1F43E,0x1F440,0x1F440,0x1F442,0x1F4FC,0x1F4FF,0x1F53D,
    0x1F54B,0x1F54E,0x1F550,0x1F567,0x1F57A,0x1F57A,0x1F595,0x1F596,0x1F5A4,0x1F5A4,0x1F5FB,0x1F64F,
    0x1F680,0x1F6C5,0x1F6CC,0x1F6CC,0x1F6D0,0x1F6D2,0x1F6D5,0x1F6D7,0x1F6DC,0x1F6DF,0x1F6EB,0x1F6EC,
    0x1F6F4,0x1F6FC,0x1F7E0,0x1F7EB,0x1F7F0,0x1F7F0,0x1F90C,0x1F93A,0x1F93C,0x1F945,0x1F947,0x1F9FF,
    0x1FA70,0x1FA7C,0x1FA80,0x1FA89,0x1FA8F,0x1FAC6,0x1FACE,0x1FADC,0x1FADF,0x1FAE9,0x1FAF0,0x1FAF8,
    0x20000,0x2FFFD,0x30000,0x3FFFD
  ];
  // Ambiguous(A) 범위 — 1자로 세되, 한도 근처에서만 "플랫폼에 따라 2자일 수 있음" 힌트에 쓴다.
  var EAW_A = [
    0xA1,0xA1,0xA4,0xA4,0xA7,0xA8,0xAA,0xAA,0xAD,0xAE,0xB0,0xB4,0xB6,0xBA,0xBC,0xBF,0xC6,0xC6,
    0xD0,0xD0,0xD7,0xD8,0xDE,0xE1,0xE6,0xE6,0xE8,0xEA,0xEC,0xED,0xF0,0xF0,0xF2,0xF3,0xF7,0xFA,
    0xFC,0xFC,0xFE,0xFE,0x101,0x101,0x111,0x111,0x113,0x113,0x11B,0x11B,0x126,0x127,0x12B,0x12B,
    0x131,0x133,0x138,0x138,0x13F,0x142,0x144,0x144,0x148,0x14B,0x14D,0x14D,0x152,0x153,0x166,0x167,
    0x16B,0x16B,0x1CE,0x1CE,0x1D0,0x1D0,0x1D2,0x1D2,0x1D4,0x1D4,0x1D6,0x1D6,0x1D8,0x1D8,0x1DA,0x1DA,
    0x1DC,0x1DC,0x251,0x251,0x261,0x261,0x2C4,0x2C4,0x2C7,0x2C7,0x2C9,0x2CB,0x2CD,0x2CD,0x2D0,0x2D0,
    0x2D8,0x2DB,0x2DD,0x2DD,0x2DF,0x2DF,0x300,0x36F,0x391,0x3A1,0x3A3,0x3A9,0x3B1,0x3C1,0x3C3,0x3C9,
    0x401,0x401,0x410,0x44F,0x451,0x451,0x2010,0x2010,0x2013,0x2016,0x2018,0x2019,0x201C,0x201D,
    0x2020,0x2022,0x2024,0x2027,0x2030,0x2030,0x2032,0x2033,0x2035,0x2035,0x203B,0x203B,
    0x203E,0x203E,0x2074,0x2074,0x207F,0x207F,0x2081,0x2084,0x20AC,0x20AC,0x2103,0x2103,
    0x2105,0x2105,0x2109,0x2109,0x2113,0x2113,0x2116,0x2116,0x2121,0x2122,0x2126,0x2126,
    0x212B,0x212B,0x2153,0x2154,0x215B,0x215E,0x2160,0x216B,0x2170,0x2179,0x2189,0x2189,
    0x2190,0x2199,0x21B8,0x21B9,0x21D2,0x21D2,0x21D4,0x21D4,0x21E7,0x21E7,0x2200,0x2200,
    0x2202,0x2203,0x2207,0x2208,0x220B,0x220B,0x220F,0x220F,0x2211,0x2211,0x2215,0x2215,
    0x221A,0x221A,0x221D,0x2220,0x2223,0x2223,0x2225,0x2225,0x2227,0x222C,0x222E,0x222E,
    0x2234,0x2237,0x223C,0x223D,0x2248,0x2248,0x224C,0x224C,0x2252,0x2252,0x2260,0x2261,
    0x2264,0x2267,0x226A,0x226B,0x226E,0x226F,0x2282,0x2283,0x2286,0x2287,0x2295,0x2295,
    0x2299,0x2299,0x22A5,0x22A5,0x22BF,0x22BF,0x2312,0x2312,0x2460,0x24E9,0x24EB,0x254B,
    0x2550,0x2573,0x2580,0x258F,0x2592,0x2595,0x25A0,0x25A1,0x25A3,0x25A9,0x25B2,0x25B3,
    0x25B6,0x25B7,0x25BC,0x25BD,0x25C0,0x25C1,0x25C6,0x25C8,0x25CB,0x25CB,0x25CE,0x25D1,
    0x25E2,0x25E5,0x25EF,0x25EF,0x2605,0x2606,0x2609,0x2609,0x260E,0x260F,0x261C,0x261C,
    0x261E,0x261E,0x2640,0x2640,0x2642,0x2642,0x2660,0x2661,0x2663,0x2665,0x2667,0x266A,
    0x266C,0x266D,0x266F,0x266F,0x269E,0x269F,0x26BF,0x26BF,0x26C6,0x26CD,0x26CF,0x26D3,
    0x26D5,0x26E1,0x26E3,0x26E3,0x26E8,0x26E9,0x26EB,0x26F1,0x26F4,0x26F4,0x26F6,0x26F9,
    0x26FB,0x26FC,0x26FE,0x26FF,0x273D,0x273D,0x2776,0x277F,0x2B56,0x2B59,0x3248,0x324F,
    0xE000,0xF8FF,0xFE00,0xFE0F,0xFFFD,0xFFFD,0x1F100,0x1F10A,0x1F110,0x1F12D,0x1F130,0x1F169,
    0x1F170,0x1F18D,0x1F18F,0x1F190,0x1F19B,0x1F1AC,0xE0100,0xE01EF,0xF0000,0xFFFFD,
    0x100000,0x10FFFD
  ];
  var _seg = null;

  function inRange(tbl, cp) {
    var lo = 0, hi = (tbl.length >> 1) - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1, i = mid << 1;
      if (cp < tbl[i]) hi = mid - 1;
      else if (cp > tbl[i + 1]) lo = mid + 1;
      else return true;
    }
    return false;
  }

  function graphemesOf(text) {
    if (_seg === null) {
      try {
        _seg = (typeof Intl !== "undefined" && Intl.Segmenter)
          ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : false;
      } catch (e) { _seg = false; }
    }
    if (_seg) {
      var arr = Array.from(_seg.segment(text)), out = [], i;
      for (i = 0; i < arr.length; i++) out.push(arr[i].segment);
      return out;
    }
    return Array.from(text); // 폴백: 코드포인트 단위 (Intl.Segmenter 미지원 구형 브라우저)
  }

  function countChars(text, doubleWidth) {
    var gs = graphemesOf(text);
    if (doubleWidth === false) return gs.length;
    var n = 0;
    for (var i = 0; i < gs.length; i++) n += inRange(EAW_WF, gs[i].codePointAt(0)) ? 2 : 1;
    return n;
  }

  // {KeyWord:기본값} 은 기본값 문자열 기준으로 센다. 기본값이 없으면 추측하지 않고 그대로 세고 표시한다.
  function resolvePlaceholders(text) {
    var withDefault = false, without = false;
    var out = text.replace(/\{([^{}]+)\}/g, function (m, inner) {
      var i = inner.lastIndexOf(":");
      if (i >= 0 && i < inner.length - 1) { withDefault = true; return inner.slice(i + 1); }
      without = true;
      return m;
    });
    return { text: out, ph: without ? "nodefault" : (withDefault ? "default" : "none") };
  }

  function measure(text, doubleWidth) {
    var r = resolvePlaceholders(text);
    var gs = graphemesOf(r.text);
    var n = 0, amb = 0, wide = 0, i, cp, g;
    for (i = 0; i < gs.length; i++) {
      g = gs[i];
      cp = g.codePointAt(0);
      if (inRange(EAW_WF, cp)) {
        wide++;
        n += (doubleWidth === false) ? 1 : 2;
      } else {
        n += 1;
        // Ambiguous 는 1자로 센다. 다만 "2자일 수도 있음" 힌트 대상은 라틴/그리스/키릴을 뺀 것만 —
        // é 나 α 까지 경고하면 서구권 문구에 거짓 경고가 된다.
        if (inRange(EAW_A, cp) && !/\p{Script=Latin}|\p{Script=Greek}|\p{Script=Cyrillic}/u.test(g)) amb++;
      }
    }
    return {
      count: n,
      wide: wide,
      amb: amb,
      emoji: /\p{Extended_Pictographic}/u.test(r.text),
      ph: r.ph,
      spaces: (r.text.match(/\s/g) || []).length,
      empty: text === "",
      blank: text !== "" && text.trim() === ""
    };
  }

  /* ---------- 판정 (셀 단위) ---------- */
  function judge(m, field) {
    if (m.empty) return "empty";
    if (field.hard && m.count > field.hard) return "over";        // 소프트 권장치라도 하드 상한은 진짜 반려
    if (m.count > field.max) return field.soft ? "truncate" : "over";
    if (field.min && m.count < field.min) return "under";
    if (m.count >= field.max * 0.9) return "near";
    return "ok";
  }
  function isIssue(st) { return st === "over" || st === "under" || st === "truncate"; }

  /* ============================================================
     [parse] CSV/TSV — RFC4180 자체 구현 (외부 라이브러리 0).
     따옴표 안의 구분자·줄바꿈 허용, "" → " 이스케이프.
     광고 문구에는 콤마가 흔해 따옴표 처리가 필수다.
     ============================================================ */
  function detectDelimiter(text) {
    var lines = text.split(/\r\n|\r|\n/, 5), tabs = 0, commas = 0;
    for (var i = 0; i < lines.length; i++) {
      tabs += (lines[i].match(/\t/g) || []).length;
      commas += (lines[i].match(/,/g) || []).length;
    }
    return tabs > commas ? "\t" : ",";
  }

  function parseTable(text, delim) {
    var rows = [], row = [], field = "", i = 0, inQ = false, n = text.length, c;
    while (i < n) {
      c = text.charAt(i);
      if (inQ) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      // 따옴표는 필드 첫 글자일 때만 인용 시작 — 12" 피자 같은 문구를 깨뜨리지 않는다
      if (c === '"' && field === "") { inQ = true; i++; continue; }
      if (c === delim) { row.push(field); field = ""; i++; continue; }
      if (c === "\n" || c === "\r") {
        if (c === "\r" && text.charAt(i + 1) === "\n") i++;
        row.push(field); rows.push(row); row = []; field = ""; i++; continue;
      }
      field += c; i++;
    }
    row.push(field); rows.push(row);
    var out = [];
    for (i = 0; i < rows.length; i++) {
      if (rows[i].length === 1 && rows[i][0] === "") continue;  // 빈 줄은 데이터가 아니다
      var allEmpty = true;
      for (var j = 0; j < rows[i].length; j++) if (rows[i][j].trim() !== "") { allEmpty = false; break; }
      if (!allEmpty) out.push(rows[i]);
    }
    return out;
  }

  function normHeader(s) {
    return String(s == null ? "" : s).replace(/^\uFEFF/, "").toLowerCase().replace(/[\s_\-]/g, "").trim();
  }
  function matchAny(list, s) {
    for (var i = 0; i < list.length; i++) if (list[i].test(s)) return true;
    return false;
  }
  function roleOf(pf, header) {
    var h = normHeader(header);
    if (!h) return null;
    if (matchAny(GROUP_MATCH, h)) return "__group";
    for (var i = 0; i < pf.fields.length; i++) if (matchAny(pf.fields[i].match, h)) return pf.fields[i].id;
    return null;
  }

  /* ---------- Worker (20,000 셀 초과 시에만) ---------- */
  function buildWorkerUrl() {
    var src = [
      "var EAW_WF=" + JSON.stringify(EAW_WF) + ";",
      "var EAW_A=" + JSON.stringify(EAW_A) + ";",
      "var _seg=null;",
      inRange.toString(),
      graphemesOf.toString(),
      resolvePlaceholders.toString(),
      measure.toString(),
      "onmessage=function(e){var d=e.data,x=d.texts,dw=d.doubleWidth,out=[],",
      "step=Math.max(1,Math.ceil(x.length/40)),i;",
      "for(i=0;i<x.length;i++){out.push(measure(x[i],dw));",
      "if(i%step===0)postMessage({type:'progress',done:i,total:x.length});}",
      "postMessage({type:'done',measures:out});};"
    ].join("\n");
    return URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  }

  function measureAllSync(texts, dw) {
    var out = [];
    for (var i = 0; i < texts.length; i++) out.push(measure(texts[i], dw));
    return out;
  }

  // done(measures, note) — note 는 폴백 사유(있으면 UI 에 표기, 조용히 넘기지 않는다)
  function measureAll(texts, dw, onProgress, done) {
    var canWorker = texts.length > WORKER_CELLS && typeof Worker !== "undefined" &&
                    typeof URL !== "undefined" && URL.createObjectURL && typeof Blob !== "undefined";
    if (!canWorker) { done(measureAllSync(texts, dw), null); return; }
    var url = null, w = null, settled = false, timer = null;
    function finish(res, note) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { if (w) w.terminate(); } catch (e) { /* noop */ }
      try { if (url) URL.revokeObjectURL(url); } catch (e) { /* noop */ }
      done(res, note);
    }
    function fallback(reason) { finish(measureAllSync(texts, dw), reason); }
    try {
      url = buildWorkerUrl();
      w = new Worker(url);
    } catch (e) { fallback(t("tool.msg.workerFallback")); return; }
    timer = setTimeout(function () { fallback(t("tool.msg.workerTimeout")); }, 60000);
    w.onerror = function () { fallback(t("tool.msg.workerFallback")); };
    w.onmessage = function (e) {
      var d = e.data || {};
      if (d.type === "progress") { if (onProgress) onProgress(d.done, d.total); return; }
      if (d.type === "done") finish(d.measures, null);
    };
    try { w.postMessage({ texts: texts, doubleWidth: dw }); }
    catch (e) { fallback(t("tool.msg.workerFallback")); }
  }

  /* ============================================================
     [ui] 상태 — 광고 문구는 어디에도 저장하지 않는다.
     localStorage 에는 플랫폼 프리셋과 (헤더가 있을 때만) 열 매핑 취향만 남는다.
     ============================================================ */
  var $ = function (id) { return document.getElementById(id); };
  var elPlatform = $("acl-platform"), elFieldType = $("acl-fieldtype"), elText = $("acl-text"),
      elSingleRes = $("acl-single-result"), elPaste = $("acl-paste"), elDrop = $("acl-drop"),
      elBrowse = $("acl-browse"), elFile = $("acl-file"), elCheck = $("acl-check"), elSample = $("acl-sample"),
      elProg = $("acl-prog"), elProgBar = $("acl-prog-bar"), elProgT = $("acl-prog-t"),
      elBatchRes = $("acl-batch-result"), elGridWrap = $("acl-grid-wrap"), elGrid = $("acl-grid"),
      elOnly = $("acl-only"), elCopy = $("acl-copy"), elCsv = $("acl-csv"), elCap = $("acl-cap"),
      elTabS = $("acl-tab-single"), elTabB = $("acl-tab-batch"),
      elPaneS = $("acl-pane-single"), elPaneB = $("acl-pane-batch");
  if (!elPlatform) return;

  var prefs = { platform: "google-rsa", cols: {} };
  try {
    var raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      var p = JSON.parse(raw);
      if (p && typeof p === "object") {
        if (p.platform && platformById(p.platform).id === p.platform) prefs.platform = p.platform;
        if (p.cols && typeof p.cols === "object") prefs.cols = p.cols;
      }
    }
  } catch (e) { /* private mode / 손상된 값 → 기본값 */ }
  try {
    var qp = new URLSearchParams(location.search).get("platform");
    if (qp && platformById(qp).id === qp) prefs.platform = qp;
  } catch (e) { /* 구형 브라우저 */ }

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* noop */ }
  }

  var sheet = null;   // { header:[], rows:[[]], mapping:[], headerDetected:bool, excluded:[], note:"" }
  var view = null;    // { cells:[[{...}]], summary:{}, groups:[] }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;";
    });
  }
  function currentPf() { return platformById(prefs.platform); }

  /* ---------- 셀렉트 채우기 ---------- */
  function fillPlatformSelect() {
    elPlatform.innerHTML = "";
    for (var i = 0; i < PLATFORMS.length; i++) {
      var o = document.createElement("option");
      o.value = PLATFORMS[i].id;
      o.textContent = t(PLATFORMS[i].labelKey);
      elPlatform.appendChild(o);
    }
    elPlatform.value = prefs.platform;
  }
  function fillFieldSelect() {
    var pf = currentPf(), keep = elFieldType.value;
    elFieldType.innerHTML = "";
    for (var i = 0; i < pf.fields.length; i++) {
      var f = pf.fields[i], o = document.createElement("option");
      o.value = f.id;
      o.textContent = t(f.labelKey) + " — " + limitLabel(f);
      elFieldType.appendChild(o);
    }
    elFieldType.value = fieldById(pf, keep) ? keep : pf.fields[0].id;
  }
  function limitLabel(f) {
    if (f.min) return t("tool.limit.range", { min: f.min, max: f.max });
    if (f.soft) return f.hard ? t("tool.limit.soft", { max: f.max, hard: f.hard }) : t("tool.limit.rec", { max: f.max });
    return t("tool.limit.max", { max: f.max });
  }

  /* ---------- 모드 (a) 단건 — oninput 즉답 ---------- */
  function renderSingle() {
    var pf = currentPf(), f = fieldById(pf, elFieldType.value) || pf.fields[0];
    var text = elText.value;
    if (text === "") {
      elSingleRes.innerHTML = '<p class="acl-sub" style="margin:0">' + esc(t("tool.msg.emptySingle")) + "</p>";
      return;
    }
    var m = measure(text, pf.cjkDouble), st = judge(m, f);
    var pct = Math.min(100, Math.round((m.count / f.max) * 100));
    var barColor = st === "over" ? "var(--acl-over)" : st === "under" ? "var(--acl-under)"
      : (st === "near" || st === "truncate") ? "var(--acl-near)" : "var(--acl-ok)";
    var h = '<div class="acl-big">' + m.count + " <small>/ " + f.max + "</small></div>" +
      '<div class="acl-state is-' + st + '">' + esc(stateLabel(st, f)) + "</div>" +
      '<div class="acl-meter"><i style="width:' + pct + "%;background:" + barColor + '"></i></div>' +
      '<p class="acl-sub">' + esc(t("tool.single.detail", {
        field: t(f.labelKey), limit: limitLabel(f), spaces: m.spaces
      })) + "</p>";
    var hints = cellHints(m, f, pf, st);
    if (hints.length) {
      h += '<ul class="acl-hints">';
      for (var i = 0; i < hints.length; i++) h += "<li>" + esc(hints[i]) + "</li>";
      h += "</ul>";
    }
    elSingleRes.innerHTML = h;
  }

  function stateLabel(st, f) {
    if (st === "over") return t("tool.st.over");
    if (st === "under") return t("tool.st.under", { min: f.min });
    if (st === "truncate") return t("tool.st.truncate");
    if (st === "near") return t("tool.st.near");
    if (st === "empty") return t("tool.st.empty");
    return t("tool.st.ok");
  }

  function cellHints(m, f, pf, st) {
    var out = [];
    if (pf.cjkDouble && m.wide > 0) out.push(t("tool.hint.wide", { n: m.wide, sub: m.wide * 2 }));
    if (m.blank) out.push(t("tool.hint.blank", { n: m.spaces }));
    if (m.ph === "default") out.push(t("tool.hint.phDefault"));
    if (m.ph === "nodefault") out.push(t("tool.hint.phNoDefault"));
    if (m.emoji && (pf.id === "google-rsa" || pf.id === "google-pmax")) out.push(t("tool.hint.emojiGoogle"));
    else if (m.emoji) out.push(t("tool.hint.emoji"));
    if (m.amb > 0 && m.count >= f.max * 0.9) out.push(t("tool.hint.amb", { n: m.amb }));
    if (st === "truncate" && f.hard) out.push(t("tool.hint.softHard", { max: f.max, hard: f.hard }));
    return out;
  }

  /* ---------- 모드 (b) 일괄 ---------- */
  function note(kind, msg) {
    return '<li class="acl-note is-' + kind + '"><b>' + esc(msg) + "</b></li>";
  }

  function showBatchMessage(html) {
    elBatchRes.innerHTML = html;
    elGridWrap.hidden = true;
  }

  function loadText(text, notes) {
    notes = notes || [];
    text = text.replace(/^\uFEFF/, "");
    if (text.trim() === "") { sheet = null; showBatchMessage('<p class="acl-sub" style="margin:0">' + esc(t("tool.msg.emptyBatch")) + "</p>"); return; }
    var delim = detectDelimiter(text);
    var rows = parseTable(text, delim);
    if (!rows.length) { sheet = null; showBatchMessage('<p class="acl-sub" style="margin:0">' + esc(t("tool.msg.emptyBatch")) + "</p>"); return; }

    var pf = currentPf();
    // 헤더 판정: 1행에서 2개 이상 매치 (열이 하나뿐이면 1개 매치도 헤더로 인정)
    var first = rows[0], hits = 0, i;
    for (i = 0; i < first.length; i++) if (roleOf(pf, first[i])) hits++;
    var headerDetected = hits >= 2 || (first.length === 1 && hits === 1);

    var mode = colModeOf(rows);
    var header, body;
    if (headerDetected) { header = first; body = rows.slice(1); }
    else { header = []; body = rows; for (i = 0; i < mode; i++) header.push(t("tool.col", { n: i + 1 })); }

    var expected = headerDetected ? header.length : mode;
    var excluded = [], keep = [];
    for (i = 0; i < body.length; i++) {
      if (body[i].length !== expected) {
        excluded.push({ n: i + (headerDetected ? 2 : 1), got: body[i].length, want: expected });
      } else keep.push(body[i]);
    }

    sheet = {
      header: header, rows: keep, headerDetected: headerDetected, excluded: excluded,
      delim: delim, notes: notes, mapping: []
    };
    // 열 유형 초기값 = 헤더 추론 + 저장된 취향. 최종 진실은 드롭다운.
    for (i = 0; i < expected; i++) {
      var role = headerDetected ? roleOf(pf, header[i]) : null;
      var saved = headerDetected ? prefs.cols[normHeader(header[i])] : null;
      if (saved === "__none") role = null;
      else if (saved && (saved === "__group" || fieldById(pf, saved))) role = saved;
      sheet.mapping.push(role || null);
    }
    runCheck();
  }

  function colModeOf(rows) {
    var counts = {}, best = 0, bestN = 0;
    for (var i = 0; i < rows.length; i++) {
      var L = rows[i].length;
      counts[L] = (counts[L] || 0) + 1;
      if (counts[L] > bestN) { bestN = counts[L]; best = L; }
    }
    return best;
  }

  function runCheck() {
    if (!sheet) return;
    var pf = currentPf();
    var texts = [], idx = [], r, c;
    for (r = 0; r < sheet.rows.length; r++) {
      for (c = 0; c < sheet.mapping.length; c++) {
        var role = sheet.mapping[c];
        if (!role || role === "__group") continue;
        texts.push(sheet.rows[r][c] == null ? "" : sheet.rows[r][c]);
        idx.push([r, c]);
      }
    }
    if (!texts.length) {
      view = null;
      renderSummary(null, null);
      renderGrid();
      elGridWrap.hidden = false;
      return;
    }
    setProgress(0, texts.length, texts.length > WORKER_CELLS);
    measureAll(texts, pf.cjkDouble, function (done, total) {
      setProgress(done, total, true);
    }, function (measures, fallbackNote) {
      hideProgress();
      buildView(measures, idx, fallbackNote);
      renderSummary(view, fallbackNote);
      renderGrid();
      elGridWrap.hidden = false;
    });
  }

  function setProgress(done, total, show) {
    if (!show) { elProg.hidden = true; return; }
    elProg.hidden = false;
    var pct = total ? Math.round((done / total) * 100) : 0;
    elProgBar.style.width = pct + "%";
    elProgT.textContent = t("tool.progress", { pct: pct, total: total });
  }
  function hideProgress() { elProg.hidden = true; elProgBar.style.width = "0%"; }

  function buildView(measures, idx, fallbackNote) {
    var pf = currentPf();
    var cells = [], r, c;
    for (r = 0; r < sheet.rows.length; r++) { cells.push([]); for (c = 0; c < sheet.mapping.length; c++) cells[r].push(null); }
    var sum = { checked: 0, over: 0, under: 0, truncate: 0, near: 0, ok: 0, empty: 0 };
    for (var i = 0; i < idx.length; i++) {
      r = idx[i][0]; c = idx[i][1];
      var f = fieldById(pf, sheet.mapping[c]);
      if (!f) continue;
      var m = measures[i], st = judge(m, f);
      cells[r][c] = { m: m, f: f, st: st };
      if (st === "empty") sum.empty++; else { sum.checked++; sum[st]++; }
    }
    // 행 단위 규칙 (Google RSA 최소 헤드라인 3 / 설명 2)
    var groupCol = sheet.mapping.indexOf("__group");
    var groups = {}, order = [];
    for (r = 0; r < sheet.rows.length; r++) {
      var rowInfo = { over: 0, under: 0, truncate: 0, empty: 0, filled: {} };
      for (c = 0; c < sheet.mapping.length; c++) {
        var cell = cells[r][c];
        if (!cell) continue;
        if (cell.st === "empty") rowInfo.empty++;
        else {
          if (isIssue(cell.st)) rowInfo[cell.st]++;
          rowInfo.filled[cell.f.id] = (rowInfo.filled[cell.f.id] || 0) + 1;
        }
      }
      rowInfo.short = [];
      if (pf.rowRule) {
        for (var fid in pf.rowRule) {
          if (!pf.rowRule.hasOwnProperty(fid)) continue;
          if (sheet.mapping.indexOf(fid) === -1) continue; // 그 열 자체가 없으면 판정하지 않는다
          var have = rowInfo.filled[fid] || 0;
          if (have < pf.rowRule[fid]) rowInfo.short.push({ id: fid, have: have, need: pf.rowRule[fid] });
        }
      }
      cells[r].info = rowInfo;
      if (groupCol >= 0) {
        var g = (sheet.rows[r][groupCol] || "").trim() || t("tool.group.none");
        if (!groups[g]) { groups[g] = { name: g, rows: 0, over: 0, under: 0, truncate: 0 }; order.push(g); }
        groups[g].rows++;
        groups[g].over += rowInfo.over; groups[g].under += rowInfo.under; groups[g].truncate += rowInfo.truncate;
      }
    }
    var glist = [];
    for (var k = 0; k < order.length; k++) glist.push(groups[order[k]]);
    var unmapped = 0;
    for (c = 0; c < sheet.mapping.length; c++) if (!sheet.mapping[c]) unmapped++;
    view = { cells: cells, sum: sum, groups: glist, unmapped: unmapped, fallbackNote: fallbackNote };
  }

  function renderSummary(v, fallbackNote) {
    var h = "", notes = [];
    if (!v) {
      h += '<p class="acl-sub" style="margin:0">' + esc(t("tool.msg.nothingMapped")) + "</p>";
    } else {
      var s = v.sum;
      h += '<dl class="acl-sum">' +
        card(t("tool.sum.checked"), s.checked, "") +
        card(t("tool.sum.over"), s.over, s.over ? "is-over" : "") +
        (currentPf().soft ? card(t("tool.sum.truncate"), s.truncate, s.truncate ? "is-near" : "") : "") +
        (hasMin() ? card(t("tool.sum.under"), s.under, s.under ? "is-under" : "") : "") +
        card(t("tool.sum.near"), s.near, s.near ? "is-near" : "") +
        card(t("tool.sum.empty"), s.empty, "") +
        "</dl>";
      if (s.checked === 0) notes.push(t("tool.msg.nothingMapped"));
      if (v.unmapped > 0) notes.push(t("tool.msg.unmapped", { n: v.unmapped }));
      if (v.groups.length > 1) h += groupTable(v.groups);
    }
    if (sheet) {
      for (var s2 = 0; s2 < sheet.notes.length; s2++) notes.push(sheet.notes[s2]);
      if (!sheet.headerDetected) notes.push(t("tool.msg.noHeader"));
      if (sheet.excluded.length) {
        var det = [], lim = Math.min(sheet.excluded.length, 5);
        for (var i = 0; i < lim; i++) {
          det.push(t("tool.msg.excludedRow", {
            n: sheet.excluded[i].n, got: sheet.excluded[i].got, want: sheet.excluded[i].want
          }));
        }
        if (sheet.excluded.length > lim) det.push(t("tool.msg.andMore", { n: sheet.excluded.length - lim }));
        notes.push(t("tool.msg.excluded", { n: sheet.excluded.length }) + " — " + det.join("; "));
      }
    }
    if (fallbackNote) notes.push(fallbackNote);
    if (notes.length) {
      h += '<ul class="acl-notes">';
      for (var j = 0; j < notes.length; j++) h += "<li><b>!</b> " + esc(notes[j]) + "</li>";
      h += "</ul>";
    }
    elBatchRes.innerHTML = h;
  }
  function hasMin() {
    var fs = currentPf().fields;
    for (var i = 0; i < fs.length; i++) if (fs[i].min) return true;
    return false;
  }
  function card(label, n, cls) {
    return "<div><dt>" + esc(label) + '</dt><dd class="' + cls + '">' + n + "</dd></div>";
  }
  function groupTable(gs) {
    var h = '<div class="acl-groups"><table><thead><tr><th>' + esc(t("tool.group.name")) + "</th><th>" +
      esc(t("tool.group.rows")) + "</th><th>" + esc(t("tool.sum.over")) + "</th></tr></thead><tbody>";
    for (var i = 0; i < gs.length; i++) {
      var bad = gs[i].over + gs[i].under + gs[i].truncate;
      h += "<tr><td>" + esc(gs[i].name) + "</td><td>" + gs[i].rows + '</td><td class="' +
        (bad ? "is-over" : "") + '" style="' + (bad ? "color:var(--acl-over)" : "color:var(--muted)") + '">' + bad + "</td></tr>";
    }
    return h + "</tbody></table></div>";
  }

  function renderGrid() {
    if (!sheet) { elGrid.innerHTML = ""; return; }
    var pf = currentPf(), onlyIssues = elOnly.checked;
    var h = "<thead><tr><th></th>";
    for (var c = 0; c < sheet.mapping.length; c++) {
      h += '<th><div class="acl-hname" title="' + esc(sheet.header[c] || "") + '">' + esc(sheet.header[c] || "") + "</div>" +
        '<select class="acl-map' + (sheet.mapping[c] ? "" : " is-none") + '" data-col="' + c + '">' +
        '<option value="__none"' + (!sheet.mapping[c] ? " selected" : "") + ">" + esc(t("tool.map.none")) + "</option>" +
        '<option value="__group"' + (sheet.mapping[c] === "__group" ? " selected" : "") + ">" + esc(t("tool.map.group")) + "</option>";
      for (var i = 0; i < pf.fields.length; i++) {
        var f = pf.fields[i];
        h += '<option value="' + f.id + '"' + (sheet.mapping[c] === f.id ? " selected" : "") + ">" +
          esc(t(f.labelKey) + " (" + limitLabel(f) + ")") + "</option>";
      }
      h += "</select></th>";
    }
    h += "</tr></thead><tbody>";

    var shown = 0, hidden = 0;
    for (var r = 0; r < sheet.rows.length; r++) {
      var info = view && view.cells[r] ? view.cells[r].info : null;
      var bad = info ? (info.over + info.under + info.truncate + info.short.length) : 0;
      if (onlyIssues && !bad) { hidden++; continue; }
      if (shown >= RENDER_ROWS) { hidden++; continue; }
      shown++;
      h += '<tr><td class="acl-rn">' + (r + (sheet.headerDetected ? 2 : 1)) + rowBadges(info) + "</td>";
      for (c = 0; c < sheet.mapping.length; c++) {
        var raw = sheet.rows[r][c] == null ? "" : sheet.rows[r][c];
        var cell = view && view.cells[r] ? view.cells[r][c] : null;
        if (!cell) {
          h += '<td class="acl-cell is-skip"><div class="acl-txt">' + esc(clip(raw)) + "</div></td>";
          continue;
        }
        h += '<td class="acl-cell is-' + cell.st + '"><div class="acl-txt">' + esc(clip(raw)) + "</div>" +
          '<span class="acl-n">' + (cell.st === "empty" ? esc(t("tool.st.empty")) : cell.m.count + " / " + cell.f.max) + "</span>" +
          cellFlags(cell, pf) + "</td>";
      }
      h += "</tr>";
    }
    h += "</tbody>";
    elGrid.innerHTML = h;

    if (hidden > 0) {
      elCap.hidden = false;
      elCap.textContent = onlyIssues
        ? t("tool.cap.filtered", { shown: shown, total: sheet.rows.length })
        : t("tool.cap.capped", { shown: shown, total: sheet.rows.length });
    } else elCap.hidden = true;

    var sels = elGrid.querySelectorAll(".acl-map");
    for (var s = 0; s < sels.length; s++) sels[s].addEventListener("change", onMapChange);
  }

  function clip(s) { return s.length > TXT_CLIP ? s.slice(0, TXT_CLIP) + "…" : s; }

  function rowBadges(info) {
    if (!info) return "";
    var h = '<span class="acl-badges">';
    if (info.over) h += '<span class="acl-badge is-over">' + esc(t("tool.badge.over", { n: info.over })) + "</span>";
    if (info.truncate) h += '<span class="acl-badge is-near">' + esc(t("tool.badge.truncate", { n: info.truncate })) + "</span>";
    if (info.under) h += '<span class="acl-badge is-under">' + esc(t("tool.badge.under", { n: info.under })) + "</span>";
    if (info.empty) h += '<span class="acl-badge">' + esc(t("tool.badge.empty", { n: info.empty })) + "</span>";
    for (var i = 0; i < info.short.length; i++) {
      h += '<span class="acl-badge is-under">' + esc(t("tool.badge.short", {
        field: t(fieldLabelKey(info.short[i].id)), have: info.short[i].have, need: info.short[i].need
      })) + "</span>";
    }
    return h + "</span>";
  }
  function fieldLabelKey(id) {
    var f = fieldById(currentPf(), id);
    return f ? f.labelKey : id;
  }

  function cellFlags(cell, pf) {
    var out = [];
    if (cell.st === "under") out.push(t("tool.st.under", { min: cell.f.min }));
    if (cell.st === "truncate") out.push(t("tool.st.truncate"));
    if (cell.m.ph === "default") out.push(t("tool.hint.phDefault"));
    if (cell.m.ph === "nodefault") out.push(t("tool.hint.phNoDefault"));
    if (cell.m.emoji && (pf.id === "google-rsa" || pf.id === "google-pmax")) out.push(t("tool.hint.emojiGoogle"));
    if (cell.m.blank) out.push(t("tool.hint.blank", { n: cell.m.spaces }));
    if (cell.m.amb > 0 && cell.m.count >= cell.f.max * 0.9) out.push(t("tool.hint.amb", { n: cell.m.amb }));
    return out.length ? '<span class="acl-flag">' + esc(out.join(" · ")) + "</span>" : "";
  }

  function onMapChange(e) {
    var c = parseInt(e.target.getAttribute("data-col"), 10);
    var v = e.target.value;
    sheet.mapping[c] = v === "__none" ? null : v;
    if (sheet.headerDetected) {
      prefs.cols[normHeader(sheet.header[c])] = v;   // 열 유형 취향만 저장 — 문구는 저장하지 않는다
      savePrefs();
    }
    runCheck();
  }

  /* ---------- 내보내기 ---------- */
  function exportRows() {
    var out = [], pf = currentPf();
    var head = [t("tool.ex.row")];
    var groupCol = sheet.mapping.indexOf("__group");
    if (groupCol >= 0) head.push(t("tool.ex.group"));
    head = head.concat([t("tool.ex.col"), t("tool.ex.field"), t("tool.ex.len"),
                        t("tool.ex.limit"), t("tool.ex.status"), t("tool.ex.text")]);
    out.push(head);
    for (var r = 0; r < sheet.rows.length; r++) {
      for (var c = 0; c < sheet.mapping.length; c++) {
        var cell = view && view.cells[r] ? view.cells[r][c] : null;
        if (!cell) continue;
        if (elOnly.checked && !isIssue(cell.st)) continue;
        var line = [String(r + (sheet.headerDetected ? 2 : 1))];
        if (groupCol >= 0) line.push(sheet.rows[r][groupCol] || "");
        line = line.concat([
          sheet.header[c] || "", t(cell.f.labelKey),
          cell.st === "empty" ? "0" : String(cell.m.count),
          limitLabel(cell.f), stateLabel(cell.st, cell.f),
          sheet.rows[r][c] || ""
        ]);
        out.push(line);
      }
    }
    return out;
  }
  function toTsv(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var line = [];
      for (var j = 0; j < rows[i].length; j++) line.push(String(rows[i][j]).replace(/[\t\r\n]+/g, " "));
      out.push(line.join("\t"));
    }
    return out.join("\n");
  }
  function toCsv(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var line = [];
      for (var j = 0; j < rows[i].length; j++) {
        var v = String(rows[i][j]);
        line.push(/[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
      }
      out.push(line.join(","));
    }
    return out.join("\r\n");
  }

  function flash(btn, key) {
    var old = btn.textContent;
    btn.textContent = t(key);
    setTimeout(function () { btn.textContent = old; }, 1400);
  }

  /* ---------- 파일 읽기 ---------- */
  var BIN_SIG = [[0x50, 0x4B, 0x03, 0x04], [0x50, 0x4B, 0x05, 0x06], [0x25, 0x50, 0x44, 0x46],
                 [0xD0, 0xCF, 0x11, 0xE0], [0x1F, 0x8B]];
  function looksBinary(bytes) {
    for (var i = 0; i < BIN_SIG.length; i++) {
      var sig = BIN_SIG[i], hit = true;
      for (var j = 0; j < sig.length; j++) if (bytes[j] !== sig[j]) { hit = false; break; }
      if (hit) return true;
    }
    var scan = Math.min(bytes.length, 2048);
    for (var k = 0; k < scan; k++) if (bytes[k] === 0) return true;   // NUL = 텍스트가 아니다
    return false;
  }

  function readFile(file) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      showBatchMessage('<p class="acl-sub" style="margin:0"><b>' +
        esc(t("tool.err.tooBig", { mb: Math.round(file.size / 1048576) })) + "</b></p>");
      return;
    }
    if (/\.(xlsx?|numbers|ods|pdf|zip|gz)$/i.test(file.name)) {
      showBatchMessage('<p class="acl-sub" style="margin:0"><b>' + esc(t("tool.err.binary")) + "</b></p>");
      return;
    }
    var notes = [];
    if (file.size > BIG_BYTES) {
      notes.push(t("tool.msg.bigFile", { mb: Math.round(file.size / 1048576) }));
      elBatchRes.innerHTML = '<p class="acl-sub" style="margin:0">' + esc(notes[0]) + "</p>";
    }

    var fr = new FileReader();
    fr.onerror = function () {
      showBatchMessage('<p class="acl-sub" style="margin:0"><b>' + esc(t("tool.err.read")) + "</b></p>");
    };
    fr.onload = function () {
      try {
        var bytes = new Uint8Array(fr.result);
        if (looksBinary(bytes)) {
          showBatchMessage('<p class="acl-sub" style="margin:0"><b>' + esc(t("tool.err.binary")) + "</b></p>");
          return;
        }
        var text = null;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch (e1) {
          // 한글 엑셀이 저장한 CSV 는 EUC-KR 인 경우가 많다 — 조용히 깨뜨리지 않고 폴백 + 고지
          try {
            text = new TextDecoder("euc-kr").decode(bytes);
            notes.push(t("tool.msg.euckr"));
          } catch (e2) {
            showBatchMessage('<p class="acl-sub" style="margin:0"><b>' + esc(t("tool.err.encoding")) + "</b></p>");
            return;
          }
        }
        if (text.indexOf("\u0000") >= 0) {
          showBatchMessage('<p class="acl-sub" style="margin:0"><b>' + esc(t("tool.err.binary")) + "</b></p>");
          return;
        }
        if (text.length > 200000) { elPaste.value = ""; notes.push(t("tool.msg.notShown")); }
        else elPaste.value = text;
        loadText(text, notes);
      } catch (e) {
        showBatchMessage('<p class="acl-sub" style="margin:0"><b>' + esc(t("tool.err.read")) + "</b></p>");
      }
    };
    fr.readAsArrayBuffer(file);
  }

  /* ---------- 이벤트 ---------- */
  function setMode(batch) {
    elTabS.classList.toggle("is-on", !batch);
    elTabB.classList.toggle("is-on", batch);
    elTabS.setAttribute("aria-selected", String(!batch));
    elTabB.setAttribute("aria-selected", String(batch));
    elPaneS.hidden = batch;
    elPaneB.hidden = !batch;
  }
  elTabS.addEventListener("click", function () { setMode(false); });
  elTabB.addEventListener("click", function () { setMode(true); });

  elPlatform.addEventListener("change", function () {
    prefs.platform = elPlatform.value;
    savePrefs();
    fillFieldSelect();
    renderSingle();
    if (sheet) {
      // 프리셋이 바뀌면 필드 집합이 달라진다 → 헤더에서 다시 추론(사용자 취향은 유지)
      var pf = currentPf();
      for (var i = 0; i < sheet.mapping.length; i++) {
        var saved = sheet.headerDetected ? prefs.cols[normHeader(sheet.header[i])] : null;
        if (saved === "__none") { sheet.mapping[i] = null; continue; }
        if (saved === "__group") { sheet.mapping[i] = "__group"; continue; }
        if (saved && fieldById(pf, saved)) { sheet.mapping[i] = saved; continue; }
        sheet.mapping[i] = sheet.headerDetected ? roleOf(pf, sheet.header[i]) : null;
      }
      runCheck();
    }
  });
  elFieldType.addEventListener("change", renderSingle);
  elText.addEventListener("input", renderSingle);

  elCheck.addEventListener("click", function () { loadText(elPaste.value, []); });
  elPaste.addEventListener("paste", function () {
    setTimeout(function () { if (elPaste.value.trim() !== "") loadText(elPaste.value, []); }, 0);
  });
  elOnly.addEventListener("change", renderGrid);

  elBrowse.addEventListener("click", function () { elFile.click(); });
  elFile.addEventListener("change", function () { if (elFile.files && elFile.files[0]) readFile(elFile.files[0]); });
  ["dragenter", "dragover"].forEach(function (ev) {
    elDrop.addEventListener(ev, function (e) { e.preventDefault(); elDrop.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    elDrop.addEventListener(ev, function (e) { e.preventDefault(); elDrop.classList.remove("is-over"); });
  });
  elDrop.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  });

  elCopy.addEventListener("click", function () {
    if (!sheet || !view) return;
    var txt = toTsv(exportRows());
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { flash(elCopy, "tool.copied"); },
        function () { flash(elCopy, "tool.copyFail"); });
    } else flash(elCopy, "tool.copyFail");
  });
  elCsv.addEventListener("click", function () {
    if (!sheet || !view) return;
    try {
      var blob = new Blob(["\uFEFF" + toCsv(exportRows())], { type: "text/csv;charset=utf-8;" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = SLUG + "-" + prefs.platform + ".csv";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    } catch (e) { flash(elCsv, "tool.copyFail"); }
  });
  elSample.addEventListener("click", function () {
    elPaste.value = t("tool.sample.data");
    loadText(elPaste.value, []);
  });

  document.addEventListener("i18n:change", function () {
    fillPlatformSelect(); fillFieldSelect(); renderSingle();
    if (sheet) { renderSummary(view, view ? view.fallbackNote : null); renderGrid(); }
    else if (elBatchRes.innerHTML) showBatchMessage('<p class="acl-sub" style="margin:0">' + esc(t("tool.msg.emptyBatch")) + "</p>");
  });

  fillPlatformSelect();
  fillFieldSelect();
  renderSingle();
  showBatchMessage('<p class="acl-sub" style="margin:0">' + esc(t("tool.msg.emptyBatch")) + "</p>");

  // 계산 로직 자체 검증용 노출 (node 단위 테스트에서 사용, 브라우저 동작에는 영향 없음)
  window.__ACL = {
    countChars: countChars, measure: measure, judge: judge, parseTable: parseTable,
    detectDelimiter: detectDelimiter, roleOf: roleOf, PLATFORMS: PLATFORMS, platformById: platformById,
    fieldById: fieldById, normHeader: normHeader, toCsv: toCsv, toTsv: toTsv
  };
  // TOOLJS:END
})();
