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
  var A = ["a-cash", "a-invest", "a-home", "a-vehicles", "a-other"];
  var LI = ["l-mortgage", "l-car", "l-student", "l-cards", "l-other"];
  var fields = A.concat(LI).map(function (id) { return $(id); });
  var rateEl = $("a-taxrate");
  if (rateEl) fields.push(rateEl);
  var result = $("result"), errEl = $("err"), negEl = $("r-neg");
  for (var f = 0; f < fields.length; f++) { if (!fields[f]) return; }
  if (!result || !errEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var money = function (n) { return Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 }); };

  // 파싱 실패 사유를 모아 첫 번째 것만 보여준다 — 조용히 0으로 넘기지 않는다.
  var bad = null;
  function amount(id) {
    var raw = String($(id).value).replace(/[,\s]/g, "");
    if (raw === "") return 0;
    var n = parseFloat(raw);
    if (!isFinite(n)) { if (!bad) bad = "tool.err.num"; return 0; }
    if (n < 0) { if (!bad) bad = "tool.err.neg"; return 0; }
    return n;
  }
  function sum(ids) { var s = 0; for (var i = 0; i < ids.length; i++) s += amount(ids[i]); return s; }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    bad = null;
    var assets = sum(A), liab = sum(LI);
    if (bad) return fail(bad);
    // 전부 비었거나 전부 0이면 계산할 것이 없다.
    if (assets === 0 && liab === 0) return fail("tool.err.empty");

    var net = assets - liab;
    var netEl = $("r-net");
    netEl.textContent = money(net);
    netEl.className = net < 0 ? "rc-val negative" : "rc-val";
    negEl.textContent = t("tool.neg");
    negEl.hidden = net >= 0;

    $("r-assets").textContent = money(assets);
    $("r-liab").textContent = money(liab);
    // 자산이 0이면 비율은 정의되지 않는다 (Infinity 노출 금지).
    $("r-ratio").textContent = assets > 0 ? (Math.round((liab / assets) * 1000) / 10) + "%" : "—";

    // 집·주담대를 입력한 사람만 보는 "투자 가능 순자산" 관점.
    var home = amount("a-home"), mtg = amount("l-mortgage");
    var hasHome = home > 0 || mtg > 0;
    $("c-equity").hidden = !hasHome;
    $("c-exhome").hidden = !hasHome;
    if (hasHome) {
      var eq = home - mtg, exh = net - eq;
      $("r-equity").textContent = money(eq);
      $("r-equity").className = eq < 0 ? "rc-val negative" : "rc-val";
      $("r-exhome").textContent = money(exh);
      $("r-exhome").className = exh < 0 ? "rc-val negative" : "rc-val";
    }

    // 선택 입력: 세전 은퇴계좌에 적용할 인출 세율. 비우면 기존 동작(액면가) 그대로.
    var invest = amount("a-invest"), rateRaw = rateEl ? String(rateEl.value).replace(/[,\s%]/g, "") : "";
    var showTax = false, rate = 0;
    if (rateRaw !== "") {
      rate = parseFloat(rateRaw);
      if (!isFinite(rate) || rate < 0 || rate > 60) return fail("tool.err.rate");
      showTax = rate > 0 && invest > 0;
    }
    $("c-aftertax").hidden = !showTax;
    if (showTax) {
      var afterTax = net - invest * (rate / 100);
      $("r-aftertax").textContent = money(afterTax);
      $("r-aftertax").className = afterTax < 0 ? "rc-val negative" : "rc-val";
    }

    var liquid = amount("a-cash") + invest;
    var illiquid = assets - liquid;
    $("r-split").textContent = assets > 0
      ? t("tool.r.liquid") + " " + money(liquid) + " (" + Math.round((liquid / assets) * 100) + "%)  ·  " +
        t("tool.r.illiquid") + " " + money(illiquid) + " (" + Math.round((illiquid / assets) * 100) + "%)"
      : "";

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  fields.forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
