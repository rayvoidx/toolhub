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
  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "interest-calc") + ":last";
  var LIM = { principalMin: 1000, principalMax: 10000000000, rateMax: 30, monthsMax: 360 };
  var TAX_PERMILLE = [154, 95, 0]; // 일반과세 15.4% / 세금우대 9.5% / 비과세 0% (퍼밀 정수 — 부동소수 오차 차단)
  var METHODS = ["simple", "monthly", "yearly"]; // 단리 / 월복리 / 연복리

  function $(id) { return document.getElementById(id); }
  var principalEl = $("principal-input");
  var rateEl = $("rate-input");
  var monthsEl = $("months-input");
  var calcBtn = $("calc-btn");
  var resetBtn = $("reset-btn");
  var box = $("result-box");
  var errEl = $("result-error");
  var bodyEl = $("result-body");
  var outMaturity = $("r-maturity");
  var outPrincipal = $("r-principal");
  var outPretax = $("r-pretax");
  var outTax = $("r-tax");
  var outAftertax = $("r-aftertax");
  var compareEl = $("r-compare");
  var clipNoteEl = $("r-clip-note");
  if (!principalEl || !rateEl || !monthsEl || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function fmt(n) { return t("tool.amount", "{n}원").replace("{n}", group(n)); }

  // calc-core:start — 순수 계산 코어 (거치식 목돈 예치, node 단위검증 대상)
  function permilleFloor(amount, permille) {
    // 정수 퍼밀 절사 — 원금 100억·이자 수십조 원에서도 2^53 초과 없이 정확 (1000 분해 연산)
    var q = Math.floor(amount / 1000);
    var rem = amount - q * 1000;
    return q * permille + Math.floor(rem * permille / 1000);
  }
  function computeInterest(principal, ratePct, months, method, taxPermille) {
    var r = ratePct / 100;
    var pretaxRaw;
    if (method === "monthly") {
      pretaxRaw = principal * (Math.pow(1 + r / 12, months) - 1);  // 월복리: P((1+r/12)^n − 1)
    } else if (method === "yearly") {
      pretaxRaw = principal * (Math.pow(1 + r, months / 12) - 1);  // 연복리: P((1+r)^(n/12) − 1)
    } else {
      pretaxRaw = principal * r * (months / 12);                   // 단리: P·r·(n/12)
    }
    var pretax = Math.floor(pretaxRaw);                 // 세전이자 원 단위 버림 (이율 0% → 정확히 0)
    var tax = permilleFloor(pretax, taxPermille);       // 세금 원 단위 절사 (정수 퍼밀 연산)
    var aftertax = pretax - tax;
    return { principal: principal, pretax: pretax, tax: tax, aftertax: aftertax, maturity: principal + aftertax };
  }
  // calc-core:end

  function radioVal(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function setRadio(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }
  function showError(msg) {
    box.hidden = false;
    bodyEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = msg;
  }
  function methodName(method) {
    var key = method === "monthly" ? "tool.method.monthly" : (method === "yearly" ? "tool.method.yearly" : "tool.method.simple");
    var fallback = method === "monthly" ? "월복리" : (method === "yearly" ? "연복리" : "단리");
    return t(key, fallback);
  }

  var calculated = false; // 첫 계산 시도 후부터 입력 변경 시 실시간 재계산

  function calculate() {
    calculated = true;

    // 빈 입력·0·음수 → 명시적 안내 (조용한 실패 금지)
    var rawPrincipal = (principalEl.value || "").replace(/[^\d]/g, "");
    var principal = rawPrincipal ? Number(rawPrincipal) : NaN;
    if (isNaN(principal) || principal < LIM.principalMin) {
      showError(t("tool.err.principal", "원금을 입력하세요 (1,000원 이상)."));
      return;
    }
    var rate = rateEl.value === "" ? NaN : Number(rateEl.value);
    if (isNaN(rate) || rate < 0) {
      showError(t("tool.err.rate", "연 이율을 0 이상의 숫자로 입력하세요 (예: 3.5)."));
      return;
    }
    var months = monthsEl.value === "" ? NaN : Math.floor(Number(monthsEl.value));
    if (isNaN(months) || months < 1) {
      showError(t("tool.err.months", "기간을 1개월 이상 입력하세요 (예: 12)."));
      return;
    }

    // 극단값 → 상한 클리핑 + 안내 (스펙: 원금 ≤ 100억, 이율 ≤ 30%, 기간 ≤ 360개월)
    var clipped = false;
    if (principal > LIM.principalMax) { principal = LIM.principalMax; principalEl.value = group(principal); clipped = true; }
    if (rate > LIM.rateMax) { rate = LIM.rateMax; rateEl.value = String(rate); clipped = true; }
    if (months > LIM.monthsMax) { months = LIM.monthsMax; monthsEl.value = String(months); clipped = true; }

    var method = radioVal("method");
    if (METHODS.indexOf(method) === -1) method = "simple";
    var taxPm = Number(radioVal("tax"));
    if (TAX_PERMILLE.indexOf(taxPm) === -1) taxPm = 154;

    var main = computeInterest(principal, rate, months, method, taxPm);

    errEl.hidden = true;
    bodyEl.hidden = false;
    box.hidden = false;
    outMaturity.textContent = fmt(main.maturity);
    outPrincipal.textContent = fmt(main.principal);
    outPretax.textContent = fmt(main.pretax);
    outTax.textContent = "− " + fmt(main.tax);
    outAftertax.textContent = fmt(main.aftertax);

    // 선택하지 않은 두 방식과의 세후 이자 차액 비교 한 줄
    var items = [];
    for (var i = 0; i < METHODS.length; i++) {
      if (METHODS[i] === method) continue;
      var alt = computeInterest(principal, rate, months, METHODS[i], taxPm);
      var diff = alt.aftertax - main.aftertax;
      var sign = diff > 0 ? "+" : (diff < 0 ? "−" : "±");
      items.push(t("tool.compare.item", "{method}면 {diff}")
        .replace("{method}", methodName(METHODS[i]))
        .replace("{diff}", sign + fmt(Math.abs(diff))));
    }
    compareEl.textContent = t("tool.compare.prefix", "같은 조건 세후 이자 비교 — ") + items.join(" · ");

    clipNoteEl.hidden = !clipped;

    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ p: principal, r: rate, m: months, method: method, tax: taxPm }));
    } catch (e) { /* private mode — 저장 실패해도 계산은 정상 */ }
  }

  function resetAll() {
    principalEl.value = "";
    rateEl.value = "";
    monthsEl.value = "";
    setRadio("method", "simple");
    setRadio("tax", "154");
    box.hidden = true;
    errEl.hidden = true;
    bodyEl.hidden = true;
    calculated = false;
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* noop */ }
    principalEl.focus();
  }

  // localStorage interest-calc:last 로 마지막 입력 복원
  function restore() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { saved = null; }
    if (!saved || typeof saved !== "object") return;
    if (typeof saved.p === "number" && isFinite(saved.p) && saved.p > 0) principalEl.value = group(Math.floor(saved.p));
    if (typeof saved.r === "number" && isFinite(saved.r) && saved.r >= 0) rateEl.value = String(saved.r);
    if (typeof saved.m === "number" && isFinite(saved.m) && saved.m >= 1) monthsEl.value = String(Math.floor(saved.m));
    if (METHODS.indexOf(saved.method) !== -1) setRadio("method", saved.method);
    if (TAX_PERMILLE.indexOf(Number(saved.tax)) !== -1) setRadio("tax", String(saved.tax));
  }

  // 이벤트 배선
  calcBtn.addEventListener("click", calculate);
  resetBtn.addEventListener("click", resetAll);

  principalEl.addEventListener("input", function () {
    var digits = principalEl.value.replace(/[^\d]/g, "").slice(0, 12).replace(/^0+(?=\d)/, "");
    var formatted = digits ? group(digits) : "";
    if (principalEl.value !== formatted) principalEl.value = formatted;
    if (calculated) calculate();
  });
  [rateEl, monthsEl].forEach(function (el) {
    el.addEventListener("input", function () { if (calculated) calculate(); });
  });
  [principalEl, rateEl, monthsEl].forEach(function (el) {
    el.addEventListener("keydown", function (ev) { if (ev.key === "Enter") calculate(); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="method"], input[name="tax"]'), function (el) {
    el.addEventListener("change", function () { if (calculated) calculate(); });
  });
  Array.prototype.forEach.call(document.querySelectorAll(".preset-btn"), function (btn) {
    btn.addEventListener("click", function () {
      monthsEl.value = btn.getAttribute("data-months");
      if (calculated) calculate();
    });
  });

  // 언어 전환 시 표시 중인 결과(금액 패턴·비교 문구·오류 문구) 재렌더
  document.addEventListener("i18n:change", function () {
    if (!box.hidden) calculate();
  });

  restore();
  // TOOLJS:END
})();
