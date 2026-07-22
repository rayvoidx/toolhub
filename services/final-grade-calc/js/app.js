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
  /* Final Grade Calculator — weighted-average algebra solved for the missing exam score.
     desired = current*(1-w) + examScore*w  =>  examScore = (desired - current*(1-w)) / w
     No external API. All calculation happens locally. State: localStorage "<slug>:state" only. */

  var CAP = 1e6; // 극단값 캡 — 말도 안 되는 입력(예: 1e20)만 걸러낸다. 정상 범위(0~100)에는 영향 없음.
  var TARGETS = [
    { letter: "A", cutoff: 90 },
    { letter: "B", cutoff: 80 },
    { letter: "C", cutoff: 70 }
  ];

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  function safe(v) {
    if (typeof v !== "number" || isNaN(v)) return null;
    if (v > CAP) return CAP;
    if (v < -CAP) return -CAP;
    return v;
  }
  // desired = current*(1-w) + score*w  →  score = (desired - current*(1-w)) / w
  function requiredScore(current, desired, weightPct) {
    var w = weightPct / 100;
    return (desired - current * (1 - w)) / w;
  }
  // achievable(0<x<=100) / impossible(>100, 만점도 부족) / secured(<=0, 0점이어도 목표 이상)
  function classify(score) {
    if (score > 100) return "impossible";
    if (score <= 0) return "secured";
    return "achievable";
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { requiredScore: requiredScore, classify: classify, TARGETS: TARGETS };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "final-grade-calc") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtPct(v, maxDec) {
    try {
      return new Intl.NumberFormat(uiLang(), { style: "percent", maximumFractionDigits: maxDec == null ? 1 : maxDec }).format(v / 100);
    } catch (e) { return (Math.round(v * 10) / 10) + "%"; }
  }
  function statusLabel(status) { return tr("tool.status." + status, status); }
  function statusClass(status) {
    return status === "achievable" ? "fg-ok" : (status === "secured" ? "fg-secured" : "fg-bad");
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var currentEl = $("fg-current"), desiredEl = $("fg-desired"), weightEl = $("fg-weight");
  var emptyEl = $("fg-empty"), errorEl = $("fg-error"), mainEl = $("fg-main");
  var chipEl = $("fg-chip"), valueEl = $("fg-value"), noteEl = $("fg-note");
  var tableWrap = $("fg-table-wrap"), tableBody = $("fg-table-body"), cappedEl = $("fg-capped");
  if (!currentEl || !desiredEl || !weightEl || !mainEl) return;

  /* ---- 파싱 (빈 값/음수/비수 전부 명시 처리 — 조용한 실패 금지) ---- */
  function parseField(el) {
    var raw = String(el.value == null ? "" : el.value).trim();
    if (raw === "") return { empty: true };
    var n = Number(raw);
    if (!isFinite(n)) return { empty: true };
    var capped = false;
    var v = safe(n);
    if (v !== n) capped = true;
    return { empty: false, value: v, negative: v < 0, capped: capped };
  }

  function showState(which) {
    emptyEl.hidden = which !== "empty";
    errorEl.hidden = which !== "error";
    mainEl.hidden = which !== "main";
    tableWrap.hidden = which !== "main";
  }

  function showError(key, fallback) {
    errorEl.textContent = tr(key, fallback);
    emptyEl.hidden = true; errorEl.hidden = false; mainEl.hidden = true; tableWrap.hidden = true;
  }

  function renderTable(current, weightPct) {
    tableBody.textContent = "";
    for (var i = 0; i < TARGETS.length; i++) {
      var tgt = TARGETS[i];
      var req = requiredScore(current, tgt.cutoff, weightPct);
      var status = classify(req);
      var tr1 = document.createElement("tr");

      var tdTarget = document.createElement("td");
      tdTarget.textContent = tgt.letter + " (" + fmtPct(tgt.cutoff, 0) + ")";

      var tdScore = document.createElement("td");
      tdScore.textContent = fmtPct(req, 1);

      var tdStatus = document.createElement("td");
      var chip = document.createElement("span");
      chip.className = "fg-chip " + statusClass(status);
      chip.textContent = statusLabel(status);
      tdStatus.appendChild(chip);

      tr1.appendChild(tdTarget); tr1.appendChild(tdScore); tr1.appendChild(tdStatus);
      tableBody.appendChild(tr1);
    }
  }

  function persist() {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        current: currentEl.value, desired: desiredEl.value, weight: weightEl.value
      }));
    } catch (e) { /* private mode — 저장 실패는 계산에 영향 없음 */ }
  }

  var anyCapped = false;

  function render() {
    persist();
    var c = parseField(currentEl), d = parseField(desiredEl), w = parseField(weightEl);
    anyCapped = !!(c.capped || d.capped || w.capped);
    cappedEl.hidden = !anyCapped;

    // 빈 값 — 오류 아님, 안내만 (철칙: 조용한 실패 금지)
    if (c.empty || d.empty || w.empty) { showState("empty"); return; }

    // 명시적 유효성 검사 — 각 필드별 자연스러운 오류 문구
    if (c.negative) return showError("tool.err.negative", "Grade percentages can't be negative.");
    if (d.negative) return showError("tool.err.negative", "Grade percentages can't be negative.");
    if (w.value <= 0) return showError("tool.err.weightZero", "Final exam weight must be greater than 0%.");
    if (w.value > 100) return showError("tool.err.weightRange", "Final exam weight can't be more than 100%.");

    var required = requiredScore(c.value, d.value, w.value);
    var status = classify(required);

    chipEl.className = "fg-chip fg-chip-lg " + statusClass(status);
    chipEl.textContent = statusLabel(status);
    valueEl.textContent = fmtPct(required, 1);
    valueEl.className = "fg-hero-value " + statusClass(status);

    var noteKey = "tool.note." + status;
    var noteFallback = status === "impossible"
      ? "Reaching {desired} isn't possible anymore — you'd need {score} on the final, and no exam score can go above 100%. Talk to your instructor about extra credit or dropped grades."
      : status === "secured"
        ? "Good news — you've already secured at least {desired} in this class. Even a 0% on the final keeps you there."
        : "You need at least {score} on the final exam to reach your target grade of {desired}.";
    noteEl.textContent = tr(noteKey, noteFallback)
      .replace("{score}", fmtPct(required, 1))
      .replace("{desired}", fmtPct(d.value, 1));

    renderTable(c.value, w.value);
    showState("main");
  }

  /* ---- 초기화 · 복원 ---- */
  (function init() {
    var saved = null;
    try { var s = localStorage.getItem(SKEY); if (s) saved = JSON.parse(s); } catch (e) { saved = null; }
    if (saved) {
      if (saved.current) currentEl.value = saved.current;
      if (saved.desired) desiredEl.value = saved.desired;
      if (saved.weight) weightEl.value = saved.weight;
    }
    render();
  })();

  /* ---- 이벤트 ---- */
  function onEnter(e) { if (e.key === "Enter") render(); }
  [currentEl, desiredEl, weightEl].forEach(function (el) {
    el.addEventListener("input", render);
    el.addEventListener("keydown", onEnter);
  });

  // 언어 전환 시 동적 문구·Intl 포맷 재적용
  document.addEventListener("i18n:change", render);
  // TOOLJS:END
})();
