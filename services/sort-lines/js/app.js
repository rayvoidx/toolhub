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
  /* Alphabetical Order Tool — paste lines, sort A-Z / Z-A / natural / by length / shuffle / reverse.
     상태: localStorage "<slug>:state" 만 (입력 텍스트 + 옵션). 외부 API 없음, 모든 정렬은 로컬. */

  var cfg = window.APP_CONFIG || {};
  var STATE_KEY = (cfg.slug || "sort-lines") + ":state";
  var ARTICLE_RE = /^(a|an|the)\s+/i;

  var inputEl = document.getElementById("sl-input");
  var modeEl = document.getElementById("sl-mode");
  var caseEl = document.getElementById("sl-case");
  var articlesEl = document.getElementById("sl-articles");
  var blankEl = document.getElementById("sl-blank");
  var dedupeEl = document.getElementById("sl-dedupe");
  var trimEl = document.getElementById("sl-trim");
  var sortBtn = document.getElementById("sl-sort");
  var sampleBtn = document.getElementById("sl-sample");
  var clearBtn = document.getElementById("sl-clear");
  var inCountEl = document.getElementById("sl-input-count");
  var msgEmptyEl = document.getElementById("sl-msg-empty");
  var msgAllBlankEl = document.getElementById("sl-msg-allblank");
  var outWrap = document.getElementById("sl-out-wrap");
  var outputEl = document.getElementById("sl-output");
  var outCountEl = document.getElementById("sl-output-count");
  var copyBtn = document.getElementById("sl-copy");
  var useBtn = document.getElementById("sl-use");
  var copyHintEl = document.getElementById("sl-copy-hint");

  if (!inputEl || !modeEl) return; // 마크업 없으면 조용히 종료 (다른 페이지 방지)

  var hasSorted = false;   // true면 이후 옵션 변경 시 자동 재계산
  var lastInCount = 0;
  var lastOutCount = 0;
  var copyHintTimer = null;

  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }

  function fmtNum(n) {
    try {
      var lang = (window.I18N && window.I18N.lang && window.I18N.lang()) || undefined;
      return n.toLocaleString(lang);
    } catch (e) { return String(n); }
  }

  // ----- 순수 함수 (line 배열 조작 — 브라우저 로컬) -----

  function splitLines(text) {
    if (!text) return [];
    return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  }

  function compareKey(line, ignoreArticles) {
    var s = ignoreArticles ? line.replace(ARTICLE_RE, "") : line;
    return s;
  }

  // localeCompare 기반 비교: numeric=true → natural order(item2 < item10),
  // sensitivity 'accent' → 대소문자 무시, 'variant' → 대소문자 구분
  function alphaCompare(a, b, opts) {
    var ka = compareKey(a, opts.articles);
    var kb = compareKey(b, opts.articles);
    return ka.localeCompare(kb, undefined, {
      numeric: !!opts.numeric,
      sensitivity: opts.caseSensitive ? "variant" : "accent"
    });
  }

  // 첫 등장만 남긴다. 대소문자 구분 옵션이 꺼져 있으면 대소문자 무시 비교.
  function dedupeLines(lines, caseSensitive) {
    var seen = Object.create(null);
    return lines.filter(function (l) {
      var k = "k" + (caseSensitive ? l : l.toLowerCase());
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  function shuffleArray(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function computeResult(lines, mode, opts) {
    if (!lines.length) return [];
    if (mode === "shuffle") return shuffleArray(lines);
    if (mode === "reverse") return lines.slice().reverse();
    if (mode === "length" || mode === "lengthDesc") {
      var sign = mode === "lengthDesc" ? -1 : 1;
      return lines.slice().sort(function (a, b) {
        var d = (a.length - b.length) * sign;
        if (d !== 0) return d;
        return alphaCompare(a, b, { numeric: false, caseSensitive: opts.caseSensitive, articles: opts.articles });
      });
    }
    if (mode === "natural") {
      return lines.slice().sort(function (a, b) {
        return alphaCompare(a, b, { numeric: true, caseSensitive: opts.caseSensitive, articles: opts.articles });
      });
    }
    if (mode === "za") {
      return lines.slice().sort(function (a, b) {
        return -alphaCompare(a, b, { numeric: false, caseSensitive: opts.caseSensitive, articles: opts.articles });
      });
    }
    // "az" 기본값
    return lines.slice().sort(function (a, b) {
      return alphaCompare(a, b, { numeric: false, caseSensitive: opts.caseSensitive, articles: opts.articles });
    });
  }

  // ----- 렌더 -----

  function currentLines() {
    var raw = inputEl.value;
    var lines = splitLines(raw);
    if (trimEl && trimEl.checked) {
      lines = lines.map(function (l) { return l.trim(); });
    }
    if (blankEl && blankEl.checked) {
      lines = lines.filter(function (l) { return l.trim() !== ""; });
    }
    if (dedupeEl && dedupeEl.checked) lines = dedupeLines(lines, !!(caseEl && caseEl.checked));
    return { raw: raw, lines: lines };
  }

  function updateInputCount() {
    var cur = currentLines();
    lastInCount = cur.lines.length;
    if (inCountEl) {
      inCountEl.textContent = cur.lines.length
        ? t("tool.input.count").replace("{n}", fmtNum(cur.lines.length))
        : "";
    }
    return cur;
  }

  function sortLines() {
    var cur = updateInputCount();
    var raw = cur.raw;
    var lines = cur.lines;

    if (!lines.length) {
      showEmptyState(raw);
      saveState();
      return;
    }

    var mode = modeEl.value || "az";
    var opts = {
      caseSensitive: !!(caseEl && caseEl.checked),
      articles: !!(articlesEl && articlesEl.checked)
    };
    var result = computeResult(lines, mode, opts);

    if (msgEmptyEl) msgEmptyEl.hidden = true;
    if (msgAllBlankEl) msgAllBlankEl.hidden = true;
    if (outWrap) outWrap.hidden = false;
    if (outputEl) outputEl.value = result.join("\n");
    lastOutCount = result.length;
    if (outCountEl) outCountEl.textContent = t("tool.output.count").replace("{n}", fmtNum(result.length));

    hasSorted = true;
    saveState();
  }

  // 빈 입력 / 공백만 있는 입력 — 조용한 실패 금지, 상태별 문구 구분
  function showEmptyState(raw) {
    if (outWrap) outWrap.hidden = true;
    var allBlankButNotEmpty = raw != null && raw.trim() !== "";
    if (msgEmptyEl) msgEmptyEl.hidden = allBlankButNotEmpty;
    if (msgAllBlankEl) msgAllBlankEl.hidden = !allBlankButNotEmpty;
    hasSorted = false;
  }

  // ----- 복사 -----

  function flashCopyHint(key) {
    if (!copyHintEl) return;
    copyHintEl.hidden = false;
    copyHintEl.textContent = t(key);
    if (copyHintTimer) clearTimeout(copyHintTimer);
    copyHintTimer = setTimeout(function () { copyHintEl.hidden = true; }, 1800);
  }

  function fallbackCopy(text) {
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
      flashCopyHint(ok ? "tool.copied" : "tool.copyError");
    } catch (e) {
      flashCopyHint("tool.copyError");
    }
  }

  function copyOutput() {
    var text = outputEl ? outputEl.value : "";
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { flashCopyHint("tool.copied"); },
        function () { fallbackCopy(text); }
      );
    } else {
      fallbackCopy(text);
    }
  }

  // ----- localStorage 저장/복원 -----

  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        input: inputEl.value,
        mode: modeEl.value,
        caseSensitive: !!(caseEl && caseEl.checked),
        articles: !!(articlesEl && articlesEl.checked),
        blank: blankEl ? !!blankEl.checked : true,
        dedupe: !!(dedupeEl && dedupeEl.checked),
        trim: !!(trimEl && trimEl.checked)
      }));
    } catch (e) { /* private mode — 세션 메모리만 유지 */ }
  }

  function loadState() {
    var s = null;
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (raw) s = JSON.parse(raw);
    } catch (e) { s = null; /* 손상된 값 무시 */ }
    if (!s || typeof s !== "object") return;
    if (typeof s.input === "string") inputEl.value = s.input;
    if (typeof s.mode === "string") modeEl.value = s.mode;
    if (caseEl) caseEl.checked = !!s.caseSensitive;
    if (articlesEl) articlesEl.checked = !!s.articles;
    if (blankEl) blankEl.checked = s.blank !== false;
    if (dedupeEl) dedupeEl.checked = !!s.dedupe;
    if (trimEl) trimEl.checked = !!s.trim;
  }

  // ----- 샘플 데이터 -----

  var SAMPLE_LINES = [
    "banana", "Apple", "item10", "item2", "item1", "cherry",
    "The Great Gatsby", "A Tale of Two Cities", "An American Tragedy", "",
    "grape", "Fig"
  ];

  // ----- 이벤트 -----

  if (sortBtn) sortBtn.addEventListener("click", sortLines);

  if (sampleBtn) {
    sampleBtn.addEventListener("click", function () {
      inputEl.value = SAMPLE_LINES.join("\n");
      sortLines();
      inputEl.focus();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      inputEl.value = "";
      showEmptyState("");
      updateInputCount();
      saveState();
      inputEl.focus();
    });
  }

  if (inputEl) {
    inputEl.addEventListener("input", function () {
      updateInputCount();
      saveState();
    });
  }

  [modeEl, caseEl, articlesEl, blankEl, dedupeEl, trimEl].forEach(function (el) {
    if (!el) return;
    el.addEventListener("change", function () {
      updateInputCount();
      if (hasSorted) sortLines();
      else saveState();
    });
  });

  if (copyBtn) copyBtn.addEventListener("click", copyOutput);

  if (useBtn) {
    useBtn.addEventListener("click", function () {
      if (!outputEl || !outputEl.value) return;
      inputEl.value = outputEl.value;
      if (outWrap) outWrap.hidden = true;
      hasSorted = false;
      updateInputCount();
      if (msgEmptyEl) msgEmptyEl.hidden = true;
      if (msgAllBlankEl) msgAllBlankEl.hidden = true;
      saveState();
      inputEl.focus();
    });
  }

  // 언어 전환 시 카운트 문구를 새 언어로 다시 포맷 (재정렬/재셔플은 하지 않음)
  document.addEventListener("i18n:change", function () {
    if (inCountEl) {
      inCountEl.textContent = lastInCount
        ? t("tool.input.count").replace("{n}", fmtNum(lastInCount))
        : "";
    }
    if (hasSorted && outCountEl) {
      outCountEl.textContent = t("tool.output.count").replace("{n}", fmtNum(lastOutCount));
    }
  });

  // ----- 초기화 -----
  loadState();
  updateInputCount();
  if (inputEl.value.trim() !== "") {
    sortLines();
  } else {
    showEmptyState(inputEl.value);
  }
  // TOOLJS:END
})();
