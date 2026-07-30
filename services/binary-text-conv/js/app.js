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
  /* Binary Translator — Text <-> binary / hex / decimal byte codes, two-way live.
     상태: localStorage "binary-text-conv:last"(텍스트) / "binary-text-conv:mode"(탭) 만.
     외부 API 없음, 모든 변환은 UTF-8 바이트 기반으로 브라우저 로컬에서 수행. */

  var LAST_KEY = "binary-text-conv:last"; // 마지막 Plain text 입력
  var MODE_KEY = "binary-text-conv:mode"; // 마지막 선택 탭 (binary|hex|decimal)

  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }

  /* ---- UTF-8 바이트 변환 (Korean/CJK/이모지까지 정확히 왕복) ---- */
  function utf8Encode(str) {
    return new TextEncoder().encode(str == null ? "" : str);
  }
  function utf8Decode(bytes) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  function pad(s, len) {
    s = String(s);
    while (s.length < len) s = "0" + s;
    return s;
  }

  /* ---- 바이트 배열 → 문자열 표현 (node 단위 검증 대상) ---- */
  function bytesToBinary(bytes) {
    var out = [];
    for (var i = 0; i < bytes.length; i++) out.push(pad(bytes[i].toString(2), 8));
    return out.join(" ");
  }
  function bytesToHex(bytes) {
    var out = [];
    for (var i = 0; i < bytes.length; i++) out.push(pad(bytes[i].toString(16), 2));
    return out.join(" ");
  }
  function bytesToDecimal(bytes) {
    var out = [];
    for (var i = 0; i < bytes.length; i++) out.push(String(bytes[i]));
    return out.join(" ");
  }

  /* ---- 문자열 표현 → 바이트 배열 (관용적 파싱: 공백/개행 무시, 형식만 검증) ----
     실패 시 throw — 호출부가 오류 문구를 붙인다 (조용한 실패 금지). */
  function parseBinary(raw) {
    var s = String(raw == null ? "" : raw).replace(/\s+/g, "");
    if (s === "") return new Uint8Array(0);
    if (!/^[01]+$/.test(s) || s.length % 8 !== 0) throw new Error("invalidBinary");
    var out = [];
    for (var i = 0; i < s.length; i += 8) out.push(parseInt(s.substr(i, 8), 2));
    return new Uint8Array(out);
  }
  function parseHex(raw) {
    var s = String(raw == null ? "" : raw).replace(/\s+/g, "").replace(/0[xX]/g, "");
    if (s === "") return new Uint8Array(0);
    if (!/^[0-9a-fA-F]+$/.test(s) || s.length % 2 !== 0) throw new Error("invalidHex");
    var out = [];
    for (var i = 0; i < s.length; i += 2) out.push(parseInt(s.substr(i, 2), 16));
    return new Uint8Array(out);
  }
  function parseDecimal(raw) {
    var trimmed = String(raw == null ? "" : raw).trim();
    if (trimmed === "") return new Uint8Array(0);
    var parts = trimmed.split(/[\s,]+/).filter(function (x) { return x.length > 0; });
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (!/^\d{1,3}$/.test(parts[i])) throw new Error("invalidDecimal");
      var n = parseInt(parts[i], 10);
      if (n < 0 || n > 255) throw new Error("invalidDecimal");
      out.push(n);
    }
    return new Uint8Array(out);
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      bytesToBinary: bytesToBinary, bytesToHex: bytesToHex, bytesToDecimal: bytesToDecimal,
      parseBinary: parseBinary, parseHex: parseHex, parseDecimal: parseDecimal
    };
    return;
  }

  var MODES = {
    binary: { toStr: bytesToBinary, parse: parseBinary, errKey: "tool.msg.invalidBinary", labelKey: "tool.encoded.label.binary", phKey: "tool.encoded.ph.binary" },
    hex: { toStr: bytesToHex, parse: parseHex, errKey: "tool.msg.invalidHex", labelKey: "tool.encoded.label.hex", phKey: "tool.encoded.ph.hex" },
    decimal: { toStr: bytesToDecimal, parse: parseDecimal, errKey: "tool.msg.invalidDecimal", labelKey: "tool.encoded.label.decimal", phKey: "tool.encoded.ph.decimal" }
  };
  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var textEl = $("btc-text"), encEl = $("btc-encoded");
  var encLabelEl = $("btc-encoded-label");
  var countEl = $("btc-count");
  var errEl = $("btc-error"), fbEl = $("btc-feedback");
  var clearBtn = $("btc-clear"), exampleBtn = $("btc-example");
  var tabsWrap = $("btc-tabs");
  if (!textEl || !encEl || !tabsWrap) return;
  var tabBtns = tabsWrap.querySelectorAll(".mode-tab");
  var copyBtns = document.querySelectorAll(".btc-copy");

  var mode = "binary";
  var dir = "encode"; // "encode"(text가 기준) | "decode"(encoded가 기준) — 마지막으로 편집한 쪽

  /* ---- 메시지 표시 (에러는 다음 액션까지 유지, 성공 피드백은 자동 소멸) ---- */
  var fbTimer = null;
  function showErr(msg) {
    if (!errEl) return;
    errEl.hidden = false;
    errEl.textContent = msg;
  }
  function hideErr() { if (errEl) { errEl.hidden = true; errEl.textContent = ""; } }
  function showFb(msg) {
    if (!fbEl) return;
    fbEl.hidden = false;
    fbEl.textContent = msg;
    if (fbTimer) clearTimeout(fbTimer);
    fbTimer = setTimeout(function () { fbEl.hidden = true; }, 2000);
  }

  function updateCount(n) {
    if (!countEl) return;
    countEl.textContent = t("tool.count").replace("{n}", String(n));
  }

  /* ---- 탭 UI ---- */
  function styleTab(btn, active) {
    btn.style.background = active ? "var(--accent)" : "var(--bg)";
    btn.style.color = active ? "#fff" : "var(--ink)";
    btn.style.borderColor = active ? "var(--accent)" : "var(--line)";
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }
  function syncTabs() {
    for (var i = 0; i < tabBtns.length; i++) {
      styleTab(tabBtns[i], tabBtns[i].getAttribute("data-mode") === mode);
    }
  }
  function applyModeCopy() {
    var m = MODES[mode];
    if (encLabelEl) encLabelEl.textContent = t(m.labelKey);
    encEl.setAttribute("placeholder", t(m.phKey));
    encEl.setAttribute("data-i18n-placeholder", m.phKey);
  }

  /* ---- 변환: text → encoded(현재 모드) ---- */
  function renderFromText() {
    var bytes = utf8Encode(textEl.value);
    encEl.value = MODES[mode].toStr(bytes);
    updateCount(bytes.length);
    hideErr();
  }
  /* ---- 변환: encoded(현재 모드) → text ---- */
  function renderFromEncoded() {
    if (encEl.value.trim() === "") {
      textEl.value = "";
      updateCount(0);
      hideErr();
      return;
    }
    try {
      var bytes = MODES[mode].parse(encEl.value);
      textEl.value = utf8Decode(bytes);
      updateCount(bytes.length);
      hideErr();
    } catch (e) {
      textEl.value = "";
      updateCount(0);
      showErr(t(MODES[mode].errKey));
    }
  }

  function saveState() {
    try { localStorage.setItem(LAST_KEY, textEl.value); } catch (e) { /* private mode */ }
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* noop */ }
  }

  function setMode(next) {
    if (!MODES[next] || next === mode) return;
    mode = next;
    syncTabs();
    applyModeCopy();
    // 모드 전환은 항상 현재 텍스트를 기준으로 다시 그린다 (표시 기수만 바뀔 뿐, 데이터 손실 없음)
    dir = "encode";
    renderFromText();
    saveState();
  }

  /* ---- 이벤트 ---- */
  textEl.addEventListener("input", function () {
    dir = "encode";
    renderFromText();
    saveState();
  });
  encEl.addEventListener("input", function () {
    dir = "decode";
    renderFromEncoded();
    saveState();
  });

  for (var ti = 0; ti < tabBtns.length; ti++) {
    (function (btn) {
      btn.addEventListener("click", function () { setMode(btn.getAttribute("data-mode")); });
    })(tabBtns[ti]);
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      textEl.value = "";
      encEl.value = "";
      updateCount(0);
      hideErr();
      dir = "encode";
      try { localStorage.removeItem(LAST_KEY); } catch (e) { /* noop */ }
      if (textEl.focus) textEl.focus();
    });
  }

  if (exampleBtn) {
    exampleBtn.addEventListener("click", function () {
      textEl.value = t("tool.example.text");
      dir = "encode";
      renderFromText();
      saveState();
    });
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }
  function copyValue(el) {
    var val = el ? el.value : "";
    if (!val) { showFb(t("tool.msg.nothingToCopy")); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(val).then(
        function () { showFb(t("tool.msg.copied")); },
        function () { showFb(legacyCopy(val) ? t("tool.msg.copied") : t("tool.msg.copyError")); }
      );
    } else {
      showFb(legacyCopy(val) ? t("tool.msg.copied") : t("tool.msg.copyError"));
    }
  }
  for (var ci = 0; ci < copyBtns.length; ci++) {
    (function (btn) {
      btn.addEventListener("click", function () { copyValue($(btn.getAttribute("data-copy"))); });
    })(copyBtns[ci]);
  }

  /* ---- 언어 전환 시 라벨/placeholder/에러 문구 재적용 ---- */
  document.addEventListener("i18n:change", function () {
    applyModeCopy();
    updateCount(utf8Encode(textEl.value).length);
    if (!errEl.hidden && dir === "decode") showErr(t(MODES[mode].errKey));
  });

  /* ---- 초기화: 저장된 모드/텍스트 복원 ---- */
  (function init() {
    try {
      var savedMode = localStorage.getItem(MODE_KEY);
      if (savedMode && MODES[savedMode]) mode = savedMode;
    } catch (e) { /* noop */ }
    try {
      var last = localStorage.getItem(LAST_KEY);
      if (typeof last === "string") textEl.value = last;
    } catch (e) { /* 손상값 무시 */ }
    syncTabs();
    applyModeCopy();
    dir = "encode";
    renderFromText();
  })();
  // TOOLJS:END
})();
