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
  var msrp = $("msrp"), price = $("price"), residual = $("residual"), mf = $("mf");
  var term = $("term"), down = $("down"), tax = $("tax");
  var result = $("result"), errEl = $("err"), warnEl = $("warn");
  if (!msrp || !price || !residual || !mf || !term) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  function num(el) {
    var v = String(el.value).replace(/[,\s$]/g, "");
    if (v === "") return NaN;
    return parseFloat(v);
  }
  function money(n, dp) {
    var s = Math.abs(n).toFixed(dp);
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (n < 0 ? "-$" : "$") + s;
  }
  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function calc() {
    var vMsrp = num(msrp), vPrice = num(price), vRes = num(residual), vMf = num(mf);
    // 선택 입력: 비우면 0 (무선납·무과세 리스는 실제로 존재한다). 값이 있으면 범위를 검사한다.
    var vDown = down.value.trim() === "" ? 0 : num(down);
    var vTax = tax.value.trim() === "" ? 0 : num(tax);
    var months = parseInt(term.value, 10) || 36;

    if (!isFinite(vMsrp) || vMsrp <= 0) return fail("tool.err.msrp");
    if (!isFinite(vPrice) || vPrice <= 0) return fail("tool.err.price");
    if (!isFinite(vRes) || vRes < 1 || vRes > 99) return fail("tool.err.residual");
    if (!isFinite(vMf) || vMf < 0 || vMf > 0.05) return fail("tool.err.mf");
    if (!isFinite(vDown) || vDown < 0 || vDown >= vPrice) return fail("tool.err.down");
    if (!isFinite(vTax) || vTax < 0 || vTax > 30) return fail("tool.err.tax");

    var cap = vPrice - vDown;                    // 캡코스트 = 협상가 - 선납금
    var resVal = vMsrp * vRes / 100;             // 잔존가치는 협상가가 아니라 MSRP 기준
    var dep = (cap - resVal) / months;           // 감가 부분
    var fin = (cap + resVal) * vMf;              // 금융비용 = (캡코스트+잔존가치) × 머니팩터
    var base = dep + fin;
    var payment = base * (1 + vTax / 100);

    $("r-monthly").textContent = money(payment, 2);
    $("r-dep").textContent = money(dep, 2);
    $("r-fin").textContent = money(fin, 2);
    $("r-res").textContent = money(resVal, 0);
    $("r-total").textContent = money(payment * months + vDown, 0);
    $("r-apr").textContent = (vMf * 2400).toFixed(2) + "%";

    // 잔존가치 > 캡코스트: 계산은 성립하지만 현실적으로 입력 오류다 — 값은 주되 경고를 붙인다.
    warnEl.hidden = dep >= 0;
    warnEl.textContent = dep >= 0 ? "" : t("tool.warn.residual");

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [msrp, price, residual, mf, down, tax].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  term.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
