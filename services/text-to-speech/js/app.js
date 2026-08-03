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
  /* Text to Speech — 브라우저 내장 Web Speech API(speechSynthesis)로 텍스트를 읽어준다.
     외부 API·서버 없음. 음성 목록은 기기/브라우저가 제공하는 것만 사용.
     상태: localStorage "<slug>:state" (텍스트/음성/속도/피치)만 저장. */

  function $(id) { return document.getElementById(id); }
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "text-to-speech") + ":state";

  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }

  var textEl = $("tts-text"), charCountEl = $("char-count-num");
  var viewEl = $("tts-view");
  var voiceEl = $("voice-select"), voiceNoteEl = $("voice-note");
  var rateEl = $("rate"), rateValEl = $("rate-val");
  var pitchEl = $("pitch"), pitchValEl = $("pitch-val");
  var primaryBtn = $("play-btn"), stopBtn = $("stop-btn");
  var statusEl = $("tts-status"), errEl = $("tts-error");
  var unsupportedEl = $("tts-unsupported");
  if (!textEl || !voiceEl || !primaryBtn || !stopBtn) return;

  /* ---- 지원 여부 ---- */
  var supported = ("speechSynthesis" in window) && (typeof window.SpeechSynthesisUtterance !== "undefined");
  if (!supported) {
    if (unsupportedEl) { unsupportedEl.hidden = false; unsupportedEl.textContent = tr("tool.err.unsupported"); }
    [textEl, voiceEl, rateEl, pitchEl, primaryBtn, stopBtn].forEach(function (el) {
      if (el) el.disabled = true;
    });
    return;
  }
  var synth = window.speechSynthesis;

  /* ---- 저장 상태 ---- */
  function loadState() {
    try {
      var raw = localStorage.getItem(SKEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveState() {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        text: textEl.value,
        voiceURI: voiceEl.value,
        rate: rateEl.value,
        pitch: pitchEl.value
      }));
    } catch (e) { /* private mode — 저장만 실패, 기능은 정상 */ }
  }
  var stateInit = loadState();

  /* ---- 오류/상태 표시 ---- */
  function showError(msg) {
    if (!errEl) return;
    errEl.textContent = msg;
    errEl.hidden = false;
  }
  function hideError() {
    if (!errEl) return;
    errEl.hidden = true;
    errEl.textContent = "";
  }
  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || "";
  }

  /* ---- 글자 수 + 예상 재생 시간 ---- */
  var etaWrapEl = $("eta-wrap"), etaValEl = $("eta-val"), limitNoteEl = $("limit-note");
  var WPM = 165; // rate 1.0 기준 일반적인 TTS 낭독 속도
  function wordCount(t) { var m = t.match(/\S+/g); return m ? m.length : 0; }
  function fmtDuration(sec) {
    sec = Math.max(1, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = (h && m < 10 ? "0" : "") + m;
    return (h ? h + ":" : "") + mm + ":" + (s < 10 ? "0" : "") + s;
  }
  function updateCharCount() {
    var t = textEl.value;
    if (charCountEl) charCountEl.textContent = String(t.length);
    if (limitNoteEl) limitNoteEl.hidden = !(textEl.maxLength > 0 && t.length >= textEl.maxLength);
    if (!etaWrapEl || !etaValEl) return;
    var w = wordCount(t);
    if (!w) { etaWrapEl.hidden = true; return; }
    etaWrapEl.hidden = false;
    etaValEl.textContent = fmtDuration(w / (WPM * clampRate(rateEl ? rateEl.value : 1)) * 60);
  }

  /* ---- 음성 목록 (언어별 그룹) ---- */
  var voices = [];
  function regionOrLangName(dn, tag) {
    if (dn) {
      try { var n = dn.of(tag); if (n && n !== tag) return n; } catch (e) { /* 폴백 */ }
    }
    return tag;
  }
  function langDisplayNames() {
    try {
      if (typeof Intl !== "undefined" && Intl.DisplayNames) {
        return new Intl.DisplayNames([uiLang()], { type: "language" });
      }
    } catch (e) { /* 미지원 브라우저 */ }
    return null;
  }
  function voiceKey(v) { return v.voiceURI + "|" + v.lang; }
  function renderVoiceOptions() {
    var prevSelected = voiceEl.value;
    voiceEl.textContent = "";
    if (!voices.length) {
      if (voiceNoteEl) voiceNoteEl.hidden = false;
      return;
    }
    if (voiceNoteEl) voiceNoteEl.hidden = true;

    var dn = langDisplayNames();
    var groups = {}; // lang -> voices[]
    var i;
    for (i = 0; i < voices.length; i++) {
      var v = voices[i];
      var lang = v.lang || "?";
      if (!groups[lang]) groups[lang] = [];
      groups[lang].push(v);
    }
    var langs = Object.keys(groups);
    langs.sort(function (a, b) {
      var na = regionOrLangName(dn, a), nb = regionOrLangName(dn, b);
      return na < nb ? -1 : (na > nb ? 1 : 0);
    });

    var offlineTag = tr("tool.voice.offlineTag", "(offline)");
    var onlineTag = tr("tool.voice.onlineTag", "(online)");

    for (i = 0; i < langs.length; i++) {
      var lang2 = langs[i];
      var list = groups[lang2].slice();
      list.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
      var og = document.createElement("optgroup");
      og.label = regionOrLangName(dn, lang2);
      for (var j = 0; j < list.length; j++) {
        var voice = list[j];
        var opt = document.createElement("option");
        opt.value = voiceKey(voice);
        opt.textContent = voice.name + " — " + (voice.localService ? offlineTag : onlineTag);
        og.appendChild(opt);
      }
      voiceEl.appendChild(og);
    }

    // 복원 우선순위: 이전 선택값 → 저장된 값 → UI 언어와 일치하는 첫 음성 → 첫 음성
    var wanted = prevSelected || (stateInit && stateInit.voiceURI) || "";
    var found = false;
    for (i = 0; i < voiceEl.options.length; i++) {
      if (voiceEl.options[i].value === wanted) { voiceEl.value = wanted; found = true; break; }
    }
    if (!found) {
      var ui = uiLang();
      for (i = 0; i < voices.length; i++) {
        if (voices[i].lang && voices[i].lang.toLowerCase().indexOf(ui.toLowerCase()) === 0) {
          voiceEl.value = voiceKey(voices[i]);
          found = true;
          break;
        }
      }
    }
    if (!found && voiceEl.options.length) voiceEl.selectedIndex = 0;
    updateVoiceNote();
  }
  function getSelectedVoice() {
    var key = voiceEl.value;
    for (var i = 0; i < voices.length; i++) {
      if (voiceKey(voices[i]) === key) return voices[i];
    }
    return voices.length ? voices[0] : null;
  }
  function updateVoiceNote() {
    if (!voiceNoteEl || !voices.length) return;
    var v = getSelectedVoice();
    if (!v) return;
    voiceNoteEl.hidden = false;
    voiceNoteEl.textContent = v.localService ? tr("tool.voice.noteOffline") : tr("tool.voice.noteOnline");
  }
  var voicePollTimer = null;
  function loadVoices() {
    voices = synth.getVoices() || [];
    renderVoiceOptions();
    if (voices.length && voicePollTimer) { clearInterval(voicePollTimer); voicePollTimer = null; }
  }
  if ("onvoiceschanged" in synth) synth.addEventListener("voiceschanged", loadVoices);
  loadVoices();
  // 일부 브라우저(구형 Safari 등)는 voiceschanged 를 쏘지 않으므로 짧게 폴링 후 포기
  voicePollTimer = setInterval(loadVoices, 300);
  setTimeout(function () { if (voicePollTimer) { clearInterval(voicePollTimer); voicePollTimer = null; } }, 4000);

  /* ---- 단어 하이라이트 (boundary 이벤트가 있을 때만 진보적으로 표시) ---- */
  var wordSpans = [], activeSpan = null, spansBuilt = false;
  function buildHighlightView(text) {
    viewEl.textContent = "";
    wordSpans = [];
    var re = /\S+/g, m, lastIndex = 0;
    while ((m = re.exec(text))) {
      if (m.index > lastIndex) viewEl.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
      var span = document.createElement("span");
      span.className = "tts-word";
      span.textContent = m[0];
      viewEl.appendChild(span);
      wordSpans.push({ start: m.index, end: m.index + m[0].length, el: span });
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < text.length) viewEl.appendChild(document.createTextNode(text.slice(lastIndex)));
    spansBuilt = true;
  }
  function highlightAt(charIndex) {
    if (!wordSpans.length) return;
    var found = null, i;
    for (i = 0; i < wordSpans.length; i++) {
      var w = wordSpans[i];
      if (charIndex >= w.start && charIndex < w.end) { found = w; break; }
      if (charIndex < w.start) { found = i > 0 ? wordSpans[i - 1] : w; break; }
    }
    if (!found) found = wordSpans[wordSpans.length - 1];
    if (activeSpan && activeSpan !== found) activeSpan.el.classList.remove("active");
    found.el.classList.add("active");
    activeSpan = found;
    try { found.el.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) { /* 구형 브라우저 */ }
  }
  function clearHighlight() {
    if (activeSpan) { activeSpan.el.classList.remove("active"); activeSpan = null; }
  }
  function hideView() {
    if (!viewEl) return;
    viewEl.hidden = true;
    viewEl.textContent = "";
    wordSpans = [];
    spansBuilt = false;
  }

  /* ---- Chrome 장문 정지 버그 워크어라운드 (~15초 후 재생이 멎는 알려진 버그)
     10초마다 pause→resume 를 찔러 내부 타이머를 리셋한다. 버그 없는 브라우저에서도
     무해(이미 멈춘 상태면 조용히 무시)하므로 항상 걸어둔다. ---- */
  var watchdogTimer = null;
  function startWatchdog() {
    stopWatchdog();
    watchdogTimer = setInterval(function () {
      if (!synth.speaking) { stopWatchdog(); return; }
      if (synth.paused) return; // 사용자가 일시정지한 상태는 건드리지 않는다
      try { synth.pause(); synth.resume(); } catch (e) { /* 일부 브라우저 미지원 */ }
    }, 10000);
  }
  function stopWatchdog() {
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  }

  /* ---- 재생 상태 머신 ---- */
  var state = "idle"; // idle | speaking | paused
  function updateButtons() {
    if (state === "idle") {
      primaryBtn.textContent = tr("tool.play", "▶ Play");
      stopBtn.disabled = true;
    } else if (state === "speaking") {
      primaryBtn.textContent = tr("tool.pause", "⏸ Pause");
      stopBtn.disabled = false;
    } else if (state === "paused") {
      primaryBtn.textContent = tr("tool.resume", "▶ Resume");
      stopBtn.disabled = false;
    }
  }
  function setState(s) { state = s; updateButtons(); }

  /* ---- 숫자 클램프 (슬라이더는 HTML min/max 로 막히지만 방어적으로 한 번 더) ---- */
  function clampRate(n) { n = parseFloat(n); if (!isFinite(n)) n = 1; return Math.min(3, Math.max(0.25, n)); }
  // 0.25 같은 세밀한 값도 보이도록 소수 2자리 후 불필요한 0만 제거 (1.00 → 1.0)
  function fmtRate(n) { return n.toFixed(2).replace(/0$/, ""); }
  function clampPitch(n) { n = parseFloat(n); if (!isFinite(n)) n = 1; return Math.min(2, Math.max(0, n)); }

  function updateSliderLabels() {
    if (rateValEl) rateValEl.textContent = fmtRate(clampRate(rateEl.value)) + "×";
    if (pitchValEl) pitchValEl.textContent = clampPitch(pitchEl.value).toFixed(1);
  }

  /* ---- 발화 시작/제어 ---- */
  var utter = null;
  function startSpeaking() {
    var text = textEl.value;
    if (!text || !text.replace(/\s+/g, "").length) {
      showError(tr("tool.err.empty"));
      return;
    }
    hideError();
    clearHighlight();
    hideView();

    var voice = getSelectedVoice();
    utter = new window.SpeechSynthesisUtterance(text);
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = uiLang();
    }
    utter.rate = clampRate(rateEl.value);
    utter.pitch = clampPitch(pitchEl.value);

    utter.onstart = function () { setState("speaking"); startWatchdog(); setStatus(tr("tool.status.speaking")); };
    utter.onresume = function () { setState("speaking"); setStatus(tr("tool.status.speaking")); };
    utter.onpause = function () { setState("paused"); setStatus(tr("tool.status.paused")); };
    utter.onend = function () {
      setState("idle"); stopWatchdog(); clearHighlight(); hideView();
      setStatus(tr("tool.status.done"));
    };
    utter.onerror = function (e) {
      setState("idle"); stopWatchdog(); clearHighlight(); hideView();
      var kind = e && e.error;
      if (kind === "canceled" || kind === "interrupted") { setStatus(""); return; } // 사용자가 멈춘 것 — 오류 아님
      if (kind === "not-allowed") { showError(tr("tool.err.blocked")); return; }
      showError(tr("tool.err.speak"));
    };
    utter.addEventListener("boundary", function (e) {
      if (e.name && e.name !== "word") return; // 문장 경계 이벤트는 무시, 단어만 하이라이트
      if (!spansBuilt) buildHighlightView(text);
      if (wordSpans.length) { viewEl.hidden = false; highlightAt(e.charIndex || 0); }
    });

    synth.cancel(); // 큐에 남은 이전 발화 정리
    synth.speak(utter);
    saveState();
  }

  primaryBtn.addEventListener("click", function () {
    if (state === "speaking") { synth.pause(); return; }
    if (state === "paused") { synth.resume(); return; }
    startSpeaking();
  });
  stopBtn.addEventListener("click", function () {
    if (state !== "idle") synth.cancel();
  });

  textEl.addEventListener("input", function () { updateCharCount(); hideError(); saveState(); });
  rateEl.addEventListener("input", function () { updateSliderLabels(); updateCharCount(); saveState(); });
  pitchEl.addEventListener("input", function () { updateSliderLabels(); saveState(); });
  voiceEl.addEventListener("change", function () { updateVoiceNote(); saveState(); });

  // 언어 전환 시 음성 그룹 라벨·오프라인/온라인 표기·버튼 라벨 재적용
  document.addEventListener("i18n:change", function () {
    renderVoiceOptions();
    updateButtons();
  });

  // 페이지 이탈 시 재생 정리 (탭을 떠나도 백그라운드에서 계속 말하지 않도록)
  window.addEventListener("beforeunload", function () { try { synth.cancel(); } catch (e) { /* noop */ } });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state !== "idle") { try { synth.cancel(); } catch (e) { /* noop */ } }
  });

  /* ---- 초기화 ---- */
  if (stateInit && typeof stateInit.text === "string") textEl.value = stateInit.text;
  if (stateInit && stateInit.rate != null) rateEl.value = stateInit.rate;
  if (stateInit && stateInit.pitch != null) pitchEl.value = stateInit.pitch;
  updateCharCount();
  updateSliderLabels();
  updateButtons();
  // TOOLJS:END
})();
