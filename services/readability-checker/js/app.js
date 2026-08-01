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

  // Cloudflare Web Analytics — 쿠키리스·페이지뷰만. 토큰 설정 시에만 로드.
  // 실패해도 본 기능에 영향 없게 격리 (safeTrack 원칙 — 부가 기능은 본 기능과 격리, 철칙 5)
  // 수집 범위는 privacy.html §3 과 일치해야 한다. 도구 입력값은 절대 실리지 않는다(§1 약속).
  if (cfg.analytics && cfg.analytics.cfBeaconToken) {
    try {
      var s = document.createElement("script");
      s.defer = true;
      s.src = "https://static.cloudflareinsights.com/beacon.min.js";
      s.setAttribute("data-cf-beacon", JSON.stringify({ token: cfg.analytics.cfBeaconToken }));
      document.head.appendChild(s);
    } catch (e) { /* 분석 실패는 조용히 무시 — 본 기능에 영향 없음 */ }
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
  var $ = function (id) { return document.getElementById(id); };
  var input = $("text-input"), result = $("result"), errEl = $("err");
  if (!input) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  // 구간 경계는 Flesch 원 표 그대로. 색은 낮을수록 붉게 — 숫자만 봐도 방향이 읽히도록.
  var BANDS = [
    [90, "tool.band.b90", "#15803d"],
    [80, "tool.band.b80", "#16a34a"],
    [70, "tool.band.b70", "#4d7c0f"],
    [60, "tool.band.b60", "#ca8a04"],
    [50, "tool.band.b50", "#ea580c"],
    [30, "tool.band.b30", "#dc2626"],
    [-999, "tool.band.b0", "#991b1b"]
  ];

  // 사전 없이 모음군을 센다. 묵음 e 와 -ed 어미를 먼저 떼는 것이 정확도의 대부분을 만든다.
  function syllables(word) {
    var w = String(word).toLowerCase().replace(/[^a-z]/g, "");
    if (!w) return 1;             // 숫자·기호뿐인 토큰도 소리 내어 읽으면 최소 1음절
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    var m = w.match(/[aeiouy]{1,2}/g);
    return m ? m.length : 1;
  }

  function analyze(text) {
    var tokens = text.split(/\s+/).filter(function (w) { return /[a-z0-9]/i.test(w); });
    // 종결부호가 하나도 없는 한 줄 입력도 문장 1개로 센다 — 0 나누기 방지.
    var sents = text.split(/[.!?\u2026]+/).filter(function (s) { return /[a-z0-9]/i.test(s); }).length || 1;
    var syl = 0;
    for (var i = 0; i < tokens.length; i++) syl += syllables(tokens[i]);
    var w = tokens.length, wps = w / sents, spw = syl / w;
    return {
      words: w, sentences: sents, syllables: syl, wps: wps, spw: spw,
      ease: 206.835 - 1.015 * wps - 84.6 * spw,
      grade: 0.39 * wps + 11.8 * spw - 15.59
    };
  }

  function band(ease) {
    for (var i = 0; i < BANDS.length; i++) if (ease >= BANDS[i][0]) return BANDS[i];
    return BANDS[BANDS.length - 1];
  }

  function calc() {
    var text = String(input.value).replace(/\s+/g, " ").trim();
    if (!text) return fail("tool.err.empty");

    var a = analyze(text);
    // 표본이 10단어 미만이면 문장당 단어 수가 요동쳐 점수가 무의미해진다 — 조용히 내지 않는다.
    if (a.words < 10) return fail("tool.err.short");

    var b = band(a.ease);
    $("r-ease").textContent = a.ease.toFixed(1);
    var bandEl = $("r-band");
    bandEl.textContent = t(b[1]);
    bandEl.style.color = b[2];

    var g = a.grade;
    $("r-grade").textContent = (g < 0 ? 0 : g).toFixed(1);
    $("r-gradetext").textContent = g >= 13
      ? t("tool.grade.college")
      : t("tool.grade.fmt").replace("{n}", String(Math.max(1, Math.round(g))));

    $("r-words").textContent = String(a.words);
    $("r-sentences").textContent = String(a.sentences);
    $("r-syllables").textContent = String(a.syllables);
    $("r-wps").textContent = a.wps.toFixed(1);
    $("r-spw").textContent = a.spw.toFixed(2);

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  // 텍스트 영역에서 Enter 는 줄바꿈이므로 제출은 Ctrl/Cmd+Enter 로 받는다.
  input.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) calc(); });
  input.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
