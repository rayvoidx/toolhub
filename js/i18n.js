/* ============================================================
   i18n 엔진 — 허브 홈 변형 (2026-09-14 언어별 lazy 로드).
   왜: 홈 js/locales.js 는 14언어 × 325도구 = 933KB 를 렌더 차단으로 매 방문 내려받았다
       (Lighthouse: 렌더 차단 1,060ms, LCP 9.1s). 방문자는 한 언어만 본다.
   구조: en 은 js/locales/en.js 를 동기 로드(폴백·셀렉터용), 나머지 13언어는 js/locales/<lang>.js 를
         필요할 때만 로드한다. 진본 카탈로그는 js/locales.js(전 언어, 사람이 편집) —
         factory/gen-hub-locales.js 가 언어별 파일을 생성하며 페이지는 진본을 직접 싣지 않는다.
   계약 (docs/I18N.md) 은 동일:
   - 번역 대상 텍스트: data-i18n="key" / 속성: data-i18n-placeholder|title|aria-label
   - 카탈로그에 없는 키는 HTML 원문(baked) 폴백 — 부분 번역도 깨지지 않는다.
   - 언어 결정 우선순위: URL ?lang= → localStorage → navigator.languages → "en"
   - 언어 파일 로드 실패 시 영어를 유지하고 콘솔에 경고한다(조용한 실패 금지).
   ============================================================ */
