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
  /* Remove Duplicate Lines — paste a list, remove duplicate lines while keeping the first
     occurrence of each. Options: case-insensitive compare, trim whitespace before compare,
     also sort output, show-only-duplicates mode. Stats: unique count / removed count.
     상태: localStorage "<slug>:state" 만 (입력 텍스트 + 옵션). 외부 API 없음, 모든 처리는 로컬. */

  var cfg = window.APP_CONFIG || {};
  var STATE_KEY = (cfg.slug || "remove-duplicate-lines") + ":state";

  // ----- 순수 함수 (line 배열 조작 — 브라우저 로컬, node 단위 검증 대상) -----

  // 줄바꿈 정규화 + 분리. 텍스트 맨 끝의 개행 하나가 만드는 빈 꼬리 원소만 제거한다
  // (사용자가 의도적으로 넣은 중간의 빈 줄은 그대로 유지 — 조용한 변형 금지).
  function splitLines(text) {
    if (!text) return [];
    var norm = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var arr = norm.split("\n");
    if (arr.length > 1 && arr[arr.length - 1] === "") arr.pop();
    return arr;
  }

  // 빈 줄(공백만 있는 줄 포함) 제거 — 기본값 off, 켰을 때만 동작한다.
  function dropBlankLines(lines) {
    return lines.filter(function (l) { return l.replace(/^\s+|\s+$/g, "") !== ""; });
  }

  // 비교 키: trim → 대소문자 순으로 정규화. 원본 줄 텍스트는 절대 바꾸지 않는다.
  function compareKey(line, opts) {
    var s = opts.trim ? line.replace(/^\s+|\s+$/g, "") : line;
    return opts.caseInsensitive ? s.toLowerCase() : s;
  }

  // 1패스 카운트 + 2패스 분류. Object.create(null) 로 프로토타입 오염("__proto__" 등) 방지.
  function dedupeLines(lines, opts) {
    var counts = Object.create(null);
    var i, k;
    for (i = 0; i < lines.length; i++) {
      k = compareKey(lines[i], opts);
      counts[k] = (counts[k] || 0) + 1;
    }
    var seen = Object.create(null);
    var uniqueList = [], duplicateList = [];
    for (i = 0; i < lines.length; i++) {
      k = compareKey(lines[i], opts);
      if (!seen[k]) {
        seen[k] = true;
        uniqueList.push(lines[i]);
        if (counts[k] > 1) duplicateList.push(lines[i]);
      }
    }
    return {
      counts: counts,
      unique: uniqueList,
      duplicates: duplicateList,
      uniqueCount: uniqueList.length,
      duplicateCount: duplicateList.length,
      removedCount: lines.length - uniqueList.length,
      totalCount: lines.length
    };
  }

  // localeCompare 기반 정렬(수치 인지) — case-insensitive 옵션과 정렬 감도를 맞춘다.
  function sortLines(list, caseInsensitive) {
    return list.slice().sort(function (a, b) {
      return a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: caseInsensitive ? "accent" : "variant"
      });
    });
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { splitLines: splitLines, dropBlankLines: dropBlankLines, compareKey: compareKey, dedupeLines: dedupeLines, sortLines: sortLines };
    return;
  }

  /* ---- DOM ---- */
  var $ = function (id) { return document.getElementById(id); };
  var inputEl = $("rdl-input");
  var caseEl = $("rdl-case");
  var trimEl = $("rdl-trim");
  var sortEl = $("rdl-sort");
  var onlyDupsEl = $("rdl-onlydups");
  var countsEl = $("rdl-counts");
  var blankEl = $("rdl-blank");
  var runBtn = $("rdl-run");
  var sampleBtn = $("rdl-sample");
  var clearBtn = $("rdl-clear");
  var inCountEl = $("rdl-input-count");
  var msgEmptyEl = $("rdl-msg-empty");
  var msgNoDupsEl = $("rdl-msg-nodups");
  var outWrap = $("rdl-out-wrap");
  var outputEl = $("rdl-output");
  var statsEl = $("rdl-stats");
  var copyBtn = $("rdl-copy");
  var useBtn = $("rdl-use");
  var copyHintEl = $("rdl-copy-hint");

  if (!inputEl || !outputEl) return; // 마크업 없으면 조용히 종료 (다른 페이지 방지)

  var hasRun = false;      // true면 이후 옵션 변경 시 자동 재계산
  var lastInCount = 0;
  var lastStats = null;
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

  // ----- 옵션 읽기 -----
  function readOpts() {
    return {
      caseInsensitive: !!(caseEl && caseEl.checked),
      trim: !!(trimEl && trimEl.checked),
      dropBlank: !!(blankEl && blankEl.checked),
      sortOutput: !!(sortEl && sortEl.checked),
      onlyDups: !!(onlyDupsEl && onlyDupsEl.checked),
      showCounts: !!(countsEl && countsEl.checked)
    };
  }

  // ----- 렌더 -----

  function updateInputCount(raw) {
    var lines = splitLines(raw);
    lastInCount = lines.length;
    if (inCountEl) {
      inCountEl.textContent = lines.length && raw.trim() !== ""
        ? t("tool.input.count").replace("{n}", fmtNum(lines.length))
        : "";
    }
    return lines;
  }

  function showEmptyState() {
    if (outWrap) outWrap.hidden = true;
    if (msgNoDupsEl) msgNoDupsEl.hidden = true;
    if (msgEmptyEl) msgEmptyEl.hidden = false;
    if (statsEl) statsEl.textContent = "";
    hasRun = false;
    lastStats = null;
  }

  function process() {
    var raw = inputEl.value;
    var lines = updateInputCount(raw);

    if (raw.trim() === "") {
      showEmptyState();
      saveState();
      return;
    }

    var opts = readOpts();
    if (opts.dropBlank) lines = dropBlankLines(lines);
    if (lines.length === 0) {
      showEmptyState();
      saveState();
      return;
    }
    var result = dedupeLines(lines, opts);
    lastStats = result;

    var outList = opts.onlyDups ? result.duplicates : result.unique;
    if (opts.sortOutput) outList = sortLines(outList, opts.caseInsensitive);
    // 중복만 보기 + 횟수 표시: 원본 줄 뒤에 등장 횟수를 덧붙인다 (기본 off — 기존 출력 유지)
    if (opts.onlyDups && opts.showCounts) {
      outList = outList.map(function (line) {
        var n = result.counts[compareKey(line, opts)] || 1;
        return line + " (\u00d7" + fmtNum(n) + ")";
      });
    }

    if (msgEmptyEl) msgEmptyEl.hidden = true;

    if (opts.onlyDups && result.duplicates.length === 0) {
      if (outWrap) outWrap.hidden = true;
      if (msgNoDupsEl) {
        msgNoDupsEl.hidden = false;
        msgNoDupsEl.textContent = t("tool.noDuplicates").replace("{n}", fmtNum(result.totalCount));
      }
    } else {
      if (msgNoDupsEl) msgNoDupsEl.hidden = true;
      if (outWrap) outWrap.hidden = false;
      outputEl.value = outList.join("\n");
    }

    if (statsEl) {
      statsEl.textContent = t("tool.stats.summary")
        .replace("{unique}", fmtNum(result.uniqueCount))
        .replace("{removed}", fmtNum(result.removedCount));
    }

    hasRun = true;
    saveState();
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
        caseInsensitive: !!(caseEl && caseEl.checked),
        trim: !!(trimEl && trimEl.checked),
        dropBlank: !!(blankEl && blankEl.checked),
        sortOutput: !!(sortEl && sortEl.checked),
        onlyDups: !!(onlyDupsEl && onlyDupsEl.checked),
      showCounts: !!(countsEl && countsEl.checked)
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
    if (caseEl) caseEl.checked = !!s.caseInsensitive;
    if (trimEl) trimEl.checked = !!s.trim;
    if (blankEl) blankEl.checked = !!s.dropBlank;
    if (sortEl) sortEl.checked = !!s.sortOutput;
    if (onlyDupsEl) onlyDupsEl.checked = !!s.onlyDups;
    if (countsEl) countsEl.checked = !!s.showCounts;
  }

  // ----- 샘플 데이터 (정확 중복 + 대소문자 변형 + 공백 변형을 모두 보여준다) -----
  var SAMPLE_LINES = [
    "apple", "banana", "apple", "Apple ", "cherry",
    "banana", "date", "cherry", "elderberry"
  ];

  // ----- 이벤트 -----

  if (runBtn) runBtn.addEventListener("click", process);

  if (sampleBtn) {
    sampleBtn.addEventListener("click", function () {
      inputEl.value = SAMPLE_LINES.join("\n");
      process();
      inputEl.focus();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      inputEl.value = "";
      showEmptyState();
      updateInputCount("");
      saveState();
      inputEl.focus();
    });
  }

  if (inputEl) {
    inputEl.addEventListener("input", function () {
      updateInputCount(inputEl.value);
      saveState();
    });
  }

  [caseEl, trimEl, blankEl, sortEl, onlyDupsEl, countsEl].forEach(function (el) {
    if (!el) return;
    el.addEventListener("change", function () {
      if (hasRun || inputEl.value.trim() !== "") process();
      else saveState();
    });
  });

  if (copyBtn) copyBtn.addEventListener("click", copyOutput);

  if (useBtn) {
    useBtn.addEventListener("click", function () {
      if (!outputEl.value) return;
      inputEl.value = outputEl.value;
      updateInputCount(inputEl.value);
      process();
      inputEl.focus();
    });
  }

  // 언어 전환 시 카운트·통계 문구를 새 언어로 다시 포맷 (재계산은 하지 않음)
  document.addEventListener("i18n:change", function () {
    if (inCountEl) {
      inCountEl.textContent = lastInCount && inputEl.value.trim() !== ""
        ? t("tool.input.count").replace("{n}", fmtNum(lastInCount))
        : "";
    }
    if (hasRun && lastStats && statsEl) {
      statsEl.textContent = t("tool.stats.summary")
        .replace("{unique}", fmtNum(lastStats.uniqueCount))
        .replace("{removed}", fmtNum(lastStats.removedCount));
      if (readOpts().onlyDups && lastStats.duplicateCount === 0 && msgNoDupsEl && !msgNoDupsEl.hidden) {
        msgNoDupsEl.textContent = t("tool.noDuplicates").replace("{n}", fmtNum(lastStats.totalCount));
      }
    }
  });

  // ----- 초기화 -----
  loadState();
  updateInputCount(inputEl.value);
  if (inputEl.value.trim() !== "") {
    process();
  } else {
    showEmptyState();
  }
  // TOOLJS:END
})();
