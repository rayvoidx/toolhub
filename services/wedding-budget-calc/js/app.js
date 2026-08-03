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
  var budget = $("budget"), guests = $("guests"), priority = $("priority"), buffer = $("buffer");
  var result = $("result"), errEl = $("err");
  if (!budget || !guests || !priority || !buffer) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var money = function (n) { return Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 }); };

  var CATS = ["tool.cat.venue", "tool.cat.photo", "tool.cat.attire", "tool.cat.flowers", "tool.cat.music",
              "tool.cat.stationery", "tool.cat.cake", "tool.cat.transport", "tool.cat.rings", "tool.cat.buffer"];
  // 각 프리셋은 합이 정확히 100 — 우선순위는 항목 간 포인트 이동일 뿐 총액을 늘리지 않는다.
  var PRESETS = {
    balanced: [45, 12, 9, 10, 8, 3, 2, 3, 3, 5],
    venue:    [53, 12, 7, 7, 6, 2, 2, 3, 3, 5],
    photo:    [40, 20, 9, 8, 7, 3, 2, 3, 3, 5],
    party:    [41, 10, 9, 10, 15, 2, 2, 3, 3, 5],
  };

  function badgeKey(perGuest) {
    if (perGuest < 150) return "tool.badge.tight";
    if (perGuest < 250) return "tool.badge.lean";
    if (perGuest <= 350) return "tool.badge.typical";
    return "tool.badge.high";
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var b = parseFloat(String(budget.value).replace(/,/g, ""));
    if (!isFinite(b) || b <= 0 || b > 10000000) return fail("tool.err.budget");
    var g = parseFloat(String(guests.value).replace(/,/g, ""));
    if (!isFinite(g) || g < 1 || g > 2000) return fail("tool.err.guests");
    g = Math.round(g);

    var bufRaw = String(buffer.value).trim();
    var buf = bufRaw === "" ? 5 : parseFloat(bufRaw.replace(/,/g, ""));
    if (!isFinite(buf) || buf < 0 || buf > 30) return fail("tool.err.buffer");

    // 예비비 비율을 바꾸면 나머지 항목을 비례 조정 — 합은 항상 정확히 100.
    var base = PRESETS[priority.value] || PRESETS.balanced;
    var scale = (100 - buf) / (100 - base[base.length - 1]);
    var pct = [];
    for (var p = 0; p < base.length; p++) {
      pct.push(p === base.length - 1 ? buf : base[p] * scale);
    }
    var perGuest = b / g;
    $("r-perguest").textContent = money(perGuest);
    $("r-badge").textContent = t(badgeKey(perGuest));

    // 반올림 오차는 최대 항목(예식장)이 흡수한다 — 표 합계가 총예산과 정확히 맞는다.
    var body = $("split-body");
    body.textContent = "";
    var topIdx = 0;
    for (var i = 0; i < pct.length; i++) if (pct[i] > pct[topIdx]) topIdx = i;

    var amts = [], rest = 0;
    for (var k = 0; k < pct.length; k++) {
      amts.push(k === 0 ? 0 : Math.round((b * pct[k]) / 100));
      if (k > 0) rest += amts[k];
    }
    amts[0] = b - rest;
    $("r-percater").textContent = money(amts[0] / g);
    var pctText = function (v) { return (Math.round(v * 10) / 10) + "%"; };

    for (var j = 0; j < CATS.length; j++) {
      var amt = amts[j];
      var tr = document.createElement("tr");
      var c1 = document.createElement("td"); c1.textContent = t(CATS[j]);
      var c2 = document.createElement("td"); c2.className = "num"; c2.textContent = pctText(pct[j]);
      var c3 = document.createElement("td"); c3.className = "amt"; c3.textContent = money(amt);
      tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3);
      body.appendChild(tr);
      if (j === topIdx) $("r-top").textContent = t(CATS[j]) + " · " + money(amt);
      if (j === CATS.length - 1) $("r-buffer").textContent = money(amt) + " (" + pctText(pct[j]) + ")";
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [budget, guests, buffer].forEach(function (el) {
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  priority.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
