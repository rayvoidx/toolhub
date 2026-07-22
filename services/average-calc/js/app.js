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
  /* Average Calculator — 콤마/공백/줄바꿈으로 구분된 숫자 목록을 관대하게 파싱해
     평균(산술평균)·중앙값·최빈값·범위·최소·최대·합계·개수·기하평균을 계산한다.
     상태: localStorage "<slug>:state" 에 마지막 입력값만 저장. 외부 API 없음, 전부 로컬 계산. */

  var LIMIT = 5000;         // 극단적으로 큰 붙여넣기 방지 — 이후 값은 무시하고 안내
  var MAX_ABS = 1e15;       // 극단값 캡 — 오버플로/비정상 표시 방지, 부호 유지한 채 절단
  var NUM_RE = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

  /* ---- 순수 파싱·계산 (node 단위 검증 대상) ---- */
  // 콤마·공백(줄바꿈 포함)을 구분자로 관대하게 토큰화. 숫자 형식이 아닌 토큰은 조용히
  // 버리지 않고 invalid 카운트로 노출한다(호출부가 안내 문구로 보여줌).
  function parseNumbers(raw) {
    var tokens = String(raw == null ? "" : raw).split(/[,\s]+/);
    var values = [], invalid = 0, truncated = false, clipped = false;
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i].trim();
      if (tok === "") continue;
      if (values.length >= LIMIT) { truncated = true; break; }
      if (NUM_RE.test(tok)) {
        var n = parseFloat(tok);
        if (isFinite(n)) {
          if (Math.abs(n) > MAX_ABS) { n = (n < 0 ? -1 : 1) * MAX_ABS; clipped = true; }
          values.push(n);
          continue;
        }
      }
      invalid++;
    }
    return { values: values, invalid: invalid, truncated: truncated, clipped: clipped };
  }

  // 통계 묶음 계산. 빈 배열은 null(호출부가 "입력 없음" 상태로 처리).
  function computeStats(values) {
    var count = values.length;
    if (count === 0) return null;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var sum = 0, i;
    for (i = 0; i < count; i++) sum += values[i];
    var mean = sum / count;
    var mid = Math.floor(count / 2);
    var median = (count % 2 === 0) ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    var min = sorted[0], max = sorted[count - 1];
    var range = max - min;

    // 최빈값: 빈도표 → 최대빈도 동률 전부(오름차순). 전부 1회씩이면 "최빈값 없음".
    var freq = {}, keys = [];
    for (i = 0; i < count; i++) {
      var k = String(values[i]);
      if (!Object.prototype.hasOwnProperty.call(freq, k)) { freq[k] = 0; keys.push(values[i]); }
      freq[k]++;
    }
    keys.sort(function (a, b) { return a - b; });
    var maxFreq = 0;
    for (i = 0; i < keys.length; i++) { if (freq[String(keys[i])] > maxFreq) maxFreq = freq[String(keys[i])]; }
    var noMode = keys.length > 1 && maxFreq === 1;
    var modeVals = [];
    if (!noMode) {
      for (i = 0; i < keys.length; i++) {
        if (freq[String(keys[i])] === maxFreq) modeVals.push(keys[i]);
      }
    }

    // 기하평균: 양수만 정의됨(0·음수 포함 시 null). 로그 합의 평균 → 지수 변환으로
    // 큰 곱셈에서의 오버플로를 피한다.
    var gmean = null;
    var allPositive = true;
    for (i = 0; i < count; i++) { if (!(values[i] > 0)) { allPositive = false; break; } }
    if (allPositive) {
      var logSum = 0;
      for (i = 0; i < count; i++) logSum += Math.log(values[i]);
      gmean = Math.exp(logSum / count);
    }

    return {
      count: count, sum: sum, mean: mean, median: median,
      min: min, max: max, range: range,
      modeVals: modeVals, noMode: noMode, gmean: gmean
    };
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseNumbers: parseNumbers, computeStats: computeStats,
      LIMIT: LIMIT, MAX_ABS: MAX_ABS
    };
    return;
  }

  /* ---- i18n · 숫자 포맷 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "average-calc") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmt(n, maxDigits) {
    try {
      return Number(n).toLocaleString(uiLang(), { maximumFractionDigits: (maxDigits == null ? 6 : maxDigits) });
    } catch (e) { return String(n); }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var inputEl = $("avg-input");
  var emptyEl = $("result-empty"), gridEl = $("avg-grid");
  var noteEl = $("avg-note"), copyHintEl = $("copy-hint");
  if (!inputEl || !gridEl) return;
  var cards = gridEl.querySelectorAll(".stat-card");

  function setCard(key, text) {
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute("data-copy") === key) {
        var valEl = cards[i].querySelector(".stat-val");
        if (valEl) valEl.textContent = text;
        cards[i].setAttribute("data-value", text);
      }
    }
  }

  /* ---- 렌더 ---- */
  function render() {
    var parsed = parseNumbers(inputEl.value);
    var stats = computeStats(parsed.values);

    if (!stats) {
      gridEl.hidden = true;
      copyHintEl.hidden = true;
      noteEl.hidden = true;
      emptyEl.hidden = false;
      return;
    }

    setCard("count", fmt(stats.count, 0));
    setCard("sum", fmt(stats.sum));
    setCard("mean", fmt(stats.mean));
    setCard("median", fmt(stats.median));
    setCard("min", fmt(stats.min));
    setCard("max", fmt(stats.max));
    setCard("range", fmt(stats.range));
    setCard("mode", stats.noMode
      ? tr("tool.mode.none", "No mode (every value is unique)")
      : stats.modeVals.map(function (v) { return fmt(v); }).join(", "));
    setCard("gmean", stats.gmean == null ? "—" : fmt(stats.gmean));

    emptyEl.hidden = true;
    gridEl.hidden = false;
    copyHintEl.hidden = false;

    var notes = [];
    if (parsed.invalid > 0) {
      notes.push(tr("tool.ignored", "{n} item(s) ignored — not valid numbers").replace("{n}", String(parsed.invalid)));
    }
    if (parsed.truncated) {
      notes.push(tr("tool.truncated", "Only the first {n} numbers were used").replace("{n}", fmt(LIMIT, 0)));
    }
    if (parsed.clipped) {
      notes.push(tr("tool.clipped", "Some values were capped at ±{max} to prevent overflow").replace("{max}", fmt(MAX_ABS, 0)));
    }
    if (stats.gmean == null) {
      notes.push(tr("tool.gmean.na", "Geometric mean needs every number to be positive"));
    }
    if (notes.length > 0) {
      noteEl.textContent = notes.join(" · ");
      noteEl.hidden = false;
    } else {
      noteEl.hidden = true;
    }
  }

  /* ---- 클릭 복사 ---- */
  var copiedTimers = {};
  function flashCopied(card) {
    var labelEl = card.querySelector(".stat-label");
    if (!labelEl) return;
    var key = card.getAttribute("data-copy");
    labelEl.textContent = tr("tool.copied", "Copied");
    if (copiedTimers[key]) clearTimeout(copiedTimers[key]);
    copiedTimers[key] = setTimeout(function () {
      // data-i18n 라벨을 현재 언어로 복원
      labelEl.textContent = tr("tool.res." + key, labelEl.textContent);
    }, 1100);
  }
  function legacyCopy(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { /* 복사 미지원 — 표시값은 그대로 남는다 */ }
  }
  function copyCard(card) {
    var raw = card.getAttribute("data-value");
    if (raw == null) return;
    var done = function () { flashCopied(card); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(raw).then(done, function () { legacyCopy(raw, done); });
      } else {
        legacyCopy(raw, done);
      }
    } catch (e) {
      legacyCopy(raw, done);
    }
  }
  for (var i = 0; i < cards.length; i++) {
    cards[i].addEventListener("click", function () { copyCard(this); });
  }

  /* ---- 저장/복원 (private mode 등 저장 실패는 조용히 무시, 계산엔 영향 없음) ---- */
  function saveState() {
    try { localStorage.setItem(SKEY, inputEl.value); } catch (e) { /* noop */ }
  }
  function loadState() {
    try {
      var v = localStorage.getItem(SKEY);
      if (typeof v === "string" && v.length > 0) inputEl.value = v;
    } catch (e) { /* noop */ }
  }

  /* ---- 이벤트 ---- */
  inputEl.addEventListener("input", function () { render(); saveState(); });
  // 언어 전환 시 숫자 포맷·최빈값 없음 문구 재적용
  document.addEventListener("i18n:change", render);

  loadState();
  render();
  // TOOLJS:END
})();
