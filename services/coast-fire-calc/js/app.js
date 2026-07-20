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
  var LS_KEY = (cfg.slug || "coast-fire-calc") + ":last";
  var MAX = Number.MAX_SAFE_INTEGER; // 지수표기 방지 — 이 값 초과/비유한 시 클램프
  var LIM = {
    ageMin: 15, ageMax: 90, retireMax: 100,
    savingsMax: 1e12, monthlyMax: 1e9, spendMax: 1e11, fireMax: 1e12,
    wrateMin: 2, wrateMax: 10, returnMax: 15
  };
  var WRATE_DEFAULT = 4, RETURN_DEFAULT = 5;

  function $(id) { return document.getElementById(id); }
  var ageEl = $("age-input"), retireEl = $("retire-input"), savingsEl = $("savings-input");
  var spendEl = $("spend-input"), wrateEl = $("wrate-input"), firenumEl = $("firenum-input");
  var returnEl = $("return-input"), monthlyEl = $("monthly-input"), calcBtn = $("calc-btn");
  var spendingBlock = $("spending-block"), numberBlock = $("number-block");
  var box = $("result-box"), errEl = $("result-error"), bodyEl = $("result-body");
  var badgeEl = $("r-badge"), coastEl = $("r-coast"), subEl = $("r-sub"), msgEl = $("r-msg");
  var projEl = $("r-projection"), gapLabelEl = $("r-gaplabel"), gapEl = $("r-gap");
  var progEl = $("r-progress"), progBar = $("r-progressbar"), firenumOut = $("r-firenum");
  var coastAgeBox = $("r-coastage"), coastAgeVal = $("r-coastage-val");
  var negReturnNote = $("r-negreturn"), wrateNote = $("r-wrateclamp"), clipNote = $("r-clipped");
  if (!ageEl || !retireEl || !savingsEl || !returnEl || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function digitsOnly(s) { return String(s).replace(/[^\d]/g, ""); }
  // 입력 필드용 — 로케일 파싱 문제 회피로 ASCII 콤마 그룹핑 고정
  function groupInput(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  // 결과 표시용 — 천단위·소수는 Intl 에 위임(현재 언어), 지수표기 없음, 비유한/초과 클램프
  function fmt(n) {
    if (!isFinite(n)) n = MAX;
    if (n > MAX) n = MAX;
    if (n < -MAX) n = -MAX;
    var v = Math.round(n);
    var lang = (window.I18N && window.I18N.lang && window.I18N.lang()) || "en";
    try { return new Intl.NumberFormat(lang, { maximumFractionDigits: 0, useGrouping: true }).format(v); }
    catch (e) { return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(v); }
  }

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상, Math 외 의존 없음)
  // 코스트 파이어 넘버(오늘) = FIRE / (1+r)^n  (현재가치) · 투영 = P × (1+r)^n
  function coastCore(o) {
    var r = o.g / 100;
    var n = o.R - o.A;                       // 남은 연수 (호출부에서 n>0 보장)
    var growth = Math.pow(1 + r, n);
    var coastNumber = o.fire / growth;       // 현재가치 — 핵심 공식
    var projection = o.P * growth;           // 추가납입 0 투영
    var reached = o.P >= coastNumber;        // ≡ projection ≥ fire
    var surplusToday = o.P - coastNumber;    // >0 잉여, <0 부족
    var surplusAtRetire = projection - o.fire;
    var progress = coastNumber > 0 ? (o.P / coastNumber) * 100 : 0;
    return {
      r: r, n: n, growth: growth, coastNumber: coastNumber, projection: projection,
      reached: reached, surplusToday: surplusToday, surplusAtRetire: surplusAtRetire, progress: progress
    };
  }
  // 코스트 파이어 나이 (미달 & C>0): 월초 납입 annuity-due FV 로 매월 누적,
  // 그 시점부터 무납입으로 은퇴까지 코스트 가능한 최초 시점을 찾는다. (savings/dca 엔진 재사용)
  // 반환: { months: k } 도달, { atRetire: true } 은퇴시점 겨우 도달, null 은퇴 전 불가
  function coastAge(o) {
    var r = o.g / 100, m = r / 12, n = o.R - o.A, total = n * 12;
    for (var k = 1; k <= total; k++) {
      var Pk;
      if (m === 0) Pk = o.P + o.C * k;
      else Pk = o.P * Math.pow(1 + m, k) + o.C * (1 + m) * (Math.pow(1 + m, k) - 1) / m; // annuity-due FV
      var yearsRemaining = n - k / 12;
      var coastNeeded = o.fire / Math.pow(1 + r, yearsRemaining);
      if (Pk >= coastNeeded) return (k >= total) ? { atRetire: true } : { months: k };
    }
    return null; // 은퇴 전엔 코스트 불가
  }
  // FIRE 넘버 산출: 연지출 모드 = S/(w/100), 넘버 모드 = F
  function fireNumber(mode, spend, wrate, fnum) {
    return mode === "spending" ? spend / (wrate / 100) : fnum;
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

    // 배지
    if (res.reached) {
      badgeEl.className = "badge ok";
      badgeEl.textContent = "✓ " + t("tool.badge.reached", "You're Coast FIRE");
    } else {
      badgeEl.className = "badge no";
      badgeEl.textContent = t("tool.badge.notyet", "Not coasting yet");
    }

    coastEl.textContent = fmt(res.coastNumber);

    subEl.textContent = t("tool.result.sub", "{rate}% real return · {years} years to retirement")
      .replace("{rate}", state.returnLabel)
      .replace("{years}", res.n);

    // 주 메시지
    if (state.notCoasting) {
      msgEl.textContent = t("tool.msg.notCoasting", "With nothing invested yet and no contributions, you're not coasting — enter what you've already saved.");
    } else if (res.reached) {
      msgEl.textContent = t("tool.msg.reached", "Your current savings should grow to your FIRE number by age {age} with no further contributions — about {surplus} more than you need today.")
        .replace("{age}", state.retireLabel)
        .replace("{surplus}", fmt(Math.abs(res.surplusToday)));
    } else {
      msgEl.textContent = t("tool.msg.notReached", "You're about {short} short of the Coast FIRE number today. More time or contributions would close the gap.")
        .replace("{short}", fmt(Math.abs(res.surplusToday)));
    }

    projEl.textContent = fmt(res.projection);

    // 잉여/부족 카드 (부호에 따라 라벨·색 전환)
    if (res.surplusToday >= 0) {
      gapLabelEl.textContent = t("tool.result.surplus", "Surplus today");
      gapEl.textContent = "+" + fmt(res.surplusToday);
      gapEl.className = "rc-val pos";
    } else {
      gapLabelEl.textContent = t("tool.result.shortfall", "Shortfall today");
      gapEl.textContent = "−" + fmt(Math.abs(res.surplusToday));
      gapEl.className = "rc-val neg";
    }

    // 진척도 (표시 상한 999)
    var p = res.progress;
    var pText;
    if (p >= 999) pText = "999+";
    else if (p > 0 && p < 1) pText = "<1";
    else pText = String(Math.round(p));
    progEl.textContent = pText + "%";
    progBar.style.width = Math.max(0, Math.min(100, p)) + "%";

    firenumOut.textContent = fmt(state.fire);

    // 코스트 파이어 나이 (미달 & C>0)
    if (state.coastAge) {
      coastAgeBox.hidden = false;
      var ca = state.coastAge;
      if (ca.months != null) {
        var yFromNow = Math.floor(ca.months / 12);
        var moFromNow = ca.months % 12;
        var ageAt = state.ageNum + ca.months / 12;
        coastAgeVal.textContent = t("tool.coastAge.val", "≈ age {age} ({y}y {m}mo from now) — you could stop contributing then.")
          .replace("{age}", Math.floor(ageAt) + (moFromNow ? " " + moFromNow + "mo" : ""))
          .replace("{y}", yFromNow)
          .replace("{m}", moFromNow);
      } else if (ca.atRetire) {
        coastAgeVal.textContent = t("tool.coastAge.atRetire", "With these contributions you'd reach your FIRE number right around retirement.");
      } else {
        coastAgeVal.textContent = t("tool.coastAge.never", "Even with these contributions you won't reach Coast FIRE before retirement — raise contributions, return, or retirement age.");
      }
    } else {
      coastAgeBox.hidden = true;
    }

    negReturnNote.hidden = !state.negReturn;
    wrateNote.hidden = !state.wrateClamped;
    clipNote.hidden = !state.clipped;
  }

  function radioVal(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function setRadio(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }
  function currentMode() { return radioVal("firemode") === "number" ? "number" : "spending"; }

  function syncModeUI() {
    var mode = currentMode();
    spendingBlock.hidden = (mode !== "spending");
    numberBlock.hidden = (mode !== "number");
    var segBtns = document.querySelectorAll("#mode-seg .seg-btn");
    for (var i = 0; i < segBtns.length; i++) {
      var input = segBtns[i].querySelector("input");
      segBtns[i].classList.toggle("is-active", input && input.value === mode);
    }
  }

  function calculate() {
    var clipped = false, negReturn = false, wrateClamped = false;
    var mode = currentMode();

    var ageDigits = digitsOnly(ageEl.value);
    var retireDigits = digitsOnly(retireEl.value);
    var savingsDigits = digitsOnly(savingsEl.value);
    var spendDigits = digitsOnly(spendEl.value);
    var firenumDigits = digitsOnly(firenumEl.value);
    var returnRaw = returnEl.value.trim().replace(",", ".");
    var wrateRaw = wrateEl.value.trim().replace(",", ".");
    var monthlyDigits = digitsOnly(monthlyEl.value);

    // 1) 필수 누락: 나이·은퇴나이·저축·목표 (조용한 실패 금지)
    var targetMissing = (mode === "spending") ? (spendDigits === "") : (firenumDigits === "");
    if (ageDigits === "" || retireDigits === "" || savingsDigits === "" || targetMissing) {
      showError("tool.err.missing", "Enter your age, retirement age, savings, and target.");
      return;
    }

    // 2) 나이 파싱·클램프 + A ≥ R 차단
    var ageNum = Math.floor(Number(ageDigits));
    var retireNum = Math.floor(Number(retireDigits));
    if (ageNum < LIM.ageMin) { ageNum = LIM.ageMin; clipped = true; }
    if (ageNum > LIM.ageMax) { ageNum = LIM.ageMax; clipped = true; }
    if (retireNum > LIM.retireMax) { retireNum = LIM.retireMax; clipped = true; }
    if (retireNum <= ageNum) {
      showError("tool.err.ageOrder", "Retirement age must be greater than your current age.");
      return;
    }

    // 3) 목표(FIRE) 입력 검증
    var spendNum = 0, wrateNum = WRATE_DEFAULT, fnum = 0;
    if (mode === "spending") {
      spendNum = Number(spendDigits);
      if (spendNum <= 0) { showError("tool.err.spend", "Enter annual spending above 0."); return; }
      if (spendNum > LIM.spendMax) { spendNum = LIM.spendMax; clipped = true; }
      if (wrateRaw === "") {
        wrateNum = WRATE_DEFAULT;
      } else {
        wrateNum = Number(wrateRaw);
        if (isNaN(wrateNum) || wrateNum <= 0) { showError("tool.err.wrate", "Withdrawal rate must be greater than 0."); return; }
        if (wrateNum < LIM.wrateMin) { wrateNum = LIM.wrateMin; wrateClamped = true; }
        if (wrateNum > LIM.wrateMax) { wrateNum = LIM.wrateMax; wrateClamped = true; }
      }
    } else {
      fnum = Number(firenumDigits);
      if (fnum <= 0) { showError("tool.err.firenum", "Enter a FIRE number above 0."); return; }
      if (fnum > LIM.fireMax) { fnum = LIM.fireMax; clipped = true; }
    }

    // 4) 예상 실질수익률 (필수). g<0 → 0 클리핑+안내, g>15 → 클램프, g=0 유효(무성장)
    if (returnRaw === "" || isNaN(Number(returnRaw))) {
      showError("tool.err.return", "Enter an expected real return of 0% or more, e.g. 5%.");
      return;
    }
    var returnNum = Number(returnRaw);
    if (returnNum < 0) { returnNum = 0; negReturn = true; }
    if (returnNum > LIM.returnMax) { returnNum = LIM.returnMax; clipped = true; }

    // 5) 현재 투자자산 (0 유효), 월 납입 (선택)
    var savingsNum = Number(savingsDigits); // 위에서 빈값 아님 보장 — 0 은 유효
    if (savingsNum > LIM.savingsMax) { savingsNum = LIM.savingsMax; clipped = true; }
    var monthlyNum = monthlyDigits === "" ? 0 : Number(monthlyDigits);
    if (monthlyNum > LIM.monthlyMax) { monthlyNum = LIM.monthlyMax; clipped = true; }

    var fire = fireNumber(mode, spendNum, wrateNum, fnum);
    var res = coastCore({ A: ageNum, R: retireNum, P: savingsNum, fire: fire, g: returnNum });

    // 코스트 파이어 나이 — 미달 & 월납입>0 일 때만
    var caResult = null;
    if (!res.reached && monthlyNum > 0) {
      caResult = coastAge({ A: ageNum, R: retireNum, P: savingsNum, C: monthlyNum, fire: fire, g: returnNum });
    }
    // P=0 & C=0 → 아직 코스팅 아님 명시
    var notCoasting = (savingsNum === 0 && monthlyNum === 0 && !res.reached);

    render({
      res: res, fire: fire, mode: mode,
      returnLabel: returnNum, retireLabel: retireNum, ageNum: ageNum,
      coastAge: caResult, notCoasting: notCoasting,
      negReturn: negReturn, wrateClamped: wrateClamped, clipped: clipped
    });

    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        age: ageNum, retire: retireNum, savings: savingsNum, mode: mode,
        spend: spendNum, wrate: wrateNum, fire: fnum,
        ret: returnNum, monthly: monthlyNum
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }

    updateChips();
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

  // 이벤트 배선 — 실시간 재계산 + Enter
  savingsEl.addEventListener("input", function () { formatAmount(savingsEl); calculate(); });
  spendEl.addEventListener("input", function () { formatAmount(spendEl); calculate(); });
  firenumEl.addEventListener("input", function () { formatAmount(firenumEl); calculate(); });
  monthlyEl.addEventListener("input", function () { formatAmount(monthlyEl); calculate(); });
  ageEl.addEventListener("input", calculate);
  retireEl.addEventListener("input", calculate);
  returnEl.addEventListener("input", calculate);
  wrateEl.addEventListener("input", calculate);
  calcBtn.addEventListener("click", calculate);

  var modeRadios = document.querySelectorAll('input[name="firemode"]');
  for (var mi = 0; mi < modeRadios.length; mi++) {
    modeRadios[mi].addEventListener("change", function () { syncModeUI(); calculate(); });
  }

  var wrateChipEls = document.querySelectorAll("#wrate-chips .chip");
  for (var wi = 0; wi < wrateChipEls.length; wi++) {
    wrateChipEls[wi].addEventListener("click", function () { wrateEl.value = this.getAttribute("data-wrate"); calculate(); });
  }
  var returnChipEls = document.querySelectorAll("#return-chips .chip");
  for (var ri = 0; ri < returnChipEls.length; ri++) {
    returnChipEls[ri].addEventListener("click", function () { returnEl.value = this.getAttribute("data-return"); calculate(); });
  }

  function onEnter(e) { if (e.key === "Enter") calculate(); }
  var enterEls = [ageEl, retireEl, savingsEl, spendEl, wrateEl, firenumEl, returnEl, monthlyEl];
  for (var ei = 0; ei < enterEls.length; ei++) enterEls[ei].addEventListener("keydown", onEnter);

  // 마지막 입력값 복원 (localStorage — 서버 미전송)
  (function restore() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (!saved) { syncModeUI(); return; }
      var p = JSON.parse(saved);
      if (p.age != null) ageEl.value = p.age;
      if (p.retire != null) retireEl.value = p.retire;
      if (p.savings != null) savingsEl.value = groupInput(p.savings);
      if (p.mode === "number" || p.mode === "spending") setRadio("firemode", p.mode);
      if (p.spend != null && p.spend > 0) spendEl.value = groupInput(p.spend);
      if (p.wrate != null) wrateEl.value = p.wrate;
      if (p.fire != null && p.fire > 0) firenumEl.value = groupInput(p.fire);
      if (p.ret != null) returnEl.value = p.ret;
      if (p.monthly != null && p.monthly > 0) monthlyEl.value = groupInput(p.monthly);
      syncModeUI();
      if (p.age != null && p.retire != null && p.savings != null) calculate();
    } catch (e) { syncModeUI(); /* 접근 불가·파싱 실패 — 빈 폼으로 시작 */ }
  })();
  updateChips();

  // 언어 전환 시 동적 문구(금액·배지·메시지·오류) 재렌더
  document.addEventListener("i18n:change", function () {
    if (!last) return;
    if (last.kind === "error") showError(last.key, last.fallback);
    else render(last.state);
  });
  // TOOLJS:END
})();
