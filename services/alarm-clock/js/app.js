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
  /* Online Alarm Clock — 브라우저 탭이 열려 있는 동안만 동작하는 정적 알람 시계.
     서버·푸시 없음: 매초 현재 시각을 갱신하고, 분 경계에서 저장된 알람 목록과 비교해
     일치하면 WebAudio 톤 + (허용 시) Notification 으로 알린다.
     상태: localStorage "<slug>:alarms"(알람 배열, 최대 5개), "<slug>:state"(마지막 입력값). */

  var CFG = window.APP_CONFIG || {};
  var SLUG = CFG.slug || "alarm-clock";
  var SKEY_ALARMS = SLUG + ":alarms";
  var SKEY_STATE = SLUG + ":state";
  var MAX_ALARMS = 5;
  var SKEY_SNOOZE = SLUG + ":snoozeMin";
  var SNOOZE_CHOICES = [1, 5, 10, 15, 20, 30];
  var SNOOZE_DEFAULT = 5;
  var RING_CYCLE_MS = 1500;   // 비프 1사이클 간격
  var RING_MAX_CYCLES = 200;  // 약 5분 후 소리만 자동 정지 — 배너·탭 깜빡임은 Stop 전까지 유지

  /* ---- i18n 헬퍼 ---- */
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }

  /* ---- 순수 헬퍼 (시각 파싱·포맷) ---- */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  function isValidTime(s) { return TIME_RE.test(String(s == null ? "" : s)); }
  function nowHM(d) { return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function addMinutes(d, mins) { return new Date(d.getTime() + mins * 60000); }
  function genId() { return "a" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  function fmtBigClock(d) {
    try { return new Intl.DateTimeFormat(uiLang(), { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d); }
    catch (e) { return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()); }
  }
  function fmtDateLine(d) {
    try { return new Intl.DateTimeFormat(uiLang(), { weekday: "long", month: "long", day: "numeric" }).format(d); }
    catch (e) { return d.toDateString(); }
  }
  function fmtAlarmTime(hhmm) {
    var p = String(hhmm).split(":");
    var d = new Date();
    d.setHours(parseInt(p[0], 10) || 0, parseInt(p[1], 10) || 0, 0, 0);
    try { return new Intl.DateTimeFormat(uiLang(), { hour: "2-digit", minute: "2-digit" }).format(d); }
    catch (e) { return hhmm; }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var timeEl = $("ac-time"), dateEl = $("ac-date");
  var ringingEl = $("ac-ringing"), ringingListEl = $("ac-ringing-list"), ringStopAllBtn = $("ac-ring-stopall");
  var timeInput = $("ac-time-input"), labelInput = $("ac-label-input"), addBtn = $("ac-add-btn"), errEl = $("ac-err");
  var presetsWrap = $("ac-presets");
  var testSoundBtn = $("ac-test-sound"), notifBtn = $("ac-notif-btn"), notifStatusEl = $("ac-notif-status");
  var emptyEl = $("ac-empty"), listEl = $("ac-list"), maxNoteEl = $("ac-max-note");
  var toastEl = $("ac-toast"), snoozeSel = $("ac-snooze-len");
  if (!timeEl || !timeInput || !addBtn || !listEl) return;

  /* ---- 상태 ---- */
  var alarms = loadAlarms();
  var ringingQueue = []; // [{id, time, label}] — 동시에 여러 알람이 울릴 수 있어 큐로 관리
  var snoozeMap = {};    // alarmId -> 다시 울릴 epoch ms (일별 스케줄과 별개 트랙)
  var lastCheckedHM = null;
  var audioCtx = null, audioOk = null;
  var ringTimerId = null, ringCycles = 0;
  var flashTimerId = null, flashOn = false;
  var baseTitle = document.title;

  function loadAlarms() {
    try {
      var raw = localStorage.getItem(SKEY_ALARMS);
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (a) { return a && isValidTime(a.time); })
        .slice(0, MAX_ALARMS)
        .map(function (a) {
          return { id: a.id || genId(), time: a.time, label: String(a.label || "").slice(0, 40), enabled: a.enabled !== false };
        });
    } catch (e) { return []; } // private mode·손상된 데이터 — 빈 목록으로 안전 폴백
  }
  function saveAlarms() {
    try { localStorage.setItem(SKEY_ALARMS, JSON.stringify(alarms)); } catch (e) { /* private mode */ }
  }
  function loadState() {
    try { var raw = localStorage.getItem(SKEY_STATE); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function saveState() {
    try { localStorage.setItem(SKEY_STATE, JSON.stringify({ time: timeInput.value, label: labelInput.value })); }
    catch (e) { /* noop */ }
  }

  /* ---- 스누즈 길이 (기본 5분, 사용자가 1~30분에서 선택) ---- */
  function snoozeMinutes() {
    var v = snoozeSel ? parseInt(snoozeSel.value, 10) : NaN;
    return SNOOZE_CHOICES.indexOf(v) === -1 ? SNOOZE_DEFAULT : v;
  }
  function renderSnoozeSelect() {
    if (!snoozeSel) return;
    var cur = snoozeSel.options.length ? snoozeMinutes() : loadSnoozePref();
    snoozeSel.textContent = "";
    SNOOZE_CHOICES.forEach(function (m) {
      var o = document.createElement("option");
      o.value = String(m);
      o.textContent = tr("tool.snooze.opt", "{n} min").replace("{n}", String(m));
      if (m === cur) o.selected = true;
      snoozeSel.appendChild(o);
    });
  }
  function loadSnoozePref() {
    var v;
    try { v = parseInt(localStorage.getItem(SKEY_SNOOZE), 10); } catch (e) { v = NaN; }
    return SNOOZE_CHOICES.indexOf(v) === -1 ? SNOOZE_DEFAULT : v;
  }

  /* ---- 실시간 시계 ---- */
  function renderClock(d) {
    timeEl.textContent = fmtBigClock(d);
    dateEl.textContent = fmtDateLine(d);
  }

  /* ---- 짧은 상태 토스트 (스누즈 확인 등) ---- */
  var toastTimer = null;
  function showToast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.textContent = ""; }, 3200);
  }

  /* ---- 오류 표시 ---- */
  function showError(key, fallback) {
    errEl.textContent = tr(key, fallback);
    errEl.hidden = false;
  }
  function clearError() { errEl.hidden = true; errEl.textContent = ""; }

  /* ---- 알림 권한: 사용자 제스처(버튼 클릭) 시점에만 요청 — 로드 시 자동 요청 없음 ---- */
  function notifSupported() { return typeof window !== "undefined" && "Notification" in window; }
  function ensureNotifPermission() {
    if (!notifSupported()) { renderNotifStatus(); return; }
    if (Notification.permission === "default") {
      try {
        var p = Notification.requestPermission();
        if (p && p.then) p.then(renderNotifStatus, renderNotifStatus);
        else renderNotifStatus(); // 구형 콜백형 API 대비 아래에서 재시도
      } catch (e) {
        try { Notification.requestPermission(renderNotifStatus); } catch (e2) { /* 미지원 브라우저 */ }
      }
    } else {
      renderNotifStatus();
    }
  }
  function renderNotifStatus() {
    if (!notifStatusEl) return;
    if (!notifSupported()) {
      notifStatusEl.textContent = tr("tool.notif.unsupported", "This browser doesn't support notifications — sound alerts still work.");
    } else if (Notification.permission === "granted") {
      notifStatusEl.textContent = tr("tool.notif.granted", "Notifications enabled.");
    } else if (Notification.permission === "denied") {
      notifStatusEl.textContent = tr("tool.notif.denied", "Notifications blocked — sound alerts still work while this tab is open.");
    } else {
      notifStatusEl.textContent = "";
    }
  }
  function sendNotification(alarm) {
    if (!notifSupported() || Notification.permission !== "granted") return;
    try {
      var icon;
      try { icon = new URL("icons/icon.svg", location.href).href; } catch (e) { icon = "icons/icon.svg"; }
      new Notification(alarm.label || tr("tool.item.defaultLabel", "Alarm"), {
        body: fmtAlarmTime(alarm.time),
        icon: icon,
        tag: SLUG + "-" + alarm.id
      });
    } catch (e) { /* 알림 실패는 조용히 무시 — 소리·배너는 이미 동작 중이라 사용자는 놓치지 않는다 */ }
  }

  /* ---- Web Audio 알람음 합성 (오디오 파일·CDN 없음) ---- */
  function ensureAudio() {
    if (audioOk === false) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error("Web Audio unsupported");
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") {
        var pr = audioCtx.resume();
        if (pr && pr.catch) pr.catch(function () { /* 재개 실패 — 다음 시도에서 재시도 */ });
      }
      audioOk = true;
    } catch (e) { audioOk = false; }
  }
  function beepTriple() { // OscillatorNode 비프 3회 합성 — 오디오 미지원이면 조용히 무시
    if (!audioCtx || audioOk !== true) return;
    try {
      var t0 = audioCtx.currentTime + 0.01;
      for (var i = 0; i < 3; i++) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        var at = t0 + i * 0.22;
        osc.type = "square";
        osc.frequency.setValueAtTime(988, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(at);
        osc.stop(at + 0.2);
      }
    } catch (e) { audioOk = false; }
  }
  function startRingLoop() {
    if (ringTimerId) return; // 이미 재생 중
    ensureAudio();
    ringCycles = 0;
    beepTriple();
    ringTimerId = setInterval(function () {
      ringCycles += 1;
      if (ringingQueue.length === 0 || ringCycles >= RING_MAX_CYCLES) { stopRingLoop(); return; }
      beepTriple();
    }, RING_CYCLE_MS);
  }
  function stopRingLoop() {
    if (ringTimerId) { clearInterval(ringTimerId); ringTimerId = null; }
  }

  /* ---- 탭 타이틀 깜빡임 — 다른 탭을 보고 있어도 눈에 띄게 ---- */
  function startFlash() {
    if (flashTimerId) return;
    flashTimerId = setInterval(function () {
      flashOn = !flashOn;
      document.title = flashOn ? "⏰ " + tr("tool.item.defaultLabel", "Alarm") : baseTitle;
    }, 1000);
  }
  function stopFlash() {
    if (flashTimerId) { clearInterval(flashTimerId); flashTimerId = null; }
    document.title = baseTitle;
  }

  /* ---- 울리는 알람 배너 (동시에 여러 개 가능) ---- */
  function renderRinging() {
    if (!ringingEl || !ringingListEl) return;
    ringingListEl.textContent = "";
    if (!ringingQueue.length) {
      ringingEl.hidden = true;
      if (ringStopAllBtn) ringStopAllBtn.hidden = true;
      stopRingLoop();
      stopFlash();
      return;
    }
    ringingEl.hidden = false;
    if (ringStopAllBtn) ringStopAllBtn.hidden = ringingQueue.length < 2;
    ringingQueue.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "ac-ring-item";

      var txt = document.createElement("span");
      txt.className = "ac-ring-text";
      txt.textContent = tr("tool.ring.line", "{label} — {time}")
        .replace("{label}", item.label || tr("tool.item.defaultLabel", "Alarm"))
        .replace("{time}", fmtAlarmTime(item.time));

      var snoozeBtn = document.createElement("button");
      snoozeBtn.type = "button";
      snoozeBtn.className = "ac-ring-btn ac-ring-snooze";
      snoozeBtn.textContent = tr("tool.ring.snooze", "Snooze {n} min").replace("{n}", String(snoozeMinutes()));
      snoozeBtn.addEventListener("click", function () { snoozeAlarm(item.id); });

      var stopBtn = document.createElement("button");
      stopBtn.type = "button";
      stopBtn.className = "ac-ring-btn ac-ring-stop";
      stopBtn.textContent = tr("tool.ring.stop", "Stop");
      stopBtn.addEventListener("click", function () { dismissRinging(item.id); });

      row.appendChild(txt);
      row.appendChild(snoozeBtn);
      row.appendChild(stopBtn);
      ringingListEl.appendChild(row);
    });
    startRingLoop();
    startFlash();
  }
  function dismissRinging(id) {
    ringingQueue = ringingQueue.filter(function (r) { return r.id !== id; });
    renderRinging();
  }
  function dismissAllRinging() {
    ringingQueue = [];
    renderRinging();
  }
  function snoozeAlarm(id) {
    var item = null;
    ringingQueue.forEach(function (r) { if (r.id === id) item = r; });
    dismissRinging(id);
    if (!item) return;
    snoozeMap[id] = Date.now() + snoozeMinutes() * 60000;
    var until = new Date(snoozeMap[id]);
    showToast(tr("tool.toast.snoozed", "Snoozed until {time}.")
      .replace("{time}", fmtAlarmTime(pad2(until.getHours()) + ":" + pad2(until.getMinutes()))));
  }
  function fireAlarm(alarm) {
    var already = false;
    ringingQueue.forEach(function (r) { if (r.id === alarm.id) already = true; });
    if (already) return; // 같은 분 안에서 중복 트리거 방지
    ringingQueue.push({ id: alarm.id, time: alarm.time, label: alarm.label });
    renderRinging();
    sendNotification(alarm);
  }

  /* ---- 알람 CRUD ---- */
  function findAlarm(id) {
    for (var i = 0; i < alarms.length; i++) { if (alarms[i].id === id) return alarms[i]; }
    return null;
  }
  function addAlarm(time, label) {
    clearError();
    if (!isValidTime(time)) { showError("tool.err.required", "Choose an alarm time first."); return false; }
    if (alarms.length >= MAX_ALARMS) { showError("tool.list.max", "You've reached the 5-alarm limit — delete one to add another."); return false; }
    var dup = alarms.some(function (a) { return a.time === time; });
    if (dup) { showError("tool.err.duplicate", "You already have an alarm set for this exact time."); return false; }
    alarms.push({ id: genId(), time: time, label: String(label || "").slice(0, 40), enabled: true });
    alarms.sort(function (a, b) { return a.time < b.time ? -1 : (a.time > b.time ? 1 : 0); });
    saveAlarms();
    renderList();
    return true;
  }
  function deleteAlarm(id) {
    alarms = alarms.filter(function (a) { return a.id !== id; });
    delete snoozeMap[id];
    saveAlarms();
    renderList();
    dismissRinging(id);
  }
  function toggleAlarm(id) {
    var a = findAlarm(id);
    if (!a) return;
    a.enabled = !a.enabled;
    saveAlarms();
    renderList();
  }

  function renderList() {
    listEl.textContent = "";
    var has = alarms.length > 0;
    if (emptyEl) emptyEl.hidden = has;
    listEl.hidden = !has;
    if (maxNoteEl) maxNoteEl.hidden = alarms.length < MAX_ALARMS;
    if (addBtn) addBtn.disabled = alarms.length >= MAX_ALARMS;
    alarms.forEach(function (a) {
      var li = document.createElement("li");
      li.className = "ac-item" + (a.enabled ? "" : " ac-item-off");

      var toggleLabel = document.createElement("label");
      toggleLabel.className = "ac-toggle";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = a.enabled;
      cb.setAttribute("aria-label", tr("tool.item.toggleAria", "Turn this alarm on or off"));
      cb.addEventListener("change", function () { toggleAlarm(a.id); });
      var slider = document.createElement("span");
      slider.className = "ac-toggle-slider";
      toggleLabel.appendChild(cb);
      toggleLabel.appendChild(slider);

      var info = document.createElement("div");
      info.className = "ac-item-info";
      var timeSpan = document.createElement("span");
      timeSpan.className = "ac-item-time";
      timeSpan.textContent = fmtAlarmTime(a.time);
      var labelSpan = document.createElement("span");
      labelSpan.className = "ac-item-label";
      labelSpan.textContent = a.label || tr("tool.item.defaultLabel", "Alarm");
      info.appendChild(timeSpan);
      info.appendChild(labelSpan);

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "ac-item-del";
      delBtn.setAttribute("aria-label", tr("tool.item.delete", "Delete alarm"));
      delBtn.textContent = "×";
      delBtn.addEventListener("click", function () { deleteAlarm(a.id); });

      li.appendChild(toggleLabel);
      li.appendChild(info);
      li.appendChild(delBtn);
      listEl.appendChild(li);
    });
  }

  /* ---- 매초 틱: 시계 갱신 + 분 경계에서 알람 매칭 + 스누즈 확인 ----
     분 문자열이 바뀔 때만 스캔해 같은 분 안에서 중복 실행되지 않는다.
     탭이 백그라운드에서 오래 멈췄다 돌아오면 지나간 분은 그냥 건너뛴다(명시적으로 고지된 한계). */
  function tick() {
    var now = new Date();
    renderClock(now);
    var hm = nowHM(now);
    if (hm !== lastCheckedHM) {
      lastCheckedHM = hm;
      alarms.forEach(function (a) { if (a.enabled && a.time === hm) fireAlarm(a); });
    }
    var t = now.getTime();
    Object.keys(snoozeMap).forEach(function (id) {
      if (snoozeMap[id] <= t) {
        delete snoozeMap[id];
        var a = findAlarm(id);
        if (a) fireAlarm(a);
      }
    });
  }

  /* ---- 이벤트 ---- */
  addBtn.addEventListener("click", function () {
    if (addAlarm(timeInput.value, labelInput.value)) {
      timeInput.value = "";
      labelInput.value = "";
      saveState();
      timeInput.focus();
      ensureNotifPermission(); // 버튼 클릭 = 사용자 제스처, 권한 요청에 적합한 시점
    }
  });
  timeInput.addEventListener("input", function () { clearError(); saveState(); });
  labelInput.addEventListener("input", saveState);

  if (presetsWrap) {
    var presetBtns = presetsWrap.querySelectorAll(".ac-preset");
    for (var pi = 0; pi < presetBtns.length; pi++) {
      presetBtns[pi].addEventListener("click", function () {
        var mins = parseInt(this.getAttribute("data-min"), 10);
        if (!isFinite(mins) || mins <= 0) return;
        var target = addMinutes(new Date(), mins);
        var hm = pad2(target.getHours()) + ":" + pad2(target.getMinutes());
        addAlarm(hm, this.textContent); // 프리셋 버튼의 (이미 번역된) 라벨을 그대로 알람 라벨로 사용
        ensureNotifPermission();
      });
    }
  }

  if (testSoundBtn) {
    testSoundBtn.addEventListener("click", function () {
      ensureAudio();
      beepTriple();
    });
  }
  if (notifBtn) notifBtn.addEventListener("click", ensureNotifPermission);
  if (ringStopAllBtn) ringStopAllBtn.addEventListener("click", dismissAllRinging);

  // 언어 전환 시 동적으로 그려진 문구(목록·배너·상태) 재적용
  if (snoozeSel) {
    snoozeSel.addEventListener("change", function () {
      try { localStorage.setItem(SKEY_SNOOZE, String(snoozeMinutes())); } catch (e) { /* private mode */ }
      renderRinging(); // 울리는 중이면 버튼 문구를 새 길이로 갱신
    });
  }

  document.addEventListener("i18n:change", function () {
    renderSnoozeSelect();
    renderList();
    renderRinging();
    renderNotifStatus();
  });

  /* ---- 초기화 ---- */
  var savedState = loadState();
  if (savedState) {
    if (savedState.time && isValidTime(savedState.time)) timeInput.value = savedState.time;
    if (savedState.label) labelInput.value = String(savedState.label).slice(0, 40);
  }
  renderSnoozeSelect();
  renderList();
  renderNotifStatus();
  var initNow = new Date();
  renderClock(initNow);
  lastCheckedHM = nowHM(initNow); // 로드된 바로 그 분에 중복 발화하지 않도록 기준점을 먼저 세팅
  setInterval(tick, 1000);
  // TOOLJS:END
})();
