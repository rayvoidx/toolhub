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
  /* Lorem Ipsum Generator — classic-Latin word bank + a seeded PRNG shuffle so every
     click produces a fresh, non-repeating passage while staying within the same
     authentic Lorem Ipsum vocabulary. No external API, no network, no eval(). */

  /* ---- classic Lorem Ipsum vocabulary (baked, no punctuation, lowercase) ---- */
  var WORD_BANK = [
    "accusamus", "accusantium", "adipisci", "aliquam", "aliquid", "amet", "animi",
    "aperiam", "architecto", "asperiores", "aspernatur", "assumenda", "atque", "aut",
    "autem", "beatae", "blanditiis", "commodi", "consequatur", "consequuntur",
    "corporis", "corrupti", "culpa", "cum", "cumque", "cupiditate", "debitis",
    "delectus", "deleniti", "deserunt", "dicta", "dignissimos", "distinctio",
    "dolor", "dolore", "dolorem", "doloremque", "dolores", "doloribus", "dolorum",
    "ducimus", "earum", "eaque", "eius", "eligendi", "enim", "eos", "error", "esse",
    "est", "et", "eum", "eveniet", "ex", "excepturi", "exercitationem", "expedita",
    "explicabo", "facere", "facilis", "fuga", "fugiat", "fugit", "harum", "hic",
    "id", "illo", "illum", "impedit", "in", "inventore", "ipsa", "ipsum", "iste",
    "itaque", "iure", "iusto", "laboriosam", "laborum", "laudantium", "libero",
    "magnam", "magni", "maiores", "maxime", "minima", "minus", "modi", "molestiae",
    "molestias", "mollitia", "natus", "necessitatibus", "nemo", "neque", "nesciunt",
    "nihil", "nisi", "nobis", "non", "nostrum", "numquam", "obcaecati", "odio",
    "odit", "officia", "officiis", "omnis", "optio", "pariatur", "perferendis",
    "perspiciatis", "placeat", "porro", "possimus", "praesentium", "quae",
    "quaerat", "quam", "quas", "quasi", "qui", "quia", "quibusdam", "quidem",
    "quis", "quisquam", "quo", "quod", "quos", "ratione", "recusandae",
    "reiciendis", "rem", "repellat", "repellendus", "reprehenderit", "repudiandae",
    "rerum", "saepe", "sapiente", "sed", "sequi", "similique", "sint", "sit",
    "soluta", "sunt", "suscipit", "tempora", "tempore", "temporibus", "totam",
    "ullam", "unde", "ut", "vel", "velit", "veniam", "vero", "vitae", "voluptas",
    "voluptate", "voluptatem", "voluptates", "voluptatibus", "voluptatum"
  ];
  var CLASSIC_WORDS = ["lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit"];
  var CLASSIC_SENTENCE = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";

  // Allowed range per mode (caps keep the DOM/textarea from choking on extreme input)
  var MODE_LIMITS = {
    paragraphs: { min: 1, max: 50, def: 3 },
    sentences: { min: 1, max: 150, def: 5 },
    words: { min: 1, max: 1000, def: 50 }
  };

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */

  // Deterministic PRNG (mulberry32) — seeded so a single generate() call produces
  // a coherent, reproducible-if-needed sequence without relying on Math.random().
  function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function capitalize(str) {
    return str.length ? str.charAt(0).toUpperCase() + str.slice(1) : str;
  }

  // Clamp + normalize a raw count string to an integer within [min, max].
  // Empty/NaN/negative/zero all fall back to the mode default rather than
  // silently failing. Returns { value, clamped } so the UI can explain itself.
  function clampCount(raw, limits) {
    var n = parseInt(String(raw == null ? "" : raw).trim(), 10);
    if (!isFinite(n) || isNaN(n)) return { value: limits.def, clamped: true };
    if (n < limits.min) return { value: limits.min, clamped: true };
    if (n > limits.max) return { value: limits.max, clamped: true };
    return { value: n, clamped: false };
  }

  // One random sentence: minWords..maxWords picked from the bank, comma inserted
  // near the middle for longer sentences (mimics natural Lorem Ipsum rhythm).
  function buildSentence(rand, minWords, maxWords) {
    var n = minWords + Math.floor(rand() * (maxWords - minWords + 1));
    var words = [];
    for (var i = 0; i < n; i++) words.push(WORD_BANK[Math.floor(rand() * WORD_BANK.length)]);
    if (n > 6) {
      var commaPos = 2 + Math.floor(rand() * (n - 4));
      words[commaPos] = words[commaPos] + ",";
    }
    return { text: capitalize(words.join(" ")) + ".", words: n };
  }

  // One paragraph = 3-6 sentences; the very first paragraph can lead with the
  // canonical opening line when startClassic is on (consuming one sentence slot).
  function buildParagraph(rand, startClassic) {
    var count = 3 + Math.floor(rand() * 4);
    var sentences = [];
    var wordTotal = 0;
    if (startClassic) {
      sentences.push(CLASSIC_SENTENCE);
      wordTotal += CLASSIC_WORDS.length;
      count -= 1;
    }
    for (var i = 0; i < count; i++) {
      var s = buildSentence(rand, 6, 16);
      sentences.push(s.text);
      wordTotal += s.words;
    }
    return { text: sentences.join(" "), sentences: sentences.length, words: wordTotal };
  }

  // Core generator. opts = { mode, count, startClassic, wrapHtml, seed }.
  // Returns { text, stats: { paragraphs, sentences, words, chars } }.
  function generateLoremIpsum(opts) {
    var mode = opts.mode === "sentences" || opts.mode === "words" ? opts.mode : "paragraphs";
    var limits = MODE_LIMITS[mode];
    var clamped = clampCount(opts.count, limits);
    var count = clamped.value;
    var startClassic = !!opts.startClassic;
    var wrapHtml = !!opts.wrapHtml;
    var rand = mulberry32(opts.seed == null ? 1 : opts.seed);

    var plain, paragraphs, sentences, words;

    if (mode === "words") {
      var wordList = [];
      if (startClassic) {
        for (var w = 0; w < CLASSIC_WORDS.length && wordList.length < count; w++) wordList.push(CLASSIC_WORDS[w]);
      }
      while (wordList.length < count) wordList.push(WORD_BANK[Math.floor(rand() * WORD_BANK.length)]);
      wordList = wordList.slice(0, count);
      plain = capitalize(wordList.join(" ")) + ".";
      paragraphs = 1; sentences = 1; words = wordList.length;
    } else if (mode === "sentences") {
      var sentList = [];
      var start = 0;
      if (startClassic) { sentList.push(CLASSIC_SENTENCE); words = CLASSIC_WORDS.length; start = 1; }
      else { words = 0; }
      for (var i = start; i < count; i++) {
        var sObj = buildSentence(rand, 6, 16);
        sentList.push(sObj.text);
        words += sObj.words;
      }
      plain = sentList.join(" ");
      paragraphs = 1; sentences = sentList.length;
    } else {
      var paraList = [];
      paragraphs = count; sentences = 0; words = 0;
      for (var p = 0; p < count; p++) {
        var pObj = buildParagraph(rand, p === 0 && startClassic);
        paraList.push(pObj.text);
        sentences += pObj.sentences;
        words += pObj.words;
      }
      plain = paraList.join("\n\n");
      if (wrapHtml) {
        plain = paraList.map(function (t) { return "<p>" + t + "</p>"; }).join("\n");
      }
    }

    var outputText = plain;
    if (wrapHtml && mode !== "paragraphs") {
      outputText = "<p>" + plain + "</p>";
    }
    // Character stats always reflect the readable content, not the <p> markup
    // (a no-op replace when the mode/option combo never added any tags).
    var plainForCount = plain.replace(/<\/?p>/g, "");

    return {
      text: outputText,
      countUsed: count,
      clamped: clamped.clamped,
      stats: {
        paragraphs: paragraphs,
        sentences: sentences,
        words: words,
        chars: plainForCount.length
      }
    };
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      mulberry32: mulberry32, clampCount: clampCount, buildSentence: buildSentence,
      buildParagraph: buildParagraph, generateLoremIpsum: generateLoremIpsum,
      WORD_BANK: WORD_BANK, MODE_LIMITS: MODE_LIMITS
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "lorem-ipsum-gen") + ":state";
  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmt(n) {
    try { return Number(n).toLocaleString(uiLang()); }
    catch (e) { return String(n); }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var modeEl = $("li-mode"), countEl = $("li-count"), hintEl = $("li-count-hint");
  var classicEl = $("li-classic"), htmlEl = $("li-html");
  var genBtn = $("li-generate"), copyBtn = $("li-copy");
  var emptyEl = $("li-empty"), outputEl = $("li-output"), statsEl = $("li-stats");
  var stParagraphs = $("li-stat-paragraphs"), stSentences = $("li-stat-sentences");
  var stWords = $("li-stat-words"), stChars = $("li-stat-chars");
  if (!modeEl || !countEl || !genBtn || !outputEl) return;

  var lastText = "";

  function currentLimits() {
    return MODE_LIMITS[modeEl.value] || MODE_LIMITS.paragraphs;
  }

  // Keep the number input's min/max/aria in sync with the active mode, and
  // reset to that mode's default when the current value no longer fits.
  function syncCountBounds(preserveValue) {
    var limits = currentLimits();
    countEl.min = String(limits.min);
    countEl.max = String(limits.max);
    if (!preserveValue) {
      countEl.value = String(limits.def);
      hintEl.hidden = true;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        mode: modeEl.value,
        count: countEl.value,
        classic: !!classicEl.checked,
        html: !!htmlEl.checked
      }));
    } catch (e) { /* private mode — noop */ }
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(SKEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function render() {
    var limits = currentLimits();
    var raw = countEl.value;
    var clamped = clampCount(raw, limits);
    if (clamped.clamped && raw.trim() !== "") {
      countEl.value = String(clamped.value);
    }
    hintEl.hidden = !clamped.clamped;
    if (clamped.clamped) {
      hintEl.textContent = t("tool.count.hint", "Adjusted to the allowed range ({min}–{max}).")
        .replace("{min}", fmt(limits.min)).replace("{max}", fmt(limits.max));
    }

    var seed = (Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0;
    var result = generateLoremIpsum({
      mode: modeEl.value,
      count: clamped.value,
      startClassic: !!classicEl.checked,
      wrapHtml: !!htmlEl.checked,
      seed: seed
    });

    lastText = result.text;
    outputEl.value = result.text;
    outputEl.hidden = false;
    emptyEl.hidden = true;
    statsEl.hidden = false;
    copyBtn.disabled = false;

    stParagraphs.textContent = fmt(result.stats.paragraphs);
    stSentences.textContent = fmt(result.stats.sentences);
    stWords.textContent = fmt(result.stats.words);
    stChars.textContent = fmt(result.stats.chars);

    saveState();
  }

  /* ---- 클릭 복사 ---- */
  var copyResetTimer = null;
  function flashCopied(ok) {
    copyBtn.textContent = t(ok ? "tool.copied" : "tool.copyError", ok ? "Copied" : "Couldn't copy");
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(function () {
      copyBtn.textContent = t("tool.copy", "Copy");
    }, 1400);
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      flashCopied(ok);
    } catch (e) { flashCopied(false); }
  }
  function copyOutput() {
    if (!lastText) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(lastText).then(function () { flashCopied(true); }, function () { legacyCopy(lastText); });
      } else {
        legacyCopy(lastText);
      }
    } catch (e) { legacyCopy(lastText); }
  }

  /* ---- 이벤트 ---- */
  modeEl.addEventListener("change", function () {
    syncCountBounds(false);
    render();
  });
  countEl.addEventListener("input", render);
  countEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); render(); }
  });
  classicEl.addEventListener("change", render);
  htmlEl.addEventListener("change", render);
  genBtn.addEventListener("click", render);
  copyBtn.addEventListener("click", copyOutput);
  outputEl.addEventListener("click", function () { outputEl.select(); });

  // Re-render dynamic hint/stat number formatting on language switch (labels
  // themselves are refreshed by the i18n engine); keep the same generated text.
  document.addEventListener("i18n:change", function () {
    if (hintEl && !hintEl.hidden) {
      var limits = currentLimits();
      hintEl.textContent = t("tool.count.hint", "Adjusted to the allowed range ({min}–{max}).")
        .replace("{min}", fmt(limits.min)).replace("{max}", fmt(limits.max));
    }
    if (!statsEl.hidden) {
      var result = generateLoremIpsum({
        mode: modeEl.value, count: countEl.value,
        startClassic: !!classicEl.checked, wrapHtml: !!htmlEl.checked, seed: 1
      });
      stParagraphs.textContent = fmt(result.stats.paragraphs);
      stSentences.textContent = fmt(result.stats.sentences);
      stWords.textContent = fmt(result.stats.words);
      stChars.textContent = fmt(result.stats.chars);
    }
  });

  /* ---- 초기화: 저장된 설정 복원 후 자동 생성 ---- */
  (function init() {
    var stored = loadState();
    if (stored && MODE_LIMITS[stored.mode]) modeEl.value = stored.mode;
    syncCountBounds(!!(stored && stored.count));
    if (stored && stored.count) countEl.value = stored.count;
    if (stored) {
      classicEl.checked = stored.classic !== false;
      htmlEl.checked = !!stored.html;
    }
    render();
  })();
  // TOOLJS:END
})();
