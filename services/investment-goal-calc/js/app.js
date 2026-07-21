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
  var LS_KEY = (cfg.slug || "investment-goal-calc") + ":last";
  var MAX = Number.MAX_SAFE_INTEGER; // 지수표기 방지 — 이 값 초과 시 클램프
  var LIM = { targetMax: 1000000000, startMax: 1000000000, returnMax: 30, yearsMax: 50, inflMax: 20 };

  function $(id) { return document.getElementById(id); }
  var targetEl = $("target-input");
  var yearsEl = $("years-input");
  var returnEl = $("return-input");
  var startEl = $("start-input");
  var inflEl = $("inflation-input");
  var calcBtn = $("calc-btn");
  var box = $("result-box");
  var errEl = $("result-error");
  var bodyEl = $("result-body");
  var outMonthly = $("r-monthly");
  var outSub = $("r-sub");
  var outShare = $("r-share");
  var outContrib = $("r-contrib");
  var outGrowth = $("r-growth");
  var outLump = $("r-lump");
  var outToday = $("r-today");
  var todayBadge = $("r-today-badge");
  var goalMetNote = $("r-goalmet");
  var clipNote = $("r-clipped");
  if (!targetEl || !yearsEl || !returnEl || !startEl || !inflEl || !calcBtn || !box) return;

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

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상; dca-calc annuity-due 성장항 재사용, 방향 역산)
  // 월초 납입 annuity-due 역산: growth = (1+m)^n, factor = (1+m)(growth−1)/m
  // 필요월납입 = ceil((목표 − 시작금×growth) / factor)  (목표 미달 방지 위해 올림)
  function computeGoal(o) {
    var m = o.annualReturn / 1200;           // 월 수익률
    var n = o.years * 12;                     // 개월
    var growth = m === 0 ? 1 : Math.pow(1 + m, n); // dca-calc futureValue 성장항 재사용
    var startProjection = o.start * growth;   // 시작금 투영
    var goalMetByStart = startProjection >= o.target; // 시작금 단독 도달

    var requiredMonthly;
    if (goalMetByStart) {
      requiredMonthly = 0;
    } else if (m === 0) {
      requiredMonthly = Math.ceil(Math.max(0, (o.target - o.start) / n)); // 무성장 직접 분할 (0-division 회피)
    } else {
      var factor = (1 + m) * (growth - 1) / m; // annuity-due factor
      requiredMonthly = Math.ceil(Math.max(0, (o.target - startProjection) / factor));
    }
    var clamped = false;
    if (!isFinite(requiredMonthly) || requiredMonthly > MAX) { requiredMonthly = MAX; clamped = true; }

    var totalContrib = Math.floor(o.start + requiredMonthly * n); // 총 납입액 = 시작금 + 월납입×개월
    if (!isFinite(totalContrib) || totalContrib > MAX) { totalContrib = MAX; clamped = true; }

    // 시장수익(성장 기여) = max(0, 목표 − 총납입) → 총납입 + 시장수익 = 목표 (카드 합 일치)
    var marketGrowth = Math.max(0, o.target - totalContrib);

    // 대안 일시금(지금 단 한 번 투자) = ceil(max(0, 목표/growth − 시작금))
    var lumpSum = Math.ceil(Math.max(0, o.target / growth - o.start));
    if (!isFinite(lumpSum) || lumpSum > MAX) { lumpSum = MAX; clamped = true; }

    // 오늘 돈 기준 목표 = floor(목표 / (1+infl/100)^Y)  (infl 0 → = 목표)
    var todayTarget = Math.floor(o.target / Math.pow(1 + o.inflation / 100, o.years));

    // 시장수익 기여 비중% (목표>0 보장 — 입력 검증에서 0/음수 차단)
    var growthShare = o.target > 0 ? Math.round(marketGrowth / o.target * 100) : 0;

    return {
      requiredMonthly: requiredMonthly, totalContrib: totalContrib, marketGrowth: marketGrowth,
      lumpSum: lumpSum, todayTarget: todayTarget, growthShare: growthShare,
      goalMetByStart: goalMetByStart, clamped: clamped
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

    outMonthly.textContent = fmt(res.requiredMonthly);

    outSub.textContent = t("tool.result.sub", "reach {target} in {years} yr at {rate}%")
      .replace("{target}", fmt(state.target))
      .replace("{years}", state.years)
      .replace("{rate}", state.returnLabel);

    outShare.textContent = t("tool.share", "Market growth covers {pct}% of your goal — your contributions do the rest.")
      .replace("{pct}", res.growthShare);

    outContrib.textContent = fmt(res.totalContrib);
    outGrowth.textContent = fmt(res.marketGrowth);
    outLump.textContent = fmt(res.lumpSum);
    outToday.textContent = fmt(res.todayTarget);
    todayBadge.hidden = !state.inflated;

    goalMetNote.hidden = !res.goalMetByStart;
    clipNote.hidden = !state.clipped;
  }

  function calculate() {
    var targetDigits = digitsOnly(targetEl.value);
    var startDigits = digitsOnly(startEl.value);
    var returnRaw = returnEl.value.trim().replace(",", ".");
    var yearsRaw = yearsEl.value.trim();
    var inflRaw = inflEl.value.trim().replace(",", ".");
    var clipped = false;

    // 목표 필수 — 빈값/0/음수는 명시 안내 (조용한 실패 금지)
    if (targetDigits === "" || Number(targetDigits) <= 0) {
      showError("tool.err.target", "Enter a target amount you're saving toward.");
      return;
    }
    // 기간 필수 — 빈값/0/음수 차단
    var yearsNum = Math.floor(Number(yearsRaw));
    if (yearsRaw === "" || isNaN(Number(yearsRaw)) || yearsNum < 1) {
      showError("tool.err.years", "Enter a time horizon of 1 to 50 years.");
      return;
    }
    // 예상 수익률 필수 (0% 는 유효)
    if (returnRaw === "" || isNaN(Number(returnRaw))) {
      showError("tool.err.return", "Enter an expected annual return (e.g. 7%).");
      return;
    }

    // 상한/하한 클리핑
    var targetNum = Number(targetDigits);
    if (targetNum > LIM.targetMax) { targetNum = LIM.targetMax; clipped = true; }

    var startNum = startDigits === "" ? 0 : Number(startDigits);
    if (startNum > LIM.startMax) { startNum = LIM.startMax; clipped = true; }

    var returnNum = Number(returnRaw);
    if (returnNum < 0) { returnNum = 0; clipped = true; } // 성장 시뮬레이터 — 하강 시나리오 미지원(0 클리핑)
    if (returnNum > LIM.returnMax) { returnNum = LIM.returnMax; clipped = true; }

    if (yearsNum > LIM.yearsMax) { yearsNum = LIM.yearsMax; clipped = true; }

    var inflNum = inflRaw === "" ? 0 : Number(inflRaw);
    if (isNaN(inflNum) || inflNum < 0) { inflNum = 0; clipped = true; }
    if (inflNum > LIM.inflMax) { inflNum = LIM.inflMax; clipped = true; }

    var res = computeGoal({
      target: targetNum, start: startNum, annualReturn: returnNum,
      years: yearsNum, inflation: inflNum
    });
    if (res.clamped) clipped = true; // 계산값 MAX 클램프도 클리핑 노트로 안내

    render({
      res: res, target: targetNum, returnLabel: returnNum, years: yearsNum,
      inflated: inflNum > 0, clipped: clipped
    });

    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        target: targetNum, start: startNum, ret: returnNum, years: yearsNum, infl: inflNum
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }

    updateChips();
  }

  function formatAmount(el) {
    var d = digitsOnly(el.value);
    el.value = d === "" ? "" : groupInput(Number(d));
  }
  function markChips(sel, attr, raw) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      var dv = els[i].getAttribute(attr);
      els[i].classList.toggle("is-active", raw !== "" && Number(dv) === Number(raw));
    }
  }
  function updateChips() {
    markChips("#years-chips .chip", "data-years", yearsEl.value.trim());
    markChips("#return-chips .chip", "data-return", returnEl.value.trim().replace(",", "."));
    markChips("#inflation-chips .chip", "data-infl", inflEl.value.trim().replace(",", "."));
  }

  // 이벤트 배선 — 실시간 재계산 + Enter
  targetEl.addEventListener("input", function () { formatAmount(targetEl); calculate(); });
  startEl.addEventListener("input", function () { formatAmount(startEl); calculate(); });
  yearsEl.addEventListener("input", calculate);
  returnEl.addEventListener("input", calculate);
  inflEl.addEventListener("input", calculate);
  calcBtn.addEventListener("click", calculate);

  function wireChips(sel, attr, targetInput) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      els[i].addEventListener("click", function () {
        targetInput.value = this.getAttribute(attr);
        calculate();
      });
    }
  }
  wireChips("#years-chips .chip", "data-years", yearsEl);
  wireChips("#return-chips .chip", "data-return", returnEl);
  wireChips("#inflation-chips .chip", "data-infl", inflEl);

  function onEnter(e) { if (e.key === "Enter") calculate(); }
  var enterEls = [targetEl, yearsEl, returnEl, startEl, inflEl];
  for (var ei = 0; ei < enterEls.length; ei++) enterEls[ei].addEventListener("keydown", onEnter);

  // 마지막 입력값 복원 (localStorage — 서버 미전송)
  (function restore() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (!saved) return;
      var p = JSON.parse(saved);
      if (p.target != null && p.target > 0) targetEl.value = groupInput(p.target);
      if (p.start != null && p.start > 0) startEl.value = groupInput(p.start);
      if (p.years != null) yearsEl.value = p.years;
      if (p.ret != null) returnEl.value = p.ret;
      if (p.infl != null && p.infl > 0) inflEl.value = p.infl;
      if (p.target != null && p.target > 0) calculate();
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
