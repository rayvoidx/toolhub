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
  var KEYS = ["v", "i", "r", "p"];
  var EL = { v: $("volts"), i: $("amps"), r: $("ohms"), p: $("watts") };
  var result = $("result"), errEl = $("err"), formulasEl = $("formulas");
  if (!EL.v || !EL.i || !EL.r || !EL.p) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var UNIT = { v: " V", i: " A", r: " Ω", p: " W" };

  // 두 값이 정해지면 나머지 둘은 대수적으로 유일하다 — 6개 조합의 해를 표로 고정한다.
  // 반환값은 화면에 그대로 찍는 "사용한 식" 문자열이라 기호는 언어 중립으로 둔다.
  var SOLVE = {
    "v,i": function (x) { x.r = x.v / x.i; x.p = x.v * x.i; return ["R = V ÷ I", "P = V × I"]; },
    "v,r": function (x) { x.i = x.v / x.r; x.p = x.v * x.v / x.r; return ["I = V ÷ R", "P = V² ÷ R"]; },
    "v,p": function (x) { x.i = x.p / x.v; x.r = x.v * x.v / x.p; return ["I = P ÷ V", "R = V² ÷ P"]; },
    "i,r": function (x) { x.v = x.i * x.r; x.p = x.i * x.i * x.r; return ["V = I × R", "P = I² × R"]; },
    "i,p": function (x) { x.v = x.p / x.i; x.r = x.p / (x.i * x.i); return ["V = P ÷ I", "R = P ÷ I²"]; },
    "r,p": function (x) { x.v = Math.sqrt(x.p * x.r); x.i = Math.sqrt(x.p / x.r); return ["V = √(P × R)", "I = √(P ÷ R)"]; }
  };

  // 밀리암페어(0.02)부터 킬로옴(4700)까지 한 화면에 담아야 해서 유효숫자 기준으로 자른다.
  function fmt(n) {
    var a = Math.abs(n);
    if (a >= 1e9 || (a > 0 && a < 1e-4)) return n.toExponential(3);
    return String(parseFloat(a >= 100 ? n.toFixed(2) : n.toPrecision(5)));
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var vals = {}, given = [], k, raw, n, idx;
    for (idx = 0; idx < KEYS.length; idx++) {
      k = KEYS[idx];
      raw = String(EL[k].value).replace(/,/g, "").trim();
      if (raw === "") continue;
      n = parseFloat(raw);
      if (!isFinite(n)) return fail("tool.err.num");
      if (n <= 0) return fail("tool.err.positive");
      vals[k] = n;
      given.push(k);
    }
    if (given.length < 2) return fail("tool.err.few");
    if (given.length > 2) return fail("tool.err.many");

    // KEYS 순서로 담았으므로 조합 키는 항상 정규형("v,i" 등)이다.
    var used = SOLVE[given.join(",")](vals);
    for (idx = 0; idx < KEYS.length; idx++) {
      k = KEYS[idx];
      if (!isFinite(vals[k]) || vals[k] <= 0) return fail("tool.err.positive");
      var entered = given.indexOf(k) >= 0;
      $("r-" + k).textContent = fmt(vals[k]) + UNIT[k];
      $("c-" + k).className = entered ? "rcard" : "rcard solved";
      $("t-" + k).textContent = t(entered ? "tool.tag.entered" : "tool.tag.solved");
    }
    formulasEl.textContent = t("tool.formulas") + ": " + used.join("   ·   ");

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  KEYS.forEach(function (k) {
    EL[k].addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    EL[k].addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
