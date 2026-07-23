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
  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "dca-calc") + ":last";
  var MAX = Number.MAX_SAFE_INTEGER; // 지수표기 방지 — 이 값 초과 시 클램프
  var LIM = { initialMax: 1000000000, monthlyMax: 100000000, returnMax: 30, yearsMax: 50, inflMax: 20, taxMax: 60 };

  function $(id) { return document.getElementById(id); }
  var initialEl = $("initial-input");
  var monthlyEl = $("monthly-input");
  var returnEl = $("return-input");
  var yearsEl = $("years-input");
  var inflEl = $("inflation-input");
  var taxEl = $("tax-input");
  var calcBtn = $("calc-btn");
  var box = $("result-box");
  var errEl = $("result-error");
  var bodyEl = $("result-body");
  var outFuture = $("r-future");
  var outSub = $("r-sub");
  var outShare = $("r-share");
  var outInvested = $("r-invested");
  var outGains = $("r-gains");
  var outTax = $("r-tax");
  var outReal = $("r-real");
  var realBadge = $("r-real-badge");
  var clipNote = $("r-clipped");
  if (!initialEl || !monthlyEl || !returnEl || !yearsEl || !inflEl || !taxEl || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function digitsOnly(s) { return String(s).replace(/[^\d]/g, ""); }
  // 입력 필드용 — 로케일 구분자 파싱 문제를 피하려 ASCII 콤마 그룹핑 고정
  function groupInput(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  // 결과 표시용 — 천단위·소수는 Intl 에 위임(현재 언어), 지수표기 없음
  function fmt(n) {
    var lang = (window.I18N && window.I18N.lang && window.I18N.lang()) || "en";
    try { return new Intl.NumberFormat(lang, { maximumFractionDigits: 0, useGrouping: true }).format(n); }
    catch (e) { return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(n); }
  }

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상; savings-calc annuity-due 엔진 재사용)
  // 월초 납입 annuity-due FV, m = 예상연수익률/100/12, n = 기간(년)×12
  function futureValue(initial, monthly, m, n) {
    if (m === 0) return initial + monthly * n; // 수익률 0 분기 (0-division 회피)
    var growth = Math.pow(1 + m, n);
    return initial * growth + monthly * (1 + m) * (growth - 1) / m; // annuity-due FV
  }
  function computeDCA(o) {
    var m = o.annualReturn / 1200;         // 월 수익률
    var n = o.years * 12;                   // 개월
    var invested = Math.floor(o.initial + o.monthly * n);
    var fvRaw = futureValue(o.initial, o.monthly, m, n);
    var clamped = false;
    var fv = Math.floor(fvRaw);
    if (!isFinite(fv) || fv > MAX) { fv = MAX; clamped = true; }     // MAX_SAFE_INTEGER 클램프
    if (invested > fv) invested = fv;       // 방어 (수익률>=0 이므로 정상 경로에선 발생 안 함)
    var gains = fv - invested;              // 수익 = FV − 원금 (invested+gains=fv 보장 → 카드 합 일치)
    if (gains < 0) gains = 0;
    var tax = Math.floor(gains * o.taxRate / 100);   // 수익에만 과세, 만기 일시 인출 가정
    var afterTax = fv - tax;
    var realValue = Math.floor(afterTax / Math.pow(1 + o.inflation / 100, o.years)); // 물가 0 → 실질=세후
    var gainShare = fv > 0 ? Math.round(gains / fv * 100) : 0;       // 수익 비중(%)
    return {
      invested: invested, fv: fv, gains: gains, tax: tax,
      afterTax: afterTax, realValue: realValue, gainShare: gainShare, clamped: clamped
    };
  }
  // calc-core:end

  var last = null; // 마지막 렌더 상태 (언어 전환 재렌더용 — 영속 상태는 localStorage 에만)

  function showError(key, fallback) {
    last = { kind: "error", key: key, fallback: fallback };
    box.hidden = false;
    bodyEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }
  function render(state) {
    last = { kind: "result", state: state };
    var res = state.res;
    errEl.hidden = true;
    bodyEl.hidden = false;
    box.hidden = false;

    outFuture.textContent = fmt(res.afterTax);

    outSub.textContent = t("tool.result.sub", "{rate}% expected return · {years} yr · {monthly}/mo")
      .replace("{rate}", state.returnLabel)
      .replace("{years}", state.years)
      .replace("{monthly}", fmt(state.monthly));

    outShare.textContent = t("tool.share", "Market gains make up {pct}% of your final balance.")
      .replace("{pct}", res.gainShare);

    outInvested.textContent = fmt(res.invested);
    outGains.textContent = fmt(res.gains);
    outTax.textContent = (res.tax > 0 ? "−" : "") + fmt(res.tax);
    outReal.textContent = fmt(res.realValue);
    realBadge.hidden = !state.inflated;

    clipNote.hidden = !state.clipped;
  }

  function calculate() {
    var initialDigits = digitsOnly(initialEl.value);
    var monthlyDigits = digitsOnly(monthlyEl.value);
    var returnRaw = returnEl.value.trim().replace(",", ".");
    var yearsRaw = yearsEl.value.trim();
    var inflRaw = inflEl.value.trim().replace(",", ".");
    var taxRaw = taxEl.value.trim().replace(",", ".");
    var clipped = false;

    // 월 투자금 필수 — 빈값/0/음수는 명시 안내 (조용한 실패 금지)
    if (monthlyDigits === "" || Number(monthlyDigits) <= 0) {
      showError("tool.err.monthly", "Enter a monthly contribution to see your projection.");
      return;
    }
    // 예상 수익률 필수 (0% 는 유효)
    if (returnRaw === "" || isNaN(Number(returnRaw))) {
      showError("tool.err.return", "Enter an expected annual return (e.g. 7%).");
      return;
    }
    // 기간 필수 — 빈값/0/음수 차단
    var yearsNum = Math.floor(Number(yearsRaw));
    if (yearsRaw === "" || isNaN(Number(yearsRaw)) || yearsNum < 1) {
      showError("tool.err.years", "Enter a time horizon of 1 to 50 years.");
      return;
    }

    // 상한/하한 클리핑
    var initialNum = initialDigits === "" ? 0 : Number(initialDigits);
    if (initialNum > LIM.initialMax) { initialNum = LIM.initialMax; clipped = true; }

    var monthlyNum = Number(monthlyDigits);
    if (monthlyNum > LIM.monthlyMax) { monthlyNum = LIM.monthlyMax; clipped = true; }

    var returnNum = Number(returnRaw);
    if (returnNum < 0) { returnNum = 0; clipped = true; } // 성장 시뮬레이터 — 하강 시나리오 미지원(0 클리핑)
    if (returnNum > LIM.returnMax) { returnNum = LIM.returnMax; clipped = true; }

    if (yearsNum > LIM.yearsMax) { yearsNum = LIM.yearsMax; clipped = true; }

    var inflNum = inflRaw === "" ? 0 : Number(inflRaw);
    if (isNaN(inflNum) || inflNum < 0) { inflNum = 0; clipped = true; }
    if (inflNum > LIM.inflMax) { inflNum = LIM.inflMax; clipped = true; }

    var taxNum = taxRaw === "" ? 0 : Number(taxRaw);
    if (isNaN(taxNum) || taxNum < 0) { taxNum = 0; clipped = true; }
    if (taxNum > LIM.taxMax) { taxNum = LIM.taxMax; clipped = true; }

    var res = computeDCA({
      initial: initialNum, monthly: monthlyNum, annualReturn: returnNum,
      years: yearsNum, inflation: inflNum, taxRate: taxNum
    });
    if (res.clamped) clipped = true; // 계산값 MAX 클램프도 클리핑 노트로 안내

    render({
      res: res, returnLabel: returnNum, years: yearsNum, monthly: monthlyNum,
      inflated: inflNum > 0, clipped: clipped
    });

    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        initial: initialNum, monthly: monthlyNum, ret: returnNum,
        years: yearsNum, infl: inflNum, tax: taxNum
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }

    updateChips();
  }

  function formatAmount(el) {
    var d = digitsOnly(el.value);
    el.value = d === "" ? "" : groupInput(Number(d));
  }
  function markChips(sel, raw) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      var dv = els[i].getAttribute(els[i].hasAttribute("data-return") ? "data-return"
        : els[i].hasAttribute("data-years") ? "data-years"
        : els[i].hasAttribute("data-infl") ? "data-infl" : "data-tax");
      els[i].classList.toggle("is-active", raw !== "" && Number(dv) === Number(raw));
    }
  }
  function updateChips() {
    markChips("#return-chips .chip", returnEl.value.trim().replace(",", "."));
    markChips("#years-chips .chip", yearsEl.value.trim());
    markChips("#inflation-chips .chip", inflEl.value.trim().replace(",", "."));
    markChips("#tax-chips .chip", taxEl.value.trim().replace(",", "."));
  }

  // 이벤트 배선 — 실시간 재계산 + Enter
  initialEl.addEventListener("input", function () { formatAmount(initialEl); calculate(); });
  monthlyEl.addEventListener("input", function () { formatAmount(monthlyEl); calculate(); });
  returnEl.addEventListener("input", calculate);
  yearsEl.addEventListener("input", calculate);
  inflEl.addEventListener("input", calculate);
  taxEl.addEventListener("input", calculate);
  calcBtn.addEventListener("click", calculate);

  function wireChips(sel, targetEl) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      els[i].addEventListener("click", function () {
        targetEl.value = this.getAttribute("data-return") || this.getAttribute("data-years")
          || this.getAttribute("data-infl") || this.getAttribute("data-tax");
        calculate();
      });
    }
  }
  wireChips("#return-chips .chip", returnEl);
  wireChips("#years-chips .chip", yearsEl);
  wireChips("#inflation-chips .chip", inflEl);
  wireChips("#tax-chips .chip", taxEl);

  function onEnter(e) { if (e.key === "Enter") calculate(); }
  var enterEls = [initialEl, monthlyEl, returnEl, yearsEl, inflEl, taxEl];
  for (var ei = 0; ei < enterEls.length; ei++) enterEls[ei].addEventListener("keydown", onEnter);

  // 마지막 입력값 복원 (localStorage — 서버 미전송)
  (function restore() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (!saved) return;
      var p = JSON.parse(saved);
      if (p.initial != null && p.initial > 0) initialEl.value = groupInput(p.initial);
      if (p.monthly != null && p.monthly > 0) monthlyEl.value = groupInput(p.monthly);
      if (p.ret != null) returnEl.value = p.ret;
      if (p.years != null) yearsEl.value = p.years;
      if (p.infl != null && p.infl > 0) inflEl.value = p.infl;
      if (p.tax != null && p.tax > 0) taxEl.value = p.tax;
      if (p.monthly != null && p.monthly > 0) calculate();
    } catch (e) { /* 접근 불가·파싱 실패 — 빈 폼으로 시작 */ }
  })();
  updateChips();

  // 언어 전환 시 동적 문구(금액·비중·서브라인·오류) 재렌더
  document.addEventListener("i18n:change", function () {
    if (!last) return;
    if (last.kind === "error") showError(last.key, last.fallback);
    else render(last.state);
  });
  // TOOLJS:END
})();
