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
  /* Typing Speed Test — 400여 개의 흔한 영단어(Fry Instant Words 기반, 전부 baked)를
     무작위로 뽑아 스트림으로 보여주고, 30초/1분/3분 중 고른 시간 동안 입력을 받아
     Net WPM · Gross WPM · 정확도 · 정오 글자 수를 계산한다. 외부 fetch 없음. */

  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "typing-test";
  var LS_STATE = SLUG + ":state"; // 상태 저장은 "<slug>:" prefix 만 사용 (선택한 테스트 시간만 영속화)

  var ALLOWED_DUR = [30, 60, 180];
  var DEFAULT_DUR = 60;
  var INITIAL_WORDS = 80;       // 첫 렌더 시 미리 채우는 단어 수
  var BUFFER_LOOKAHEAD = 15;    // 남은 미입력 단어가 이 수 이하로 줄면 버퍼 확장
  var CHUNK = 60;               // 확장 시 추가하는 단어 수
  var MAX_TOTAL_WORDS = 4000;   // 안전 상한 — 실제로는 절대 도달하지 않음(3분 300WPM=900단어)
  var TICK_MS = 200;

  /* ---- 흔한 영단어 400여 개 (Fry Instant Words 1-400, 전부 baked — 외부 fetch 없음) ---- */
  var WORDS = [
    "the","of","and","a","to","in","is","you","that","it",
    "he","was","for","on","are","as","with","his","they","at",
    "be","this","have","from","or","one","had","by","word","but",
    "not","what","all","were","we","when","your","can","said","there",
    "use","an","each","which","she","do","how","their","if","will",
    "up","other","about","out","many","then","them","these","so","some",
    "her","would","make","like","him","into","time","has","look","two",
    "more","write","go","see","number","no","way","could","people","my",
    "than","first","water","been","call","who","oil","its","now","find",
    "long","down","day","did","get","come","made","may","part","over",
    "new","sound","take","only","little","work","know","place","year","live",
    "me","back","give","most","very","after","thing","our","just","name",
    "good","sentence","man","think","say","great","where","help","through","much",
    "before","line","right","too","mean","old","any","same","tell","boy",
    "follow","came","want","show","also","around","form","three","small","set",
    "put","end","does","another","well","large","must","big","even","such",
    "because","turn","here","why","ask","went","men","read","need","land",
    "different","home","us","move","try","kind","hand","picture","again","change",
    "off","play","spell","air","away","animal","house","point","page","letter",
    "mother","answer","found","study","still","learn","should","world","high","every",
    "near","add","food","between","own","below","country","plant","last","school",
    "father","keep","tree","never","start","city","earth","eye","light","thought",
    "head","under","story","saw","left","few","while","along","might","close",
    "something","seem","next","hard","open","example","begin","life","always","those",
    "both","paper","together","got","group","often","run","important","until","children",
    "side","feet","car","mile","night","walk","white","sea","began","grow",
    "took","river","four","carry","state","once","book","hear","stop","without",
    "second","later","miss","idea","enough","eat","face","watch","far","really",
    "almost","let","above","girl","sometimes","mountain","cut","young","talk","soon",
    "list","song","being","leave","family","body","music","color","stand","sun",
    "questions","fish","area","mark","dog","horse","cat","bird","teeth","shoulder",
    "space","hair","ago","ran","check","game","shape","equal","hot","chief",
    "brought","heat","snow","tire","bring","yes","distant","fill","east","paint",
    "language","wheel","force","cold","cry","dark","machine","note","wait","plan",
    "figure","star","box","noun","field","rest","correct","able","pound","done",
    "beauty","drive","stood","contain","front","teach","week","final","gave","green",
    "quick","develop","ocean","warm","free","minute","strong","special","mind","behind",
    "clear","tail","produce","fact","street","inch","multiply","nothing","course","stay",
    "full","object","decide","surface","deep","moon","island","system","busy","test",
    "record","boat","common","gold","possible","plane","stead","dry","wonder","laugh",
    "thousand"
  ];

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // 저장된/URL 시간값을 허용 목록(30/60/180)으로 정규화, 그 외는 기본값
  function clampDuration(raw) {
    var n = parseInt(raw, 10);
    return ALLOWED_DUR.indexOf(n) !== -1 ? n : DEFAULT_DUR;
  }
  // 단어 하나의 채점: 일치 글자=correct, 불일치/여분/누락 글자=incorrect
  function tallyWord(target, typed) {
    target = String(target == null ? "" : target);
    typed = String(typed == null ? "" : typed);
    var max = Math.max(target.length, typed.length);
    var correct = 0, incorrect = 0;
    for (var i = 0; i < max; i++) {
      if (i < target.length && i < typed.length) {
        if (target.charAt(i) === typed.charAt(i)) correct++; else incorrect++;
      } else {
        incorrect++; // 타깃보다 더 친 글자(여분) 또는 못 친 글자(누락) 모두 오답 처리
      }
    }
    return { correct: correct, incorrect: incorrect, allCorrect: typed === target };
  }
  // Gross/Net WPM · 정확도. 5글자=1단어 관용 표기. Net = ((정타/5) - 오타) / 분, 0 하한.
  function computeStats(correctChars, incorrectChars, elapsedMs) {
    correctChars = correctChars > 0 ? correctChars : 0;
    incorrectChars = incorrectChars > 0 ? incorrectChars : 0;
    var totalChars = correctChars + incorrectChars;
    var minutes = elapsedMs > 0 ? elapsedMs / 60000 : 0;
    var accuracy = totalChars > 0 ? Math.round((correctChars / totalChars) * 100) : 100;
    if (minutes <= 0) return { grossWpm: 0, netWpm: 0, accuracy: accuracy, totalChars: totalChars };
    var grossWpm = Math.round((totalChars / 5) / minutes);
    var netWpmRaw = ((correctChars / 5) - incorrectChars) / minutes;
    var netWpm = Math.max(0, Math.round(netWpmRaw));
    return { grossWpm: grossWpm, netWpm: netWpm, accuracy: accuracy, totalChars: totalChars };
  }
  // 단어 풀에서 count개를 무작위 복원추출 (rng 주입 가능 — 노드 테스트용)
  function pickWords(pool, count, rng) {
    rng = rng || Math.random;
    var out = [];
    if (!pool || !pool.length) return out;
    for (var i = 0; i < count; i++) {
      var idx = Math.floor(rng() * pool.length);
      if (idx < 0) idx = 0;
      if (idx >= pool.length) idx = pool.length - 1;
      out.push(pool[idx]);
    }
    return out;
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      clampDuration: clampDuration, tallyWord: tallyWord,
      computeStats: computeStats, pickWords: pickWords, WORDS: WORDS
    };
    return;
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var durBtns = document.querySelectorAll("#tool .tt-dur");
  var timerEl = $("tt-timer"), wpmLiveEl = $("tt-wpm-live"), accLiveEl = $("tt-acc-live");
  var wordsBoxEl = $("tt-words");
  var inputEl = $("tt-input"), hintEl = $("tt-hint"), restartBtn = $("tt-restart");
  var resultEl = $("tt-result");
  var netEl = $("tt-r-net"), grossEl = $("tt-r-gross"), accEl = $("tt-r-acc");
  var wordsCountEl = $("tt-r-words"), correctEl = $("tt-r-correct"), wrongEl = $("tt-r-wrong");
  if (!inputEl || !wordsBoxEl || !timerEl || !restartBtn || !resultEl) return;

  /* ---- i18n · 로케일 헬퍼 ---- */
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtNum(n) {
    try { return new Intl.NumberFormat(uiLang()).format(n); } catch (e) { return String(n); }
  }
  function fmtPct(n) {
    try { return new Intl.NumberFormat(uiLang(), { style: "percent", maximumFractionDigits: 0 }).format(n / 100); }
    catch (e) { return n + "%"; }
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---- 상태 ---- */
  var DURATION = DEFAULT_DUR;
  var words = [];        // 목표 단어 문자열 배열
  var wordEls = [];      // words 와 1:1 대응하는 DOM span
  var wordIndex = 0;
  var correctChars = 0, incorrectChars = 0, wordsCompleted = 0;
  var started = false, finished = false;
  var startTime = 0, endTime = 0, tickId = null;

  /* ---- 영속화 (선택한 테스트 시간만 — 진행 중인 회차는 저장하지 않음) ---- */
  function persist() {
    try { localStorage.setItem(LS_STATE, JSON.stringify({ duration: DURATION })); }
    catch (e) { /* private mode — 저장만 실패, 동작은 정상 */ }
  }
  function loadPersistedDuration() {
    try {
      var raw = localStorage.getItem(LS_STATE);
      if (!raw) return DEFAULT_DUR;
      var p = JSON.parse(raw);
      return clampDuration(p && p.duration);
    } catch (e) { return DEFAULT_DUR; }
  }

  /* ---- 단어 스트림 빌드 ---- */
  function buildWordSpan(word) {
    var span = document.createElement("span");
    span.className = "tt-word";
    span.textContent = word;
    return span;
  }
  function appendWords(list) {
    for (var i = 0; i < list.length; i++) {
      words.push(list[i]);
      var el = buildWordSpan(list[i]);
      wordEls.push(el);
      wordsBoxEl.appendChild(el);
    }
  }
  function ensureBuffer() {
    if (words.length - wordIndex < BUFFER_LOOKAHEAD && words.length < MAX_TOTAL_WORDS) {
      appendWords(pickWords(WORDS, CHUNK, Math.random));
    }
  }
  function markCurrent() {
    if (wordEls[wordIndex]) wordEls[wordIndex].className = "tt-word tt-current";
  }

  /* ---- 렌더 ---- */
  function renderCurrentWord(typed) {
    var target = words[wordIndex];
    var el = wordEls[wordIndex];
    if (target == null || !el) return;
    var html = "", i;
    for (i = 0; i < target.length; i++) {
      var cls = "tt-char";
      if (i < typed.length) cls += (typed.charAt(i) === target.charAt(i)) ? " correct" : " incorrect";
      html += '<span class="' + cls + '">' + escapeHtml(target.charAt(i)) + "</span>";
    }
    if (typed.length > target.length) {
      var extra = typed.slice(target.length);
      for (i = 0; i < extra.length; i++) {
        html += '<span class="tt-char extra">' + escapeHtml(extra.charAt(i)) + "</span>";
      }
    }
    el.innerHTML = html;
  }
  function finalizeWord(idx, wrong) {
    var el = wordEls[idx];
    if (!el) return;
    el.className = "tt-word tt-done" + (wrong ? " tt-wrong" : "");
    el.textContent = words[idx];
  }
  function scrollCurrentIntoView() {
    var el = wordEls[wordIndex];
    if (!el || !el.scrollIntoView) return;
    var reduced = false;
    try { reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { /* 미지원 브라우저 — 기본 동작 사용 */ }
    try { el.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" }); }
    catch (e) { try { el.scrollIntoView(); } catch (e2) { /* noop */ } }
  }

  /* ---- 실시간 통계 ---- */
  function updateLiveStats() {
    if (!started) return;
    var elapsed = finished ? DURATION * 1000 : (Date.now() - startTime);
    var st = computeStats(correctChars, incorrectChars, elapsed);
    wpmLiveEl.textContent = fmtNum(st.netWpm);
    accLiveEl.textContent = fmtPct(st.accuracy);
  }

  /* ---- 단어 커밋 (스페이스/Enter 또는 시간 종료 시) ---- */
  function commitWord(typed, countSpace) {
    var target = words[wordIndex];
    if (target == null) return; // MAX_TOTAL_WORDS 상한 도달 등 — 조용히 무시(실사용에서 도달 불가)
    var tally = tallyWord(target, typed);
    correctChars += tally.correct;
    incorrectChars += tally.incorrect;
    if (countSpace) correctChars += 1; // 커밋을 유발한 스페이스 자체는 항상 정타로 계산
    wordsCompleted += 1;
    finalizeWord(wordIndex, !tally.allCorrect);
    wordIndex += 1;
    ensureBuffer();
    markCurrent();
  }

  /* ---- 타이머 ---- */
  function tick() {
    var remain = endTime - Date.now();
    if (remain <= 0) { finishTest(); return; }
    timerEl.textContent = fmtNum(Math.ceil(remain / 1000));
    updateLiveStats();
  }
  function startTest() {
    if (started) return;
    started = true;
    startTime = Date.now();
    endTime = startTime + DURATION * 1000;
    if (hintEl) hintEl.hidden = true;
    tickId = setInterval(tick, TICK_MS);
    tick();
  }
  function finishTest() {
    if (tickId) { clearInterval(tickId); tickId = null; }
    finished = true;
    timerEl.textContent = "0";
    var leftover = inputEl.value;
    if (leftover.length > 0) commitWord(leftover, false); // 남은 부분 단어도 채점(스페이스 보너스 없음)
    inputEl.value = "";
    inputEl.disabled = true;
    var st = computeStats(correctChars, incorrectChars, DURATION * 1000);
    showResult(st);
  }
  function showResult(st) {
    netEl.textContent = fmtNum(st.netWpm);
    grossEl.textContent = fmtNum(st.grossWpm);
    accEl.textContent = fmtPct(st.accuracy);
    wordsCountEl.textContent = fmtNum(wordsCompleted);
    correctEl.textContent = fmtNum(correctChars);
    wrongEl.textContent = fmtNum(incorrectChars);
    resultEl.hidden = false;
    restartBtn.focus();
  }

  /* ---- 입력 처리 ---- */
  function handleInput() {
    if (finished) { inputEl.value = ""; return; }
    if (!started) startTest();
    var val = inputEl.value;
    while (true) {
      var sp = val.indexOf(" ");
      if (sp === -1) break;
      commitWord(val.slice(0, sp), true);
      val = val.slice(sp + 1);
    }
    inputEl.value = val;
    renderCurrentWord(val);
    scrollCurrentIntoView();
    updateLiveStats();
  }

  /* ---- 재시작 (시간 변경 포함) — 새 무작위 순서로 완전히 새 회차 ---- */
  function resetTest(newDur) {
    if (tickId) { clearInterval(tickId); tickId = null; }
    if (newDur != null) DURATION = clampDuration(newDur);
    persist();
    started = false; finished = false;
    wordIndex = 0; correctChars = 0; incorrectChars = 0; wordsCompleted = 0;
    words = []; wordEls = [];
    wordsBoxEl.innerHTML = "";
    appendWords(pickWords(WORDS, INITIAL_WORDS, Math.random));
    markCurrent();
    inputEl.disabled = false;
    inputEl.value = "";
    resultEl.hidden = true;
    if (hintEl) hintEl.hidden = false;
    timerEl.textContent = fmtNum(DURATION);
    wpmLiveEl.textContent = fmtNum(0);
    accLiveEl.textContent = fmtPct(100);
    updateDurButtons();
    try { inputEl.focus(); } catch (e) { /* noop */ }
  }
  function updateDurButtons() {
    for (var i = 0; i < durBtns.length; i++) {
      var d = parseInt(durBtns[i].getAttribute("data-dur"), 10);
      durBtns[i].setAttribute("aria-pressed", d === DURATION ? "true" : "false");
    }
  }

  /* ---- 이벤트 ---- */
  inputEl.addEventListener("input", handleInput);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (finished) return;
      if (!started) startTest();
      inputEl.value = inputEl.value + " ";
      handleInput();
    }
  });
  inputEl.addEventListener("paste", function (e) { e.preventDefault(); }); // 붙여넣기로 결과 왜곡 방지
  inputEl.addEventListener("drop", function (e) { e.preventDefault(); });
  wordsBoxEl.addEventListener("click", function () { if (!inputEl.disabled) inputEl.focus(); });
  restartBtn.addEventListener("click", function () { resetTest(null); });
  for (var di = 0; di < durBtns.length; di++) {
    durBtns[di].addEventListener("click", function () {
      resetTest(parseInt(this.getAttribute("data-dur"), 10));
    });
  }

  // 백그라운드 복귀 시 즉시 재계산 — 종료 시각이 지났으면 그 자리에서 종료 처리
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && started && !finished) tick();
  });

  // 언어 전환 시 숫자·퍼센트 포맷을 새 로케일로 재렌더 (단어 자체는 항상 영어 고정)
  document.addEventListener("i18n:change", function () {
    if (started && !finished) updateLiveStats();
    if (finished) showResult(computeStats(correctChars, incorrectChars, DURATION * 1000));
    else { timerEl.textContent = fmtNum(DURATION); if (!started) accLiveEl.textContent = fmtPct(100); }
  });

  /* ---- 초기화: 저장된 테스트 시간 복원 → 새 회차 준비 ---- */
  resetTest(loadPersistedDuration());
  // TOOLJS:END
})();
