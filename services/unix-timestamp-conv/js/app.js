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
  var MAX_MS = 8.64e15;        // JS Date 표현 한계 (±275760년)
  var UNIT_NAME = {            // 감지 단위 표시용 (셀렉트 라벨과 달리 자릿수 힌트 없는 짧은 이름)
    s: ["tool.nameS", "Seconds"],
    ms: ["tool.nameMs", "Milliseconds"],
    us: ["tool.nameUs", "Microseconds"]
  };

  /* ============================================================
     순수 계산 (node 단위 검증 대상 — 외부 API·라이브러리 0)
     ============================================================ */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function padYear(y) {
    var neg = y < 0, s = String(Math.abs(y));
    while (s.length < 4) s = "0" + s;
    return (neg ? "-" : "") + s;
  }

  // 정수부 자릿수 (부호·선행 0 제외) — "0001720512345" 를 13자리로 오인하지 않게
  function digitCount(clean) {
    var intPart = clean.replace(/^[-+]/, "").split(".")[0].replace(/^0+(?=\d)/, "");
    return intPart.length;
  }

  // 자릿수 자동 인식: ≤11=초, 12~14=밀리초, 15~17=마이크로초, 18+ = 판단 보류
  function detectUnit(clean) {
    var n = digitCount(clean);
    if (n <= 11) return "s";
    if (n <= 14) return "ms";
    if (n <= 17) return "us";
    return null;
  }

  function toMillis(value, unit) {
    if (unit === "s") return Math.round(value * 1000);
    if (unit === "us") return Math.round(value / 1000);
    return Math.round(value);
  }

  // raw 문자열 → { ok, ms, unit, digits } | { ok:false, error:"empty|nan|digits|range" }
  function parseTimestamp(raw, mode) {
    var clean = String(raw == null ? "" : raw).trim();
    if (!clean) return { ok: false, error: "empty" };
    if (!/^[-+]?\d+(\.\d+)?$/.test(clean)) return { ok: false, error: "nan" };
    var unit = (mode && mode !== "auto") ? mode : detectUnit(clean);
    if (!unit) return { ok: false, error: "digits" };
    var value = Number(clean);
    if (!isFinite(value)) return { ok: false, error: "range" };
    var ms = toMillis(value, unit);
    if (!isFinite(ms) || Math.abs(ms) > MAX_MS) return { ok: false, error: "range", unit: unit };
    return { ok: true, ms: ms, unit: unit, digits: digitCount(clean) };
  }

  // epoch(ms) → "YYYY-MM-DD HH:mm:ss" (utc=true 면 UTC, 아니면 브라우저 로컬)
  function formatDateTime(ms, utc) {
    var d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    var y = utc ? d.getUTCFullYear() : d.getFullYear();
    var mo = (utc ? d.getUTCMonth() : d.getMonth()) + 1;
    var day = utc ? d.getUTCDate() : d.getDate();
    var h = utc ? d.getUTCHours() : d.getHours();
    var mi = utc ? d.getUTCMinutes() : d.getMinutes();
    var s = utc ? d.getUTCSeconds() : d.getSeconds();
    return padYear(y) + "-" + pad2(mo) + "-" + pad2(day) + " " + pad2(h) + ":" + pad2(mi) + ":" + pad2(s);
  }

  // 상대 시간 단위 선택 (deltaMs = 대상 − 현재)
  function relativeParts(deltaMs) {
    var abs = Math.abs(deltaMs);
    if (abs < 45000) return { value: Math.round(deltaMs / 1000), unit: "second" };
    if (abs < 2700000) return { value: Math.round(deltaMs / 60000), unit: "minute" };
    if (abs < 79200000) return { value: Math.round(deltaMs / 3600000), unit: "hour" };
    if (abs < 2246400000) return { value: Math.round(deltaMs / 86400000), unit: "day" };
    if (abs < 27648000000) return { value: Math.round(deltaMs / 2629800000), unit: "month" };
    return { value: Math.round(deltaMs / 31557600000), unit: "year" };
  }

  // "YYYY-MM-DDTHH:mm[:ss]" → 부품 (datetime-local 값. 브라우저 파서 차이를 타지 않게 직접 파싱)
  function parseDateTimeLocal(str) {
    var m = /^(-?\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,3})?$/
      .exec(String(str == null ? "" : str).trim());
    if (!m) return null;
    return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +(m[6] || 0) };
  }

  // 벽시계 부품 → epoch(ms). basis: "utc" | "local"(브라우저 타임존, DST 는 Date 가 처리)
  function wallToEpochMs(p, basis) {
    var ms, t;
    if (basis === "utc") {
      ms = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s, 0);
      if (p.y >= 0 && p.y <= 99) { t = new Date(ms); t.setUTCFullYear(p.y); ms = t.getTime(); }
    } else {
      t = new Date(2000, 0, 1, 0, 0, 0, 0);   // 0~99년이 1900년대로 매핑되는 것을 피한다
      t.setFullYear(p.y, p.mo - 1, p.d);
      t.setHours(p.h, p.mi, p.s, 0);
      ms = t.getTime();
    }
    return isNaN(ms) ? null : ms;
  }

  // node 검증용 노출 (DOM 접근 전에 먼저 — 브라우저엔 module 이 없어 건너뜀)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      digitCount: digitCount,
      detectUnit: detectUnit,
      toMillis: toMillis,
      parseTimestamp: parseTimestamp,
      formatDateTime: formatDateTime,
      relativeParts: relativeParts,
      parseDateTimeLocal: parseDateTimeLocal,
      wallToEpochMs: wallToEpochMs,
      MAX_MS: MAX_MS
    };
  }
  if (typeof document === "undefined") return;   // DOM 없는 환경(node 검증)에서는 여기까지

  /* ---- i18n 헬퍼 ---- */
  function tr(key, fallback) {
    try {
      if (window.I18N) { var v = window.I18N.t(key); if (v != null) return v; }
    } catch (e) { /* i18n 부재 시 폴백 */ }
    return fallback;
  }
  function uiLang() {
    try { if (window.I18N && window.I18N.lang()) return window.I18N.lang(); } catch (e) { /* noop */ }
    return "en";
  }
  function formatRelative(deltaMs) {
    var p = relativeParts(deltaMs);
    try {
      if (typeof Intl !== "undefined" && Intl.RelativeTimeFormat) {
        return new Intl.RelativeTimeFormat(uiLang(), { numeric: "auto" }).format(p.value, p.unit);
      }
    } catch (e) { /* 구형 브라우저 → 아래 영어 폴백 */ }
    var n = Math.abs(p.value), u = p.unit + (n === 1 ? "" : "s");
    return deltaMs < 0 ? n + " " + u + " ago" : "in " + n + " " + u;
  }

  var $ = function (id) { return document.getElementById(id); };
  var nowEl = $("uts-now");
  var tsInput = $("uts-input"), unitSel = $("uts-unit");
  var aHint = $("uts-a-hint"), aErr = $("uts-a-error"), aOut = $("uts-a-out");
  var detectedEl = $("uts-detected"), tzEl = $("uts-tz");
  var localEl = $("uts-local"), utcEl = $("uts-utc"), relEl = $("uts-relative");
  var dtInput = $("uts-datetime"), basisSel = $("uts-basis");
  var bHint = $("uts-b-hint"), bErr = $("uts-b-error"), bOut = $("uts-b-out");
  var outS = $("uts-out-s"), outMs = $("uts-out-ms");
  var copyErr = $("uts-copy-error");
  if (!tsInput || !dtInput || !nowEl) return;   // 마크업 불일치 시 조용히 오동작하지 않는다

  /* ---- 브라우저 타임존 이름 (실패해도 변환은 계속) ---- */
  var TZ_NAME = "";
  try { TZ_NAME = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { TZ_NAME = ""; }
  function tzSuffix() {
    var off = -new Date().getTimezoneOffset();   // 분, 동쪽 +
    var sign = off < 0 ? "-" : "+", a = Math.abs(off);
    var label = "UTC" + sign + pad2(Math.floor(a / 60)) + ":" + pad2(a % 60);
    return TZ_NAME ? "(" + TZ_NAME + ", " + label + ")" : "(" + label + ")";
  }

  /* ---- 복사 ---- */
  function writeClipboard(text, onOk, onFail) {
    function legacy() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        ok ? onOk() : onFail();
      } catch (e) { onFail(); }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(onOk, legacy);
        return;
      }
    } catch (e) { /* 아래 폴백 */ }
    legacy();
  }
  var copyErrTimer = null;
  function bindCopy(btn) {
    btn.addEventListener("click", function () {
      var src = $(btn.getAttribute("data-copy"));
      var text = src ? src.textContent.trim() : "";
      if (!text || text === "—") {   // 복사할 값이 없으면 조용히 넘기지 않는다
        showCopyError();
        return;
      }
      writeClipboard(text, function () {
        if (copyErr) copyErr.hidden = true;
        btn.textContent = tr("tool.copied", "Copied");
        setTimeout(function () { btn.textContent = tr("tool.copy", "Copy"); }, 1200);
      }, showCopyError);
    });
  }
  function showCopyError() {
    if (!copyErr) return;
    copyErr.hidden = false;
    if (copyErrTimer) clearTimeout(copyErrTimer);
    copyErrTimer = setTimeout(function () { copyErr.hidden = true; }, 5000);
  }
  var copyBtns = document.querySelectorAll("#tool [data-copy]");
  for (var i = 0; i < copyBtns.length; i++) bindCopy(copyBtns[i]);

  /* ---- 현재 타임스탬프 (1초 갱신) ---- */
  function tickNow() { nowEl.textContent = String(Math.floor(Date.now() / 1000)); }
  tickNow();
  setInterval(tickNow, 1000);

  /* ---- 패널 A: 타임스탬프 → 날짜 ---- */
  var ERR_KEY = {
    nan: ["tool.errNaN", "Numbers only — remove any letters or symbols."],
    digits: ["tool.errDigits", "That is more than 17 digits, which is too long for a Unix timestamp. Choose the unit manually if you know it."],
    range: ["tool.errRange", "That value is outside the range this converter can show (about 275,760 BC – AD 275,760)."]
  };
  function renderA() {
    var res = parseTimestamp(tsInput.value, unitSel.value);
    if (!res.ok) {
      aOut.hidden = true;
      if (res.error === "empty") {   // 빈 입력: 출력 비움 + 안내 (NaN·0 표시 금지)
        aErr.hidden = true;
        aHint.hidden = false;
      } else {
        aHint.hidden = true;
        aErr.hidden = false;
        aErr.textContent = "⚠ " + tr(ERR_KEY[res.error][0], ERR_KEY[res.error][1]);
      }
      return;
    }
    aHint.hidden = true;
    aErr.hidden = true;
    aOut.hidden = false;
    detectedEl.textContent = tr(UNIT_NAME[res.unit][0], UNIT_NAME[res.unit][1]) +
      " · " + tr("tool.digitsCount", "{n} digits").replace("{n}", String(res.digits));
    tzEl.textContent = tzSuffix();
    localEl.textContent = formatDateTime(res.ms, false);
    utcEl.textContent = formatDateTime(res.ms, true);
    relEl.textContent = formatRelative(res.ms - Date.now());
  }

  /* ---- 패널 B: 날짜 → 타임스탬프 ---- */
  function renderB() {
    var p = parseDateTimeLocal(dtInput.value);
    if (!p) {   // 미입력/불완전 입력 → 출력 비움 + 안내
      bOut.hidden = true;
      bErr.hidden = true;
      bHint.hidden = false;
      return;
    }
    var ms = wallToEpochMs(p, basisSel.value);
    if (ms === null || Math.abs(ms) > MAX_MS) {
      bOut.hidden = true;
      bHint.hidden = true;
      bErr.hidden = false;
      bErr.textContent = "⚠ " + tr(ERR_KEY.range[0], ERR_KEY.range[1]);
      return;
    }
    bHint.hidden = true;
    bErr.hidden = true;
    bOut.hidden = false;
    outS.textContent = String(Math.floor(ms / 1000));
    outMs.textContent = String(ms);
  }

  function initDateTime() {
    var d = new Date();
    dtInput.value = padYear(d.getFullYear()) + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }

  tsInput.addEventListener("input", renderA);
  unitSel.addEventListener("change", renderA);
  dtInput.addEventListener("input", renderB);
  basisSel.addEventListener("change", renderB);
  document.addEventListener("i18n:change", function () { renderA(); renderB(); });

  initDateTime();
  renderA();
  renderB();
  // TOOLJS:END
})();
