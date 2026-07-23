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
  var LS_KEY = (cfg.slug || "stock-profit-calc") + ":last";
  var SAFE = Number.MAX_SAFE_INTEGER;
  var LIM = { price: 1e12, qty: 1e9, pct: 100, amt: 1e15 };

  var CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "KRW", "INR", "BRL", "RUB",
    "IDR", "CAD", "AUD", "CHF", "HKD", "SGD", "TWD", "MXN", "ZAR", "TRY", "SEK"];
  var REGION_CCY = { US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", HK: "HKD", TW: "TWD",
    KR: "KRW", IN: "INR", BR: "BRL", RU: "RUB", ID: "IDR", CA: "CAD", AU: "AUD",
    CH: "CHF", SG: "SGD", MX: "MXN", ZA: "ZAR", TR: "TRY", SE: "SEK",
    DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", IE: "EUR", AT: "EUR", FI: "EUR" };
  var LANG_CCY = { ko: "KRW", ja: "JPY", zh: "CNY", de: "EUR", fr: "EUR", es: "EUR",
    pt: "BRL", ru: "RUB", id: "IDR", hi: "INR", bn: "BDT", ar: "USD", ur: "PKR", en: "USD" };

  function $(id) { return document.getElementById(id); }
  var buyEl = $("buy-input"), sellEl = $("sell-input"), qtyEl = $("qty-input"), curSel = $("currency-select");
  var buyfeeEl = $("buyfee-input"), sellfeeEl = $("sellfee-input"), selltaxEl = $("selltax-input");
  var cgtEl = $("cgt-input"), deductionEl = $("deduction-input");
  var advEl = $("adv"), calcBtn = $("calc-btn");
  var box = $("result-box"), errEl = $("result-error"), bodyEl = $("result-body");
  if (!buyEl || !sellEl || !qtyEl || !curSel || !calcBtn || !box) return;

  var advFields = [buyfeeEl, sellfeeEl, selltaxEl, cgtEl, deductionEl];

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function fmtLocale() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) || navigator.language || "en";
  }
  function num(el) {
    if (!el) return null;
    var v = el.valueAsNumber;
    if (isNaN(v)) { var t2 = String(el.value).trim().replace(",", "."); v = t2 === "" ? NaN : Number(t2); }
    return isNaN(v) ? null : v;
  }
  function safe(v) { if (!isFinite(v)) return 0; if (v > SAFE) return SAFE; if (v < -SAFE) return -SAFE; return v; }
  function clampPct(v) { if (v == null) return 0; if (v < 0) return 0; if (v > LIM.pct) return LIM.pct; return v; }
  function clampAmt(v) { if (v == null) return 0; if (v < 0) return 0; if (v > LIM.amt) return LIM.amt; return v; }

  // ── Intl 포매팅 (하드코딩 없음 — 통화·천단위·소수 전부 Intl 위임) ──
  function nf(opts) { try { return new Intl.NumberFormat(fmtLocale(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }
  function cyDec(cur) { try { return nf({ style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; } }
  function money(v, cur) {
    var d = cyDec(cur);
    try { return nf({ style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(safe(v)); }
    catch (e) { return String(safe(v)); }
  }
  function signedMoney(v, cur) {
    v = safe(v);
    var s = money(Math.abs(v), cur);
    if (v > 0) return "+" + s;
    if (v < 0) return "−" + s;
    return s;
  }
  function price(v, cur) {
    var d = cyDec(cur);
    try { return nf({ style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 4) }).format(safe(v)); }
    catch (e) { return String(safe(v)); }
  }
  function qtyFmt(v) { return nf({ maximumFractionDigits: 4 }).format(safe(v)); }
  function pctFmt(v, withSign) {
    var s = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safe(v)) + "%";
    return (withSign && v > 0) ? "+" + s : s;
  }

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상, Math 외 DOM 의존 없음)
  // 전 인자 raw number, 통화무관. bF/sF/tT/cgt 는 소수비율(0.15 = 15%). A 는 통화무관 금액.
  // f = sF + tT. netProfit = (Ps·Q·(1−f) − Pb·Q·(1+bF)) − max(0, gain − A)·cgt
  function computeTrade(Pb, Ps, Q, bF, sF, tT, cgt, A) {
    var f = sF + tT;
    var buyCost = Pb * Q * (1 + bF);
    var grossProceeds = Ps * Q;
    var sellCosts = grossProceeds * f;
    var netProceeds = grossProceeds * (1 - f);
    var gain = netProceeds - buyCost;
    var taxableGain = Math.max(0, gain - A);
    var capGainsTax = taxableGain * cgt;
    var netProfit = gain - capGainsTax;
    var buyCostPos = buyCost > 0;
    var returnPct = buyCostPos ? (netProfit / buyCost) * 100 : null;
    var perShareProfit = Q > 0 ? netProfit / Q : null;
    var bePossible = f < 1;
    var breakEven = (bePossible && buyCostPos) ? buyCost / (Q * (1 - f)) : null;
    return {
      f: f, buyCost: buyCost, grossProceeds: grossProceeds, sellCosts: sellCosts,
      netProceeds: netProceeds, gain: gain, taxableGain: taxableGain, capGainsTax: capGainsTax,
      netProfit: netProfit, buyCostPos: buyCostPos, returnPct: returnPct,
      perShareProfit: perShareProfit, bePossible: bePossible, breakEven: breakEven
    };
  }
  // calc-core:end

  // ── 통화 셀렉터 (형제 finance 엔진 재사용) ──
  function detectCurrency() {
    var langs = navigator.languages || [navigator.language || ""];
    for (var i = 0; i < langs.length; i++) {
      var parts = String(langs[i]).split("-");
      if (parts.length > 1) {
        var region = parts[parts.length - 1].toUpperCase();
        if (REGION_CCY[region]) return REGION_CCY[region];
      }
    }
    var primary = String(langs[0] || "en").split("-")[0].toLowerCase();
    return LANG_CCY[primary] || "USD";
  }
  function curSymbol(cur) {
    try {
      var parts = nf({ style: "currency", currency: cur }).formatToParts(0);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === "currency") return parts[i].value;
    } catch (e) { /* noop */ }
    return cur;
  }
  function fillCurrencies(selected) {
    var list = CURRENCIES.slice();
    if (list.indexOf(selected) === -1) list.unshift(selected);
    curSel.innerHTML = "";
    for (var i = 0; i < list.length; i++) {
      var opt = document.createElement("option");
      opt.value = list[i];
      opt.textContent = list[i] + " (" + curSymbol(list[i]) + ")";
      curSel.appendChild(opt);
    }
    curSel.value = selected;
  }

  var lastRun = false;

  function showNotice(key, fallback) {
    box.hidden = false; bodyEl.hidden = true; errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }

  function calculate() {
    lastRun = true;
    var cur = curSel.value || "USD";
    var Pb = num(buyEl), Ps = num(sellEl), Q = num(qtyEl);

    // 엣지: 필수 미입력 (빈값)
    if (Pb == null || Ps == null || Q == null) {
      showNotice("tool.err.empty", "Enter buy price, sell price, and quantity.");
      persist(cur); updateChips(); return;
    }
    // 엣지: 음수 단가
    if (Pb < 0 || Ps < 0) {
      showNotice("tool.err.negative", "Prices can't be negative.");
      persist(cur); updateChips(); return;
    }
    // 엣지: 수량 ≤ 0
    if (Q <= 0) {
      showNotice("tool.err.qty", "Quantity must be greater than 0.");
      persist(cur); updateChips(); return;
    }

    // 극단값 clamp
    var clipped = false;
    if (Pb > LIM.price) { Pb = LIM.price; clipped = true; }
    if (Ps > LIM.price) { Ps = LIM.price; clipped = true; }
    if (Q > LIM.qty) { Q = LIM.qty; clipped = true; }

    var bF = clampPct(num(buyfeeEl)) / 100;
    var sF = clampPct(num(sellfeeEl)) / 100;
    var tT = clampPct(num(selltaxEl)) / 100;
    var cgt = clampPct(num(cgtEl)) / 100;
    var A = clampAmt(num(deductionEl));

    var r = computeTrade(Pb, Ps, Q, bF, sF, tT, cgt, A);
    if ([r.buyCost, r.grossProceeds, r.netProfit].some(function (v) { return !isFinite(v) || Math.abs(v) > SAFE; })) clipped = true;

    errEl.hidden = true; bodyEl.hidden = false; box.hidden = false;

    // 주 지표: 세후 순손익
    var np = safe(r.netProfit);
    var npEl = $("r-netprofit");
    npEl.textContent = signedMoney(np, cur);
    npEl.className = "rc-val " + (np >= 0 ? "pl-pos" : "pl-neg");

    // 수익률 %
    var rpEl = $("r-returnpct");
    if (r.buyCostPos) {
      rpEl.textContent = pctFmt(r.returnPct, true);
      rpEl.className = "rc-val " + (r.returnPct >= 0 ? "pl-pos" : "pl-neg");
    } else {
      rpEl.textContent = "—"; rpEl.className = "rc-val";
    }

    // 손익분기 매도가
    var beEl = $("r-breakeven");
    if (!r.buyCostPos) {
      beEl.textContent = "—"; beEl.className = "rc-val";
    } else if (!r.bePossible) {
      beEl.textContent = t("tool.err.breakEven", "Sell costs ≥100%, break-even not possible.");
      beEl.className = "rc-val subtle";
    } else {
      beEl.textContent = price(r.breakEven, cur); beEl.className = "rc-val";
    }

    // Pb=0 안내 (수익률·손익분기 산출불가)
    var pbNote = $("r-pb-note");
    if (!r.buyCostPos) { pbNote.hidden = false; pbNote.textContent = t("tool.note.pbZero", "Return % and break-even need a buy price above 0."); }
    else pbNote.hidden = true;

    // 요약 라인
    $("r-sub").textContent = t("tool.result.sub", "{q} shares · buy {pb} → sell {ps}")
      .replace("{q}", qtyFmt(Q)).replace("{pb}", price(Pb, cur)).replace("{ps}", price(Ps, cur));

    // 접이식 내역
    $("r-buycost").textContent = money(r.buyCost, cur);
    $("r-grossproceeds").textContent = money(r.grossProceeds, cur);
    $("r-sellcosts").textContent = money(r.sellCosts, cur);
    var gEl = $("r-gain");
    gEl.textContent = signedMoney(r.gain, cur); gEl.className = "bd-v " + (safe(r.gain) >= 0 ? "pl-pos" : "pl-neg");
    $("r-cgt").textContent = money(r.capGainsTax, cur);
    var np2El = $("r-netprofit2");
    np2El.textContent = signedMoney(r.netProfit, cur); np2El.className = "bd-v " + (np >= 0 ? "pl-pos" : "pl-neg");
    $("r-pershare").textContent = r.perShareProfit == null ? "—" : signedMoney(r.perShareProfit, cur);

    $("r-clipped").hidden = !clipped;
    persist(cur);
    updateChips();
  }

  function updateChips() {
    var chips = document.querySelectorAll("#preset-chips .chip");
    var raws = [selltaxEl.value.trim(), cgtEl.value.trim(), deductionEl.value.trim()];
    var allEmpty = raws.every(function (s) { return s === ""; });
    var cur = { tt: clampPct(num(selltaxEl)), cgt: clampPct(num(cgtEl)), a: clampAmt(num(deductionEl)) };
    for (var i = 0; i < chips.length; i++) {
      var c = chips[i];
      var match = !allEmpty
        && Number(c.getAttribute("data-tt")) === cur.tt
        && Number(c.getAttribute("data-cgt")) === cur.cgt
        && Number(c.getAttribute("data-a")) === cur.a;
      c.classList.toggle("is-active", match);
    }
  }

  function applyPreset(chip) {
    selltaxEl.value = chip.getAttribute("data-tt");
    cgtEl.value = chip.getAttribute("data-cgt");
    deductionEl.value = chip.getAttribute("data-a");
    if (advEl) advEl.open = true;
    calculate();
  }

  function persist(cur) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        buy: buyEl.value, sell: sellEl.value, qty: qtyEl.value, currency: cur,
        buyFee: buyfeeEl.value, sellFee: sellfeeEl.value, sellTax: selltaxEl.value,
        cgt: cgtEl.value, deduction: deductionEl.value
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }

  // ── 초기화 · 복원 ──
  (function init() {
    var saved = null;
    try { var s = localStorage.getItem(LS_KEY); if (s) saved = JSON.parse(s); } catch (e) { saved = null; }

    fillCurrencies((saved && saved.currency) || detectCurrency());
    if (saved) {
      if (saved.buy) buyEl.value = saved.buy;
      if (saved.sell) sellEl.value = saved.sell;
      if (saved.qty) qtyEl.value = saved.qty;
      if (saved.buyFee) buyfeeEl.value = saved.buyFee;
      if (saved.sellFee) sellfeeEl.value = saved.sellFee;
      if (saved.sellTax) selltaxEl.value = saved.sellTax;
      if (saved.cgt) cgtEl.value = saved.cgt;
      if (saved.deduction) deductionEl.value = saved.deduction;
      var advTouched = advFields.some(function (el) { return el.value && Number(el.value) > 0; });
      if (advTouched && advEl) advEl.open = true;
    }
    if (num(buyEl) != null && num(sellEl) != null && num(qtyEl) != null) calculate();
    else updateChips();
  })();

  // ── 이벤트 배선: 실시간 재계산 (oninput) + Enter ──
  [buyEl, sellEl, qtyEl].concat(advFields).forEach(function (el) { el.addEventListener("input", calculate); });
  curSel.addEventListener("change", calculate);
  calcBtn.addEventListener("click", calculate);
  var presetChips = document.querySelectorAll("#preset-chips .chip");
  for (var pc = 0; pc < presetChips.length; pc++) {
    presetChips[pc].addEventListener("click", function () { applyPreset(this); });
  }
  function onEnter(e) { if (e.key === "Enter") calculate(); }
  [buyEl, sellEl, qtyEl].concat(advFields).forEach(function (el) { el.addEventListener("keydown", onEnter); });

  // ── 언어 전환: 동적 문구·Intl 포맷을 새 로케일로 재렌더 ──
  document.addEventListener("i18n:change", function () {
    if (lastRun && !box.hidden) calculate();
  });
  // TOOLJS:END
})();
