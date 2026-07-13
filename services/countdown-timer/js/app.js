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
  var SLUG = cfg.slug || "countdown-timer";
  var LS_LAST = SLUG + ":last";        // 상태 저장은 "<slug>:" prefix 만 사용

  var TICK_MS = 250;                   // 틱 주기 — 표시는 초가 바뀔 때만 갱신
  var ALARM_CYCLE_MS = 2000;           // 비프 3회 = 1사이클
  var ALARM_MAX_CYCLES = 15;           // 약 30초 후 소리 자동 정지 (시각 알림은 유지)

  // en 원문(baked) 폴백 — i18n 카탈로그가 우선 (tr() 참조)
  var MSG_ZERO = "Set a time to start.";
  var MSG_NO_AUDIO = "Sound is unavailable in this browser — you'll still get the visual alert.";
  var MSG_NO_STORAGE = "Settings can't be saved (private browsing) — they'll last for this session only.";
  var LABEL_PAUSE = "Pause";
  var LABEL_RESUME = "Resume";
  var LABEL_DONE = "Time's up!";

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // 숫자 외 문자는 무시하고 0..max 로 clamp (시 0-23, 분·초 0-59)
  function clampPart(raw, max) {
    var digits = String(raw == null ? "" : raw).replace(/[^\d]/g, "");
    if (!digits) return 0;
    var n = parseInt(digits, 10);
    if (isNaN(n) || n < 0) return 0;
    return n > max ? max : n;
  }
  function toMs(h, m, s) { return ((h * 3600) + (m * 60) + s) * 1000; }
  // 시>0 이면 HH:MM:SS, 아니면 MM:SS. 잔여 ms 는 올림(1ms 남아도 00:01)
  function formatRemain(ms) {
    var sec = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return h > 0 ? p(h) + ":" + p(m) + ":" + p(s) : p(m) + ":" + p(s);
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { clampPart: clampPart, toMs: toMs, formatRemain: formatRemain };
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var elH = $("in-hours"), elM = $("in-minutes"), elS = $("in-seconds");
  var display = $("timer-display");
  var progressEl = $("timer-progress");
  var banner = $("timer-banner");
  var msgEl = $("timer-msg");
  var startBtn = $("start-btn"), pauseBtn = $("pause-btn"), resetBtn = $("reset-btn");
  var stopSoundBtn = $("stop-sound-btn");
  var presetsWrap = $("timer-presets");
  if (!elH || !elM || !elS || !display || !startBtn || !pauseBtn || !resetBtn) return;
  var presetBtns = presetsWrap ? presetsWrap.querySelectorAll("[data-preset-min]") : [];
  var bakedTitle = document.title;

  /* ---- 상태 ---- */
  var state = "idle";                  // idle | running | paused | done
  var totalMs = 0;                     // 설정 시간 (ms)
  var endTime = 0;                     // 절대 종료 시각 — 매 틱 endTime - Date.now() 재계산
  var remainMs = 0;                    // 일시정지 시 보관하는 잔여 ms
  var tickId = null, lastShownSec = -1;
  var audioCtx = null, audioOk = null; // null=미시도 / true / false
  var alarmId = null, alarmCycles = 0;
  var flashId = null, flashOn = false;
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
  function baseTitle() {
    var v = tr("meta.title", null);
    return v != null ? v : bakedTitle;
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

  /* ---- 입력 ---- */
  function readParts() {
    return { h: clampPart(elH.value, 23), m: clampPart(elM.value, 59), s: clampPart(elS.value, 59) };
  }
  function writeParts(p) {
    elH.value = String(p.h); elM.value = String(p.m); elS.value = String(p.s);
  }
  function configuredMs() { var p = readParts(); return toMs(p.h, p.m, p.s); }

  /* ---- 뷰 ---- */
  function setProgress(ratio) {
    if (!progressEl) return;
    var r = ratio;
    if (r < 0) r = 0;
    if (r > 1) r = 1;
    progressEl.style.width = (r * 100) + "%";
  }
  function show(el, on) { if (el) el.style.display = on ? "" : "none"; }
  function setPauseLabel(resume) {
    var key = resume ? "tool.resume" : "tool.pause";
    pauseBtn.setAttribute("data-i18n", key); // 언어 전환 시에도 라벨 유지
    pauseBtn.textContent = tr(key, resume ? LABEL_RESUME : LABEL_PAUSE);
  }
  function setInputsEnabled(on) {
    elH.disabled = !on; elM.disabled = !on; elS.disabled = !on;
    for (var i = 0; i < presetBtns.length; i++) presetBtns[i].disabled = !on;
  }
  function applyState(next) {
    state = next;
    show(startBtn, next === "idle" || next === "done");
    show(pauseBtn, next === "running" || next === "paused");
    setInputsEnabled(next === "idle" || next === "done");
    if (banner) banner.hidden = next !== "done";
    display.style.color = next === "done" ? "var(--accent)" : "";
  }
  // idle/done 공통: 설정 시간 표시 + 0 가드 ("전부 0 → 시작 비활성 + 안내")
  function updateIdleView() {
    var ms = configuredMs();
    if (state === "idle") {
      display.textContent = formatRemain(ms);
      setProgress(1);
    }
    if (ms <= 0) {
      startBtn.disabled = true;
      addNotice("tool.msg.zero", MSG_ZERO);
    } else {
      startBtn.disabled = false;
      removeNotice("tool.msg.zero");
    }
  }
  function renderRunning(remain) {
    var sec = Math.ceil(remain / 1000);
    if (sec === lastShownSec) return;  // 초 단위 변화 시에만 갱신
    lastShownSec = sec;
    var text = formatRemain(remain);
    display.textContent = text;
    setProgress(totalMs > 0 ? remain / totalMs : 0);
    document.title = text + " — " + (cfg.name || "Timer"); // 탭 타이틀에 남은 시간
  }
  function tick() {
    if (state !== "running") return;
    var remain = endTime - Date.now();
    if (remain <= 0) { finish(); return; } // 백그라운드에서 지난 종료도 즉시 처리
    renderRunning(remain);
  }

  /* ---- 알림음: Web Audio 합성 (오디오 파일·CDN 없음) ---- */
  // AudioContext 는 시작 버튼 클릭(사용자 제스처) 시점에 생성·resume — 자동재생 정책 회피
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
    } catch (e) {
      audioOk = false;
      addNotice("tool.msg.noAudio", MSG_NO_AUDIO); // 시각 알림만 동작
    }
  }
  function beepTriple() { // OscillatorNode 880Hz 비프음 3회 합성
    if (!audioCtx || audioOk !== true) return;
    try {
      var t0 = audioCtx.currentTime + 0.01;
      for (var i = 0; i < 3; i++) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        var at = t0 + i * 0.45;
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, at);
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
      addNotice("tool.msg.noAudio", MSG_NO_AUDIO);
    }
  }
  function stopAlarm() {
    if (alarmId) { clearInterval(alarmId); alarmId = null; }
  }
  function playAlarm() {
    if (audioOk !== true || !audioCtx) {
      addNotice("tool.msg.noAudio", MSG_NO_AUDIO);
      return;
    }
    try {
      if (audioCtx.state === "suspended") {
        var pr = audioCtx.resume();
        if (pr && pr.catch) pr.catch(function () { /* noop */ });
      }
    } catch (e) { /* noop */ }
    alarmCycles = 0;
    beepTriple();
    alarmId = setInterval(function () {
      alarmCycles += 1;
      if (state !== "done" || alarmCycles >= ALARM_MAX_CYCLES) { stopAlarm(); return; }
      beepTriple();
    }, ALARM_CYCLE_MS);
  }

  /* ---- 탭 타이틀 깜빡임 ---- */
  function stopFlash() {
    if (flashId) { clearInterval(flashId); flashId = null; }
  }
  function startFlash() {
    stopFlash();
    document.title = "⏰ " + tr("tool.done", LABEL_DONE);
    flashOn = true;
    flashId = setInterval(function () {
      flashOn = !flashOn;
      document.title = flashOn ? "⏰ " + tr("tool.done", LABEL_DONE) : baseTitle();
    }, 1000);
  }

  /* ---- 마지막 설정 저장·복원 (localStorage "<slug>:last") ---- */
  function saveLast(p) {
    try {
      localStorage.setItem(LS_LAST, JSON.stringify(p));
      storageOk = true;
    } catch (e) {
      // 세션 메모리 폴백(입력 필드가 세션 상태를 유지) + 명시적 안내
      if (storageOk) { storageOk = false; addNotice("tool.msg.noStorage", MSG_NO_STORAGE); }
    }
  }
  function loadLast() {
    try {
      var raw = localStorage.getItem(LS_LAST);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || typeof p !== "object") return null;
      return { h: clampPart(p.h, 23), m: clampPart(p.m, 59), s: clampPart(p.s, 59) };
    } catch (e) { return null; } // 읽기 실패 → 기본값 (저장 시도 시점에 안내)
  }

  /* ---- 전이 ---- */
  function start() {
    var p = readParts();
    writeParts(p); // clamp 결과를 입력칸에 반영
    var ms = toMs(p.h, p.m, p.s);
    if (ms <= 0) { // 방어 — 버튼 비활성이 우선이지만 조용한 실패 금지
      startBtn.disabled = true;
      addNotice("tool.msg.zero", MSG_ZERO);
      return;
    }
    stopAlarm();
    stopFlash();
    totalMs = ms;
    endTime = Date.now() + totalMs; // 종료 시각 확정 — 이후는 재계산만
    lastShownSec = -1;
    saveLast(p);
    ensureAudio();
    applyState("running");
    setPauseLabel(false);
    renderRunning(totalMs);
    if (tickId) clearInterval(tickId);
    tickId = setInterval(tick, TICK_MS);
  }
  function togglePause() {
    if (state === "running") {
      remainMs = endTime - Date.now();
      if (remainMs < 0) remainMs = 0;
      if (tickId) { clearInterval(tickId); tickId = null; }
      applyState("paused");
      setPauseLabel(true);
    } else if (state === "paused") {
      endTime = Date.now() + remainMs; // 재개 시 endTime 재산출
      lastShownSec = -1;
      applyState("running");
      setPauseLabel(false);
      tickId = setInterval(tick, TICK_MS);
      tick();
    }
  }
  function finish() {
    if (tickId) { clearInterval(tickId); tickId = null; }
    display.textContent = formatRemain(0);
    setProgress(0);
    applyState("done"); // 종료 배너(role=alert) 표시 + 입력 재활성
    playAlarm();
    startFlash();
  }
  function dismiss() { // 알림음 정지 버튼 — 소리·깜빡임 해제 후 대기 상태로
    stopAlarm();
    stopFlash();
    document.title = baseTitle();
    applyState("idle");
    updateIdleView();
  }
  function reset() {
    if (tickId) { clearInterval(tickId); tickId = null; }
    stopAlarm();
    stopFlash();
    document.title = baseTitle();
    applyState("idle");
    lastShownSec = -1;
    updateIdleView();
  }

  /* ---- 이벤트 ---- */
  startBtn.addEventListener("click", start);
  pauseBtn.addEventListener("click", togglePause);
  resetBtn.addEventListener("click", reset);
  if (stopSoundBtn) stopSoundBtn.addEventListener("click", dismiss);

  function onFieldInput() {
    if (state === "done") { dismiss(); return; } // 종료 후 값 수정 = 알림 해제로 간주
    if (state === "idle") updateIdleView();
  }
  function makeFieldChange(el, max) {
    return function () {
      el.value = String(clampPart(el.value, max));
      onFieldInput();
    };
  }
  function blockNonDigitKeys(ev) {
    var k = ev.key;
    if (k === "-" || k === "+" || k === "e" || k === "E" || k === "." || k === ",") ev.preventDefault();
  }
  var fields = [[elH, 23], [elM, 59], [elS, 59]];
  for (var fi = 0; fi < fields.length; fi++) {
    fields[fi][0].addEventListener("input", onFieldInput);
    fields[fi][0].addEventListener("change", makeFieldChange(fields[fi][0], fields[fi][1]));
    fields[fi][0].addEventListener("keydown", blockNonDigitKeys);
  }

  function makePresetHandler(min) {
    return function () {
      if (state === "done") dismiss();
      if (state !== "idle") return; // running/paused 에서는 버튼이 비활성이라 도달 불가 (방어)
      writeParts({ h: 0, m: min, s: 0 });
      updateIdleView();
    };
  }
  for (var pi = 0; pi < presetBtns.length; pi++) {
    (function (btn) {
      var min = parseInt(btn.getAttribute("data-preset-min"), 10) || 0;
      btn.addEventListener("click", makePresetHandler(min));
    })(presetBtns[pi]);
  }

  // 백그라운드 복귀 시 즉시 재계산 — 종료 시각이 지났으면 그 자리에서 종료 처리
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && state === "running") tick();
  });

  // 언어 전환 시 동적 문구 재번역 (라벨류는 data-i18n 훅으로 엔진이 처리)
  document.addEventListener("i18n:change", function () {
    renderNotices();
    if (state === "done" && flashId && flashOn) {
      document.title = "⏰ " + tr("tool.done", LABEL_DONE);
    }
  });

  /* ---- 초기화: 마지막 설정 복원 → 기본 00:05:00 ---- */
  var last = loadLast();
  if (last) writeParts(last);
  applyState("idle");
  setPauseLabel(false);
  updateIdleView();
  // TOOLJS:END
})();
