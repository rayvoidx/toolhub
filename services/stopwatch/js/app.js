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
  var SLUG = cfg.slug || "stopwatch";
  var LS_STATE = SLUG + ":state";      // 상태 저장은 "<slug>:" prefix 만 사용

  var MAX_LAPS = 99;                   // 렌더 성능 보호 상한
  var CAP_CS = 35999999;              // 99:59:59.99 = 센티초 상한 (오버플로 캡)

  // en 원문(baked) 폴백 — i18n 카탈로그가 우선 (tr() 참조)
  var LABEL_START = "Start", LABEL_RESUME = "Resume", LABEL_PAUSE = "Pause";
  var LABEL_LAP = "Lap", LABEL_RESET = "Reset";
  var LABEL_COPY = "Copy results", LABEL_COPIED = "Copied!";
  var MSG_MAX = "Lap limit reached (99). Reset to record more laps.";
  var MSG_NO_STORAGE = "Times can't be saved (private browsing) — they'll last for this session only.";
  var MSG_COPY_FAIL = "Couldn't copy automatically — the results are shown below; select and copy them manually.";

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  // 표시: MM:SS.cc, 1시간 이상이면 H:MM:SS.cc. 99시간 초과는 "99:59:59.99+" 캡.
  function formatTime(ms) {
    var cs = Math.floor(Math.max(0, ms) / 10); // 센티초(1/100초)
    var capped = false;
    if (cs > CAP_CS) { cs = CAP_CS; capped = true; }
    var c = cs % 100;
    var totalSec = Math.floor(cs / 100);
    var s = totalSec % 60;
    var totalMin = Math.floor(totalSec / 60);
    var m = totalMin % 60;
    var h = Math.floor(totalMin / 60);
    var body = h > 0
      ? h + ":" + pad2(m) + ":" + pad2(s) + "." + pad2(c)
      : pad2(m) + ":" + pad2(s) + "." + pad2(c);
    return capped ? body + "+" : body;
  }
  // 타임스탬프 재계산 방식 — 시스템 시계 역행 시 max(0,...) 클램프
  function computeElapsed(accumulated, startEpochMs, running, now) {
    if (!running) return Math.max(0, accumulated);
    return Math.max(0, accumulated + (now - startEpochMs));
  }
  // 랩 누적값 배열 → 구간(split) 배열. split[i] = laps[i] - laps[i-1]
  function computeSplits(laps) {
    var out = [];
    for (var i = 0; i < laps.length; i++) out.push(i === 0 ? laps[0] : laps[i] - laps[i - 1]);
    return out;
  }
  // 구간 배열에서 최단/최장 인덱스 (랩 2개 이상일 때만 의미 있음)
  function extremeSplitIdx(splits) {
    if (splits.length < 2) return { min: -1, max: -1 };
    var minI = 0, maxI = 0;
    for (var i = 1; i < splits.length; i++) {
      if (splits[i] < splits[minI]) minI = i;
      if (splits[i] > splits[maxI]) maxI = i;
    }
    return { min: minI, max: maxI };
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      formatTime: formatTime, computeElapsed: computeElapsed,
      computeSplits: computeSplits, extremeSplitIdx: extremeSplitIdx
    };
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var display = $("sw-display");
  var startPauseBtn = $("startpause-btn"), lapResetBtn = $("lapreset-btn");
  var copyBtn = $("copy-btn"), copyArea = $("sw-copy-area");
  var msgEl = $("sw-msg");
  var lapCountEl = $("sw-lap-count");
  var lapsEmpty = $("sw-laps-empty"), lapsTable = $("sw-laps-table"), lapsBody = $("sw-laps-body");
  if (!display || !startPauseBtn || !lapResetBtn) return;

  /* ---- 상태 (running·accumulated·startEpochMs·laps 만 진실, 나머지는 파생) ---- */
  var running = false;
  var accumulated = 0;                 // 정지 구간까지 누적된 ms
  var startEpochMs = 0;                // 마지막 시작 시각 (running 일 때만 유효)
  var laps = [];                       // 랩별 누적 elapsed(ms) 배열
  var rafId = null;
  var storageOk = true;

  /* ---- i18n 헬퍼 ---- */
  function tr(key, fallback) {
    try {
      if (window.I18N) { var v = window.I18N.t(key); if (v != null) return v; }
    } catch (e) { /* i18n 부재 시 폴백 */ }
    return fallback;
  }

  /* ---- 안내 문구 (.result) — 조용한 실패 금지 ---- */
  var notices = [];                    // { key, fallback } — i18n 전환 시 재번역
  function renderNotices() {
    if (!msgEl) return;
    if (!notices.length) { msgEl.hidden = true; msgEl.textContent = ""; return; }
    var parts = [];
    for (var i = 0; i < notices.length; i++) parts.push(tr(notices[i].key, notices[i].fallback));
    msgEl.textContent = parts.join(" · ");
    msgEl.hidden = false;
  }
  function addNotice(key, fallback) {
    for (var i = 0; i < notices.length; i++) if (notices[i].key === key) return;
    notices.push({ key: key, fallback: fallback });
    renderNotices();
  }
  function removeNotice(key) {
    for (var i = 0; i < notices.length; i++) {
      if (notices[i].key === key) { notices.splice(i, 1); renderNotices(); return; }
    }
  }

  /* ---- 영속화 (localStorage "<slug>:state") ---- */
  function saveState() {
    var payload = { running: running, accumulated: accumulated, startEpochMs: startEpochMs, laps: laps };
    try {
      localStorage.setItem(LS_STATE, JSON.stringify(payload));
      storageOk = true;
    } catch (e) {
      // 세션 메모리 폴백(변수가 세션 상태를 유지) + 명시적 안내
      if (storageOk) { storageOk = false; addNotice("tool.msg.noStorage", MSG_NO_STORAGE); }
    }
  }
  function isFiniteNum(n) { return typeof n === "number" && isFinite(n); }
  function loadState() {
    var raw;
    try { raw = localStorage.getItem(LS_STATE); }
    catch (e) { storageOk = false; addNotice("tool.msg.noStorage", MSG_NO_STORAGE); return; }
    if (!raw) return;
    try {
      var p = JSON.parse(raw);
      if (!p || typeof p !== "object") return;                 // 손상 → 무해 초기화(기본값 유지)
      if (!isFiniteNum(p.accumulated) || p.accumulated < 0) return;
      if (!isFiniteNum(p.startEpochMs) || p.startEpochMs < 0) return;
      var okLaps = [];
      if (Object.prototype.toString.call(p.laps) === "[object Array]") {
        for (var i = 0; i < p.laps.length && okLaps.length < MAX_LAPS; i++) {
          if (isFiniteNum(p.laps[i]) && p.laps[i] >= 0) okLaps.push(p.laps[i]);
        }
      }
      accumulated = p.accumulated;
      laps = okLaps;
      if (p.running === true) {
        running = true;
        startEpochMs = p.startEpochMs;
        // 미래 시각(시계 이상)이면 지금으로 클램프 — 음수 경과 방지
        if (startEpochMs > Date.now()) startEpochMs = Date.now();
      } else {
        running = false;
        startEpochMs = 0;
      }
    } catch (e) { /* 파싱 실패 → 기본값 (무해 초기화) */ }
  }

  /* ---- 뷰 ---- */
  function currentElapsed() { return computeElapsed(accumulated, startEpochMs, running, Date.now()); }
  function renderDisplay() { display.textContent = formatTime(currentElapsed()); }

  function updateButtons() {
    // 우측 = Start/Pause 토글
    var spKey = running ? "tool.pause" : (currentElapsed() > 0 || laps.length > 0 ? "tool.resume" : "tool.start");
    var spFallback = running ? LABEL_PAUSE : (currentElapsed() > 0 || laps.length > 0 ? LABEL_RESUME : LABEL_START);
    startPauseBtn.setAttribute("data-i18n", spKey);
    startPauseBtn.textContent = tr(spKey, spFallback);
    startPauseBtn.style.background = running ? "var(--muted)" : "";
    // 좌측 = 실행 중 Lap / 정지 중 Reset
    var lrKey = running ? "tool.lap" : "tool.reset";
    var lrFallback = running ? LABEL_LAP : LABEL_RESET;
    lapResetBtn.setAttribute("data-i18n", lrKey);
    lapResetBtn.textContent = tr(lrKey, lrFallback);
    // 정지 상태에서 초기화할 것이 없으면(경과 0·랩 0) Reset 비활성
    var nothingToReset = !running && currentElapsed() === 0 && laps.length === 0;
    // 실행 중 랩이 상한이면 Lap 비활성
    var lapFull = running && laps.length >= MAX_LAPS;
    lapResetBtn.disabled = nothingToReset || lapFull;
  }

  function renderLaps() {
    var n = laps.length;
    if (lapCountEl) lapCountEl.textContent = String(n);
    if (copyBtn) copyBtn.hidden = n === 0;
    if (n === 0) {
      if (lapsEmpty) lapsEmpty.hidden = false;
      if (lapsTable) lapsTable.hidden = true;
      lapsBody.innerHTML = "";
      if (copyArea) { copyArea.hidden = true; copyArea.value = ""; }
      return;
    }
    if (lapsEmpty) lapsEmpty.hidden = true;
    if (lapsTable) lapsTable.hidden = false;
    var splits = computeSplits(laps);
    var ext = extremeSplitIdx(splits);
    var html = "";
    for (var i = n - 1; i >= 0; i--) {              // 최신 랩이 위
      var color = "";
      if (i === ext.min) color = "color:#16a34a;font-weight:700;";      // 최단 = 초록
      else if (i === ext.max) color = "color:#ef4444;font-weight:700;"; // 최장 = 빨강
      html += "<tr style='border-bottom:1px solid var(--line);'>" +
        "<td style='text-align:left;padding:9px 6px;'>" + (i + 1) + "</td>" +
        "<td style='text-align:right;padding:9px 6px;" + color + "'>" + formatTime(splits[i]) + "</td>" +
        "<td style='text-align:right;padding:9px 6px;color:var(--muted);'>" + formatTime(laps[i]) + "</td>" +
        "</tr>";
    }
    lapsBody.innerHTML = html;
  }

  function renderAll() { renderDisplay(); updateButtons(); renderLaps(); }

  /* ---- rAF 루프 (setInterval 틱 누적 금지 — 표시는 매 프레임 재계산) ---- */
  function loop() {
    if (!running) { rafId = null; return; }
    renderDisplay();
    rafId = (window.requestAnimationFrame || function (f) { return setTimeout(f, 33); })(loop);
  }
  function startLoop() { if (rafId == null) rafId = (window.requestAnimationFrame || function (f) { return setTimeout(f, 33); })(loop); }
  function stopLoop() {
    if (rafId != null) { (window.cancelAnimationFrame || clearTimeout)(rafId); rafId = null; }
  }

  /* ---- 전이 ---- */
  function toggleStartPause() {
    if (running) {                                  // 일시정지
      accumulated = currentElapsed();
      running = false;
      startEpochMs = 0;
      stopLoop();
    } else {                                         // 시작/재개
      startEpochMs = Date.now();                     // 시작 시각 확정 — 이후는 재계산만
      running = true;
      startLoop();
    }
    saveState();
    renderAll();
  }
  function lap() {
    if (!running) return;
    if (laps.length >= MAX_LAPS) { addNotice("tool.msg.maxLaps", MSG_MAX); updateButtons(); return; }
    laps.push(currentElapsed());
    if (laps.length >= MAX_LAPS) addNotice("tool.msg.maxLaps", MSG_MAX);
    saveState();
    renderLaps();
    updateButtons();
  }
  function reset() {
    running = false;
    accumulated = 0;
    startEpochMs = 0;
    laps = [];
    stopLoop();
    removeNotice("tool.msg.maxLaps");
    if (copyArea) { copyArea.hidden = true; copyArea.value = ""; }
    saveState();
    renderAll();
  }

  /* ---- 기록 복사 (탭 구분: 랩번호 \t 구간 \t 누적) ---- */
  function buildCopyText() {
    var splits = computeSplits(laps);
    var header = tr("tool.thLap", "Lap") + "\t" + tr("tool.thSplit", "Split") + "\t" + tr("tool.thTotal", "Total");
    var rows = [header];
    for (var i = 0; i < laps.length; i++) {
      rows.push((i + 1) + "\t" + formatTime(splits[i]) + "\t" + formatTime(laps[i]));
    }
    return rows.join("\n");
  }
  function flashCopied() {
    var restore = tr("tool.copy", LABEL_COPY);
    copyBtn.textContent = tr("tool.copied", LABEL_COPIED);
    setTimeout(function () { copyBtn.textContent = tr("tool.copy", restore); }, 1400);
  }
  function fallbackCopy(text) {                      // clipboard 불가 시 textarea + execCommand
    if (!copyArea) { addNotice("tool.msg.copyFail", MSG_COPY_FAIL); return; }
    copyArea.value = text;
    copyArea.hidden = false;
    copyArea.removeAttribute("aria-hidden");
    try {
      copyArea.focus();
      copyArea.select();
      copyArea.setSelectionRange(0, text.length);
      var ok = document.execCommand && document.execCommand("copy");
      if (ok) {
        copyArea.hidden = true;
        copyArea.setAttribute("aria-hidden", "true");
        removeNotice("tool.msg.copyFail");
        flashCopied();
        return;
      }
    } catch (e) { /* 폴백도 실패 — 아래에서 수동 안내 */ }
    addNotice("tool.msg.copyFail", MSG_COPY_FAIL);  // textarea 를 남겨 수동 복사 가능
  }
  function copyResults() {
    if (laps.length === 0) return;
    var text = buildCopyText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        removeNotice("tool.msg.copyFail");
        if (copyArea) { copyArea.hidden = true; copyArea.value = ""; }
        flashCopied();
      }).catch(function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  /* ---- 이벤트 ---- */
  startPauseBtn.addEventListener("click", toggleStartPause);
  lapResetBtn.addEventListener("click", function () { if (running) lap(); else reset(); });
  if (copyBtn) copyBtn.addEventListener("click", copyResults);

  // 키보드 단축키: Space=시작/일시정지, L=랩, R=초기화 (e.code — IME 무관)
  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;             // 브라우저 단축키는 방해 안 함
    var ae = document.activeElement;
    var tag = (ae && ae.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (ae && ae.isContentEditable)) return;
    if (e.code === "Space") { e.preventDefault(); toggleStartPause(); }
    else if (e.code === "KeyL") { e.preventDefault(); if (running) lap(); }
    else if (e.code === "KeyR") { e.preventDefault(); reset(); }
  });

  // 백그라운드 복귀 시 즉시 재계산 (rAF 는 배경 탭에서 멈추므로 표시 갱신)
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && running) { renderDisplay(); startLoop(); }
  });

  // 언어 전환 시 동적 문구 재번역 (라벨류·헤더는 data-i18n 훅으로 엔진이 처리)
  document.addEventListener("i18n:change", function () {
    renderNotices();
    updateButtons();
    if (copyBtn && !copyBtn.hidden) copyBtn.textContent = tr("tool.copy", LABEL_COPY);
  });

  /* ---- 초기화: 저장 상태 복원 (새로고침 무손실) → 없으면 00:00.00 ---- */
  loadState();
  if (running) startLoop();
  if (laps.length >= MAX_LAPS) addNotice("tool.msg.maxLaps", MSG_MAX);
  renderAll();
  // TOOLJS:END
})();
