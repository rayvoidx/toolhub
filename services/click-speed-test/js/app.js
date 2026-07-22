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
  /* Click Speed Test (CPS) — 선택한 시간(1/5/10/30/60초) 동안 클릭 버튼을 최대한 빠르게 눌러
     CPS(초당 클릭 수)를 측정한다. pointerdown 이벤트를 세어(click 이벤트보다 지연이 적어
     지터·버터플라이 클릭처럼 빠른 연타도 누락 없이 집계) 마우스·터치 모두 지원한다.
     상태: localStorage "<slug>:state" (마지막 선택 시간 + 시간별 최고 기록)만. 외부 API 없음. */

  var DURATIONS = [1, 5, 10, 30, 60];
  var DEFAULT_DURATION = 5;
  // 등급 경계 — CPS 오름차순, 마지막 항목은 상한 없음(Infinity)
  var RANKS = [
    { max: 3, key: "turtle", emoji: "🐢" },
    { max: 5, key: "rabbit", emoji: "🐇" },
    { max: 7, key: "cat", emoji: "🐱" },
    { max: 9, key: "leopard", emoji: "🐆" },
    { max: 11, key: "tiger", emoji: "🐯" },
    { max: Infinity, key: "cheetah", emoji: "⚡" }
  ];

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }
  // clicks/duration = CPS. duration<=0 이면 0 (0으로 나누기 방지).
  function computeCps(clicks, duration) {
    clicks = clicks < 0 ? 0 : clicks;
    if (!(duration > 0)) return 0;
    return round2(clicks / duration);
  }
  function rankFor(cps) {
    for (var i = 0; i < RANKS.length; i++) {
      if (cps < RANKS[i].max) return RANKS[i];
    }
    return RANKS[RANKS.length - 1];
  }
  function normDuration(n) {
    n = parseFloat(n);
    return DURATIONS.indexOf(n) !== -1 ? n : null;
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      round2: round2, computeCps: computeCps, rankFor: rankFor,
      normDuration: normDuration, DURATIONS: DURATIONS, RANKS: RANKS
    };
    return;
  }

  /* ---- i18n · Intl 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "click-speed-test") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtInt(n) {
    try { return Number(n).toLocaleString(uiLang(), { maximumFractionDigits: 0 }); }
    catch (e) { return String(n); }
  }
  function fmtCps(n) {
    try {
      return Number(n).toLocaleString(uiLang(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (e) { return String(n.toFixed ? n.toFixed(2) : n); }
  }
  function fmtSeconds(n) {
    try {
      return Number(n).toLocaleString(uiLang(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    } catch (e) { return String(n); }
  }

  /* ---- 상태 저장/복원 ---- */
  function loadState() {
    var fallback = { duration: DEFAULT_DURATION, best: {} };
    try {
      var raw = localStorage.getItem(SKEY);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return fallback;
      var d = normDuration(parsed.duration) || DEFAULT_DURATION;
      var best = (parsed.best && typeof parsed.best === "object") ? parsed.best : {};
      return { duration: d, best: best };
    } catch (e) { return fallback; } // private mode / 손상된 값 — 기본값으로 계속
  }
  function saveState() {
    try { localStorage.setItem(SKEY, JSON.stringify({ duration: duration, best: best })); }
    catch (e) { /* noop */ }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var durationGroup = $("duration-group");
  var clickCountEl = $("click-count"), timeLeftEl = $("time-left");
  var progressBar = $("progress-bar");
  var targetBtn = $("click-target"), targetTextEl = $("target-text");
  var resultPanel = $("result-panel"), newBestBadge = $("new-best-badge");
  var rankEmojiEl = $("rank-emoji"), rankNameEl = $("rank-name");
  var rCpsEl = $("r-cps"), rClicksEl = $("r-clicks"), rDurationEl = $("r-duration");
  var rBestLabelEl = $("r-best-label"), rBestEl = $("r-best");
  var retryBtn = $("retry-btn"), resetBestBtn = $("reset-best-btn");
  if (!targetBtn || !durationGroup || !resultPanel) return;
  var chips = durationGroup.querySelectorAll(".csp-chip");

  /* ---- 상태 ---- */
  var initial = loadState();
  var duration = initial.duration;
  var best = initial.best;
  var state = "idle"; // idle | running | done
  var clicks = 0;
  var startTime = 0, endTime = 0;
  var rafId = null;
  var lastRank = null, lastCps = 0, lastNewBest = false;

  /* ---- 렌더 헬퍼 ---- */
  function syncChips() {
    for (var i = 0; i < chips.length; i++) {
      var b = chips[i];
      var on = parseFloat(b.getAttribute("data-dur")) === duration;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }
  function resetDisplay() {
    clicks = 0;
    if (clickCountEl) clickCountEl.textContent = fmtInt(0);
    if (timeLeftEl) timeLeftEl.textContent = fmtSeconds(duration) + "s";
    if (progressBar) progressBar.style.width = "100%";
    resultPanel.hidden = true;
    if (newBestBadge) newBestBadge.hidden = true;
    targetBtn.classList.remove("is-running", "is-done");
    if (targetTextEl) targetTextEl.textContent = tr("tool.target.idle", "Click to start!");
  }
  function setChipsDisabled(disabled) {
    for (var i = 0; i < chips.length; i++) chips[i].disabled = disabled;
  }

  /* ---- 시간 선택 ---- */
  function selectDuration(n) {
    var d = normDuration(n);
    if (!d || state === "running") return;
    duration = d;
    saveState();
    syncChips();
    resetDisplay();
    updateBestPreview();
  }
  function updateBestPreview() {
    if (!rBestLabelEl) return;
    rBestLabelEl.textContent = tr("tool.result.best", "Your best ({n}s)").replace("{n}", String(duration));
  }

  /* ---- 테스트 진행 ---- */
  function startTest() {
    if (state !== "idle") return;
    state = "running";
    clicks = 1; // 시작을 유발한 클릭도 집계
    startTime = performance.now();
    endTime = startTime + duration * 1000;
    setChipsDisabled(true);
    targetBtn.classList.add("is-running");
    if (targetTextEl) targetTextEl.textContent = tr("tool.target.running", "Keep clicking!");
    if (clickCountEl) clickCountEl.textContent = fmtInt(clicks);
    tick();
  }
  function registerClick() {
    if (state !== "running") return;
    clicks++;
    if (clickCountEl) clickCountEl.textContent = fmtInt(clicks);
  }
  function tick() {
    var now = performance.now();
    var remain = Math.max(0, (endTime - now) / 1000);
    if (timeLeftEl) timeLeftEl.textContent = fmtSeconds(remain) + "s";
    if (progressBar) progressBar.style.width = String(Math.max(0, (remain / duration) * 100)) + "%";
    if (now >= endTime) { endTest(); return; }
    rafId = requestAnimationFrame(tick);
  }
  function endTest() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    state = "done";
    setChipsDisabled(false);
    targetBtn.classList.remove("is-running");
    targetBtn.classList.add("is-done");
    if (targetTextEl) targetTextEl.textContent = tr("tool.target.done", "Time's up!");
    if (timeLeftEl) timeLeftEl.textContent = fmtSeconds(0) + "s";
    if (progressBar) progressBar.style.width = "0%";

    var cps = computeCps(clicks, duration);
    var rank = rankFor(cps);
    var key = String(duration);
    var prevBest = typeof best[key] === "number" ? best[key] : null;
    var isNewBest = prevBest == null || cps > prevBest;
    if (isNewBest) { best[key] = cps; saveState(); }

    lastRank = rank; lastCps = cps; lastNewBest = isNewBest;
    renderResult();
  }
  function renderResult() {
    if (!lastRank) return;
    if (rankEmojiEl) rankEmojiEl.textContent = lastRank.emoji;
    if (rankNameEl) rankNameEl.textContent = tr("tool.rank." + lastRank.key, lastRank.key);
    if (rCpsEl) rCpsEl.textContent = fmtCps(lastCps);
    if (rClicksEl) rClicksEl.textContent = fmtInt(clicks);
    if (rDurationEl) rDurationEl.textContent = fmtSeconds(duration) + "s";
    updateBestPreview();
    var key = String(duration);
    if (rBestEl) rBestEl.textContent = typeof best[key] === "number" ? fmtCps(best[key]) : "—";
    if (newBestBadge) newBestBadge.hidden = !lastNewBest;
    resultPanel.hidden = false;
  }
  function retry() {
    state = "idle";
    resetDisplay();
  }
  function resetBestScore() {
    best = {};
    saveState();
    var key = String(duration);
    if (rBestEl) rBestEl.textContent = "—";
    if (resetBestBtn) {
      var original = tr("tool.resetBest", "Reset best score");
      resetBestBtn.textContent = tr("tool.resetBest.done", "Best score reset.");
      setTimeout(function () { resetBestBtn.textContent = original; }, 1400);
    }
  }

  /* ---- 이벤트 ---- */
  targetBtn.addEventListener("pointerdown", function (e) {
    e.preventDefault(); // 터치에서 이어지는 합성 마우스 이벤트/스크롤·확대 제스처 방지
    if (state === "idle") startTest();
    else if (state === "running") registerClick();
    // state === "done" 일 때는 무시 — "다시 하기" 버튼으로만 재시작
  });
  targetBtn.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    e.preventDefault(); // 네이티브 버튼의 중복 click 발화 방지(키당 1회만 집계)
    if (state === "idle") startTest();
    else if (state === "running") registerClick();
  });
  for (var i = 0; i < chips.length; i++) {
    chips[i].addEventListener("click", function () { selectDuration(this.getAttribute("data-dur")); });
  }
  if (retryBtn) retryBtn.addEventListener("click", retry);
  if (resetBestBtn) resetBestBtn.addEventListener("click", resetBestScore);

  // 언어 전환 시 동적 문구 재적용
  document.addEventListener("i18n:change", function () {
    if (targetTextEl) {
      var k = state === "running" ? "tool.target.running" : (state === "done" ? "tool.target.done" : "tool.target.idle");
      targetTextEl.textContent = tr(k, targetTextEl.textContent);
    }
    if (state === "done") renderResult(); else updateBestPreview();
  });

  syncChips();
  resetDisplay();
  updateBestPreview();
  // TOOLJS:END
})();
