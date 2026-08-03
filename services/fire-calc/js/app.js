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
  var LS_KEY = (cfg.slug || "fire-calc") + ":last";
  var MAX = Number.MAX_SAFE_INTEGER; // 지수표기 방지 — 이 값 초과/비유한 시 클램프
  var LIM = {
    expensesMax: 1e11, savingsMax: 1e12, monthlyMax: 1e9,
    wrateMin: 2, wrateMax: 10, returnMax: 15, yearsCap: 100
  };
  var WRATE_DEFAULT = 4;
  var TIERS = [
    { mult: 0.5, labelKey: "tool.tiers.lean", labelFallback: "Lean FIRE" },
    { mult: 1, labelKey: "tool.tiers.regular", labelFallback: "Regular FIRE" },
    { mult: 2, labelKey: "tool.tiers.fat", labelFallback: "Fat FIRE" }
  ];

  function $(id) { return document.getElementById(id); }
  var expensesEl = $("expenses-input"), wrateEl = $("wrate-input"), savingsEl = $("savings-input");
  var monthlyEl = $("monthly-input"), returnEl = $("return-input"), calcBtn = $("calc-btn");
  var box = $("result-box"), errEl = $("result-error"), bodyEl = $("result-body");
  var badgeEl = $("r-badge"), firenumEl = $("r-firenum"), subEl = $("r-sub"), msgEl = $("r-msg");
  var progEl = $("r-progress"), progBar = $("r-progressbar"), gapLabelEl = $("r-gaplabel"), gapEl = $("r-gap");
  var dateEl = $("r-date"), projEl = $("r-projection"), tiersBody = $("tiers-body");
  var ageEl = $("age-input"), ageCard = $("r-agecard"), ageValEl = $("r-age");
  var negReturnNote = $("r-negreturn"), wrateNote = $("r-wrateclamp"), clipNote = $("r-clipped");
  if (!expensesEl || !savingsEl || !monthlyEl || !returnEl || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function fmtLang() { return (window.I18N && window.I18N.lang && window.I18N.lang()) || "en"; }
  function digitsOnly(s) { return String(s).replace(/[^\d]/g, ""); }
  // 입력 필드용 — 로케일 파싱 문제 회피로 ASCII 콤마 그룹핑 고정
  function groupInput(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function nf(opts) { try { return new Intl.NumberFormat(fmtLang(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }
  // 결과 표시용 — 천단위는 Intl 에 위임(현재 언어), 지수표기 없음, 비유한/초과 클램프
  function fmt(n) {
    if (!isFinite(n)) n = MAX;
    if (n > MAX) n = MAX;
    if (n < -MAX) n = -MAX;
    return nf({ maximumFractionDigits: 0, useGrouping: true }).format(Math.round(n));
  }
  function numFmt(n, dec) {
    if (!isFinite(n)) n = 0;
    return nf({ minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
  }

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상, Math 외 의존 없음)
  // FIRE 넘버 = 연지출 ÷ (인출률/100)  — 4% 룰이면 연지출 × 25
  function fireNumber(expenses, wratePct) { return expenses / (wratePct / 100); }

  // 월 복리로 원금 P, 매월 납입 C, 연수익률 rPct 를 목표 F 까지 걸리는 개월수.
  // 종신연금(ordinary annuity, 월말 납입) FV 공식을 F 에 대해 대수적으로 역산.
  // FV = P(1+i)^m + C[(1+i)^m − 1]/i  ⇒  (1+i)^m = (F + C/i) / (P + C/i)
  function monthsToTarget(P, C, rPct, F) {
    if (P >= F) return { months: 0 };
    if (P <= 0 && C <= 0) return { never: true }; // 원금도 납입도 0 이면 수익률이 있어도 영원히 0
    var i = rPct / 100 / 12;
    var months;
    if (i === 0) {
      if (C <= 0) return { never: true };
      months = (F - P) / C;
    } else {
      var k = C / i;
      var denom = P + k;
      if (denom <= 0) return { never: true };
      var ratio = (F + k) / denom;
      if (ratio <= 0) return { never: true };
      months = Math.log(ratio) / Math.log(1 + i);
    }
    if (!isFinite(months) || months < 0) return { never: true };
    return { months: months };
  }
  // 주어진 개월수 뒤 잔고 투영 (ordinary annuity)
  function projectedAt(P, C, rPct, months) {
    var i = rPct / 100 / 12;
    if (i === 0) return P + C * months;
    return P * Math.pow(1 + i, months) + C * ((Math.pow(1 + i, months) - 1) / i);
  }
  // 목표 F 까지의 결과를 already/never/beyond(수평선 초과)/normal 로 분류
  function computeTarget(P, C, rPct, F, capMonths) {
    if (P >= F) return { kind: "already", months: 0, projection: P };
    var mres = monthsToTarget(P, C, rPct, F);
    if (mres.never) return { kind: "never" };
    if (mres.months > capMonths) return { kind: "beyond", months: mres.months };
    return { kind: "normal", months: mres.months, projection: projectedAt(P, C, rPct, mres.months) };
  }
  // calc-core:end

  function targetDateLabel(months) {
    var d = new Date();
    d.setMonth(d.getMonth() + Math.round(months));
    try { return new Intl.DateTimeFormat(fmtLang(), { year: "numeric", month: "long" }).format(d); }
    catch (e) { return new Intl.DateTimeFormat("en", { year: "numeric", month: "long" }).format(d); }
  }

  var last = null; // 마지막 렌더 상태 (언어 전환 재렌더용 — 영속 상태는 localStorage 에만)

  function showError(key, fallback) {
    last = { kind: "error", key: key, fallback: fallback };
    box.hidden = false;
    bodyEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }

  function renderTiers(rows) {
    tiersBody.innerHTML = "";
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], tgt = row.target;
      var tr = document.createElement("tr");
      var tdTier = document.createElement("td"); tdTier.textContent = t(row.labelKey, row.labelFallback);
      var tdExp = document.createElement("td"); tdExp.textContent = fmt(row.expenses);
      var tdFire = document.createElement("td"); tdFire.textContent = fmt(row.fire);
      var tdTime = document.createElement("td");
      if (tgt.kind === "already") tdTime.textContent = t("tool.tiers.already", "Already there");
      else if (tgt.kind === "never") tdTime.textContent = t("tool.tiers.never", "Not reachable");
      else if (tgt.kind === "beyond") tdTime.textContent = t("tool.tiers.beyond", "100+ yrs");
      else tdTime.textContent = t("tool.tiers.yearsVal", "{n} yr").replace("{n}", numFmt(tgt.months / 12, 1));
      tr.appendChild(tdTier); tr.appendChild(tdExp); tr.appendChild(tdFire); tr.appendChild(tdTime);
      tiersBody.appendChild(tr);
    }
  }

  function render(state) {
    last = { kind: "result", state: state };
    errEl.hidden = true;
    bodyEl.hidden = false;
    box.hidden = false;

    firenumEl.textContent = fmt(state.fire);
    subEl.textContent = t("tool.result.sub", "{wrate}% withdrawal rate · {expenses}/year in retirement")
      .replace("{wrate}", numFmt(state.wrateNum, state.wrateNum % 1 === 0 ? 0 : 1))
      .replace("{expenses}", fmt(state.expensesNum));

    var tgt = state.target, dash = t("tool.result.none", "—");
    if (tgt.kind === "already") {
      badgeEl.className = "badge ok";
      badgeEl.textContent = "✓ " + t("tool.badge.reached", "You're already FIRE");
      msgEl.textContent = t("tool.msg.already", "Your current savings already meet or beat your FIRE number — you've reached financial independence today.");
      dateEl.textContent = targetDateLabel(0);
      projEl.textContent = fmt(tgt.projection);
    } else if (tgt.kind === "never") {
      badgeEl.className = "badge no";
      badgeEl.textContent = t("tool.badge.notyet", "Not there yet");
      msgEl.textContent = t("tool.msg.never", "With these inputs, you'll never reach your FIRE number — add some savings, monthly investing, or a positive expected return.");
      dateEl.textContent = dash;
      projEl.textContent = dash;
    } else if (tgt.kind === "beyond") {
      badgeEl.className = "badge no";
      badgeEl.textContent = t("tool.badge.notyet", "Not there yet");
      msgEl.textContent = t("tool.msg.beyond", "Reaching your FIRE number would take more than {cap} years at these inputs — try increasing your monthly investing or expected return.")
        .replace("{cap}", LIM.yearsCap);
      dateEl.textContent = dash;
      projEl.textContent = dash;
    } else {
      badgeEl.className = "badge no";
      badgeEl.textContent = t("tool.badge.notyet", "Not there yet");
      var totalMonths = Math.round(tgt.months);
      var y = Math.floor(totalMonths / 12), m = totalMonths % 12;
      var dl = targetDateLabel(tgt.months);
      if (m > 0) {
        msgEl.textContent = t("tool.msg.result", "About {years}y {months}mo to your FIRE number — around {date}.")
          .replace("{years}", y).replace("{months}", m).replace("{date}", dl);
      } else {
        msgEl.textContent = t("tool.msg.resultYearsOnly", "About {years}y to your FIRE number — around {date}.")
          .replace("{years}", y).replace("{date}", dl);
      }
      dateEl.textContent = dl;
      projEl.textContent = fmt(tgt.projection);
    }

    // 진척도 (표시 상한 999)
    var p = state.progress, pText;
    if (p >= 999) pText = "999+";
    else if (p > 0 && p < 1) pText = "<1";
    else pText = String(Math.round(p));
    progEl.textContent = pText + "%";
    progBar.style.width = Math.max(0, Math.min(100, p)) + "%";

    // 잉여/부족 카드
    if (state.gap >= 0) {
      gapLabelEl.textContent = t("tool.result.surplus", "Surplus today");
      gapEl.textContent = "+" + fmt(state.gap);
      gapEl.className = "rc-val pos";
    } else {
      gapLabelEl.textContent = t("tool.result.shortfall", "Shortfall today");
      gapEl.textContent = "−" + fmt(Math.abs(state.gap));
      gapEl.className = "rc-val neg";
    }

    // FIRE 시점 나이 (나이 입력 시에만)
    if (ageCard) {
      if (state.age == null) {
        ageCard.hidden = true;
        ageValEl.textContent = "";
      } else {
        ageCard.hidden = false;
        if (tgt.kind === "already") ageValEl.textContent = numFmt(state.age, 0);
        else if (tgt.kind === "normal") ageValEl.textContent = numFmt(state.age + Math.floor(Math.round(tgt.months) / 12), 0);
        else ageValEl.textContent = dash;
      }
    }

    renderTiers(state.tiers);

    negReturnNote.hidden = !state.negReturn;
    wrateNote.hidden = !state.wrateClamped;
    clipNote.hidden = !state.clipped;
  }

  function formatAmount(el) {
    var d = digitsOnly(el.value);
    el.value = d === "" ? "" : groupInput(Number(d));
  }
  function updateChips() {
    var wr = wrateEl.value.trim().replace(",", ".");
    var wc = document.querySelectorAll("#wrate-chips .chip");
    for (var i = 0; i < wc.length; i++) {
      wc[i].classList.toggle("is-active", wr !== "" && Number(wc[i].getAttribute("data-wrate")) === Number(wr));
    }
    var rr = returnEl.value.trim().replace(",", ".");
    var rc = document.querySelectorAll("#return-chips .chip");
    for (var j = 0; j < rc.length; j++) {
      rc[j].classList.toggle("is-active", rr !== "" && Number(rc[j].getAttribute("data-return")) === Number(rr));
    }
  }

  function calculate() {
    var clipped = false, negReturn = false, wrateClamped = false;

    var expensesDigits = digitsOnly(expensesEl.value);
    var savingsDigits = digitsOnly(savingsEl.value);
    var monthlyDigits = digitsOnly(monthlyEl.value);
    var wrateRaw = wrateEl.value.trim().replace(",", ".");
    var returnRaw = returnEl.value.trim().replace(",", ".");

    // 1) 연지출 (필수, 0 초과)
    if (expensesDigits === "") {
      showError("tool.err.expenses", "Enter your annual expenses in retirement, above 0.");
      return;
    }
    var expensesNum = Number(expensesDigits);
    if (expensesNum <= 0) {
      showError("tool.err.expenses", "Enter your annual expenses in retirement, above 0.");
      return;
    }
    if (expensesNum > LIM.expensesMax) { expensesNum = LIM.expensesMax; clipped = true; }

    // 2) 인출률 (선택, 기본 4%, 2-10% 클램프)
    var wrateNum;
    if (wrateRaw === "") {
      wrateNum = WRATE_DEFAULT;
    } else {
      wrateNum = Number(wrateRaw);
      if (isNaN(wrateNum) || wrateNum <= 0) {
        showError("tool.err.wrate", "Withdrawal rate must be greater than 0.");
        return;
      }
      if (wrateNum < LIM.wrateMin) { wrateNum = LIM.wrateMin; wrateClamped = true; }
      if (wrateNum > LIM.wrateMax) { wrateNum = LIM.wrateMax; wrateClamped = true; }
    }

    // 3) 현재 투자자산·월 납입 (둘 다 선택, 0 유효)
    var savingsNum = savingsDigits === "" ? 0 : Number(savingsDigits);
    if (savingsNum > LIM.savingsMax) { savingsNum = LIM.savingsMax; clipped = true; }
    var monthlyNum = monthlyDigits === "" ? 0 : Number(monthlyDigits);
    if (monthlyNum > LIM.monthlyMax) { monthlyNum = LIM.monthlyMax; clipped = true; }

    // 4) 예상 연 수익률 (필수). r<0 → 0 클리핑+안내, r>15 → 클램프, r=0 유효(무성장)
    if (returnRaw === "" || isNaN(Number(returnRaw))) {
      showError("tool.err.return", "Enter an expected real return of 0% or more, e.g. 6%.");
      return;
    }
    var returnNum = Number(returnRaw);
    if (returnNum < 0) { returnNum = 0; negReturn = true; }
    if (returnNum > LIM.returnMax) { returnNum = LIM.returnMax; clipped = true; }

    // 5) 현재 나이 (선택) — 18-99 정수만, 벗어나면 명시 오류
    var ageNum = null;
    if (ageEl) {
      var ageRaw = ageEl.value.trim();
      if (ageRaw !== "") {
        ageNum = Number(ageRaw);
        if (!isFinite(ageNum) || Math.floor(ageNum) !== ageNum || ageNum < 18 || ageNum > 99) {
          showError("tool.err.age", "Enter a current age between 18 and 99, or leave it blank.");
          return;
        }
      }
    }

    var fire = fireNumber(expensesNum, wrateNum);
    var capMonths = LIM.yearsCap * 12;
    var target = computeTarget(savingsNum, monthlyNum, returnNum, fire, capMonths);

    var tierRows = [];
    for (var i = 0; i < TIERS.length; i++) {
      var texp = expensesNum * TIERS[i].mult;
      if (texp > LIM.expensesMax) texp = LIM.expensesMax;
      var tfire = fireNumber(texp, wrateNum);
      var ttarget = computeTarget(savingsNum, monthlyNum, returnNum, tfire, capMonths);
      tierRows.push({ expenses: texp, fire: tfire, target: ttarget, labelKey: TIERS[i].labelKey, labelFallback: TIERS[i].labelFallback });
    }

    render({
      fire: fire, expensesNum: expensesNum, wrateNum: wrateNum, target: target,
      progress: fire > 0 ? (savingsNum / fire) * 100 : 0, gap: savingsNum - fire,
      age: ageNum, tiers: tierRows, negReturn: negReturn, wrateClamped: wrateClamped, clipped: clipped
    });

    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        expenses: expensesNum, wrate: wrateNum, savings: savingsNum, monthly: monthlyNum, ret: returnNum, age: ageNum
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }

    updateChips();
  }

  // 이벤트 배선 — 실시간 재계산 + Enter
  expensesEl.addEventListener("input", function () { formatAmount(expensesEl); calculate(); });
  savingsEl.addEventListener("input", function () { formatAmount(savingsEl); calculate(); });
  monthlyEl.addEventListener("input", function () { formatAmount(monthlyEl); calculate(); });
  wrateEl.addEventListener("input", calculate);
  returnEl.addEventListener("input", calculate);
  if (ageEl) ageEl.addEventListener("input", calculate);
  calcBtn.addEventListener("click", calculate);

  var wrateChipEls = document.querySelectorAll("#wrate-chips .chip");
  for (var wi = 0; wi < wrateChipEls.length; wi++) {
    wrateChipEls[wi].addEventListener("click", function () { wrateEl.value = this.getAttribute("data-wrate"); calculate(); });
  }
  var returnChipEls = document.querySelectorAll("#return-chips .chip");
  for (var ri = 0; ri < returnChipEls.length; ri++) {
    returnChipEls[ri].addEventListener("click", function () { returnEl.value = this.getAttribute("data-return"); calculate(); });
  }

  function onEnter(e) { if (e.key === "Enter") calculate(); }
  var enterEls = [expensesEl, wrateEl, savingsEl, monthlyEl, returnEl, ageEl];
  for (var ei = 0; ei < enterEls.length; ei++) { if (enterEls[ei]) enterEls[ei].addEventListener("keydown", onEnter); }

  // 마지막 입력값 복원 (localStorage — 서버 미전송)
  (function restore() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (!saved) { updateChips(); return; }
      var p = JSON.parse(saved);
      if (p.expenses != null && p.expenses > 0) expensesEl.value = groupInput(p.expenses);
      if (p.wrate != null) wrateEl.value = p.wrate;
      if (p.savings != null && p.savings > 0) savingsEl.value = groupInput(p.savings);
      if (p.monthly != null && p.monthly > 0) monthlyEl.value = groupInput(p.monthly);
      if (p.ret != null) returnEl.value = p.ret;
      if (p.age != null && ageEl) ageEl.value = p.age;
      updateChips();
      if (p.expenses != null && p.ret != null) calculate();
    } catch (e) { updateChips(); /* 접근 불가·파싱 실패 — 빈 폼으로 시작 */ }
  })();

  // 언어 전환 시 동적 문구(금액·배지·메시지·오류·표) 재렌더
  document.addEventListener("i18n:change", function () {
    if (!last) return;
    if (last.kind === "error") showError(last.key, last.fallback);
    else render(last.state);
  });
  // TOOLJS:END
})();
