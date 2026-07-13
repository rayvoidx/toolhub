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
  var cfg  = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "uuid-gen";
  var NIL  = "00000000-0000-0000-0000-000000000000";

  // 안전 난수 가용성 — 없으면 절대 Math.random 으로 폴백하지 않는다.
  var C = (typeof crypto !== "undefined") ? crypto : null;
  var hasSecure = !!(C && typeof C.getRandomValues === "function");

  // DOM
  var warnEl     = document.getElementById("uuid-warn");
  var versionEl  = document.getElementById("uuid-version");
  var countEl    = document.getElementById("uuid-count");
  var genBtn     = document.getElementById("uuid-generate");
  var noteEl     = document.getElementById("uuid-count-note");
  var upperEl    = document.getElementById("uuid-upper");
  var hyphensEl  = document.getElementById("uuid-hyphens");
  var bracesEl   = document.getElementById("uuid-braces");
  var statusEl   = document.getElementById("uuid-status");
  var copyAllBtn = document.getElementById("uuid-copyall");
  var listEl     = document.getElementById("uuid-list");
  var toastEl    = document.getElementById("uuid-toast");

  var currentBatch = []; // [{ canonical, isNil }] — 생성값은 여기(메모리)만, localStorage 저장 금지 (one-shot)

  // ---- i18n 헬퍼 (누락 키는 원문 폴백) ----
  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }

  // ---- 바이트 → canonical(소문자·하이픈) UUID 문자열 ----
  function bytesToUuid(b) {
    var h = [];
    for (var i = 0; i < 16; i++) h.push((b[i] + 0x100).toString(16).slice(1));
    return h[0] + h[1] + h[2] + h[3] + "-" + h[4] + h[5] + "-" +
           h[6] + h[7] + "-" + h[8] + h[9] + "-" +
           h[10] + h[11] + h[12] + h[13] + h[14] + h[15];
  }

  // ---- UUID v4 (crypto.randomUUID 우선, 아니면 getRandomValues + RFC 4122 비트) ----
  function uuidV4() {
    if (C && typeof C.randomUUID === "function") {
      try { return C.randomUUID(); } catch (e) { /* 폴백 진행 */ }
    }
    var b = new Uint8Array(16);
    C.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
    return bytesToUuid(b);
  }

  // 48-bit Unix ms 타임스탬프를 바이트 0-5(big-endian)에 기록
  function writeTs(b, ms) {
    b[0] = Math.floor(ms / 0x10000000000) & 0xff;
    b[1] = Math.floor(ms / 0x100000000) & 0xff;
    b[2] = Math.floor(ms / 0x1000000) & 0xff;
    b[3] = Math.floor(ms / 0x10000) & 0xff;
    b[4] = Math.floor(ms / 0x100) & 0xff;
    b[5] = ms & 0xff;
  }

  // 동일 ms 충돌 시 난수 꼬리를 +1 (배치 내 단조 증가), version·variant 는 복원
  function bumpTail(b) {
    for (var i = 15; i >= 6; i--) {
      b[i] = (b[i] + 1) & 0xff;
      if (b[i] !== 0) break; // carry 없음
    }
    b[6] = (b[6] & 0x0f) | 0x70; // version 7
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  }

  // UUID v7 배치 생성기 — 같은 ms 안에서 단조 증가 보장
  function makeV7() {
    var lastMs = -1;
    var last = null;
    return function next() {
      var ms = Date.now();
      var b;
      if (last && ms <= lastMs) {           // 같은 ms(충돌) 또는 시계 역행 → ts 유지, 꼬리 증가
        b = last.slice(0);
        bumpTail(b);
      } else {                              // ms 진행 → 새 난수
        b = new Uint8Array(16);
        C.getRandomValues(b);
        writeTs(b, ms);
        b[6] = (b[6] & 0x0f) | 0x70;        // version 7
        b[8] = (b[8] & 0x3f) | 0x80;        // variant 10xx
        lastMs = ms;
      }
      last = b.slice(0);
      return bytesToUuid(b);
    };
  }

  // ---- 포맷 토글을 렌더 시점에 적용 (재생성 없음) ----
  function formatUuid(canonical, isNil) {
    if (isNil) return canonical; // NIL 은 포맷 토글 무시 (spec) — 항상 canonical
    var s = canonical;
    if (upperEl.checked) s = s.toUpperCase();
    if (!hyphensEl.checked) s = s.replace(/-/g, "");
    if (bracesEl.checked) s = "{" + s + "}";
    return s;
  }

  // ---- 클립보드 (navigator.clipboard 우선, execCommand 폴백) ----
  var toastTimer = null;
  function showToast(msg, isError) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = "uuid-toast " + (isError ? "is-error" : "is-ok");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.textContent = ""; toastEl.className = "uuid-toast"; }, 2200);
  }

  function copyText(text, onOk) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onOk, function () { fallbackCopy(text, onOk); });
    } else {
      fallbackCopy(text, onOk);
    }
  }

  function fallbackCopy(text, onOk) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok && onOk) onOk();
      else showToast(t("tool.copyError"), true);
    } catch (e) {
      showToast(t("tool.copyError"), true);
    }
  }

  // ---- 렌더 ----
  function renderBatch() {
    listEl.innerHTML = "";
    if (!currentBatch.length) {
      statusEl.textContent = t("tool.emptyHint");
      copyAllBtn.hidden = true;
      return;
    }
    var frag = document.createDocumentFragment();
    for (var i = 0; i < currentBatch.length; i++) {
      var item = currentBatch[i];
      var formatted = formatUuid(item.canonical, item.isNil);
      var li = document.createElement("li");
      li.className = "uuid-item";
      var span = document.createElement("span");
      span.className = "uuid-value";
      span.textContent = formatted;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "uuid-copy";
      btn.textContent = t("tool.copy");
      btn.setAttribute("aria-label", t("tool.copyRow"));
      btn.setAttribute("data-value", formatted);
      li.appendChild(span);
      li.appendChild(btn);
      frag.appendChild(li);
    }
    listEl.appendChild(frag);
    statusEl.textContent = t("tool.generated").replace("{n}", String(currentBatch.length));
    copyAllBtn.hidden = false;
  }

  // ---- 생성 ----
  function clampCount() {
    var raw = String(countEl.value || "").trim();
    var n = parseInt(raw, 10);
    if (raw === "" || isNaN(n) || n < 1) {
      countEl.value = "1";
      noteEl.textContent = t("tool.minNote");
      noteEl.hidden = false;
      return 1;
    }
    if (n > 500) {
      countEl.value = "500";
      noteEl.textContent = t("tool.maxNote");
      noteEl.hidden = false;
      return 500;
    }
    countEl.value = String(n);
    noteEl.hidden = true;
    noteEl.textContent = "";
    return n;
  }

  function generate() {
    if (!hasSecure) return; // 안전 난수 없으면 생성하지 않음 (조용한 실패 아님 — 배너로 안내)
    var n = clampCount();
    var version = versionEl.value;
    var batch = [];
    var i;
    if (version === "nil") {
      for (i = 0; i < n; i++) batch.push({ canonical: NIL, isNil: true });
    } else if (version === "v7") {
      var next = makeV7();
      for (i = 0; i < n; i++) batch.push({ canonical: next(), isNil: false });
    } else {
      for (i = 0; i < n; i++) batch.push({ canonical: uuidV4(), isNil: false });
    }
    currentBatch = batch;
    savePrefs();
    renderBatch();
  }

  // ---- 환경설정 저장/복원 (버전·포맷만. 생성값은 저장 안 함) ----
  function savePrefs() {
    try {
      localStorage.setItem(SLUG + ":version", versionEl.value);
      localStorage.setItem(SLUG + ":upper",   upperEl.checked   ? "1" : "0");
      localStorage.setItem(SLUG + ":hyphens", hyphensEl.checked ? "1" : "0");
      localStorage.setItem(SLUG + ":braces",  bracesEl.checked  ? "1" : "0");
    } catch (e) { /* private mode — noop */ }
  }

  function loadPrefs() {
    try {
      var v = localStorage.getItem(SLUG + ":version");
      if (v === "v4" || v === "v7" || v === "nil") versionEl.value = v;
      var u = localStorage.getItem(SLUG + ":upper");
      var h = localStorage.getItem(SLUG + ":hyphens");
      var b = localStorage.getItem(SLUG + ":braces");
      if (u !== null) upperEl.checked   = u === "1";
      if (h !== null) hyphensEl.checked = h === "1";
      if (b !== null) bracesEl.checked  = b === "1";
    } catch (e) { /* noop */ }
  }

  // ---- 이벤트 ----
  listEl.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest(".uuid-copy") : null;
    if (!btn) return;
    var val = btn.getAttribute("data-value");
    if (!val) return;
    copyText(val, function () {
      btn.textContent = t("tool.copied");
      btn.classList.add("is-copied");
      setTimeout(function () {
        btn.textContent = t("tool.copy");
        btn.classList.remove("is-copied");
      }, 1500);
    });
  });

  copyAllBtn.addEventListener("click", function () {
    if (!currentBatch.length) { showToast(t("tool.emptyHint"), true); return; }
    var lines = currentBatch.map(function (it) { return formatUuid(it.canonical, it.isNil); });
    copyText(lines.join("\n"), function () { showToast(t("tool.copiedAll"), false); });
  });

  genBtn.addEventListener("click", generate);

  countEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); generate(); }
  });

  versionEl.addEventListener("change", savePrefs);

  // 포맷 토글 → 현재 배치 재렌더(재생성 없음) + 저장
  [upperEl, hyphensEl, bracesEl].forEach(function (el) {
    el.addEventListener("change", function () { savePrefs(); renderBatch(); });
  });

  // 언어 전환 → 동적 문구(상태/복사 버튼/힌트) 재렌더
  document.addEventListener("i18n:change", function () {
    if (!noteEl.hidden) { /* 노트는 최근 클램프 사유 유지가 어려우니 언어전환 시 감춤 */ noteEl.hidden = true; }
    renderBatch();
  });

  // ---- 초기화 ----
  loadPrefs();
  if (!hasSecure) {
    warnEl.hidden = false;
    genBtn.disabled = true;
    countEl.disabled = true;
    versionEl.disabled = true;
    upperEl.disabled = true;
    hyphensEl.disabled = true;
    bracesEl.disabled = true;
    statusEl.textContent = "";
    copyAllBtn.hidden = true;
  } else {
    generate(); // 로드 즉시 1개 생성 (lede: "Click generate for a fresh RFC 4122 UUID")
  }
  // TOOLJS:END
})();
