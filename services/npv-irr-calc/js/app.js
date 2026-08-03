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
  var c0El = $("c0"), rateEl = $("rate"), body = $("pv-body");
  var result = $("result"), errEl = $("err");
  if (!c0El || !rateEl || !body || !result) return;

  var cfEls = [];
  for (var i = 1; i <= 10; i++) { var el = $("cf" + i); if (el) cfEls.push(el); }
  if (!cfEls.length) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) {
    var v = String(el.value).replace(/[\s,]/g, "");
    return v === "" ? null : parseFloat(v);
  };
  var money = function (n) {
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // 연도 라벨은 언어마다 어순이 달라("Year 1" / "1년차" / "第1年") {n} 자리표시자로 채운다.
  function labels() {
    var pat = t("tool.cf.year");
    for (var i = 0; i < cfEls.length; i++) {
      var lab = $("lab-cf" + (i + 1));
      if (lab) lab.textContent = pat.replace("{n}", String(i + 1));
    }
  }

  function npvAt(r, c0, flows) {
    var v = -c0;
    for (var i = 0; i < flows.length; i++) v += flows[i] / Math.pow(1 + r, i + 1);
    return v;
  }

  // 부호가 바뀌지 않으면 근이 없다 — 이때는 IRR 을 만들어내지 않고 명시적으로 없음을 알린다.
  function irrOf(c0, flows) {
    var lo = -0.9999, hi = 10;
    var flo = npvAt(lo, c0, flows), fhi = npvAt(hi, c0, flows);
    if (!isFinite(flo) || !isFinite(fhi)) return null;
    if (Math.abs(flo) < 0.01) return lo;
    if (Math.abs(fhi) < 0.01) return hi;
    if (flo * fhi > 0) return null;
    for (var k = 0; k < 300; k++) {
      var mid = (lo + hi) / 2, fm = npvAt(mid, c0, flows);
      if (Math.abs(fm) < 0.01) return mid;
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  function paybackOf(c0, flows) {
    var cum = 0;
    for (var i = 0; i < flows.length; i++) {
      var prev = cum;
      cum += flows[i];
      if (cum >= c0) return flows[i] === 0 ? i + 1 : i + (c0 - prev) / flows[i];
    }
    return null;
  }

  // 할인 회수기간 — 누적 현재가치가 0을 넘는 시점. 유입이 0 이하인 해에서는 보간하지 않는다.
  function dpaybackOf(r, c0, flows) {
    var cum = -c0;
    for (var i = 0; i < flows.length; i++) {
      var pv = flows[i] / Math.pow(1 + r, i + 1);
      if (!isFinite(pv)) return null;
      if (cum + pv >= 0) return pv > 0 ? i + (-cum) / pv : i + 1;
      cum += pv;
    }
    return null;
  }

  function row(cells, cls) {
    var tr = document.createElement("tr");
    for (var i = 0; i < cells.length; i++) {
      var td = document.createElement("td");
      td.textContent = cells[i];
      if (cls && i === 4) td.className = cls;
      tr.appendChild(td);
    }
    return tr;
  }

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function calc() {
    var c0 = num(c0El);
    if (c0 === null || !isFinite(c0) || c0 <= 0) return fail("tool.err.c0");

    var pct = num(rateEl);
    if (pct === null || !isFinite(pct) || pct <= -99 || pct > 1000) return fail("tool.err.rate");
    var r = pct / 100;

    var flows = [];
    for (var i = 0; i < cfEls.length; i++) {
      var v = num(cfEls[i]);
      if (v === null) break;          // 빈 칸에서 시리즈 종료
      if (!isFinite(v)) return fail("tool.err.cfnum");
      flows.push(v);
    }
    if (!flows.length) return fail("tool.err.cf");

    var npv = npvAt(r, c0, flows);
    var pvIn = npv + c0;
    var pi = pvIn / c0;
    var irr = irrOf(c0, flows);
    var pb = paybackOf(c0, flows);

    var npvEl = $("r-npv");
    npvEl.textContent = money(npv);
    npvEl.className = "rc-val " + (npv >= 0 ? "pos" : "neg");
    $("r-verdict").textContent = t(npv >= 0 ? "tool.verdict.accept" : "tool.verdict.reject");
    $("r-irr").textContent = irr === null ? t("tool.r.irr.none") : (irr * 100).toFixed(2) + "%";
    $("r-payback").textContent = pb === null ? t("tool.r.payback.none") : pb.toFixed(2) + " " + t("tool.r.years");
    var dpb = dpaybackOf(r, c0, flows);
    $("r-dpayback").textContent = dpb === null ? t("tool.r.payback.none") : dpb.toFixed(2) + " " + t("tool.r.years");
    $("r-pi").textContent = pi.toFixed(3);

    while (body.firstChild) body.removeChild(body.firstChild);
    var cum = -c0;
    body.appendChild(row(["0", money(-c0), "1.0000", money(-c0), money(cum)], "neg"));
    for (var y = 1; y <= flows.length; y++) {
      var f = 1 / Math.pow(1 + r, y);
      var pv = flows[y - 1] * f;
      cum += pv;
      body.appendChild(row([String(y), money(flows[y - 1]), f.toFixed(4), money(pv), money(cum)], cum >= 0 ? "pos" : "neg"));
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  labels();
  $("calc-btn").addEventListener("click", calc);
  var inputs = [c0El, rateEl].concat(cfEls);
  inputs.forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () {
    labels();
    if (!result.hidden || !errEl.hidden) calc();
  });
  // TOOLJS:END
})();
