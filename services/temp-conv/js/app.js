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
  function $(id) { return document.getElementById(id); }
  var inputs = { c: $("c-input"), f: $("f-input"), k: $("k-input") };
  var placeholderEl = $("tc-placeholder");
  var summaryEl = $("tc-summary");
  var contextEl = $("tc-context");
  var warnEl = $("tc-warn");
  var copyMsgEl = $("tc-copymsg");
  var quickEl = $("tc-quick");
  var homeEl = $("tc-home");
  var homeNoteEl = $("tc-home-note");
  if (!inputs.c || !inputs.f || !inputs.k || !summaryEl || !warnEl) return;

  var CFG = window.APP_CONFIG || {};
  var HOME_KEY = (CFG.slug || "temp-conv") + ":home";
  var UNITS = ["c", "f", "k"];
  var MAXLEN = 15;                 // 극단값: 입력 15자리 제한
  var last = { kind: "empty" };   // 마지막 렌더 상태 (언어 전환 재렌더용 — 영속 상태 아님)
  var copyTimer = null;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상)
  function toCelsius(unit, v) {
    if (unit === "f") return (v - 32) * 5 / 9;
    if (unit === "k") return v - 273.15;
    return v; // c
  }
  function fromCelsius(c) {
    return { c: c, f: c * 9 / 5 + 32, k: c + 273.15 };
  }
  function belowAbsoluteZero(unit, v) {
    if (unit === "f") return v < -459.67;
    if (unit === "k") return v < 0;
    return v < -273.15; // c
  }
  function fmt(n) {
    if (n == null || !isFinite(n)) return "";
    var s = (Math.round(n * 100) / 100).toFixed(2); // 소수 2자리 반올림
    s = s.replace(/0+$/, "").replace(/\.$/, "");    // 정수로 떨어지면 정수 표시
    if (s === "-0") s = "0";
    return s;
  }

  /* ---- 축4: 일상 단위는 나라로 갈린다 ----
     화씨를 일상 온도 단위로 쓰는 나라 = 미국·미국령 + 카리브 일부 + 태평양 자유연합국 + 라이베리아.
     그 외 전 세계는 섭씨. 연 1회 갱신으로도 수렴하는 정적 목록이라 내장한다(실시간 조회 없음). */
  var FAHRENHEIT_COUNTRIES = {
    US: 1, PR: 1, GU: 1, VI: 1, AS: 1, MP: 1,   // 미국 및 미국령
    BS: 1, BZ: 1, KY: 1, MS: 1, KN: 1,          // 바하마·벨리즈·케이맨·몬트세랫·세인트키츠네비스
    PW: 1, FM: 1, MH: 1,                        // 팔라우·미크로네시아·마셜제도
    LR: 1                                       // 라이베리아
  };
  // 지역 단서가 없으면 섭씨 — 화씨권을 뺀 사실상 모든 나라가 섭씨이므로 다수결이 아니라 근거 있는 기본값
  var DEFAULT_HOME = "c";

  // 프리셋은 "내가 찾아보는 값" = 내가 안 쓰는 단위로 준다.
  // 섭씨권 사용자는 미국 레시피·예보의 °F 를 찾고, 화씨권 사용자는 해외 °C 를 찾는다.
  var PRESETS = {
    c: { unit: "f", sym: "°F", items: [
      { key: "freezing", v: 32 }, { key: "room", v: 68 }, { key: "body", v: 98.6 },
      { key: "fever", v: 100.4 }, { key: "boiling", v: 212 }, { key: "oven", v: 350 }
    ] },
    f: { unit: "c", sym: "°C", items: [
      { key: "freezing", v: 0 }, { key: "room", v: 20 }, { key: "body", v: 37 },
      { key: "fever", v: 38 }, { key: "boiling", v: 100 }, { key: "oven", v: 180 }
    ] }
  };

  function normHome(v) {
    v = String(v == null ? "" : v).trim().toLowerCase();
    return (v === "c" || v === "f") ? v : null;
  }
  // "en-US" → "US", "zh-Hans-CN" → "CN", "es-419"·"en" → null (지역 서브태그는 항상 2글자)
  function regionOfTag(tag) {
    var parts = String(tag == null ? "" : tag).split("-");
    for (var i = 1; i < parts.length; i++) {
      if (/^[A-Za-z]{2}$/.test(parts[i])) return parts[i].toUpperCase();
    }
    return null;
  }
  // 우선순위: URL ?home= → 저장값 → 브라우저 지역 → 섭씨
  function detectHome(urlHome, stored, tags) {
    var h = normHome(urlHome);
    if (h) return h;
    h = normHome(stored);
    if (h) return h;
    tags = tags || [];
    for (var i = 0; i < tags.length; i++) {
      var r = regionOfTag(tags[i]);
      if (r) return FAHRENHEIT_COUNTRIES[r] ? "f" : "c"; // 지역을 찾은 순간 확정 (GB→섭씨)
    }
    return DEFAULT_HOME;
  }
  // 축2: 결과에 붙일 맥락 밴드 (섭씨 기준). 절대영도 미만은 경고가 대신 말하므로 null.
  function bandOf(c) {
    if (c == null || !isFinite(c)) return null;
    if (c < -273.15) return null;
    if (c <= -100) return "cryo";
    if (c < -0.5) return "subzero";
    if (c <= 0.5) return "freezing";
    if (c < 16) return "cold";
    if (c < 24) return "room";
    if (c < 35.5) return "warm";
    if (c < 37.8) return "body";
    if (c < 42.5) return "fever";
    if (c < 99.5) return "hotwater";
    if (c < 150) return "boiling";
    if (c < 260) return "oven";
    return "extreme";
  }
  // calc-core:end

  /* ---- Intl 헬퍼 — 숫자 표기만 현지화 ---- */
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  // 소수점·자릿수 구분은 Intl 에 맡기되(de: 176,67 / fr: 1 234,5) 숫자 문자체계는 latn 고정.
  // 입력칸이 type=number 라 ASCII 숫자만 담기므로, 요약이 벵골·아랍 숫자면 값을 대조할 수 없다.
  function fmtLoc(n) {
    if (n == null || !isFinite(n)) return "";
    var v = Math.round(n * 100) / 100;
    if (v === 0) v = 0; // -0 정규화
    try { return v.toLocaleString(uiLang() + "-u-nu-latn", { maximumFractionDigits: 2 }); }
    catch (e) { return fmt(n); } // Intl 미지원 → 기존 ASCII 표기로 폴백
  }

  function hideContext() {
    if (contextEl) { contextEl.hidden = true; contextEl.textContent = ""; }
  }

  function renderResult() {
    var s = last || { kind: "empty" };
    if (s.kind === "empty") {
      if (placeholderEl) placeholderEl.hidden = false;
      summaryEl.hidden = true;
      warnEl.hidden = true;
      hideContext();
      return;
    }
    if (placeholderEl) placeholderEl.hidden = true;
    if (s.kind === "bad") {
      summaryEl.hidden = true;
      warnEl.hidden = false;
      warnEl.textContent = t("tool.warn.badinput", "Please enter a valid number.");
      hideContext();
      return;
    }
    // kind === "ok" — 값 표시 (절대영도 미만이어도 값은 보여주고 경고만 덧붙임)
    summaryEl.hidden = false;
    summaryEl.textContent = t("tool.result.summary", "{c} °C  =  {f} °F  =  {k} K")
      .replace("{c}", fmtLoc(s.c)).replace("{f}", fmtLoc(s.f)).replace("{k}", fmtLoc(s.k));
    // 축2: 이 온도가 무엇인지 한 줄 (절대영도 미만이면 경고가 대신 말한다)
    var band = s.below ? null : bandOf(s.c);
    var bandTxt = band ? t("tool.band." + band, "") : "";
    if (contextEl) {
      contextEl.textContent = bandTxt || "";
      contextEl.hidden = !bandTxt;
    }
    if (s.below) {
      warnEl.hidden = false;
      warnEl.textContent = t("tool.warn.abszero",
        "Below absolute zero (−273.15 °C / −459.67 °F / 0 K) — colder than physically possible.");
    } else {
      warnEl.hidden = true;
    }
  }

  function clearAll() {
    for (var i = 0; i < UNITS.length; i++) inputs[UNITS[i]].value = "";
    last = { kind: "empty" };
    renderResult();
  }

  function convertFrom(unit) {
    var el = inputs[unit];
    if (el.value.length > MAXLEN) el.value = el.value.slice(0, MAXLEN); // 초과 자릿수 무시

    // 숫자 아님(badInput) → 계산하지 않고 경고 (조용한 실패 금지)
    if (el.validity && el.validity.badInput) {
      last = { kind: "bad" };
      renderResult();
      return;
    }
    var raw = el.value.trim();
    if (raw === "") { clearAll(); return; }   // 빈 입력 → 나머지도 비움 (0 표시 금지)

    var v = Number(raw);
    if (!isFinite(v)) { last = { kind: "bad" }; renderResult(); return; }

    var all = fromCelsius(toCelsius(unit, v));
    for (var i = 0; i < UNITS.length; i++) {
      var u = UNITS[i];
      if (u !== unit) inputs[u].value = fmt(all[u]); // 편집 중 필드는 덮어쓰지 않음
    }
    last = { kind: "ok", c: all.c, f: all.f, k: all.k, below: belowAbsoluteZero(unit, v) };
    renderResult();
  }

  function showCopyMsg(key, fallback) {
    if (!copyMsgEl) return;
    copyMsgEl.textContent = t(key, fallback);
    copyMsgEl.hidden = false;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(function () { copyMsgEl.hidden = true; }, 1600);
  }

  function copyValue(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var v = el.value.trim();
    if (v === "") { showCopyMsg("tool.copy.empty", "Nothing to copy yet — type a temperature first."); return; }
    var done = function () { showCopyMsg("tool.copy.done", "Copied to clipboard"); };
    var fail = function () { showCopyMsg("tool.copy.fail", "Couldn't copy. Please select and copy manually."); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(v).then(done, fail);
      } else {
        var ta = document.createElement("textarea");
        ta.value = v; ta.setAttribute("readonly", "");
        ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) { done(); } else { fail(); }
      }
    } catch (e) { fail(); }
  }

  // 어느 필드든 입력 즉시 나머지 2개 동기화 (마지막 입력 필드 기준)
  for (var iu = 0; iu < UNITS.length; iu++) {
    (function (u) {
      inputs[u].addEventListener("input", function () { convertFrom(u); });
    })(UNITS[iu]);
  }

  // 필드별 복사 버튼
  var copyBtns = document.querySelectorAll(".tc-copy");
  for (var q = 0; q < copyBtns.length; q++) {
    copyBtns[q].addEventListener("click", function () {
      copyValue(this.getAttribute("data-target"));
    });
  }

  /* ---- 축4: 일상 단위 상태 (URL ?home= → localStorage → 브라우저 지역 추정) ---- */
  function urlHome() {
    try { return new URLSearchParams(location.search).get("home"); }
    catch (e) { return null; } // 구형 브라우저 — 추정으로 계속 진행
  }
  function storedHome() {
    try { return localStorage.getItem(HOME_KEY); }
    catch (e) { return null; } // private mode — 저장만 실패, 변환은 정상
  }
  function saveHome(v) {
    try { localStorage.setItem(HOME_KEY, v); } catch (e) { /* noop */ }
  }
  function resolvedLocale() {
    // navigator.language 가 "en"(지역 없음)이어도 브라우저 기본 로케일엔 보통 지역이 남는다
    try { return new Intl.DateTimeFormat().resolvedOptions().locale; }
    catch (e) { return ""; }
  }
  function browserTags() {
    var langs = (navigator.languages && navigator.languages.length)
      ? Array.prototype.slice.call(navigator.languages)
      : [navigator.language || ""];
    return langs.concat([resolvedLocale()]);
  }
  var home = detectHome(urlHome(), storedHome(), browserTags());

  // 빠른 버튼 — 국가 기본값에 따라 "내가 안 쓰는 단위"로 렌더, 클릭 즉시 전체 변환
  function onPresetClick() {
    var unit = this.getAttribute("data-unit");
    var val = this.getAttribute("data-val");
    if (!inputs[unit]) return;
    inputs[unit].value = val;
    convertFrom(unit);
    inputs[unit].focus();
  }
  function renderPresets() {
    if (!quickEl) return;
    var set = PRESETS[home] || PRESETS[DEFAULT_HOME];
    quickEl.textContent = "";
    for (var i = 0; i < set.items.length; i++) {
      var it = set.items[i];
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tc-preset";
      b.setAttribute("data-unit", set.unit);
      b.setAttribute("data-val", String(it.v)); // 입력칸(type=number)에 넣을 값은 ASCII 그대로
      b.textContent = t("tool.preset." + it.key, it.key) + " " + fmtLoc(it.v) + set.sym;
      b.addEventListener("click", onPresetClick);
      quickEl.appendChild(b);
    }
  }
  function renderHomeNote() {
    if (homeEl && homeEl.value !== home) homeEl.value = home;
    if (homeNoteEl) homeNoteEl.textContent = t("tool.home.note." + home, "");
  }
  if (homeEl) {
    homeEl.addEventListener("change", function () {
      var v = normHome(homeEl.value);
      if (!v) return;             // 알 수 없는 값이면 무시 (조용히 바꾸지 않는다)
      home = v;
      saveHome(v);
      renderPresets();
      renderHomeNote();           // 입력값·결과는 그대로 — 단위 취향이 바뀐 것뿐이다
    });
  }

  // 언어 전환 시 동적 문구(프리셋·안내·요약·맥락·경고) 재렌더 — 입력값은 유지
  document.addEventListener("i18n:change", function () {
    renderPresets();
    renderHomeNote();
    renderResult();
  });

  renderPresets();
  renderHomeNote();
  renderResult(); // 초기: 안내 문구 노출
  // TOOLJS:END
})();
