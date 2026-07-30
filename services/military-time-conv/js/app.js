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
  // military-time-conv — 24시간(군대) 시간 <-> 12시간 AM/PM 시간 양방향 변환.
  // 입력은 관대하게 파싱한다: "0930", "930", "21:45", "9:45pm", "9.45pm", "930pm" 등.
  // 방향(dir)에 따라 파서가 갈린다: milToStd 는 24시간 표기, stdToMil 은 AM/PM 표기를 기대한다.
  // 2400 은 "그 날의 끝"(다음날 0000 과 같은 시각)이라는 특수값으로 별도 안내한다.
  // 상태는 localStorage "<slug>:state" 하나에만 저장. 외부 API 없음, 모든 계산은 로컬.
  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "military-time-conv";
  var STATE_KEY = SLUG + ":state";

  /* ---- i18n 헬퍼 ---- */
  function t(key) {
    var s = window.I18N && window.I18N.t(key);
    return s != null ? s : key;
  }
  function fmtStr(s, params) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] != null ? String(params[k]) : m;
    });
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }

  /* ---- 순수 파싱/변환 로직 (node 단위 검증 대상) ---- */

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /** "0930" / "930" / "21:45" / "21.45" / "2400" → {h,m}. 24시간 표기만 허용.
   *  h 는 0-24 (24 는 "그 날의 끝"을 뜻하는 2400 전용, m 은 반드시 0). 형식 오류 시 null. */
  function parseMilitaryInput(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s) return null;
    var digits = s.replace(/[:.\s]/g, "");
    if (!/^\d{3,4}$/.test(digits)) return { error: true };
    if (digits.length === 3) digits = "0" + digits;
    var h = parseInt(digits.slice(0, 2), 10);
    var m = parseInt(digits.slice(2, 4), 10);
    if (m > 59) return { error: true };
    if (h === 24) {
      if (m !== 0) return { error: true };
      return { h: 24, m: 0, isEndOfDay: true };
    }
    if (h > 23) return { error: true };
    return { h: h, m: m };
  }

  /** "9:45 PM" / "9.45pm" / "930pm" / "9pm" / "12:00 AM" → {h,m} in 0-23. AM/PM 표기만 허용. */
  function parseStandardInput(raw) {
    if (raw == null) return null;
    var s = String(raw).trim().toLowerCase();
    if (!s) return null;
    s = s.replace(/\./g, "").replace(/\s+/g, "");
    var m = s.match(/^(\d{1,2})(?:[:h]?(\d{2}))?(am|pm|a|p)$/);
    if (!m) return { error: true };
    var hh = parseInt(m[1], 10);
    var mm = m[2] ? parseInt(m[2], 10) : 0;
    if (hh < 1 || hh > 12 || mm > 59) return { error: true };
    var mer = m[3].charAt(0);
    var h24 = hh % 12;
    if (mer === "p") h24 += 12;
    return { h: h24, m: mm };
  }

  /** {h,m} (0-23) → "HHMM" 4자리 군대시간 문자열. */
  function toMilitaryLabel(h, m) {
    return pad2(h) + pad2(m);
  }

  /** {h,m} (0-23) → "H:MM AM/PM" 12시간 문자열. */
  function toStandardParts(h, m) {
    var period = h < 12 ? "am" : "pm";
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return { h12: h12, m: m, period: period };
  }

  var ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  var TENS = ["", "", "twenty", "thirty", "forty", "fifty"];
  function numWord(n) {
    if (n < 20) return ONES[n];
    var tt = Math.floor(n / 10), o = n % 10;
    return TENS[tt] + (o ? "-" + ONES[o] : "");
  }
  function hourWord(h) {
    if (h === 24) return "twenty-four";
    if (h === 0) return "zero";
    if (h < 10) return "oh-" + ONES[h];
    return numWord(h);
  }
  function minuteWord(m) {
    if (m === 0) return "hundred";
    if (m < 10) return "oh-" + ONES[m];
    return numWord(m);
  }
  /** 군대시간 발음 표기 (영어 관용구 — 언어 무관, 예: 9:30 → "oh-nine-thirty hours"). */
  function spokenMilitary(h, m) {
    return hourWord(h) + "-" + minuteWord(m) + " hours";
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseMilitaryInput: parseMilitaryInput, parseStandardInput: parseStandardInput,
      toMilitaryLabel: toMilitaryLabel, toStandardParts: toStandardParts,
      spokenMilitary: spokenMilitary
    };
    return;
  }

  /* ---- 상태 저장 (localStorage, 단일 JSON 키) ---- */
  var storageOk = true;
  (function () { try { localStorage.setItem(SLUG + ":_t", "1"); localStorage.removeItem(SLUG + ":_t"); } catch (e) { storageOk = false; } })();
  function readState() {
    if (!storageOk) return {};
    try { var r = localStorage.getItem(STATE_KEY); return r ? JSON.parse(r) : {}; } catch (e) { return {}; }
  }
  function persist(state) {
    if (!storageOk) return;
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* quota/private mode */ }
  }

  /* ---- DOM 참조 ---- */
  function $(id) { return document.getElementById(id); }
  var dirMilBtn = $("mtc-dir-mil"), dirStdBtn = $("mtc-dir-std");
  var inputEl = $("mtc-input"), inputLabel = $("mtc-input-label");
  var nowBtn = $("mtc-now"), quickWrap = $("mtc-quick");
  var resultEl = $("mtc-result");
  if (!inputEl || !inputLabel || !resultEl) return;

  var dirState = "milToStd"; // "milToStd" | "stdToMil"
  var lastCopy = null;

  /* ---- 방향 토글 ---- */
  function syncDirButtons() {
    if (dirMilBtn) dirMilBtn.setAttribute("aria-pressed", dirState === "milToStd" ? "true" : "false");
    if (dirStdBtn) dirStdBtn.setAttribute("aria-pressed", dirState === "stdToMil" ? "true" : "false");
    inputLabel.textContent = dirState === "milToStd" ? t("tool.input.label.mil") : t("tool.input.label.std");
    var ph = dirState === "milToStd" ? t("tool.input.ph.mil") : t("tool.input.ph.std");
    inputEl.setAttribute("placeholder", ph);
  }
  function setDir(d) {
    if (dirState === d) return;
    dirState = d;
    syncDirButtons();
    onChange();
  }

  /* ---- 렌더: 오류 ---- */
  function escHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function showEmpty() {
    lastCopy = null;
    resultEl.innerHTML = '<p class="mtc-msg">' + escHtml(t("tool.result.placeholder")) + "</p>";
  }
  function showError(msg) {
    lastCopy = null;
    resultEl.innerHTML = '<p class="mtc-msg" role="alert">' + escHtml(msg) + "</p>";
  }

  /* ---- 렌더: 성공 ---- */
  function render() {
    var raw = inputEl.value;
    if (raw == null || String(raw).trim() === "") { showEmpty(); return; }

    if (dirState === "milToStd") {
      var pm = parseMilitaryInput(raw);
      if (!pm || pm.error) { showError(t("tool.err.mil")); return; }
      var effH = pm.h === 24 ? 0 : pm.h;
      var sp = toStandardParts(effH, pm.m);
      var stdLabel = sp.h12 + ":" + pad2(sp.m) + " " + t(sp.period === "am" ? "tool.meridiem.am" : "tool.meridiem.pm");
      var milLabel = toMilitaryLabel(pm.h === 24 ? 24 : pm.h, pm.m);
      var summary = fmtStr(t("tool.summary.milToStd"), { mil: milLabel, std: stdLabel });
      var html = '<p class="mtc-summary">' + escHtml(summary) + "</p>";
      html += '<p class="mtc-spoken">' + escHtml(t("tool.spoken.label")) + ": <span lang=\"en\">" +
        escHtml(spokenMilitary(pm.h, pm.m)) + "</span></p>";
      if (pm.isEndOfDay) html += '<p class="mtc-note">' + escHtml(t("tool.note.midnightEnd")) + "</p>";
      lastCopy = summary;
      html += '<div class="mtc-copyrow"><button type="button" class="btn" id="mtc-copy">' + escHtml(t("tool.copy")) + "</button></div>";
      resultEl.innerHTML = html;
    } else {
      var ps = parseStandardInput(raw);
      if (!ps || ps.error) { showError(t("tool.err.std")); return; }
      var milLabel2 = toMilitaryLabel(ps.h, ps.m);
      var sp2 = toStandardParts(ps.h, ps.m);
      var stdLabel2 = sp2.h12 + ":" + pad2(sp2.m) + " " + t(sp2.period === "am" ? "tool.meridiem.am" : "tool.meridiem.pm");
      var summary2 = fmtStr(t("tool.summary.stdToMil"), { std: stdLabel2, mil: milLabel2 });
      var html2 = '<p class="mtc-summary">' + escHtml(summary2) + "</p>";
      html2 += '<p class="mtc-spoken">' + escHtml(t("tool.spoken.label")) + ": <span lang=\"en\">" +
        escHtml(spokenMilitary(ps.h, ps.m)) + "</span></p>";
      lastCopy = summary2;
      html2 += '<div class="mtc-copyrow"><button type="button" class="btn" id="mtc-copy">' + escHtml(t("tool.copy")) + "</button></div>";
      resultEl.innerHTML = html2;
    }
  }

  /* ---- 복사 (Clipboard API → execCommand 폴백) ---- */
  function copyDone() {
    var btn = $("mtc-copy");
    if (!btn) return;
    btn.textContent = t("tool.copied");
    setTimeout(function () { var b = $("mtc-copy"); if (b) b.textContent = t("tool.copy"); }, 1500);
  }
  function copyFallback(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) copyDone();
    } catch (e) { /* 복사 미지원 — 표시값은 그대로 남는다 */ }
  }
  function copyResult() {
    if (lastCopy == null) return;
    var text = lastCopy;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(copyDone, function () { copyFallback(text); });
    } else {
      copyFallback(text);
    }
  }
  resultEl.addEventListener("click", function (ev) {
    var el = ev.target;
    while (el && el !== resultEl) {
      if (el.id === "mtc-copy") { copyResult(); return; }
      el = el.parentNode;
    }
  });

  /* ---- 상태 저장/복원 ---- */
  function saveState() {
    persist({ dir: dirState, value: inputEl.value || "" });
  }
  function onChange() { saveState(); render(); }

  /* ---- 지금 시각 채우기 ---- */
  function fillNow() {
    var d = new Date();
    if (dirState === "milToStd") {
      inputEl.value = toMilitaryLabel(d.getHours(), d.getMinutes());
    } else {
      var sp = toStandardParts(d.getHours(), d.getMinutes());
      inputEl.value = sp.h12 + ":" + pad2(sp.m) + (sp.period === "am" ? "am" : "pm");
    }
    onChange();
  }

  /* ---- 퀵 픽 (군대시간 값 그대로 채움) ---- */
  function applyQuick(val) {
    dirState = "milToStd";
    syncDirButtons();
    inputEl.value = val;
    onChange();
  }

  /* ---- 이벤트 ---- */
  if (dirMilBtn) dirMilBtn.addEventListener("click", function () { setDir("milToStd"); });
  if (dirStdBtn) dirStdBtn.addEventListener("click", function () { setDir("stdToMil"); });
  inputEl.addEventListener("input", onChange);
  if (nowBtn) nowBtn.addEventListener("click", fillNow);
  if (quickWrap) {
    quickWrap.addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest("[data-val]") : null;
      if (!btn) return;
      applyQuick(btn.getAttribute("data-val"));
    });
  }

  // 언어 전환 시 라벨·결과 재렌더
  document.addEventListener("i18n:change", function () { syncDirButtons(); render(); });

  /* ---- 초기화: 저장값 복원, 없으면 스마트 기본값(1500 → 3:00 PM) ---- */
  (function init() {
    var saved = readState();
    dirState = saved.dir === "stdToMil" ? "stdToMil" : "milToStd";
    syncDirButtons();
    inputEl.value = typeof saved.value === "string" && saved.value ? saved.value : "1500";
    render();
  })();
  // TOOLJS:END
})();
