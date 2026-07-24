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
  /* Online Metronome — Web Audio lookahead scheduler (not a naive setInterval-per-beat),
     tap tempo, time signatures with accented downbeat, tempo-marking table for SEO.
     State: localStorage "<slug>:state" only (bpm, time signature). No external API. */

  var MIN_BPM = 30, MAX_BPM = 260, DEFAULT_BPM = 120, DEFAULT_SIG = "4/4";
  var SCHEDULE_AHEAD = 0.1;    // seconds scheduled into the future on every scheduler tick
  var LOOKAHEAD_MS = 25;       // scheduler tick interval — small vs. SCHEDULE_AHEAD, per spec
  var NOTE_LEN = 0.06;         // click envelope length in seconds
  var TAP_RESET_MS = 2000;     // gap after which a new tap starts a fresh tempo estimate
  var TAP_WINDOW = 6;          // rolling window of recent taps averaged for tap tempo

  // Time signatures: beats = clicks per measure, accents = 0-indexed beat(s) that get the
  // downbeat sound. 6/8 is compound (two dotted-quarter pulses of three eighths each), so it
  // clicks every eighth note and accents beats 1 and 4 to keep the two main pulses audible.
  var TIME_SIGS = {
    "2/4": { beats: 2, accents: [0] },
    "3/4": { beats: 3, accents: [0] },
    "4/4": { beats: 4, accents: [0] },
    "6/8": { beats: 6, accents: [0, 3] }
  };

  // Classical tempo markings (Italian, universal) mapped to an inclusive upper BPM bound —
  // used both for the "current tempo name" readout and the clickable reference table.
  var TEMPO_MARKS = [
    { key: "largo", max: 60 },
    { key: "adagio", max: 76 },
    { key: "andante", max: 108 },
    { key: "moderato", max: 120 },
    { key: "allegro", max: 156 },
    { key: "vivace", max: 176 },
    { key: "presto", max: Infinity }
  ];

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // BPM 파싱: 콤마 제거, 정수 반올림, 범위 밖은 clamp, 숫자가 아니면 fallback(직전 값) 유지
  function clampBpm(raw, fallback) {
    var n = parseFloat(String(raw == null ? "" : raw).replace(/,/g, "").trim());
    if (!isFinite(n)) return fallback == null ? DEFAULT_BPM : fallback;
    n = Math.round(n);
    if (n < MIN_BPM) return MIN_BPM;
    if (n > MAX_BPM) return MAX_BPM;
    return n;
  }
  // 표에 없는 박자는 4/4 로 (조용히 무시하지 않고 항상 유효한 상태로 되돌림)
  function normSig(code) {
    return Object.prototype.hasOwnProperty.call(TIME_SIGS, code) ? code : DEFAULT_SIG;
  }
  function markingFor(bpm) {
    for (var i = 0; i < TEMPO_MARKS.length; i++) {
      if (bpm <= TEMPO_MARKS[i].max) return TEMPO_MARKS[i].key;
    }
    return "presto";
  }
  function secPerBeat(bpm) { return 60.0 / bpm; }
  // 탭 템포: 연속된 탭 간격의 평균 → BPM. 탭이 2개 미만이면 아직 계산 불가(null).
  function tapBpm(taps) {
    if (!taps || taps.length < 2) return null;
    var sum = 0, n = 0;
    for (var i = 1; i < taps.length; i++) { sum += taps[i] - taps[i - 1]; n++; }
    if (n < 1) return null;
    var avgMs = sum / n;
    if (!(avgMs > 0)) return null;
    return clampBpm(60000 / avgMs, null);
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      clampBpm: clampBpm, normSig: normSig, markingFor: markingFor, secPerBeat: secPerBeat,
      tapBpm: tapBpm, TIME_SIGS: TIME_SIGS, TEMPO_MARKS: TEMPO_MARKS,
      MIN_BPM: MIN_BPM, MAX_BPM: MAX_BPM
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "metronome") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var bpmInput = $("bpm"), bpmSlider = $("bpm-slider");
  var bpmMinus = $("bpm-minus"), bpmPlus = $("bpm-plus");
  var tempoNameEl = $("tempo-name"), bpmHintEl = $("bpm-hint");
  var playBtn = $("play-btn"), tapBtn = $("tap-btn");
  var sigSelect = $("timesig");
  var beatsWrap = $("beat-dots");
  var statusEl = $("metro-status");
  var tableRows = document.querySelectorAll(".tempo-row");
  if (!bpmInput || !bpmSlider || !playBtn || !tapBtn || !sigSelect || !beatsWrap || !statusEl) return;

  /* ---- 상태 ---- */
  var bpm = DEFAULT_BPM;
  var sig = DEFAULT_SIG;
  var isPlaying = false;
  var audioCtx = null;
  var schedulerId = null;
  var rafId = null;
  var nextNoteTime = 0;
  var currentBeat = 0;      // 다음에 스케줄될 마디 내 박자 (0-indexed)
  var notesInQueue = [];    // 스케줄은 됐지만 아직 화면에 그리지 않은 { beat, time }
  var lastDrawnBeat = -1;
  var taps = [];

  /* ---- localStorage (private mode 등 실패 시 조용히 기본값으로) ---- */
  function loadState() {
    try {
      var raw = localStorage.getItem(SKEY);
      if (!raw) return;
      var obj = JSON.parse(raw);
      bpm = clampBpm(obj && obj.bpm, DEFAULT_BPM);
      sig = normSig(obj && obj.sig);
    } catch (e) { /* 손상된 저장값 — 기본값 유지 */ }
  }
  function saveState() {
    try { localStorage.setItem(SKEY, JSON.stringify({ bpm: bpm, sig: sig })); }
    catch (e) { /* noop */ }
  }

  /* ---- 렌더 ---- */
  function renderBeatsDom() {
    var def = TIME_SIGS[sig];
    beatsWrap.textContent = "";
    for (var i = 0; i < def.beats; i++) {
      var dot = document.createElement("span");
      dot.className = "metro-dot" + (def.accents.indexOf(i) !== -1 ? " accent" : "");
      beatsWrap.appendChild(dot);
    }
    lastDrawnBeat = -1;
  }
  function renderTempoName() {
    var m = markingFor(bpm);
    tempoNameEl.textContent = tr("tool.table." + m, m);
  }
  function renderBpm() {
    bpmInput.value = String(bpm);
    bpmSlider.value = String(bpm);
    renderTempoName();
  }
  function renderStatus() {
    if (!isPlaying) { statusEl.textContent = tr("tool.status.stopped", "Stopped"); return; }
    var tmpl = tr("tool.status.playing", "Playing at {bpm} BPM, {sig} time");
    statusEl.textContent = tmpl.replace("{bpm}", String(bpm)).replace("{sig}", sig);
  }
  function setPlayLabel() {
    var key = isPlaying ? "tool.play.stop" : "tool.play.start";
    playBtn.setAttribute("data-i18n", key);
    playBtn.textContent = tr(key, isPlaying ? "■ Stop" : "▶ Start");
    playBtn.setAttribute("aria-pressed", isPlaying ? "true" : "false");
    playBtn.classList.toggle("is-playing", isPlaying);
  }
  function showHint(text) {
    if (!bpmHintEl) return;
    bpmHintEl.textContent = text;
    bpmHintEl.hidden = false;
  }
  function clearHint() {
    if (!bpmHintEl) return;
    bpmHintEl.hidden = true;
    bpmHintEl.textContent = "";
  }

  /* ---- Web Audio 클릭음 ---- */
  function ensureAudio() {
    if (audioCtx) return true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error("no webaudio");
      audioCtx = new AC();
      return true;
    } catch (e) { audioCtx = null; return false; }
  }
  function scheduleClick(beatNum, time) {
    var accented = TIME_SIGS[sig].accents.indexOf(beatNum) !== -1;
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = accented ? 1500 : 1000;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accented ? 1 : 0.5, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + NOTE_LEN);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + NOTE_LEN + 0.02);
    notesInQueue.push({ beat: beatNum, time: time });
  }
  // "A Tale of Two Clocks" 패턴: setInterval 로 소리를 직접 내지 않고, Web Audio 의 정확한
  // 클록(audioCtx.currentTime) 기준으로 SCHEDULE_AHEAD 만큼 미리 큐에 넣는다 — 렌더링으로
  // 메인 스레드가 바빠도 오디오 타이밍은 드리프트하지 않는다.
  function nextNote() {
    nextNoteTime += secPerBeat(bpm);
    currentBeat = (currentBeat + 1) % TIME_SIGS[sig].beats;
  }
  function schedulerTick() {
    while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD) {
      scheduleClick(currentBeat, nextNoteTime);
      nextNote();
    }
  }
  // 시각 표시는 오디오 클록을 뒤따라가며 큐에서 "이미 재생 시각이 지난" 노트만 반영한다.
  function drawLoop() {
    if (!isPlaying) return;
    var now = audioCtx.currentTime;
    while (notesInQueue.length && notesInQueue[0].time <= now) {
      lastDrawnBeat = notesInQueue[0].beat;
      notesInQueue.shift();
    }
    var dots = beatsWrap.querySelectorAll(".metro-dot");
    for (var i = 0; i < dots.length; i++) dots[i].classList.toggle("on", i === lastDrawnBeat);
    rafId = requestAnimationFrame(drawLoop);
  }

  function startPlayback() {
    if (isPlaying) return;
    if (!ensureAudio()) {
      showHint(tr("tool.err.noAudio", "Sound isn't supported in this browser — no Web Audio backend available."));
      return;
    }
    if (audioCtx.state === "suspended") {
      var p = audioCtx.resume();
      if (p && p.catch) p.catch(function () { /* 재개 실패는 다음 클릭에서 재시도 */ });
    }
    isPlaying = true;
    currentBeat = 0;
    notesInQueue = [];
    lastDrawnBeat = -1;
    nextNoteTime = audioCtx.currentTime + 0.05;
    schedulerId = setInterval(schedulerTick, LOOKAHEAD_MS);
    rafId = requestAnimationFrame(drawLoop);
    setPlayLabel();
    renderStatus();
  }
  function stopPlayback() {
    if (!isPlaying) return;
    isPlaying = false;
    if (schedulerId) { clearInterval(schedulerId); schedulerId = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    notesInQueue = [];
    var dots = beatsWrap.querySelectorAll(".metro-dot");
    for (var i = 0; i < dots.length; i++) dots[i].classList.remove("on");
    setPlayLabel();
    renderStatus();
  }
  function togglePlayback() { if (isPlaying) stopPlayback(); else startPlayback(); }

  /* ---- BPM/박자 변경 ---- */
  // 재생 중 템포를 바꿔도 이미 큐에 들어간(다음 100ms 이내) 클릭은 그대로 재생되고,
  // 그 다음 클릭부터 새 템포가 적용된다 — 갑작스런 점프 없이 자연스럽게 전환된다.
  function setBpm(raw) {
    var trimmed = String(raw == null ? "" : raw).trim();
    var parsed = parseFloat(trimmed.replace(/,/g, ""));
    bpm = clampBpm(raw, bpm);
    renderBpm();
    saveState();
    if (trimmed === "") {
      showHint(tr("tool.err.empty", "Enter a tempo between {min} and {max} BPM.")
        .replace("{min}", String(MIN_BPM)).replace("{max}", String(MAX_BPM)));
    } else if (!isFinite(parsed)) {
      showHint(tr("tool.err.invalid", "Enter a number between {min} and {max} BPM.")
        .replace("{min}", String(MIN_BPM)).replace("{max}", String(MAX_BPM)));
    } else if (parsed < MIN_BPM || parsed > MAX_BPM) {
      showHint(tr("tool.err.range", "Tempo is clamped to {min}–{max} BPM.")
        .replace("{min}", String(MIN_BPM)).replace("{max}", String(MAX_BPM)));
    } else {
      clearHint();
    }
    if (isPlaying) renderStatus();
  }
  function setSig(newSig) {
    sig = normSig(newSig);
    sigSelect.value = sig;
    currentBeat = 0; // 박자 변경 시 마디 처음부터 다시 (인덱스 불일치 방지)
    renderBeatsDom();
    saveState();
    if (isPlaying) renderStatus();
  }

  /* ---- 탭 템포 ---- */
  function onTap() {
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    if (taps.length && now - taps[taps.length - 1] > TAP_RESET_MS) taps = []; // 오래 끊기면 새로 시작
    taps.push(now);
    if (taps.length > TAP_WINDOW) taps.shift();
    var t = tapBpm(taps);
    if (t != null) {
      setBpm(t);
    } else {
      showHint(tr("tool.tap.hint", "Tap the button at least twice, in rhythm, to set a tempo."));
    }
    tapBtn.classList.remove("tapped");
    void tapBtn.offsetWidth; // 애니메이션 재시작
    tapBtn.classList.add("tapped");
  }

  /* ---- 이벤트 ---- */
  bpmInput.addEventListener("input", function () { setBpm(bpmInput.value); });
  bpmInput.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") { ev.preventDefault(); togglePlayback(); }
  });
  bpmSlider.addEventListener("input", function () { setBpm(bpmSlider.value); });
  bpmMinus.addEventListener("click", function () { setBpm(bpm - 1); });
  bpmPlus.addEventListener("click", function () { setBpm(bpm + 1); });
  sigSelect.addEventListener("change", function () { setSig(sigSelect.value); });
  playBtn.addEventListener("click", togglePlayback);
  tapBtn.addEventListener("click", onTap);
  for (var ti = 0; ti < tableRows.length; ti++) {
    tableRows[ti].addEventListener("click", function () { setBpm(this.getAttribute("data-bpm")); });
  }
  // 백그라운드 탭에서는 타이머가 스로틀되어 스케줄이 밀릴 수 있으므로, 조용히 드리프트되게
  // 두지 않고 명시적으로 정지한다 — 복귀 시 사용자가 다시 Start 를 눌러 재생을 시작한다.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && isPlaying) stopPlayback();
  });
  // 언어 전환 시 동적 문구 재번역 (정적 라벨은 data-i18n 훅으로 엔진이 처리)
  document.addEventListener("i18n:change", function () {
    renderTempoName();
    renderStatus();
    setPlayLabel();
  });

  /* ---- 초기화 ---- */
  loadState();
  sigSelect.value = sig;
  renderBeatsDom();
  renderBpm();
  setPlayLabel();
  renderStatus();
  // TOOLJS:END
})();
