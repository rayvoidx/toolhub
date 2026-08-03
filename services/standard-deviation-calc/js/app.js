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
  /* Standard Deviation Calculator — 콤마/공백/줄바꿈으로 구분된 숫자 목록을 파싱해
     표본/모집단 표준편차·분산·평균·개수·편차제곱합(SS)을 계산하고, 각 값의 편차·제곱을
     보여주는 단계별 표를 제공한다. 상태: localStorage "<slug>:state" 에 마지막 입력값만
     저장. 외부 API 없음, 전부 로컬 계산. */

  var LIMIT = 5000;          // 극단적으로 큰 붙여넣기 방지 — 이후 값은 무시하고 안내
  var MAX_ABS = 1e15;        // 극단값 캡 — 오버플로/비정상 표시 방지, 부호 유지한 채 절단
  var BREAKDOWN_LIMIT = 200; // 단계별 표 표시 상한 (통계 계산 자체는 LIMIT까지 전부 반영)
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

  // 표준편차 통계 묶음. 빈 배열은 null(호출부가 "입력 없음" 상태로 처리).
  // ss = 편차제곱합(sum of squares) = Σ(x - mean)^2. 표본분산은 n=1일 때 0으로 나누므로 null.
  function computeStats(values) {
    var n = values.length;
    if (n === 0) return null;
    var sum = 0, i;
    for (i = 0; i < n; i++) sum += values[i];
    var mean = sum / n;
    var deviations = new Array(n), squared = new Array(n), ss = 0;
    for (i = 0; i < n; i++) {
      var d = values[i] - mean;
      deviations[i] = d;
      squared[i] = d * d;
      ss += d * d;
    }
    var popVariance = ss / n;
    var popStdDev = Math.sqrt(popVariance);
    var sampleVariance = n > 1 ? ss / (n - 1) : null;
    var sampleStdDev = sampleVariance == null ? null : Math.sqrt(sampleVariance);
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(n / 2);
    var median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    var range = sorted[n - 1] - sorted[0];
    // SEM = s/√n (표본 표준편차 기반 — n=1 이면 null). CV = s/|mean| (평균 0 이면 정의 불가 → null)
    var sem = sampleStdDev == null ? null : sampleStdDev / Math.sqrt(n);
    var cv = (sampleStdDev == null || mean === 0) ? null : sampleStdDev / Math.abs(mean);
    return {
      sem: sem, cv: cv,
      n: n, sum: sum, mean: mean, ss: ss, median: median, range: range,
      popVariance: popVariance, popStdDev: popStdDev,
      sampleVariance: sampleVariance, sampleStdDev: sampleStdDev,
      deviations: deviations, squared: squared, values: values
    };
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseNumbers: parseNumbers, computeStats: computeStats,
      LIMIT: LIMIT, MAX_ABS: MAX_ABS, BREAKDOWN_LIMIT: BREAKDOWN_LIMIT
    };
    return;
  }

  /* ---- i18n · 숫자 포맷 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "standard-deviation-calc") + ":state";
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
      return Number(n).toLocaleString(uiLang(), { maximumFractionDigits: (maxDigits == null ? 4 : maxDigits) });
    } catch (e) { return String(n); }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var inputEl = $("sd-input");
  var emptyEl = $("result-empty"), gridEl = $("sd-grid");
  var noteEl = $("sd-note"), copyHintEl = $("copy-hint");
  var breakdownWrap = $("breakdown-wrap"), breakdownBody = $("breakdown-body"), breakdownTrunc = $("breakdown-trunc");
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

  // 단계별 표: 값 · 편차 · 편차제곱을 표시 상한(BREAKDOWN_LIMIT)까지만 DOM에 렌더.
  function renderBreakdown(stats) {
    if (!breakdownWrap || !breakdownBody) return;
    breakdownBody.innerHTML = "";
    var shown = Math.min(stats.n, BREAKDOWN_LIMIT);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < shown; i++) {
      var row = document.createElement("tr");
      var c0 = document.createElement("td"); c0.textContent = String(i + 1);
      var c1 = document.createElement("td"); c1.textContent = fmt(stats.values[i], 6);
      var c2 = document.createElement("td"); c2.textContent = fmt(stats.deviations[i], 6);
      var c3 = document.createElement("td"); c3.textContent = fmt(stats.squared[i], 6);
      row.appendChild(c0); row.appendChild(c1); row.appendChild(c2); row.appendChild(c3);
      frag.appendChild(row);
    }
    breakdownBody.appendChild(frag);
    if (breakdownTrunc) {
      if (stats.n > BREAKDOWN_LIMIT) {
        breakdownTrunc.textContent = tr("tool.breakdown.truncated", "Showing the first {n} of {total} values.")
          .replace("{n}", fmt(BREAKDOWN_LIMIT, 0)).replace("{total}", fmt(stats.n, 0));
        breakdownTrunc.hidden = false;
      } else {
        breakdownTrunc.hidden = true;
      }
    }
    breakdownWrap.hidden = false;
  }

  /* ---- 렌더 ---- */
  function render() {
    var parsed = parseNumbers(inputEl.value);
    var stats = computeStats(parsed.values);

    if (!stats) {
      gridEl.hidden = true;
      copyHintEl.hidden = true;
      noteEl.hidden = true;
      if (breakdownWrap) breakdownWrap.hidden = true;
      emptyEl.hidden = false;
      return;
    }

    setCard("count", fmt(stats.n, 0));
    setCard("sum", fmt(stats.sum));
    setCard("mean", fmt(stats.mean));
    setCard("sampleStdDev", stats.sampleStdDev == null ? "—" : fmt(stats.sampleStdDev));
    setCard("popStdDev", fmt(stats.popStdDev));
    setCard("sampleVariance", stats.sampleVariance == null ? "—" : fmt(stats.sampleVariance));
    setCard("popVariance", fmt(stats.popVariance));
    setCard("ss", fmt(stats.ss));
    setCard("median", fmt(stats.median));
    setCard("range", fmt(stats.range));
    setCard("sem", stats.sem == null ? "—" : fmt(stats.sem));
    setCard("cv", stats.cv == null ? "—" : fmt(stats.cv * 100, 2) + "%");

    emptyEl.hidden = true;
    gridEl.hidden = false;
    copyHintEl.hidden = false;

    renderBreakdown(stats);

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
    if (stats.n === 1) {
      notes.push(tr("tool.note.sampleNA", "Sample standard deviation needs at least 2 numbers (population standard deviation works with just 1)."));
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
  // 언어 전환 시 숫자 포맷·비고 문구 재적용
  document.addEventListener("i18n:change", render);

  loadState();
  render();
  // TOOLJS:END
})();
