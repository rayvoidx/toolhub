/* ============================================================
   i18n 엔진 — 셸 공통부. 원칙적으로 수정하지 않는다.
   번역 데이터는 js/locales.js (window.I18N_LOCALES) 에만 있다.
   계약 (docs/I18N.md):
   - 번역 대상 텍스트: data-i18n="key"
   - 번역 대상 속성:   data-i18n-placeholder / data-i18n-title / data-i18n-aria-label
   - 카탈로그에 없는 키는 HTML에 구워진 원문(baked)으로 폴백 — 부분 번역도 깨지지 않는다.
   - 언어 결정 우선순위: URL ?lang= → localStorage → navigator.languages → "en"
   ============================================================ */
(function i18n() {
  "use strict";
  var cfg = window.APP_CONFIG || {};
  var LOCALES = window.I18N_LOCALES || {};
  var codes = [];
  for (var k in LOCALES) { if (LOCALES.hasOwnProperty(k)) codes.push(k); }
  if (!codes.length) return; // 카탈로그 없으면 아무것도 하지 않음 (조용한 실패 아님 — 단일 언어 서비스)

  var DEFAULT = "en";
  if (codes.indexOf(DEFAULT) === -1) DEFAULT = codes[0];
  var RTL = { ar: 1, ur: 1, fa: 1, he: 1 };
  var ATTRS = ["placeholder", "title", "aria-label"];
  var storeKey = (cfg.slug || "app") + ":lang";
  var baked = {};   // 최초 적용 전 HTML 원문 스냅샷 (누락 키 폴백용)
  var current = null;

  function normalize(code) {
    code = String(code || "").toLowerCase();
    if (!code) return null;
    if (LOCALES[code]) return code;
    var primary = code.split("-")[0];
    if (LOCALES[primary]) return primary;
    return null;
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

  function apply(lang) {
    lang = normalize(lang) || DEFAULT;
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
      var code = codes[c];
      var opt = document.createElement("option");
      opt.value = code;
      opt.textContent = (LOCALES[code] && LOCALES[code]._label) || code;
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
