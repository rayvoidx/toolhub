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
  /* Morse Code Translator — 텍스트 <-> 모스부호 양방향 실시간 변환.
     두 텍스트영역(text/morse)이 서로를 실시간으로 갱신한다. 오디오(WebAudio 비프)와
     플래시 미리보기는 국제 모스부호 표준(PARIS 타이밍: 점=1.2/WPM 초)을 따른다.
     상태: localStorage "<slug>:state" 만. 외부 API 없음, 모든 계산은 로컬. */

  /* ---- 국제 모스부호 표 (정적 데이터) ---- */
  var MORSE = {
    A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---",
    K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-",
    U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
    "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
    "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
    ".": ".-.-.-", ",": "--..--", "?": "..--..", "'": ".----.", "!": "-.-.--",
    "/": "-..-.", "(": "-.--.", ")": "-.--.-", "&": ".-...", ":": "---...",
    ";": "-.-.-.", "=": "-...-", "+": ".-.-.", "-": "-....-", "_": "..--.-",
    "\"": ".-..-.", "$": "...-..-", "@": ".--.-."
  };
  var REVERSE = {};
  (function buildReverse() {
    var k;
    for (k in MORSE) { if (Object.prototype.hasOwnProperty.call(MORSE, k)) REVERSE[MORSE[k]] = k; }
  })();
  // 표시 순서(문자 → 코드): 알파벳 → 숫자 → 문장부호 (SEO 차트용)
  var CHART_ORDER = "A B C D E F G H I J K L M N O P Q R S T U V W X Y Z 0 1 2 3 4 5 6 7 8 9 . , ? ' ! / ( ) & : ; = + - _ \" $ @".split(" ");

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // 유효 문자만 남기고 나머지는 제거 (점 · 대시 · 공백 · 슬래시). 제거 발생 여부를 함께 반환.
  function sanitizeMorse(raw) {
    var hadInvalid = false;
    var clean = String(raw == null ? "" : raw).replace(/[^.\-/\s]/g, function () { hadInvalid = true; return ""; });
    return { clean: clean, hadInvalid: hadInvalid };
  }
  // 텍스트 → 모스부호: 공백 묶음 = 단어 경계, 문자 사이는 한 칸, 단어 사이는 " / "
  function encodeText(raw) {
    var words = String(raw == null ? "" : raw).split(/\s+/).filter(function (w) { return w.length > 0; });
    var unsupported = [];
    var outWords = [];
    for (var i = 0; i < words.length; i++) {
      var chars = Array.from(words[i].toUpperCase());
      var codes = [];
      for (var j = 0; j < chars.length; j++) {
        var ch = chars[j];
        if (Object.prototype.hasOwnProperty.call(MORSE, ch)) codes.push(MORSE[ch]);
        else if (unsupported.indexOf(ch) === -1) unsupported.push(ch);
      }
      if (codes.length) outWords.push(codes.join(" "));
    }
    return { morse: outWords.join(" / "), unsupported: unsupported.slice(0, 6) };
  }
  // 모스부호 → 텍스트: "/" 로 단어 분리, 공백으로 문자 분리. 알 수 없는 유효-문자 시퀀스는 건너뛴다.
  function decodeMorse(raw) {
    var s = sanitizeMorse(raw);
    var words = s.clean.split("/");
    var unknown = [];
    var outWords = [];
    for (var i = 0; i < words.length; i++) {
      var tokens = words[i].trim().split(/\s+/).filter(function (t) { return t.length > 0; });
      var letters = "";
      for (var j = 0; j < tokens.length; j++) {
        var tok = tokens[j];
        if (Object.prototype.hasOwnProperty.call(REVERSE, tok)) letters += REVERSE[tok];
        else if (unknown.indexOf(tok) === -1) unknown.push(tok);
      }
      if (letters.length) outWords.push(letters);
    }
    return { text: outWords.join(" "), invalid: s.hadInvalid, unknown: unknown.slice(0, 6) };
  }
  // 재생 시퀀스 생성 — PARIS 표준: 점=1유닛, 대시=3유닛, 문자 내 간격=1, 문자 간 간격=3, 단어 간 간격=7
  function buildSequence(morseClean, wpm) {
    var unit = 1200 / (wpm > 0 ? wpm : 20);
    var seq = [];
    var words = morseClean.split("/").map(function (w) { return w.trim(); }).filter(function (w) { return w.length > 0; });
    for (var wi = 0; wi < words.length; wi++) {
      var letters = words[wi].split(/\s+/).filter(function (l) { return l.length > 0; });
      for (var li = 0; li < letters.length; li++) {
        var symbols = letters[li].split("");
        for (var si = 0; si < symbols.length; si++) {
          seq.push({ tone: true, dur: symbols[si] === "-" ? unit * 3 : unit });
          if (si < symbols.length - 1) seq.push({ tone: false, dur: unit });
        }
        if (li < letters.length - 1) seq.push({ tone: false, dur: unit * 3 });
      }
      if (wi < words.length - 1) seq.push({ tone: false, dur: unit * 7 });
    }
    return seq;
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      sanitizeMorse: sanitizeMorse, encodeText: encodeText, decodeMorse: decodeMorse,
      buildSequence: buildSequence, MORSE: MORSE, REVERSE: REVERSE
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var STATE_KEY = (CFG.slug || "morse-code-translator") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var textEl = $("text-input"), morseEl = $("morse-input");
  var textStatusEl = $("text-status"), morseStatusEl = $("morse-status");
  var clearBtn = $("clear-btn"), textCopyBtn = $("text-copy-btn"), morseCopyBtn = $("morse-copy-btn");
  var copyFeedbackEl = $("copy-feedback");
  var playBtn = $("play-btn"), wpmRange = $("wpm-range"), wpmLabelEl = $("wpm-label");
  var flashEl = $("flash-indicator"), audioEmptyEl = $("audio-empty-hint"), audioLiveEl = $("audio-live-status");
  var chartBody = $("chart-body");
  if (!textEl || !morseEl || !playBtn || !wpmRange) return;

  /* ---- 상태 저장/복원 ---- */
  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        text: textEl.value, morse: morseEl.value, wpm: Number(wpmRange.value)
      }));
    } catch (e) { /* private mode */ }
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && typeof data.text === "string") textEl.value = data.text;
      if (data && typeof data.morse === "string") morseEl.value = data.morse;
      if (data && data.wpm > 0) wpmRange.value = String(Math.min(40, Math.max(5, Math.round(data.wpm))));
    } catch (e) { /* 손상된 값 무시 */ }
  }

  /* ---- 상태 메시지 ---- */
  function hideStatus(el) { if (el) { el.hidden = true; el.textContent = ""; } }
  function updateTextStatus(unsupported) {
    if (!textStatusEl) return;
    if (unsupported.length) {
      textStatusEl.textContent = tr("tool.warn.unsupported", "Skipped unsupported characters: {chars}").replace("{chars}", unsupported.join(" "));
      textStatusEl.className = "mct-status is-warn";
      textStatusEl.hidden = false;
    } else {
      hideStatus(textStatusEl);
    }
  }
  function updateMorseStatus(invalid, unknown) {
    if (!morseStatusEl) return;
    var msgs = [];
    if (invalid) msgs.push(tr("tool.err.invalidMorse", "Morse code can only contain dots (.), dashes (-), spaces and / for word breaks."));
    if (unknown.length) msgs.push(tr("tool.warn.unknownMorse", "Skipped unrecognized Morse sequences: {chars}").replace("{chars}", unknown.join(" ")));
    if (msgs.length) {
      morseStatusEl.textContent = msgs.join(" ");
      morseStatusEl.className = "mct-status " + (invalid ? "is-error" : "is-warn");
      morseStatusEl.hidden = false;
    } else {
      hideStatus(morseStatusEl);
    }
  }

  /* ---- 재생 가능 여부 ---- */
  function hasPlayableMorse() { return sanitizeMorse(morseEl.value).clean.trim().length > 0; }
  function updatePlayEnabled() {
    var can = hasPlayableMorse();
    playBtn.disabled = !can;
    if (audioEmptyEl) audioEmptyEl.hidden = can;
    if (!can && playing) stopPlayback();
  }

  /* ---- 양방향 변환 ---- */
  function refreshFromText() {
    stopPlayback();
    var res = encodeText(textEl.value);
    morseEl.value = res.morse;
    updateTextStatus(res.unsupported);
    hideStatus(morseStatusEl);
    updatePlayEnabled();
    saveState();
  }
  function refreshFromMorse() {
    stopPlayback();
    var res = decodeMorse(morseEl.value);
    textEl.value = res.text;
    updateMorseStatus(res.invalid, res.unknown);
    hideStatus(textStatusEl);
    updatePlayEnabled();
    saveState();
  }

  /* ---- 복사 ---- */
  var feedbackTimer = null;
  function showFeedback(msg, isError) {
    if (!copyFeedbackEl) return;
    copyFeedbackEl.hidden = false;
    copyFeedbackEl.textContent = msg;
    copyFeedbackEl.style.color = isError ? "#b91c1c" : "var(--accent)";
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(function () { copyFeedbackEl.hidden = true; }, 2000);
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
      if (ok) showFeedback(tr("tool.copied", "Copied!"), false);
      else showFeedback(tr("tool.copyError", "Couldn't copy — please copy manually."), true);
    } catch (e) {
      showFeedback(tr("tool.copyError", "Couldn't copy — please copy manually."), true);
    }
  }
  function copyValue(value) {
    if (!value || !value.length) { showFeedback(tr("tool.emptyCopy", "Nothing to copy yet"), true); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(
        function () { showFeedback(tr("tool.copied", "Copied!"), false); },
        function () { fallbackCopy(value); }
      );
    } else {
      fallbackCopy(value);
    }
  }

  /* ---- 오디오 재생 (WebAudio) ---- */
  var audioCtx = null, playTimer = null, playing = false;
  function getCtx() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { audioCtx = null; }
    }
    return audioCtx;
  }
  function beep(ctx, durationMs) {
    if (!ctx) return;
    try {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 600;
      osc.connect(gain);
      gain.connect(ctx.destination);
      var now = ctx.currentTime;
      var stopAt = now + durationMs / 1000;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 0.006);
      gain.gain.setValueAtTime(0.22, Math.max(now, stopAt - 0.006));
      gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
      osc.start(now);
      osc.stop(stopAt + 0.02);
    } catch (e) { /* 오디오 실패는 조용히 무시 — 시각 플래시는 계속 동작 */ }
  }
  function setFlash(on) { if (flashEl) flashEl.classList.toggle("on", !!on); }
  function updatePlayButton() {
    playBtn.textContent = tr(playing ? "tool.audio.stop" : "tool.audio.play", playing ? "■ Stop" : "▶ Play");
  }
  function announceAudio(isPlaying) {
    if (!audioLiveEl) return;
    audioLiveEl.textContent = tr(isPlaying ? "tool.audio.playingStatus" : "tool.audio.stoppedStatus",
      isPlaying ? "Playing Morse code audio" : "Playback stopped");
  }
  function stopPlayback() {
    if (playTimer) { clearTimeout(playTimer); playTimer = null; }
    if (!playing) return;
    playing = false;
    setFlash(false);
    updatePlayButton();
    announceAudio(false);
  }
  function startPlayback() {
    var clean = sanitizeMorse(morseEl.value).clean;
    var seq = buildSequence(clean, Number(wpmRange.value));
    if (!seq.length) return;
    var ctx = getCtx();
    if (ctx && ctx.state === "suspended") { try { ctx.resume(); } catch (e) { /* noop */ } }
    playing = true;
    updatePlayButton();
    announceAudio(true);
    var i = 0;
    function step() {
      if (!playing) return;
      if (i >= seq.length) { stopPlayback(); return; }
      var seg = seq[i++];
      if (seg.tone) { beep(ctx, seg.dur); setFlash(true); } else { setFlash(false); }
      playTimer = setTimeout(step, seg.dur);
    }
    step();
  }

  /* ---- WPM 라벨 ---- */
  function renderWpmLabel() {
    if (!wpmLabelEl) return;
    wpmLabelEl.textContent = tr("tool.audio.wpmLabel", "Speed: {wpm} WPM").replace("{wpm}", wpmRange.value);
  }

  /* ---- 모스부호 차트 (SEO — 접기/펼치기 안의 표) ---- */
  function renderChart() {
    if (!chartBody) return;
    chartBody.textContent = "";
    for (var i = 0; i < CHART_ORDER.length; i++) {
      var ch = CHART_ORDER[i];
      var tr_ = document.createElement("tr");
      var tdCh = document.createElement("td");
      tdCh.textContent = ch;
      var tdCode = document.createElement("td");
      tdCode.className = "code";
      tdCode.textContent = MORSE[ch];
      tr_.appendChild(tdCh);
      tr_.appendChild(tdCode);
      chartBody.appendChild(tr_);
    }
    var gapRow = document.createElement("tr");
    var gapCh = document.createElement("td");
    gapCh.textContent = tr("tool.chart.wordGap", "Word break");
    var gapCode = document.createElement("td");
    gapCode.className = "code";
    gapCode.textContent = "/";
    gapRow.appendChild(gapCh);
    gapRow.appendChild(gapCode);
    chartBody.appendChild(gapRow);
  }

  /* ---- 이벤트 ---- */
  textEl.addEventListener("input", refreshFromText);
  morseEl.addEventListener("input", refreshFromMorse);
  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      stopPlayback();
      textEl.value = "";
      morseEl.value = "";
      hideStatus(textStatusEl);
      hideStatus(morseStatusEl);
      updatePlayEnabled();
      saveState();
      textEl.focus();
    });
  }
  if (textCopyBtn) textCopyBtn.addEventListener("click", function () { copyValue(textEl.value.trim()); });
  if (morseCopyBtn) morseCopyBtn.addEventListener("click", function () { copyValue(morseEl.value.trim()); });
  wpmRange.addEventListener("input", function () {
    stopPlayback();
    renderWpmLabel();
    saveState();
  });
  playBtn.addEventListener("click", function () {
    if (playing) stopPlayback(); else startPlayback();
  });
  document.addEventListener("i18n:change", function () {
    renderWpmLabel();
    updatePlayButton();
    renderChart();
    if (!textStatusEl.hidden) refreshFromText();
    if (!morseStatusEl.hidden) refreshFromMorse();
  });

  /* ---- 초기화 ---- */
  loadState();
  renderWpmLabel();
  renderChart();
  updatePlayButton();
  updatePlayEnabled();
  // TOOLJS:END
})();