(function i18n() {
  "use strict";
  var cfg = window.APP_CONFIG || {};
  var LOCALES = window.I18N_LOCALES = window.I18N_LOCALES || {};
  // 지원 언어 14개 고정(docs/I18N.md) — 카탈로그를 읽지 않고도 감지·셀렉터를 채운다.
  var LANGS = {
    en: "English", zh: "中文", hi: "हिन्दी", es: "Español", ar: "العربية", fr: "Français", bn: "বাংলা",
    pt: "Português", ru: "Русский", ur: "اردو", id: "Bahasa Indonesia", de: "Deutsch", ja: "日本語", ko: "한국어"
  };
  var codes = Object.keys(LANGS);
  var DEFAULT = "en";
  var RTL = { ar: 1, ur: 1, fa: 1, he: 1 };
  var ATTRS = ["placeholder", "title", "aria-label"];
  var storeKey = (cfg.slug || "app") + ":lang";
  var baked = {};   // 최초 적용 전 HTML 원문 스냅샷 (누락 키 폴백용)
  var current = null;
  var loading = {};
  var base = "js/";
  try {
    var si = document.querySelector('script[src$="i18n.js"]');
    if (si) base = si.getAttribute("src").replace(/i18n\.js$/, "");
  } catch (e) { /* noop */ }

  function normalize(code) {
    code = String(code || "").toLowerCase();
    if (!code) return null;
    if (LANGS[code]) return code;
    var primary = code.split("-")[0];
    return LANGS[primary] ? primary : null;
  }

  function detect() {
    try {
      var p = normalize(new URLSearchParams(location.search).get("lang"));
      if (p) return p;
    } catch (e) { /* 구형 브라우저 */ }
    try {
      var saved = normalize(localStorage.getItem(storeKey));
      if (saved) return saved;
    } catch (e) { /* private mode */ }
    var navLangs = navigator.languages || [navigator.language || ""];
    for (var i = 0; i < navLangs.length; i++) {
      var m = normalize(navLangs[i]);
      if (m) return m;
    }
    return DEFAULT;
  }

  function t(key, lang) {
    lang = lang || current || DEFAULT;
    var L = LOCALES[lang] || {};
    var F = LOCALES[DEFAULT] || {};
    if (L[key] != null) return L[key];
    if (F[key] != null) return F[key];
    return baked[key] != null ? baked[key] : null;
  }

  // 언어 파일 lazy 로드. 같은 언어의 동시 요청은 한 번만 내려받는다.
  function load(lang, done) {
    if (lang === DEFAULT || LOCALES[lang]) { done(true); return; }
    if (loading[lang]) { loading[lang].push(done); return; }
    loading[lang] = [done];
    var s = document.createElement("script");
    s.src = base + "locales/" + lang + ".js";
    s.onload = function () {
      var cbs = loading[lang]; delete loading[lang];
      for (var i = 0; i < cbs.length; i++) cbs[i](!!LOCALES[lang]);
    };
    s.onerror = function () {
      var cbs = loading[lang]; delete loading[lang];
      try { console.warn("i18n: locale file failed to load — " + s.src + " (English kept)"); } catch (e) { /* noop */ }
      for (var i = 0; i < cbs.length; i++) cbs[i](false);
    };
    document.head.appendChild(s);
  }

  function apply(lang) {
    lang = normalize(lang) || DEFAULT;
    load(lang, function (ok) { render(ok ? lang : DEFAULT); });
  }

  function render(lang) {
    var i, el, key, val, els;

    // 텍스트 노드
    els = document.querySelectorAll("[data-i18n]");
    for (i = 0; i < els.length; i++) {
      el = els[i];
      key = el.getAttribute("data-i18n");
      if (baked[key] == null) baked[key] = el.textContent;
      val = t(key, lang);
      if (val != null) el.textContent = val;
    }

    // 속성
    for (var a = 0; a < ATTRS.length; a++) {
      var attr = ATTRS[a];
      els = document.querySelectorAll("[data-i18n-" + attr + "]");
      for (i = 0; i < els.length; i++) {
        el = els[i];
        key = el.getAttribute("data-i18n-" + attr);
        var bkey = key + "@" + attr;
        if (baked[bkey] == null) baked[bkey] = el.getAttribute(attr) || "";
        val = t(key, lang);
        if (val == null) val = baked[bkey];
        el.setAttribute(attr, val);
      }
    }

    // 문서 메타 (title / description / OG)
    var title = t("meta.title", lang);
    if (title) {
      document.title = title;
      setMeta('meta[property="og:title"]', title);
    }
    var desc = t("meta.description", lang);
    if (desc) {
      setMeta('meta[name="description"]', desc);
      setMeta('meta[property="og:description"]', desc);
    }

    // 보이는 제목·브랜드도 언어 추종 (2026-08-06) — meta.title 첫 절 재사용
    if (title) {
      var headWord = title.split(/—|\||–/)[0].trim();
      var h1El = document.querySelector(".hero h1");
      if (h1El && headWord) h1El.textContent = headWord;
      var brandSpan = document.querySelector(".brand span");
      if (brandSpan && headWord) brandSpan.textContent = headWord;
    }

    // 심화 가이드 언어 스왑 — js/guide-i18n.js 가 있으면 lazy 로드 (없으면 EN 유지)
    var gc = document.querySelector(".guide-content");
    if (gc) {
      if (!gc.__en) gc.__en = gc.innerHTML;
      var applyGuide = function () {
        var g = window.GUIDES || {};
        gc.innerHTML = (lang !== "en" && g[lang]) ? g[lang] : gc.__en;
      };
      if (lang !== "en" && !window.GUIDES && !window.__guideLoading) {
        window.__guideLoading = true;
        var gs = document.createElement("script");
        gs.src = base + "guide-i18n.js";
        gs.onload = applyGuide;
        gs.onerror = function () { window.GUIDES = window.GUIDES || {}; };
        document.head.appendChild(gs);
      } else { applyGuide(); }
    }

    // 문서 언어/방향
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL[lang] ? "rtl" : "ltr";

    current = lang;
    try { localStorage.setItem(storeKey, lang); } catch (e) { /* noop */ }

    // 셀렉터 동기화
    var sel = document.getElementById("lang-select");
    if (sel && sel.value !== lang) sel.value = lang;

    // 도구 모듈에 통지 (언어 의존 렌더링이 있으면 이 이벤트를 구독)
    try {
      document.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang: lang } }));
    } catch (e) { /* CustomEvent 미지원 구형 브라우저 — 무시 */ }
  }

  function setMeta(selector, content) {
    var m = document.querySelector(selector);
    if (m) m.setAttribute("content", content);
  }

  // 언어 셀렉터 채우기 (각 언어의 자기 표기)
  var sel = document.getElementById("lang-select");
  if (sel) {
    for (var c = 0; c < codes.length; c++) {
      var opt = document.createElement("option");
      opt.value = codes[c];
      opt.textContent = LANGS[codes[c]];
      sel.appendChild(opt);
    }
    sel.addEventListener("change", function () { apply(sel.value); });
  }

  window.I18N = {
    t: function (key) { return t(key, current); },
    apply: apply,
    lang: function () { return current; },
    languages: codes.slice()
  };

  apply(detect());
})();
