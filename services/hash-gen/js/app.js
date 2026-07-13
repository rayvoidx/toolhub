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
  var CASE_KEY   = "hash-gen:case";           // 출력 대소문자 (prefs only)
  var TAB_KEY    = "hash-gen:tab";            // 활성 탭 (prefs only)
  var LARGE_FILE = 100 * 1024 * 1024;         // 대용량 파일 경고 임계 (100MB)
  var DEBOUNCE   = 150;                       // 텍스트 입력 디바운스(ms)

  // 알고리즘 정의 (표시 순서 고정): MD5, SHA-1, SHA-256, SHA-384, SHA-512
  var ALGOS = [
    { id: "md5",    sub: null },
    { id: "sha1",   sub: "SHA-1" },
    { id: "sha256", sub: "SHA-256" },
    { id: "sha384", sub: "SHA-384" },
    { id: "sha512", sub: "SHA-512" }
  ];

  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }

  /* ======================================================================
     MD5 — 순수 JS 구현 (번들, CDN 없음). Web Crypto 는 MD5 를 제공하지 않는다.
     바이트 배열(Uint8Array)을 받아 소문자 hex 를 돌려준다. (Joseph Myers 계열)
     ====================================================================== */
  function md5(bytes) {
    function add32(a, b) { return (a + b) & 0xffffffff; }
    function cmn(q, a, b, x, s, tt) {
      a = add32(add32(a, q), add32(x, tt));
      return add32((a << s) | (a >>> (32 - s)), b);
    }
    function ff(a, b, c, d, x, s, tt) { return cmn((b & c) | (~b & d), a, b, x, s, tt); }
    function gg(a, b, c, d, x, s, tt) { return cmn((b & d) | (c & ~d), a, b, x, s, tt); }
    function hh(a, b, c, d, x, s, tt) { return cmn(b ^ c ^ d, a, b, x, s, tt); }
    function ii(a, b, c, d, x, s, tt) { return cmn(c ^ (b | ~d), a, b, x, s, tt); }

    function cycle(state, k) {
      var a = state[0], b = state[1], c = state[2], d = state[3];
      a = ff(a, b, c, d, k[0], 7, -680876936);   d = ff(d, a, b, c, k[1], 12, -389564586);
      c = ff(c, d, a, b, k[2], 17, 606105819);    b = ff(b, c, d, a, k[3], 22, -1044525330);
      a = ff(a, b, c, d, k[4], 7, -176418897);    d = ff(d, a, b, c, k[5], 12, 1200080426);
      c = ff(c, d, a, b, k[6], 17, -1473231341);  b = ff(b, c, d, a, k[7], 22, -45705983);
      a = ff(a, b, c, d, k[8], 7, 1770035416);    d = ff(d, a, b, c, k[9], 12, -1958414417);
      c = ff(c, d, a, b, k[10], 17, -42063);      b = ff(b, c, d, a, k[11], 22, -1990404162);
      a = ff(a, b, c, d, k[12], 7, 1804603682);   d = ff(d, a, b, c, k[13], 12, -40341101);
      c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);

      a = gg(a, b, c, d, k[1], 5, -165796510);    d = gg(d, a, b, c, k[6], 9, -1069501632);
      c = gg(c, d, a, b, k[11], 14, 643717713);   b = gg(b, c, d, a, k[0], 20, -373897302);
      a = gg(a, b, c, d, k[5], 5, -701558691);    d = gg(d, a, b, c, k[10], 9, 38016083);
      c = gg(c, d, a, b, k[15], 14, -660478335);  b = gg(b, c, d, a, k[4], 20, -405537848);
      a = gg(a, b, c, d, k[9], 5, 568446438);     d = gg(d, a, b, c, k[14], 9, -1019803690);
      c = gg(c, d, a, b, k[3], 14, -187363961);   b = gg(b, c, d, a, k[8], 20, 1163531501);
      a = gg(a, b, c, d, k[13], 5, -1444681467);  d = gg(d, a, b, c, k[2], 9, -51403784);
      c = gg(c, d, a, b, k[7], 14, 1735328473);   b = gg(b, c, d, a, k[12], 20, -1926607734);

      a = hh(a, b, c, d, k[5], 4, -378558);       d = hh(d, a, b, c, k[8], 11, -2022574463);
      c = hh(c, d, a, b, k[11], 16, 1839030562);  b = hh(b, c, d, a, k[14], 23, -35309556);
      a = hh(a, b, c, d, k[1], 4, -1530992060);   d = hh(d, a, b, c, k[4], 11, 1272893353);
      c = hh(c, d, a, b, k[7], 16, -155497632);   b = hh(b, c, d, a, k[10], 23, -1094730640);
      a = hh(a, b, c, d, k[13], 4, 681279174);    d = hh(d, a, b, c, k[0], 11, -358537222);
      c = hh(c, d, a, b, k[3], 16, -722521979);   b = hh(b, c, d, a, k[6], 23, 76029189);
      a = hh(a, b, c, d, k[9], 4, -640364487);    d = hh(d, a, b, c, k[12], 11, -421815835);
      c = hh(c, d, a, b, k[15], 16, 530742520);   b = hh(b, c, d, a, k[2], 23, -995338651);

      a = ii(a, b, c, d, k[0], 6, -198630844);    d = ii(d, a, b, c, k[7], 10, 1126891415);
      c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
      a = ii(a, b, c, d, k[12], 6, 1700485571);   d = ii(d, a, b, c, k[3], 10, -1894986606);
      c = ii(c, d, a, b, k[10], 15, -1051523);    b = ii(b, c, d, a, k[1], 21, -2054922799);
      a = ii(a, b, c, d, k[8], 6, 1873313359);    d = ii(d, a, b, c, k[15], 10, -30611744);
      c = ii(c, d, a, b, k[6], 15, -1560198380);  b = ii(b, c, d, a, k[13], 21, 1309151649);
      a = ii(a, b, c, d, k[4], 6, -145523070);    d = ii(d, a, b, c, k[11], 10, -1120210379);
      c = ii(c, d, a, b, k[2], 15, 718787259);    b = ii(b, c, d, a, k[9], 21, -343485551);

      state[0] = add32(state[0], a); state[1] = add32(state[1], b);
      state[2] = add32(state[2], c); state[3] = add32(state[3], d);
    }

    function hexLE(n) {
      var s = "", i, by;
      for (i = 0; i < 4; i++) {
        by = (n >>> (i * 8)) & 0xff;
        s += (by < 16 ? "0" : "") + by.toString(16);
      }
      return s;
    }

    var state = [1732584193, -271733879, -1732584194, 271733878];
    var len = bytes.length, i, j, p;
    var chunk = new Array(16);
    var full = len - (len % 64);

    for (i = 0; i < full; i += 64) {
      for (j = 0; j < 16; j++) {
        p = i + j * 4;
        chunk[j] = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24);
      }
      cycle(state, chunk);
    }

    var tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var rem = len - full;
    for (i = 0; i < rem; i++) tail[i >> 2] |= bytes[full + i] << ((i % 4) * 8);
    tail[rem >> 2] |= 0x80 << ((rem % 4) * 8);
    if (rem > 55) {
      cycle(state, tail);
      for (i = 0; i < 16; i++) tail[i] = 0;
    }
    tail[14] = (len * 8) >>> 0;                 // 비트 길이 하위 32
    tail[15] = Math.floor(len / 0x20000000) >>> 0; // 비트 길이 상위 32
    cycle(state, tail);

    return hexLE(state[0]) + hexLE(state[1]) + hexLE(state[2]) + hexLE(state[3]);
  }

  // ArrayBuffer(SHA digest) → 소문자 hex
  function bufToHex(buffer) {
    var view = new Uint8Array(buffer), s = "", i;
    for (i = 0; i < view.length; i++) {
      var h = view[i].toString(16);
      s += (h.length < 2 ? "0" : "") + h;
    }
    return s;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }

  /* ---------- Web Crypto 가용성 (비보안 컨텍스트/HTTP 에서는 SHA 불가) ---------- */
  var cryptoOk = !!(window.crypto && window.crypto.subtle);
  if (typeof window.isSecureContext === "boolean" && !window.isSecureContext) cryptoOk = false;

  /* ---------- DOM 참조 ---------- */
  var textEl    = document.getElementById("hg-text");
  var fileEl    = document.getElementById("hg-file");
  var dropEl    = document.getElementById("hg-drop");
  var fileMeta  = document.getElementById("hg-file-meta");
  var fileInfo  = document.getElementById("hg-file-info");
  var rehashBtn = document.getElementById("hg-rehash");
  var verifyEl  = document.getElementById("hg-verify");
  var caseLowerBtn = document.getElementById("case-lower");
  var caseUpperBtn = document.getElementById("case-upper");
  var copyAllBtn   = document.getElementById("hg-copy-all");
  var tabText   = document.getElementById("tab-text");
  var tabFile   = document.getElementById("tab-file");
  var panelText = document.getElementById("panel-text");
  var panelFile = document.getElementById("panel-file");
  var bannerEl  = document.getElementById("hg-banner");
  var noteEl    = document.getElementById("hg-note");
  var feedbackEl= document.getElementById("hg-feedback");
  var verifyMsg = document.getElementById("hg-verify-msg");

  // 알고리즘별 카드 요소 캐시
  var cardEl = {}, cardHex = {}, cardMatch = {};
  ALGOS.forEach(function (a) {
    var card = document.querySelector('.hg-card[data-algo="' + a.id + '"]');
    cardEl[a.id]    = card;
    cardHex[a.id]   = card ? card.querySelector(".hg-hex") : null;
    cardMatch[a.id] = card ? card.querySelector(".hg-match") : null;
  });

  /* ---------- 상태 ---------- */
  var caseMode   = "lower";   // "lower" | "upper"
  var activeTab  = "text";    // "text" | "file"
  var currentHex = {};        // id -> 소문자 hex | null(사용불가) | undefined(입력없음/계산중)
  var currentFile = null;
  var seq = 0;                // 최신 계산 토큰 (경합 방지)

  /* ---------- 임시 메시지 유틸 ---------- */
  var timers = [];
  function showMsg(el, msg, kind) {
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
    el.style.color = kind === "err" ? "#b91c1c" : (kind === "warn" ? "#b45309" : "var(--accent)");
    clearElTimer(el);
    if (kind !== "err" && kind !== "warn") {
      var id = setTimeout(function () { el.hidden = true; }, 2000);
      timers.push({ el: el, id: id });
    }
  }
  function clearElTimer(el) {
    for (var i = timers.length - 1; i >= 0; i--) {
      if (timers[i].el === el) { clearTimeout(timers[i].id); timers.splice(i, 1); }
    }
  }
  function hide(el) { if (el) { el.hidden = true; el.textContent = ""; } }

  /* ---------- 렌더링 ---------- */
  function displayHex(hex) { return caseMode === "upper" ? hex.toUpperCase() : hex; }

  function renderAlgo(id) {
    var hexEl = cardHex[id];
    if (!hexEl) return;
    var v = currentHex[id];
    if (typeof v === "string" && v) {
      hexEl.textContent = displayHex(v);
      hexEl.style.opacity = "1";
    } else if (v === null) {
      hexEl.textContent = t("tool.rowNa");
      hexEl.style.opacity = ".6";
    } else {
      hexEl.textContent = "—";
      hexEl.style.opacity = ".5";
    }
  }
  function renderAll() { ALGOS.forEach(function (a) { renderAlgo(a.id); }); }

  function setMatch(id, on) {
    if (cardMatch[id]) cardMatch[id].hidden = !on;
    if (cardEl[id]) {
      cardEl[id].style.borderColor = on ? "#16a34a" : "var(--line)";
      cardEl[id].style.background  = on ? "rgba(22,163,74,0.08)" : "var(--bg)";
    }
  }

  function applyVerify() {
    var val = (verifyEl.value || "").trim().toLowerCase();
    var anyMatch = false, anyHex = false;
    ALGOS.forEach(function (a) {
      var hv = currentHex[a.id];
      var on = false;
      if (val && typeof hv === "string" && hv) {
        anyHex = true;
        if (hv === val) { on = true; anyMatch = true; }
      }
      setMatch(a.id, on);
    });
    if (!val || !anyHex) { hide(verifyMsg); return; }
    verifyMsg.hidden = false;
    if (anyMatch) {
      verifyMsg.textContent = t("tool.msg.verifyMatch");
      verifyMsg.style.color = "#16a34a";
    } else {
      verifyMsg.textContent = t("tool.msg.verifyNoMatch");
      verifyMsg.style.color = "#b45309";
    }
  }

  /* ---------- 계산 ---------- */
  function clearOutputs() {
    seq++;                       // 진행 중 async 결과 무효화
    currentHex = {};
    renderAll();
    applyVerify();
  }

  function computeAll(bytes) {
    if (!bytes || bytes.length === undefined) { clearOutputs(); return; }
    var token = ++seq;
    currentHex = {};             // 이전 입력 결과 잔상 제거
    // MD5 (동기)
    currentHex.md5 = md5(bytes);
    renderAlgo("md5");
    // SHA 계열
    ALGOS.forEach(function (a) {
      if (!a.sub) return;
      if (!cryptoOk) { currentHex[a.id] = null; renderAlgo(a.id); return; }
      renderAlgo(a.id);          // 계산 중 "—" 표시
      window.crypto.subtle.digest(a.sub, bytes).then(function (buf) {
        if (token !== seq) return;   // 오래된 결과 무시
        currentHex[a.id] = bufToHex(buf);
        renderAlgo(a.id);
        applyVerify();
      }).catch(function () {
        if (token !== seq) return;
        currentHex[a.id] = null;
        renderAlgo(a.id);
      });
    });
    applyVerify();
  }

  function recomputeActive() {
    if (activeTab === "text") {
      var v = textEl.value;
      if (v === "") { clearOutputs(); return; }
      computeAll(new TextEncoder().encode(v));
    } else {
      if (currentFile) computeFromFile(currentFile);
      else clearOutputs();
    }
  }

  /* ---------- 파일 처리 ---------- */
  function computeFromFile(file) {
    hide(noteEl);
    if (!file) { clearOutputs(); return; }
    currentFile = file;
    fileMeta.hidden = false;
    fileInfo.textContent = file.name + " · " + formatSize(file.size) + " · " + (file.type || "unknown");
    if (file.size > LARGE_FILE) showMsg(noteEl, t("tool.msg.largeFile"), "warn");
    var reader = new FileReader();
    reader.onload = function () {
      try {
        computeAll(new Uint8Array(reader.result));
      } catch (e) {
        showMsg(noteEl, t("tool.msg.readError"), "err");
      }
    };
    reader.onerror = function () { showMsg(noteEl, t("tool.msg.readError"), "err"); };
    try { reader.readAsArrayBuffer(file); }
    catch (e) { showMsg(noteEl, t("tool.msg.readError"), "err"); }
  }

  /* ---------- 복사 ---------- */
  function copyValue(value) {
    if (!value) { showMsg(feedbackEl, t("tool.msg.nothingToCopy"), "warn"); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(
        function () { showMsg(feedbackEl, t("tool.msg.copied"), "ok"); },
        function () { fallbackCopy(value); }
      );
    } else {
      fallbackCopy(value);
    }
  }
  function fallbackCopy(value) {
    try {
      var ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      showMsg(feedbackEl, ok ? t("tool.msg.copied") : t("tool.msg.copyError"), ok ? "ok" : "err");
    } catch (e) {
      showMsg(feedbackEl, t("tool.msg.copyError"), "err");
    }
  }

  /* ---------- 대소문자 토글 ---------- */
  function setCase(mode) {
    caseMode = mode === "upper" ? "upper" : "lower";
    var lo = caseMode === "lower";
    styleToggle(caseLowerBtn, lo);
    styleToggle(caseUpperBtn, !lo);
    renderAll();                 // 재계산 없이 표시만 갱신
    try { localStorage.setItem(CASE_KEY, caseMode); } catch (e) { /* private mode */ }
  }
  function styleToggle(btn, active) {
    if (!btn) return;
    btn.style.background  = active ? "var(--accent)" : "var(--bg)";
    btn.style.color       = active ? "#fff" : "var(--ink)";
    btn.style.borderColor = active ? "var(--accent)" : "var(--line)";
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }

  /* ---------- 탭 전환 ---------- */
  function selectTab(which) {
    activeTab = which === "file" ? "file" : "text";
    var isText = activeTab === "text";
    panelText.hidden = !isText;
    panelFile.hidden = isText;
    styleTab(tabText, isText);
    styleTab(tabFile, !isText);
    try { localStorage.setItem(TAB_KEY, activeTab); } catch (e) { /* noop */ }
    recomputeActive();
  }
  function styleTab(btn, active) {
    if (!btn) return;
    btn.style.background  = active ? "var(--accent)" : "var(--bg)";
    btn.style.color       = active ? "#fff" : "var(--ink)";
    btn.style.borderColor = active ? "var(--accent)" : "var(--line)";
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }

  /* ---------- 이벤트 배선 ---------- */
  var debTimer = null;
  if (textEl) {
    textEl.addEventListener("input", function () {
      if (debTimer) clearTimeout(debTimer);
      debTimer = setTimeout(function () {
        if (textEl.value === "") clearOutputs();
        else computeAll(new TextEncoder().encode(textEl.value));
      }, DEBOUNCE);
    });
  }
  if (fileEl) fileEl.addEventListener("change", function () {
    computeFromFile(fileEl.files && fileEl.files[0]);
  });
  if (dropEl) {
    ["dragenter", "dragover"].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault(); dropEl.style.borderColor = "var(--accent)"; dropEl.style.color = "var(--accent)";
      });
    });
    ["dragleave", "dragend", "drop"].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault(); dropEl.style.borderColor = "var(--line)"; dropEl.style.color = "var(--muted)";
      });
    });
    dropEl.addEventListener("drop", function (e) {
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) computeFromFile(dt.files[0]);
    });
    dropEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileEl.click(); }
    });
  }
  if (rehashBtn) rehashBtn.addEventListener("click", function () {
    if (currentFile) computeFromFile(currentFile);
  });
  if (verifyEl) verifyEl.addEventListener("input", applyVerify);
  if (caseLowerBtn) caseLowerBtn.addEventListener("click", function () { setCase("lower"); });
  if (caseUpperBtn) caseUpperBtn.addEventListener("click", function () { setCase("upper"); });
  if (copyAllBtn) copyAllBtn.addEventListener("click", function () {
    var lines = [], LABEL = { md5: "MD5", sha1: "SHA-1", sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" };
    ALGOS.forEach(function (a) {
      var v = currentHex[a.id];
      if (typeof v === "string" && v) lines.push(LABEL[a.id] + ": " + displayHex(v));
    });
    copyValue(lines.join("\n"));
  });
  // 개별 행 Copy 버튼
  var copyBtns = document.querySelectorAll(".hg-copy");
  for (var ci = 0; ci < copyBtns.length; ci++) {
    copyBtns[ci].addEventListener("click", function () {
      var id = this.getAttribute("data-algo");
      var v = currentHex[id];
      copyValue(typeof v === "string" && v ? displayHex(v) : "");
    });
  }
  if (tabText) tabText.addEventListener("click", function () { selectTab("text"); });
  if (tabFile) tabFile.addEventListener("click", function () { selectTab("file"); });

  /* ---------- 언어 전환 시 동적 문구 재적용 ---------- */
  document.addEventListener("i18n:change", function () {
    renderAll();       // "—"/사용불가 문구 갱신
    applyVerify();     // verify 메시지 갱신
  });

  /* ---------- 초기화 ---------- */
  (function init() {
    try {
      var c = localStorage.getItem(CASE_KEY);
      if (c === "upper" || c === "lower") caseMode = c;
    } catch (e) { /* noop */ }
    setCase(caseMode);

    var startTab = "text";
    try {
      var tv = localStorage.getItem(TAB_KEY);
      if (tv === "text" || tv === "file") startTab = tv;
    } catch (e) { /* noop */ }

    if (!cryptoOk && bannerEl) bannerEl.hidden = false;

    // selectTab 이 recomputeActive 를 호출 → 초기엔 빈 입력이라 "—" placeholder 유지
    selectTab(startTab);
  })();
  // TOOLJS:END
})();
