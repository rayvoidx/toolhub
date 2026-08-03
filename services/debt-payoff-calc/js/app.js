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
  var extra = $("extra"), result = $("result"), errEl = $("err");
  if (!$("bal1") || !extra) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { var v = parseFloat(String(el.value).replace(/[$,\s]/g, "")); return isFinite(v) ? v : NaN; };
  var blank = function (el) { return String(el.value).trim() === ""; };
  var money = function (n) { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var put = function (s, o) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] === undefined ? m : String(o[k]); });
  };

  var MAX_MONTHS = 1200; // 100년 안전장치 — 최소상환액 검증을 통과해도 무한 루프는 막는다.

  function dur(months) {
    var y = Math.floor(months / 12), m = months % 12, parts = [];
    if (y > 0) parts.push(put(t(y === 1 ? "tool.fmt.y1" : "tool.fmt.yn"), { n: y }));
    if (m > 0 || y === 0) parts.push(put(t(m === 1 ? "tool.fmt.m1" : "tool.fmt.mn"), { n: m }));
    return parts.join(" ");
  }

  /* 월 단위 시뮬레이션. 예산 = 모든 부채의 최소상환액 합 + 추가상환액으로 고정한다.
     한 건이 끝나도 그 최소상환액은 예산에 남아 다음 목표로 굴러간다(= 눈덩이 효과). */
  function simulate(rows, extraPay, mode) {
    var d = rows.map(function (r) { return { n: r.n, bal: r.bal, apr: r.apr, min: r.min }; });
    var budget = extraPay;
    d.forEach(function (x) { budget += x.min; });
    var months = 0, interest = 0, order = [];
    while (months < MAX_MONTHS) {
      var active = d.filter(function (x) { return x.bal > 0.005; });
      if (!active.length) break;
      months++;
      active.forEach(function (x) {
        var i = x.bal * x.apr / 1200;
        x.bal += i; interest += i;
      });
      // 목표 순서: 아발란치는 이율 높은 순, 스노볼은 잔액 적은 순.
      var target = active.slice().sort(function (a, b) {
        return mode === "avalanche" ? (b.apr - a.apr || a.bal - b.bal) : (a.bal - b.bal || b.apr - a.apr);
      });
      var avail = budget;
      active.forEach(function (x) {
        var p = Math.min(x.min, x.bal, avail);
        if (p > 0) { x.bal -= p; avail -= p; }
      });
      for (var k = 0; k < target.length && avail > 0.005; k++) {
        if (target[k].bal <= 0.005) continue;
        var p2 = Math.min(target[k].bal, avail);
        target[k].bal -= p2; avail -= p2;
      }
      active.forEach(function (x) {
        if (x.bal <= 0.005 && order.indexOf(x.n) < 0) { x.bal = 0; order.push(x.n); }
      });
    }
    var done = d.every(function (x) { return x.bal <= 0.005; });
    return { months: months, interest: interest, order: order, done: done };
  }

  function readRows() {
    var rows = [];
    for (var i = 1; i <= 5; i++) {
      var b = $("bal" + i), a = $("apr" + i), p = $("min" + i);
      if (!b || !a || !p) continue;
      if (blank(b) && blank(a) && blank(p)) continue; // 빈 행 = 없는 부채
      var bal = num(b), apr = num(a), min = num(p);
      if (!isFinite(bal) || !isFinite(apr) || !isFinite(min) || bal <= 0 || apr < 0 || apr > 100 || min <= 0) {
        return { err: put(t("tool.err.row"), { n: i }) };
      }
      var monthlyInt = bal * apr / 1200;
      // 최소상환액이 한 달 이자 이하면 그 부채는 영원히 줄지 않는다 — 조용히 돌리지 않고 알린다.
      if (min <= monthlyInt + 0.005) {
        return { err: put(t("tool.err.minlow"), { n: i, int: money(monthlyInt) }) };
      }
      rows.push({ n: i, bal: bal, apr: apr, min: min });
    }
    if (!rows.length) return { err: t("tool.err.none") };
    return { rows: rows };
  }

  function fail(msg) { result.hidden = true; errEl.hidden = false; errEl.textContent = msg; }

  function orderText(order) {
    return order.map(function (n) { return put(t("tool.row.n"), { n: n }); }).join(" \u2192 ");
  }

  function calc() {
    var ex = blank(extra) ? 0 : num(extra);
    if (!isFinite(ex) || ex < 0) return fail(t("tool.err.extra"));

    var parsed = readRows();
    if (parsed.err) return fail(parsed.err);

    var av = simulate(parsed.rows, ex, "avalanche");
    var sb = simulate(parsed.rows, ex, "snowball");
    if (!av.done || !sb.done) return fail(t("tool.err.long"));

    $("r-av-time").textContent = dur(av.months);
    $("r-av-int").textContent = money(av.interest);
    $("r-sb-time").textContent = dur(sb.months);
    $("r-sb-int").textContent = money(sb.interest);
    $("r-av-order").textContent = orderText(av.order);
    $("r-sb-order").textContent = orderText(sb.order);

    var dInt = sb.interest - av.interest, dMon = sb.months - av.months;
    var verdict;
    if (dInt < 0.005 && dMon <= 0) verdict = t("tool.v.same");
    else if (dMon <= 0) verdict = put(t("tool.v.money"), { amount: money(dInt) });
    else verdict = put(t("tool.v.both"), { amount: money(dInt), time: dur(dMon) });
    $("r-verdict").textContent = verdict;

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  var fields = [extra];
  for (var i = 1; i <= 5; i++) { fields.push($("bal" + i), $("apr" + i), $("min" + i)); }
  fields.forEach(function (el) {
    if (!el) return;
    el.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
