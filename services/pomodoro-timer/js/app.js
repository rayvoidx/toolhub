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
  var SLUG = cfg.slug || "pomodoro-timer";
  var LS_SETTINGS = SLUG + ":settings"; // 상태 저장은 "<slug>:" prefix 만 사용
  var LS_TODAY = SLUG + ":today";

  var TICK_MS = 250;                    // 틱 주기 — 렌더는 초가 바뀔 때만
  var FREQ_FOCUS_END = 880;             // 집중 종료 비프 (높은 음)
  var FREQ_BREAK_END = 660;             // 휴식 종료 비프 (낮은 음)
  var DEFAULTS = { focus: 25, short: 5, long: 15, interval: 4, auto: false };

  // en baked fallback (i18n 카탈로그가 우선 — tr() 참조)
  var MSG = {
    modeFocus: "Focus",
    modeShort: "Short break",
    modeLong: "Long break",
    cycle: "Pomodoro {n} of {m}",
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    focusDone: "Focus session complete! Next: {next} — press Start.",
    breakDone: "Break over! Next: {next} — press Start.",
    overrun: "The session ended while the tab was in the background. Auto-run paused — press Start to continue.",
    noAudio: "Sound is unavailable in this browser — you'll still get the visual alert.",
    noStorage: "Storage is unavailable (private browsing) — settings and today's count last for this session only."
  };

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // 숫자 외 문자는 무시, 빈 값은 기본값, 범위 밖은 min/max 로 clamp
  function clampInt(raw, min, max, dflt) {
    var digits = String(raw == null ? "" : raw).replace(/[^\d]/g, "");
    if (!digits) return dflt;
    var n = parseInt(digits, 10);
    if (isNaN(n)) return dflt;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }
  // 저장본 손상·범위 외 값 → 항목별 기본값 복원 (집중 1-90 / 짧은 1-30 / 긴 1-60 / 주기 2-8)
  function sanitizeSettings(raw) {
    var src = (raw && typeof raw === "object") ? raw : {};
    return {
      focus: clampInt(src.focus, 1, 90, DEFAULTS.focus),
      short: clampInt(src.short, 1, 30, DEFAULTS.short),
      long: clampInt(src.long, 1, 60, DEFAULTS.long),
      interval: clampInt(src.interval, 2, 8, DEFAULTS.interval),
      auto: src.auto === true
    };
  }
  // {date, count} — 날짜가 다르면(자정 넘김 포함) 카운트 0 으로 리셋
  function sanitizeToday(raw, dateStr) {
    var src = (raw && typeof raw === "object") ? raw : null;
    if (!src || src.date !== dateStr) return { date: dateStr, count: 0 };
    var c = parseInt(src.count, 10);
    if (isNaN(c) || c < 0) c = 0;
    if (c > 9999) c = 9999;
    return { date: dateStr, count: c };
  }
  // 잔여 ms 는 올림 (1ms 남아도 00:01) — 최대 90분이라 MM:SS 고정
  function formatMMSS(ms) {
    var sec = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(m) + ":" + p(s);
  }
  // 사이클 상태 기계: focus 완료 누적(done, 완료 "직후" 값)이 주기의 배수면 longBreak
  function nextMode(mode, focusDoneAfter, interval) {
    if (mode === "focus") return (focusDoneAfter % interval === 0) ? "long" : "short";
    return "focus";
  }
  // 사이클 내 위치 1..interval (예: "2/4번째 뽀모도로")
  function cyclePos(mode, focusDone, interval) {
    if (mode === "focus") return (focusDone % interval) + 1;
    if (focusDone <= 0) return 1;
    return ((focusDone - 1) % interval) + 1;
  }
  function localDateStr(d) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      clampInt: clampInt, sanitizeSettings: sanitizeSettings, sanitizeToday: sanitizeToday,
      formatMMSS: formatMMSS, nextMode: nextMode, cyclePos: cyclePos, localDateStr: localDateStr
    };
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var display = $("pomo-display"), modeEl = $("pomo-mode"), progressEl = $("pomo-progress");
  var cycleEl = $("pomo-cycle"), todayEl = $("pomo-today"), msgEl = $("pomo-msg");
  var startBtn = $("pomo-start"), resetBtn = $("pomo-reset"), skipBtn = $("pomo-skip");
  var inFocus = $("set-focus"), inShort = $("set-short"), inLong = $("set-long");
  var inInterval = $("set-interval"), inAuto = $("set-auto");
  if (!display || !modeEl || !cycleEl || !todayEl || !startBtn || !resetBtn || !skipBtn ||
      !inFocus || !inShort || !inLong || !inInterval || !inAuto) return;
  var bakedTitle = document.title;

  /* ---- 상태 (실행 중 세션은 저장하지 않음 — 새로고침 시 대기 상태 복귀) ---- */
  var phase = "ready";                 // ready | running | paused
  var mode = "focus";                  // focus | short | long
  var focusDone = 0;                   // 이번 방문에서 완료한 focus 수 (사이클 위치 계산용)
  var settings = sanitizeSettings(null);
  var today = { date: localDateStr(new Date()), count: 0 };
  var totalMs = 0, endTime = 0, remainMs = 0;
  var tickId = null, lastShownSec = -1;
  var audioCtx = null, audioOk = null; // null=미시도 / true / false
  var storageOk = true;

  /* ---- i18n 헬퍼 ---- */
  function tr(key, fallback) {
    try {
      if (window.I18N) {
        var v = window.I18N.t(key);
        if (v != null) return v;
      }
    } catch (e) { /* i18n 부재 시 폴백 */ }
    return fallback;
  }
  function modeKey(m) {
    return m === "focus" ? "tool.mode.focus" : (m === "short" ? "tool.mode.short" : "tool.mode.long");
  }
  function modeFallback(key) {
    return key === "tool.mode.focus" ? MSG.modeFocus
      : key === "tool.mode.short" ? MSG.modeShort : MSG.modeLong;
  }
  function modeName(m) { return tr(modeKey(m), modeFallback(modeKey(m))); }
  function baseTitle() {
    var v = tr("meta.title", null);
    return v != null ? v : bakedTitle;
  }

  /* ---- 안내 문구 (.result) — 조용한 실패 금지 ---- */
  var notices = [];                    // { key, fallback, nextKey } — i18n 전환 시 재번역
  function renderNotices() {
    if (!msgEl) return;
    if (!notices.length) { msgEl.hidden = true; msgEl.textContent = ""; return; }
    var parts = [];
    for (var i = 0; i < notices.length; i++) {
      var n = notices[i];
      var s = tr(n.key, n.fallback);
      if (n.nextKey) s = s.split("{next}").join(tr(n.nextKey, modeFallback(n.nextKey)));
      parts.push(s);
    }
    msgEl.textContent = parts.join(" · ");
    msgEl.hidden = false;
  }
  function addNotice(key, fallback, nextKey) {
    for (var i = 0; i < notices.length; i++) {
      if (notices[i].key === key) { notices[i].nextKey = nextKey || null; renderNotices(); return; }
    }
    notices.push({ key: key, fallback: fallback, nextKey: nextKey || null });
    renderNotices();
  }
  function removeNotice(key) {
    for (var i = 0; i < notices.length; i++) {
      if (notices[i].key === key) { notices.splice(i, 1); renderNotices(); return; }
    }
  }
  function clearTransient() { // 세션 전환 안내류만 제거 (noAudio/noStorage 는 유지)
    removeNotice("tool.msg.focusDone");
    removeNotice("tool.msg.breakDone");
    removeNotice("tool.msg.overrun");
  }

  /* ---- localStorage (불가 시 세션 메모리 폴백 + 명시적 안내) ---- */
  function flagNoStorage() {
    if (storageOk) { storageOk = false; addNotice("tool.msg.noStorage", MSG.noStorage, null); }
  }
  function saveSettings() {
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }
    catch (e) { flagNoStorage(); }
  }
  function loadSettings() {
    try {
      var raw = localStorage.getItem(LS_SETTINGS);
      return sanitizeSettings(raw ? JSON.parse(raw) : null);
    } catch (e) { return sanitizeSettings(null); } // 손상·불가 → 기본값 복원
  }
  function saveToday() {
    try { localStorage.setItem(LS_TODAY, JSON.stringify(today)); }
    catch (e) { flagNoStorage(); }
  }
  function loadToday() {
    var ds = localDateStr(new Date());
    try {
      var raw = localStorage.getItem(LS_TODAY);
      return sanitizeToday(raw ? JSON.parse(raw) : null, ds);
    } catch (e) { return sanitizeToday(null, ds); }
  }
  function bumpToday() {
    var ds = localDateStr(new Date());
    if (today.date !== ds) today = { date: ds, count: 0 }; // 자정 넘김 → 자동 리셋
    today.count += 1;
    saveToday();
    renderToday();
  }

  /* ---- 알림음: Web Audio 합성 (오디오 파일·CDN 없음) ---- */
  // AudioContext 는 시작 클릭(사용자 제스처)에 생성·resume — 자동재생 정책 회피
  function ensureAudio() {
    if (audioOk === false) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error("Web Audio unsupported");
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") {
        var pr = audioCtx.resume();
        if (pr && pr.catch) pr.catch(function () { /* 재개 실패 — 종료 시 재시도 */ });
      }
      audioOk = true;
      removeNotice("tool.msg.noAudio");
    } catch (e) {
      audioOk = false;
      addNotice("tool.msg.noAudio", MSG.noAudio, null); // 시각 알림만 동작
    }
  }
  function beep(freq) { // OscillatorNode 비프 3회 — 집중 종료 880Hz / 휴식 종료 660Hz
    if (audioOk !== true || !audioCtx) {
      addNotice("tool.msg.noAudio", MSG.noAudio, null);
      return;
    }
    try {
      if (audioCtx.state === "suspended") {
        var pr = audioCtx.resume();
        if (pr && pr.catch) pr.catch(function () { /* noop */ });
      }
      var t0 = audioCtx.currentTime + 0.01;
      for (var i = 0; i < 3; i++) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        var at = t0 + i * 0.45;
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(at);
        osc.stop(at + 0.32);
      }
    } catch (e) {
      audioOk = false;
      addNotice("tool.msg.noAudio", MSG.noAudio, null);
    }
  }

  /* ---- 뷰 ---- */
  function durationMs(m) {
    var min = m === "focus" ? settings.focus : (m === "short" ? settings.short : settings.long);
    return min * 60000;
  }
  function renderMode() {
    modeEl.setAttribute("data-i18n", modeKey(mode)); // 언어 전환 시에도 라벨 유지
    modeEl.textContent = modeName(mode);
    modeEl.style.color = mode === "focus" ? "var(--accent)" : "var(--muted)";
  }
  function renderCycle() {
    var s = tr("tool.cycle", MSG.cycle);
    s = s.split("{n}").join(String(cyclePos(mode, focusDone, settings.interval)));
    s = s.split("{m}").join(String(settings.interval));
    cycleEl.textContent = s;
  }
  function renderToday() { todayEl.textContent = "🍅 × " + today.count; }
  function renderClock(ms) {
    display.textContent = formatMMSS(ms);
    if (progressEl) {
      var r = totalMs > 0 ? ms / totalMs : 0;
      if (r < 0) r = 0;
      if (r > 1) r = 1;
      progressEl.style.width = (r * 100) + "%";
    }
  }
  function updateTitle(ms) { // 탭 타이틀: "24:59 · 집중 — 뽀모도로 타이머"
    if (phase === "running" || phase === "paused") {
      document.title = formatMMSS(ms) + " · " + modeName(mode) + " — " + (cfg.name || "Pomodoro Timer");
    } else {
      document.title = baseTitle();
    }
  }
  function emphasizeStart(on) { // 대기 상태에서 시작 버튼 강조
    startBtn.style.boxShadow = on ? "0 0 0 4px color-mix(in srgb, var(--accent) 35%, transparent)" : "";
  }
  function setStartLabel(key, fallback) {
    startBtn.setAttribute("data-i18n", key); // 언어 전환 시에도 라벨 유지
    startBtn.textContent = tr(key, fallback);
  }
  function applyButtons() {
    if (phase === "running") { setStartLabel("tool.pause", MSG.pause); emphasizeStart(false); }
    else if (phase === "paused") { setStartLabel("tool.resume", MSG.resume); }
    else { setStartLabel("tool.start", MSG.start); }
  }
  function renderRunning(remain) {
    var sec = Math.ceil(remain / 1000);
    if (sec === lastShownSec) return;  // 초 단위 변화 시에만 갱신
    lastShownSec = sec;
    renderClock(remain);
    updateTitle(remain);
  }

  /* ---- 전이 ---- */
  function stopTick() {
    if (tickId) { clearInterval(tickId); tickId = null; }
  }
  function enterReady() { // 현재 모드의 세션 대기 상태 (전체 길이로)
    stopTick();
    phase = "ready";
    remainMs = durationMs(mode);
    totalMs = remainMs;
    lastShownSec = -1;
    applyButtons();
    renderClock(remainMs);
    updateTitle(remainMs);
  }
  function startSession(ms) { // endTime 확정 — 이후는 endTime - Date.now() 재계산만
    stopTick();
    clearTransient();
    totalMs = durationMs(mode);
    endTime = Date.now() + ms;
    lastShownSec = -1;
    phase = "running";
    applyButtons();
    renderClock(ms);
    updateTitle(ms);
    tickId = setInterval(tick, TICK_MS);
  }
  function pauseSession() {
    if (phase !== "running") return;
    remainMs = Math.max(0, endTime - Date.now());
    stopTick();
    phase = "paused";
    applyButtons();
    updateTitle(remainMs);
  }
  function resumeSession() {
    if (phase !== "paused") return;
    endTime = Date.now() + remainMs; // 재개 시 endTime 재산출
    lastShownSec = -1;
    phase = "running";
    applyButtons();
    tickId = setInterval(tick, TICK_MS);
    tick();
  }
  function tick() {
    if (phase !== "running") return;
    var remain = endTime - Date.now();
    if (remain <= 0) { handleExpiry(-remain); return; } // 백그라운드에서 지난 종료도 즉시 처리
    renderRunning(remain);
  }
  // 세션 종료 처리 — overshoot = 종료 시각 이후 경과 ms (백그라운드 스로틀 대비)
  function handleExpiry(overshoot) {
    stopTick();
    var ended = mode;
    if (ended === "focus") { focusDone += 1; bumpToday(); } // focus 완료 → 오늘 카운트 +1
    beep(ended === "focus" ? FREQ_FOCUS_END : FREQ_BREAK_END);
    mode = nextMode(ended, focusDone, settings.interval);
    renderMode();
    renderCycle();
    var durMs = durationMs(mode);
    if (settings.auto) {
      if (overshoot < durMs) { // 자동 연속 시작 — 원래 종료 시각 기준으로 이어붙임
        startSession(durMs - overshoot);
        return;
      }
      // 여러 세션 분량 경과 — 다중 자동 스킵 대신 정지 + 명시적 안내
      enterReady();
      addNotice("tool.msg.overrun", MSG.overrun, null);
      emphasizeStart(true);
      return;
    }
    // 자동 연속 시작 off → 다음 세션 대기 + 시작 버튼 강조
    enterReady();
    addNotice(ended === "focus" ? "tool.msg.focusDone" : "tool.msg.breakDone",
      ended === "focus" ? MSG.focusDone : MSG.breakDone, modeKey(mode));
    emphasizeStart(true);
  }
  function skipSession() { // 다음 세션으로 — 건너뛴 focus 는 오늘 카운트에 넣지 않음
    var wasRunning = phase === "running";
    stopTick();
    clearTransient();
    emphasizeStart(false);
    var ended = mode;
    if (ended === "focus") focusDone += 1; // 사이클 위치는 전진
    mode = nextMode(ended, focusDone, settings.interval);
    renderMode();
    renderCycle();
    if (wasRunning && settings.auto) { startSession(durationMs(mode)); return; }
    enterReady();
  }
  function resetSession() { // 현재 세션 처음으로 (모드·사이클 위치 유지)
    clearTransient();
    emphasizeStart(false);
    enterReady();
  }

  /* ---- 설정 패널 ---- */
  function writeSettingsInputs() {
    inFocus.value = String(settings.focus);
    inShort.value = String(settings.short);
    inLong.value = String(settings.long);
    inInterval.value = String(settings.interval);
    inAuto.checked = settings.auto;
  }
  function onSettingsChange() { // clamp 후 저장 — 실행 중 세션에는 다음 세션부터 반영
    settings = sanitizeSettings({
      focus: inFocus.value, short: inShort.value, long: inLong.value,
      interval: inInterval.value, auto: inAuto.checked
    });
    writeSettingsInputs(); // clamp 결과를 입력칸에 반영
    saveSettings();
    renderCycle();
    if (phase === "ready") { // 대기 중이면 표시 시간도 즉시 갱신
      remainMs = durationMs(mode);
      totalMs = remainMs;
      renderClock(remainMs);
    }
  }
  function blockNonDigitKeys(ev) {
    var k = ev.key;
    if (k === "-" || k === "+" || k === "e" || k === "E" || k === "." || k === ",") ev.preventDefault();
  }

  /* ---- 이벤트 ---- */
  startBtn.addEventListener("click", function () { // 시작/일시정지 토글
    if (phase === "running") { pauseSession(); return; }
    ensureAudio(); // 사용자 제스처 시점에 AudioContext 생성·resume
    if (phase === "paused") { resumeSession(); return; }
    clearTransient();
    emphasizeStart(false);
    startSession(durationMs(mode));
  });
  resetBtn.addEventListener("click", resetSession);
  skipBtn.addEventListener("click", skipSession);

  var numInputs = [inFocus, inShort, inLong, inInterval];
  for (var ni = 0; ni < numInputs.length; ni++) {
    numInputs[ni].addEventListener("change", onSettingsChange);
    numInputs[ni].addEventListener("keydown", blockNonDigitKeys);
  }
  inAuto.addEventListener("change", onSettingsChange);

  // 백그라운드 복귀 시 즉시 재계산 — 종료 시각이 지났으면 그 자리에서 종료 처리
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && phase === "running") tick();
  });

  // 언어 전환 시 동적 문구 재번역 (라벨류는 data-i18n 훅으로 엔진이 처리)
  document.addEventListener("i18n:change", function () {
    renderNotices();
    renderCycle();
    var remain = phase === "running" ? Math.max(0, endTime - Date.now()) : remainMs;
    updateTitle(remain);
  });

  /* ---- 초기화: 설정·오늘 카운트 복원 → 집중 세션 대기 상태 ---- */
  settings = loadSettings();
  writeSettingsInputs();
  today = loadToday();
  renderToday();
  renderMode();
  renderCycle();
  enterReady();
  // TOOLJS:END
})();
