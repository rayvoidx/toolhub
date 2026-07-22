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
  var LS_KEY = (cfg.slug || "crypto-average-calc") + ":last";
  var SAFE = Number.MAX_SAFE_INTEGER;
  // 밈코인 대량수량(수십억 개) 대응으로 qty 상한 상향. Q·grossCost·totalCost 는 SAFE 클리핑.
  var LIM = { price: 1e12, qty: 1e15, pct: 100 };

  var CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "KRW", "INR", "BRL", "RUB",
    "IDR", "CAD", "AUD", "CHF", "HKD", "SGD", "TWD", "MXN", "ZAR", "TRY", "SEK"];
  var REGION_CCY = { US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", HK: "HKD", TW: "TWD",
    KR: "KRW", IN: "INR", BR: "BRL", RU: "RUB", ID: "IDR", CA: "CAD", AU: "AUD",
    CH: "CHF", SG: "SGD", MX: "MXN", ZA: "ZAR", TR: "TRY", SE: "SEK",
    DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", IE: "EUR", AT: "EUR", FI: "EUR" };
  var LANG_CCY = { ko: "KRW", ja: "JPY", zh: "CNY", de: "EUR", fr: "EUR", es: "EUR",
    pt: "BRL", ru: "RUB", id: "IDR", hi: "INR", bn: "BDT", ar: "USD", ur: "PKR", en: "USD" };

  function $(id) { return document.getElementById(id); }
  var lotsEl = $("lots"), addBtn = $("lot-add"), curSel = $("currency-select");
  var tickerEl = $("ticker-input");
  var buyfeeEl = $("buyfee-input"), sellfeeEl = $("sellfee-input");
  var currentEl = $("current-input"), calcBtn = $("calc-btn");
  var planqtyEl = $("planqty-input"), plantargetEl = $("plantarget-input");
  var planQtyField = $("plan-qty-field"), planTargetField = $("plan-target-field");
  var box = $("result-box"), errEl = $("result-error"), bodyEl = $("result-body");
  var advEl = $("adv"), plannerEl = $("planner");
  if (!lotsEl || !curSel || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function fmtLocale() {
    var l = (window.I18N && window.I18N.lang && window.I18N.lang()) || navigator.language || "en";
    return l;
  }
  function radioVal(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function setRadio(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }
  function num(el) {
    if (!el) return null;
    var v = el.valueAsNumber;
    if (isNaN(v)) { var t2 = String(el.value).trim().replace(",", "."); v = t2 === "" ? NaN : Number(t2); }
    return isNaN(v) ? null : v;
  }
  function safe(v) { if (!isFinite(v)) return 0; if (v > SAFE) return SAFE; if (v < -SAFE) return -SAFE; return v; }

  // ── Intl 포매팅 (하드코딩 없음 — 통화·천단위·소수 전부 Intl 위임) ──
  // 코인 오버라이드: 수량 8자리(사토시), 단가/평단/손익분기 max(cyDec,8)자리(마이크로프라이스 코인).
  // fiat 금액(totalCost·PL·addCost)은 통화 소수자리 유지. 표준표기(지수표기 금지).
  function nf(opts) { try { return new Intl.NumberFormat(fmtLocale(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }
  function cyDec(cur) { try { return nf({ style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; } }
  function money(v, cur) {
    var d = cyDec(cur);
    try { return nf({ style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(safe(v)); }
    catch (e) { return String(safe(v)); }
  }
  function moneyCeil(v, cur) {
    var d = cyDec(cur), factor = Math.pow(10, d);
    return money(Math.ceil(safe(v) * factor) / factor, cur);
  }
  function price(v, cur) {
    var d = cyDec(cur);
    try { return nf({ style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 8) }).format(safe(v)); }
    catch (e) { return String(safe(v)); }
  }
  function qtyFmt(v) { return nf({ maximumFractionDigits: 8 }).format(safe(v)); }
  function pctFmt(v, withSign) {
    var s = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + "%";
    return (withSign && v > 0) ? "+" + s : s;
  }

  // calc-core:start — 순수 계산 코어 (부모 stock-average-calc 에서 무수정 이식, node 단위검증 대상)
  // 코인=거래세 없음: sellTaxPct 인자는 호출부에서 항상 0. f=(sellFee+tax)/100, buyF=buyFee/100 (통화무관).
  // 유효행 = q>0 AND p>=0.
  function computePosition(lots, buyFeePct, sellFeePct, sellTaxPct) {
    var Q = 0, grossCost = 0, valid = 0, clipped = false, i, q, p;
    for (i = 0; i < lots.length; i++) {
      q = lots[i].q; p = lots[i].p;
      if (q == null || p == null || q <= 0 || p < 0) continue; // 계산 제외 (오류 아님)
      if (q > LIM.qty) { q = LIM.qty; clipped = true; }
      if (p > LIM.price) { p = LIM.price; clipped = true; }
      Q += q; grossCost += q * p; valid++;
    }
    if (valid === 0 || Q <= 0) return { ok: false };
    if (Q > SAFE) { Q = SAFE; clipped = true; }
    if (grossCost > SAFE) { grossCost = SAFE; clipped = true; }
    var buyF = buyFeePct / 100, f = (sellFeePct + sellTaxPct) / 100;
    var avgPrice = grossCost / Q;
    var totalCost = grossCost * (1 + buyF);
    if (totalCost > SAFE) { totalCost = SAFE; clipped = true; }
    var bePossible = f < 1;
    var breakEven = bePossible ? totalCost / (Q * (1 - f)) : null;
    return {
      ok: true, valid: valid, clipped: clipped, Q: Q, grossCost: grossCost,
      avgPrice: avgPrice, totalCost: totalCost, buyF: buyF, f: f,
      bePossible: bePossible, breakEven: breakEven
    };
  }
  function computePL(pos, C) {
    if (C == null || C <= 0) return null;
    var grossPL = (C - pos.avgPrice) * pos.Q;
    var netPL = null, returnPct = null;
    if (pos.bePossible) {
      netPL = C * pos.Q * (1 - pos.f) - pos.totalCost;
      returnPct = pos.totalCost > 0 ? netPL / pos.totalCost * 100 : null;
    }
    return { grossPL: grossPL, netPL: netPL, returnPct: returnPct };
  }
  function planByQty(pos, C, n) {
    if (C == null || C <= 0) return { ok: false, reason: "needCurrent" };
    if (n == null || n <= 0) return { ok: false, reason: "none" };
    if (n > LIM.qty) n = LIM.qty;
    var newAvg = (pos.grossCost + n * C) / (pos.Q + n);
    return { ok: true, n: n, newAvg: newAvg, addCost: n * C };
  }
  function planByTarget(pos, C, T) {
    if (C == null || C <= 0) return { ok: false, reason: "needCurrent" };
    if (T == null || T <= 0) return { ok: false, reason: "none" };
    // 하향 물타기 가능조건: 현재가 < 목표평단 < 기존평단
    if (!(C < T && T < pos.avgPrice)) return { ok: false, reason: "infeasible" };
    var n = pos.Q * (pos.avgPrice - T) / (T - C);
    var newAvg = (pos.grossCost + n * C) / (pos.Q + n);
    return { ok: true, n: n, newAvg: newAvg, addCost: n * C };
  }
  // calc-core:end

  // ── 매수 로트 행 (라벨: Amount (coins) / Price per coin) ──
  function makeRow(qv, pv) {
    var row = document.createElement("div");
    row.className = "lot-row";
    var qi = document.createElement("input");
    qi.type = "number"; qi.className = "lot-q"; qi.setAttribute("inputmode", "decimal");
    qi.min = "0"; qi.step = "any"; qi.autocomplete = "off";
    qi.placeholder = t("tool.lots.qtyPh", "Amount (coins)");
    qi.setAttribute("aria-label", t("tool.lots.qtyAria", "Amount in coins"));
    if (qv != null) qi.value = qv;
    var pi = document.createElement("input");
    pi.type = "number"; pi.className = "lot-p"; pi.setAttribute("inputmode", "decimal");
    pi.min = "0"; pi.step = "any"; pi.autocomplete = "off";
    pi.placeholder = t("tool.lots.pricePh", "Price per coin");
    pi.setAttribute("aria-label", t("tool.lots.priceAria", "Price per coin"));
    if (pv != null) pi.value = pv;
    var rm = document.createElement("button");
    rm.type = "button"; rm.className = "lot-rm"; rm.innerHTML = "&times;";
    rm.setAttribute("aria-label", t("tool.lots.removeAria", "Remove this buy"));
    rm.addEventListener("click", function () {
      var rows = lotsEl.querySelectorAll(".lot-row");
      if (rows.length > 1) { lotsEl.removeChild(row); }
      else { qi.value = ""; pi.value = ""; }
      calculate();
    });
    row.appendChild(qi); row.appendChild(pi); row.appendChild(rm);
    return row;
  }
  function readLots() {
    var out = [], rows = lotsEl.querySelectorAll(".lot-row"), i;
    for (i = 0; i < rows.length; i++) {
      out.push({ q: num(rows[i].querySelector(".lot-q")), p: num(rows[i].querySelector(".lot-p")) });
    }
    return out;
  }
  function relabelRows() {
    var rows = lotsEl.querySelectorAll(".lot-row"), i, qi, pi, rm;
    for (i = 0; i < rows.length; i++) {
      qi = rows[i].querySelector(".lot-q"); pi = rows[i].querySelector(".lot-p"); rm = rows[i].querySelector(".lot-rm");
      if (qi) { qi.placeholder = t("tool.lots.qtyPh", "Amount (coins)"); qi.setAttribute("aria-label", t("tool.lots.qtyAria", "Amount in coins")); }
      if (pi) { pi.placeholder = t("tool.lots.pricePh", "Price per coin"); pi.setAttribute("aria-label", t("tool.lots.priceAria", "Price per coin")); }
      if (rm) rm.setAttribute("aria-label", t("tool.lots.removeAria", "Remove this buy"));
    }
  }

  // ── 통화 셀렉터 ──
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

  // ── 코인 티커 (순수 장식 — 결과 헤딩 개인화, 계산 무관) ──
  function tickerText() {
    if (!tickerEl) return "";
    var raw = String(tickerEl.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return raw.slice(0, 10);
  }

  var lastRun = false; // 최소 1회 계산됐는지 (i18n:change 재렌더 가드)

  function showNotice(key, fallback) {
    box.hidden = false; bodyEl.hidden = true; errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }

  function calculate() {
    lastRun = true;
    var cur = curSel.value || "USD";
    // 코인=거래세 없음 → sellTaxPct 는 항상 0 으로 호출
    var pos = computePosition(readLots(),
      clampPct(num(buyfeeEl)), clampPct(num(sellfeeEl)), 0);

    if (!pos.ok) { showNotice("tool.err.noRows", "Add at least one buy (amount and price)."); persist(cur); updateChips(); return; }

    errEl.hidden = true; bodyEl.hidden = false; box.hidden = false;

    var tk = tickerText();
    var avgLabelEl = $("r-avg-label");
    if (avgLabelEl) avgLabelEl.textContent = t("tool.result.avgLabel", "Weighted average price") + (tk ? " · " + tk : "");
    $("r-avg").textContent = price(pos.avgPrice, cur);
    $("r-qty").textContent = qtyFmt(pos.Q);
    $("r-totalcost").textContent = money(pos.totalCost, cur);
    if (pos.bePossible) $("r-breakeven").textContent = price(pos.breakEven, cur);
    else $("r-breakeven").textContent = t("tool.err.breakEven", "Sell fee ≥100%, break-even not possible.");
    var unit = tk || t("tool.result.coinUnit", "coins");
    $("r-sub").textContent = t("tool.result.sub", "From {n} buys totaling {q} {unit}.")
      .replace("{n}", pos.valid).replace("{q}", qtyFmt(pos.Q)).replace("{unit}", unit);

    // 평가손익 (현재가 입력 시)
    var C = num(currentEl);
    var plBlock = $("pl-block"), plNote = $("r-pl-note");
    var pl = computePL(pos, C);
    if (C != null && C <= 0) {
      plBlock.hidden = true;
      plNote.hidden = false; plNote.className = "subtle"; plNote.textContent = t("tool.note.currentInvalid", "Enter a current price above 0 to see profit/loss.");
    } else if (pl) {
      plBlock.hidden = false;
      var plEl = $("r-pl"), pctEl = $("r-plpct");
      if (pos.bePossible) {
        plEl.textContent = money(pl.netPL, cur);
        plEl.className = "rc-val " + (pl.netPL >= 0 ? "pl-pos" : "pl-neg");
        pctEl.textContent = pl.returnPct == null ? "—" : pctFmt(pl.returnPct, true);
        pctEl.className = "rc-val " + (pl.returnPct >= 0 ? "pl-pos" : "pl-neg");
        plNote.hidden = false; plNote.className = "subtle";
        plNote.textContent = t("tool.result.plGross", "Before sell fee: {x}").replace("{x}", money(pl.grossPL, cur));
      } else {
        plEl.textContent = money(pl.grossPL, cur);
        plEl.className = "rc-val " + (pl.grossPL >= 0 ? "pl-pos" : "pl-neg");
        pctEl.textContent = "—"; pctEl.className = "rc-val";
        plNote.hidden = false; plNote.className = "subtle"; plNote.textContent = t("tool.result.plNoNet", "Sell fee ≥100% — net P/L not available; showing change before fees.");
      }
    } else {
      plBlock.hidden = true; plNote.hidden = true;
    }

    // 물타기 플래너
    var planBlock = $("plan-block"), planMsg = $("plan-msg");
    var mode = radioVal("planmode") || "qty";
    var engaged = mode === "qty" ? (num(planqtyEl) != null) : (num(plantargetEl) != null);
    if (!engaged) { planBlock.hidden = true; planMsg.hidden = true; }
    else {
      var plan = mode === "qty" ? planByQty(pos, C, num(planqtyEl)) : planByTarget(pos, C, num(plantargetEl));
      if (plan.ok) {
        planBlock.hidden = false; planMsg.hidden = true;
        $("r-plan-need").textContent = qtyFmt(plan.n);
        $("r-plan-cost").textContent = moneyCeil(plan.addCost, cur);
        $("r-plan-avg").textContent = price(plan.newAvg, cur);
      } else {
        planBlock.hidden = true;
        if (plan.reason === "none") { planMsg.hidden = true; }
        else {
          planMsg.hidden = false;
          planMsg.textContent = plan.reason === "needCurrent"
            ? t("tool.planner.needCurrent", "Enter a current price above 0 to plan an averaging-down buy.")
            : t("tool.planner.infeasible", "Target must be between the current price and your average.");
        }
      }
    }

    $("r-clipped").hidden = !pos.clipped;
    persist(cur);
    updateChips();
  }

  function clampPct(v) { if (v == null) return 0; if (v < 0) return 0; if (v > LIM.pct) return LIM.pct; return v; }

  // 수수료 프리셋 칩 — 매도 수수료 입력에 바인딩 (거래소 스팟 수수료 0/0.1/0.25%)
  function updateChips() {
    var raw = sellfeeEl.value.trim().replace(",", ".");
    var chips = document.querySelectorAll("#fee-chips .chip");
    for (var i = 0; i < chips.length; i++) {
      var dv = chips[i].getAttribute("data-fee");
      chips[i].classList.toggle("is-active", raw !== "" && Number(dv) === Number(raw));
    }
  }

  function persist(cur) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        lots: readLots(), currency: cur, ticker: tickerEl ? tickerEl.value : "",
        buyFee: buyfeeEl.value, sellFee: sellfeeEl.value,
        current: currentEl.value, planMode: radioVal("planmode"),
        planQty: planqtyEl.value, planTarget: plantargetEl.value
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }

  function syncPlanFields() {
    var mode = radioVal("planmode") || "qty";
    planQtyField.hidden = mode !== "qty";
    planTargetField.hidden = mode !== "target";
  }

  // ── 초기화 · 복원 ──
  (function init() {
    var saved = null;
    try { var s = localStorage.getItem(LS_KEY); if (s) saved = JSON.parse(s); } catch (e) { saved = null; }

    var startCur = (saved && saved.currency) || detectCurrency();
    fillCurrencies(startCur);

    // 로트 행: 저장분 있으면 복원, 없으면 기본 3행
    lotsEl.innerHTML = "";
    var lots = (saved && saved.lots && saved.lots.length) ? saved.lots : [null, null, null];
    for (var i = 0; i < lots.length; i++) {
      var l = lots[i] || {};
      lotsEl.appendChild(makeRow(l.q != null ? l.q : null, l.p != null ? l.p : null));
    }
    if (saved) {
      if (tickerEl && saved.ticker) tickerEl.value = saved.ticker;
      if (saved.buyFee) buyfeeEl.value = saved.buyFee;
      if (saved.sellFee) sellfeeEl.value = saved.sellFee;
      if (saved.current) currentEl.value = saved.current;
      if (saved.planQty) planqtyEl.value = saved.planQty;
      if (saved.planTarget) plantargetEl.value = saved.planTarget;
      if (saved.planMode === "target" || saved.planMode === "qty") setRadio("planmode", saved.planMode);
      if ((saved.buyFee && Number(saved.buyFee) > 0) || (saved.sellFee && Number(saved.sellFee) > 0) ||
          (saved.current && Number(saved.current) > 0)) advEl.open = true;
      if ((saved.planQty && Number(saved.planQty) > 0) || (saved.planTarget && Number(saved.planTarget) > 0)) plannerEl.open = true;
    }
    syncPlanFields();
    // 유효행이 하나라도 있으면 즉시 계산 (복원 재현)
    var hasValid = readLots().some(function (l) { return l.q != null && l.q > 0 && l.p != null && l.p >= 0; });
    if (hasValid) calculate(); else updateChips();
  })();

  // ── 이벤트 배선: 실시간 재계산 (oninput) + Enter ──
  lotsEl.addEventListener("input", calculate);
  addBtn.addEventListener("click", function () { lotsEl.appendChild(makeRow(null, null)); });
  curSel.addEventListener("change", calculate);
  var reactive = [buyfeeEl, sellfeeEl, currentEl, planqtyEl, plantargetEl];
  if (tickerEl) reactive.push(tickerEl);
  reactive.forEach(function (el) { el.addEventListener("input", calculate); });
  var planRadios = document.querySelectorAll('input[name="planmode"]');
  for (var pr = 0; pr < planRadios.length; pr++) planRadios[pr].addEventListener("change", function () { syncPlanFields(); calculate(); });
  var feeChips = document.querySelectorAll("#fee-chips .chip");
  for (var fc = 0; fc < feeChips.length; fc++) {
    feeChips[fc].addEventListener("click", function () { sellfeeEl.value = this.getAttribute("data-fee"); calculate(); });
  }
  calcBtn.addEventListener("click", calculate);
  function onEnter(e) { if (e.key === "Enter") calculate(); }
  reactive.forEach(function (el) { el.addEventListener("keydown", onEnter); });
  lotsEl.addEventListener("keydown", onEnter);

  // ── 언어 전환: 라벨·동적 문구·Intl 포맷을 새 로케일로 재렌더 ──
  document.addEventListener("i18n:change", function () {
    relabelRows();
    if (lastRun && !box.hidden) calculate();
  });
  // TOOLJS:END
})();
