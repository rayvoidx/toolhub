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
  /* Cat Age Calculator — vet step formula (year1=15, year2=+9, each after=+4),
     continuous so decimal ages (e.g. 2.5) get a precise in-between result.
     Forward: cat age -> human age + life stage. Reverse: human age -> cat age.
     Lifestyle (indoor/outdoor) only changes the informational note, never the math.
     State: localStorage "<slug>:state" only. No external API, all math is local. */

  var CAT_MAX = 30;    // practical upper bound for a realistic cat age input
  var HUMAN_MAX = 140; // matching computeHumanAge(CAT_MAX) rounded up

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  function parseNum(raw) {
    if (raw == null) return NaN;
    var s = String(raw).trim();
    if (s === "") return NaN;
    var n = parseFloat(s.replace(/,/g, ""));
    return isFinite(n) ? n : NaN;
  }
  function round1(n) {
    return Math.round((n + Number.EPSILON) * 10) / 10;
  }
  // 고양이 나이 -> 사람 나이: 1년차 15, 2년차 +9(총 24), 이후 매년 +4. 소수 나이도 연속 보간.
  function computeHumanAge(catAge) {
    var a = Math.max(0, catAge);
    if (a <= 1) return a * 15;
    if (a <= 2) return 15 + (a - 1) * 9;
    return 24 + (a - 2) * 4;
  }
  // 역변환: 사람 나이 -> 고양이 나이 (같은 구간별 공식의 역함수)
  function computeCatAge(humanAge) {
    var h = Math.max(0, humanAge);
    if (h <= 15) return h / 15;
    if (h <= 24) return 1 + (h - 15) / 9;
    return 2 + (h - 24) / 4;
  }
  // 생애주기 6단계 (수의학 가이드라인 기준 — 경계는 연속 함수를 위해 겹치지 않게 정규화)
  function lifeStage(catAge) {
    if (catAge < 0.5) return "kitten";
    if (catAge < 3) return "junior";
    if (catAge < 7) return "adult";
    if (catAge < 11) return "mature";
    if (catAge < 15) return "senior";
    return "geriatric";
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseNum: parseNum, round1: round1,
      computeHumanAge: computeHumanAge, computeCatAge: computeCatAge, lifeStage: lifeStage,
      CAT_MAX: CAT_MAX, HUMAN_MAX: HUMAN_MAX
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "cat-age-calc") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtNum(n, maxDecimals) {
    try {
      return new Intl.NumberFormat(uiLang(), { maximumFractionDigits: maxDecimals == null ? 1 : maxDecimals }).format(n);
    } catch (e) { return String(n); }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var modeForwardBtn = $("mode-forward"), modeReverseBtn = $("mode-reverse");
  var panelForward = $("panel-forward"), panelReverse = $("panel-reverse");
  var catAgeEl = $("cat-age"), humanAgeEl = $("human-age");
  var lifestyleIndoorEl = $("lifestyle-indoor"), lifestyleOutdoorEl = $("lifestyle-outdoor");
  var emptyEl = $("result-empty"), bodyEl = $("result-body");
  var rhLabelEl = $("rh-label"), rhValueEl = $("rh-value"), rhSubEl = $("rh-sub");
  var stageBadgeEl = $("stage-badge"), stageLabelEl = $("stage-label");
  var lifestyleNoteEl = $("lifestyle-note"), clippedNoteEl = $("clipped-note");
  if (!catAgeEl || !humanAgeEl || !bodyEl) return;

  var mode = "forward"; // "forward" | "reverse"

  /* ---- 상태 저장/복원 ---- */
  function saveState() {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        mode: mode,
        catAge: catAgeEl.value,
        humanAge: humanAgeEl.value,
        lifestyle: (lifestyleOutdoorEl && lifestyleOutdoorEl.checked) ? "outdoor" : "indoor"
      }));
    } catch (e) { /* private mode — 저장만 실패, 계산은 정상 */ }
  }
  function restoreState() {
    var s = null;
    try {
      var raw = localStorage.getItem(SKEY);
      if (raw) s = JSON.parse(raw);
    } catch (e) { s = null; }
    if (!s) return;
    if (s.mode === "reverse") mode = "reverse";
    if (typeof s.catAge === "string") catAgeEl.value = s.catAge;
    if (typeof s.humanAge === "string") humanAgeEl.value = s.humanAge;
    if (s.lifestyle === "outdoor" && lifestyleOutdoorEl) lifestyleOutdoorEl.checked = true;
  }

  /* ---- 모드 전환 ---- */
  function applyModeUI() {
    var fwd = mode === "forward";
    if (modeForwardBtn) modeForwardBtn.setAttribute("aria-selected", fwd ? "true" : "false");
    if (modeReverseBtn) modeReverseBtn.setAttribute("aria-selected", fwd ? "false" : "true");
    if (panelForward) panelForward.hidden = !fwd;
    if (panelReverse) panelReverse.hidden = fwd;
    if (rhLabelEl) rhLabelEl.setAttribute("data-i18n", fwd ? "tool.res.human" : "tool.res.catAge");
    if (rhLabelEl) rhLabelEl.textContent = tr(fwd ? "tool.res.human" : "tool.res.catAge");
  }
  function setMode(next) {
    if (mode === next) return;
    mode = next;
    applyModeUI();
    saveState();
    render();
  }

  /* ---- 렌더 ---- */
  function render() {
    var fwd = mode === "forward";
    var raw = fwd ? catAgeEl.value : humanAgeEl.value;
    var trimmed = String(raw == null ? "" : raw).trim();

    if (trimmed === "") {
      bodyEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.setAttribute("data-i18n", fwd ? "tool.placeholder.forward" : "tool.placeholder.reverse");
      emptyEl.textContent = tr(fwd ? "tool.placeholder.forward" : "tool.placeholder.reverse");
      emptyEl.style.color = "var(--muted)";
      return;
    }

    var n = parseNum(trimmed);
    if (isNaN(n) || n < 0) {
      bodyEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.removeAttribute("data-i18n");
      emptyEl.textContent = tr("tool.err.negative");
      emptyEl.style.color = "var(--accent-strong)";
      return;
    }

    var max = fwd ? CAT_MAX : HUMAN_MAX;
    var clipped = n > max;
    var clamped = clipped ? max : n;

    var catAge, humanAge;
    if (fwd) {
      catAge = clamped;
      humanAge = computeHumanAge(catAge);
    } else {
      humanAge = clamped;
      catAge = computeCatAge(humanAge);
    }
    catAge = round1(catAge);
    humanAge = round1(humanAge);

    emptyEl.hidden = true;
    bodyEl.hidden = false;

    if (fwd) {
      rhValueEl.textContent = fmtNum(humanAge, 1);
      rhSubEl.textContent = tr("tool.res.sub")
        .replace("{age}", fmtNum(catAge, 1)).replace("{human}", fmtNum(humanAge, 1));
    } else {
      rhValueEl.textContent = fmtNum(catAge, 1);
      rhSubEl.textContent = tr("tool.res.subReverse")
        .replace("{human}", fmtNum(humanAge, 1)).replace("{age}", fmtNum(catAge, 1));
    }

    var stage = lifeStage(catAge);
    stageLabelEl.textContent = tr("tool.stage." + stage);
    stageBadgeEl.hidden = false;

    if (fwd) {
      var outdoor = !!(lifestyleOutdoorEl && lifestyleOutdoorEl.checked);
      lifestyleNoteEl.textContent = tr(outdoor ? "tool.note.outdoor" : "tool.note.indoor");
      lifestyleNoteEl.hidden = false;
    } else {
      lifestyleNoteEl.hidden = true;
    }

    clippedNoteEl.hidden = !clipped;
  }

  /* ---- 이벤트 ---- */
  if (modeForwardBtn) modeForwardBtn.addEventListener("click", function () { setMode("forward"); });
  if (modeReverseBtn) modeReverseBtn.addEventListener("click", function () { setMode("reverse"); });
  catAgeEl.addEventListener("input", function () { saveState(); render(); });
  humanAgeEl.addEventListener("input", function () { saveState(); render(); });
  if (lifestyleIndoorEl) lifestyleIndoorEl.addEventListener("change", function () { saveState(); render(); });
  if (lifestyleOutdoorEl) lifestyleOutdoorEl.addEventListener("change", function () { saveState(); render(); });
  // Enter 키 = 즉시 재계산(라이브 렌더라 사실상 이미 반영되어 있지만 명시적으로 보장)
  [catAgeEl, humanAgeEl].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") { render(); el.blur(); } });
  });
  // 언어 전환 시 라벨·안내문·결과 문구 재적용
  document.addEventListener("i18n:change", function () {
    applyModeUI();
    render();
  });

  restoreState();
  applyModeUI();
  render();
  // TOOLJS:END
})();
