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
  var LS_KEY = (cfg.slug || "blood-alcohol-calc") + ":last";

  var R = { male: 0.68, female: 0.55 };  // Widmark r (population averages)
  var ETH = 0.789;      // ethanol density g/mL
  var BETA = 0.015;     // metabolism, %BAC per hour
  var KG_MIN = 30, KG_MAX = 250, LB_MIN = 66, LB_MAX = 550;
  var LB_TO_KG = 0.453592;
  var HOURS_MAX = 24;

  var PRESETS = {
    beer:    { vol: 355, abv: 5,  key: "tool.drink.beer" },
    wine:    { vol: 150, abv: 12, key: "tool.drink.wine" },
    soju:    { vol: 50,  abv: 17, key: "tool.drink.soju" },
    spirits: { vol: 44,  abv: 40, key: "tool.drink.spirits" },
    custom:  { vol: null, abv: null, key: "tool.drink.custom" }
  };
  var PRESET_ORDER = ["beer", "wine", "soju", "spirits", "custom"];
  var PRESET_FB = {
    beer: "Beer (355 mL · 5%)",
    wine: "Wine (150 mL · 12%)",
    soju: "Soju shot (50 mL · 17%)",
    spirits: "Spirits shot (44 mL · 40%)",
    custom: "Custom…"
  };
  var BADGE = {
    below: { key: "tool.badge.below", fb: "Below 0.03%", color: "#16a34a" },
    mid:   { key: "tool.badge.mid",   fb: "0.03%–0.079%", color: "#d97706" },
    high:  { key: "tool.badge.high",  fb: "0.08% or higher", color: "#dc2626" }
  };

  function $(id) { return document.getElementById(id); }
  function t(key, fb) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fb : v;
  }
  function msg(key, fb, args) {
    var s = t(key, fb);
    if (args) { for (var k in args) { if (args.hasOwnProperty(k)) s = s.split("{" + k + "}").join(args[k]); } }
    return s;
  }

  var weightEl = $("weight-input");
  var hoursEl = $("hours-input");
  var rowsWrap = $("drink-rows");
  var addBtn = $("add-drink");
  var calcBtn = $("calc-btn");
  var box = $("result-box");
  var errEl = $("result-error");
  var bodyEl = $("result-body");
  var outBac = $("r-bac");
  var metabEl = $("r-metabolized");
  var badgeEl = $("r-badge");
  var extremeEl = $("r-extreme");
  var peakEl = $("r-peak");
  var row003 = $("r-time-003");
  var row008 = $("r-time-008");
  var row000 = $("r-time-000");
  if (!weightEl || !hoursEl || !rowsWrap || !addBtn || !calcBtn || !box) return;

  function radioVal(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function setRadio(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }

  // calc-core:start — pure Widmark core (node unit-tested)
  function computeBAC(input) {
    // input: { sex, weightKg, drinks:[{vol,abv,qty}], hours }
    var grams = 0;
    for (var i = 0; i < input.drinks.length; i++) {
      var d = input.drinks[i];
      if (!(d.vol > 0) || !(d.abv > 0) || !(d.qty > 0)) continue; // 0/blank contributes nothing
      grams += d.vol * (d.abv / 100) * ETH * d.qty;
    }
    var r = R[input.sex] || R.male;
    var denom = input.weightKg * 1000 * r;
    var peak = denom > 0 ? (grams / denom) * 100 : 0;
    var current = peak - BETA * input.hours;
    if (current < 0) current = 0;
    // remaining time from now until below each limit (max(0, (current − L)/β))
    var t003 = current > 0.03 ? (current - 0.03) / BETA : 0;
    var t008 = current > 0.08 ? (current - 0.08) / BETA : 0;
    var t000 = current / BETA;
    var badge = current >= 0.08 ? "high" : (current >= 0.03 ? "mid" : "below");
    return {
      grams: grams, peak: peak, current: current,
      t003: t003, t008: t008, t000: t000,
      badge: badge,
      extreme: current > 0.40,
      metabolized: current <= 0.0001
    };
  }
  // calc-core:end

  function fmtPct(x) { return x.toFixed(2) + " %"; }
  function fmtTime(hoursDec) {
    var totalMin = Math.round(hoursDec * 60);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h > 0) return msg("tool.time.hm", "{h}h {m}m", { h: h, m: m });
    return msg("tool.time.mOnly", "{m}m", { m: m });
  }

  // ---- drink-row builder ----
  function makeRow(pre) {
    pre = pre || { type: "beer", qty: 1, vol: "", abv: "" };
    var row = document.createElement("div");
    row.className = "bac-drink-row";
    row.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;";

    var sel = document.createElement("select");
    sel.className = "drink-type";
    sel.style.cssText = "flex:3 1 150px;width:auto;min-width:0;";
    for (var i = 0; i < PRESET_ORDER.length; i++) {
      var k = PRESET_ORDER[i];
      var opt = document.createElement("option");
      opt.value = k;
      opt.setAttribute("data-i18n", PRESETS[k].key);
      opt.textContent = t(PRESETS[k].key, PRESET_FB[k]);
      sel.appendChild(opt);
    }
    sel.value = (PRESETS[pre.type] ? pre.type : "beer");

    var qty = document.createElement("input");
    qty.type = "number"; qty.className = "drink-qty"; qty.min = "1"; qty.step = "1";
    qty.inputMode = "numeric"; qty.value = (pre.qty != null && pre.qty !== "") ? pre.qty : 1;
    qty.setAttribute("aria-label", t("tool.drink.qty", "Quantity"));
    qty.setAttribute("data-i18n-aria-label", "tool.drink.qty");
    qty.style.cssText = "flex:1 1 64px;width:auto;min-width:0;";

    var vol = document.createElement("input");
    vol.type = "number"; vol.className = "drink-vol"; vol.min = "0"; vol.step = "1";
    vol.inputMode = "decimal"; vol.value = pre.vol != null ? pre.vol : "";
    vol.placeholder = t("tool.drink.vol", "mL");
    vol.setAttribute("data-i18n-placeholder", "tool.drink.vol");
    vol.setAttribute("aria-label", t("tool.drink.vol", "mL"));
    vol.setAttribute("data-i18n-aria-label", "tool.drink.vol");
    vol.style.cssText = "flex:1 1 64px;width:auto;min-width:0;";

    var abv = document.createElement("input");
    abv.type = "number"; abv.className = "drink-abv"; abv.min = "0"; abv.max = "100"; abv.step = "0.1";
    abv.inputMode = "decimal"; abv.value = pre.abv != null ? pre.abv : "";
    abv.placeholder = t("tool.drink.abv", "ABV %");
    abv.setAttribute("data-i18n-placeholder", "tool.drink.abv");
    abv.setAttribute("aria-label", t("tool.drink.abv", "ABV %"));
    abv.setAttribute("data-i18n-aria-label", "tool.drink.abv");
    abv.style.cssText = "flex:1 1 64px;width:auto;min-width:0;";

    var rm = document.createElement("button");
    rm.type = "button"; rm.className = "drink-remove"; rm.textContent = "×";
    rm.setAttribute("aria-label", t("tool.drink.remove", "Remove drink"));
    rm.setAttribute("data-i18n-aria-label", "tool.drink.remove");
    rm.style.cssText = "flex:0 0 auto;border:1px solid var(--line);background:var(--bg);color:var(--muted);border-radius:8px;width:38px;height:40px;font-size:20px;line-height:1;cursor:pointer;";

    row.appendChild(sel); row.appendChild(qty); row.appendChild(vol); row.appendChild(abv); row.appendChild(rm);

    function syncCustom() {
      var isC = sel.value === "custom";
      vol.hidden = !isC; abv.hidden = !isC;
    }
    syncCustom();
    sel.addEventListener("change", function () { syncCustom(); persist(); });
    qty.addEventListener("input", persist);
    vol.addEventListener("input", persist);
    abv.addEventListener("input", persist);
    rm.addEventListener("click", function () {
      if (row.parentNode) row.parentNode.removeChild(row);
      persist();
    });
    return row;
  }

  function readDrinks() {
    var out = [];
    var rows = rowsWrap.querySelectorAll(".bac-drink-row");
    for (var i = 0; i < rows.length; i++) {
      var type = rows[i].querySelector(".drink-type").value;
      var qty = parseInt(rows[i].querySelector(".drink-qty").value, 10);
      if (!(qty > 0)) qty = 0;
      var vol, abv;
      if (type === "custom") {
        vol = parseFloat(rows[i].querySelector(".drink-vol").value);
        abv = parseFloat(rows[i].querySelector(".drink-abv").value);
        if (isNaN(vol)) vol = 0;
        if (isNaN(abv)) abv = 0;
      } else {
        vol = PRESETS[type].vol; abv = PRESETS[type].abv;
      }
      out.push({ type: type, qty: qty, vol: vol, abv: abv });
    }
    return out;
  }

  function persist() {
    try {
      var rows = rowsWrap.querySelectorAll(".bac-drink-row");
      var drinks = [];
      for (var i = 0; i < rows.length; i++) {
        drinks.push({
          type: rows[i].querySelector(".drink-type").value,
          qty: rows[i].querySelector(".drink-qty").value,
          vol: rows[i].querySelector(".drink-vol").value,
          abv: rows[i].querySelector(".drink-abv").value
        });
      }
      localStorage.setItem(LS_KEY, JSON.stringify({
        sex: radioVal("sex"), weight: weightEl.value,
        unit: radioVal("wunit"), drinks: drinks, hours: hoursEl.value
      }));
    } catch (e) { /* private mode — ignore */ }
  }

  var last = null; // last render state, for i18n:change re-render (persistent state lives in localStorage)

  function showError(key, fb, args) {
    last = { kind: "error", key: key, fb: fb, args: args };
    box.hidden = false;
    bodyEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = msg(key, fb, args);
  }

  function renderTimeRow(el, show, hrs, key, fb) {
    if (!show) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = msg(key, fb, { t: fmtTime(hrs) });
  }

  function render(res) {
    last = { kind: "result", res: res };
    errEl.hidden = true;
    bodyEl.hidden = false;
    box.hidden = false;

    outBac.textContent = fmtPct(res.current);
    metabEl.hidden = !res.metabolized;

    var b = BADGE[res.badge] || BADGE.below;
    badgeEl.textContent = t(b.key, b.fb);
    badgeEl.style.cssText = "display:inline-block;padding:4px 12px;border-radius:999px;font-weight:700;font-size:14px;color:#fff;background:" + b.color + ";";

    extremeEl.hidden = !res.extreme;
    peakEl.textContent = msg("tool.result.peak", "Peak BAC was about {v}.", { v: fmtPct(res.peak) });

    renderTimeRow(row003, res.current > 0.03, res.t003, "tool.time.below003", "≈ {t} until below 0.03%");
    renderTimeRow(row008, res.current > 0.08, res.t008, "tool.time.below008", "≈ {t} until below 0.08%");
    renderTimeRow(row000, res.current > 0 && !res.metabolized, res.t000, "tool.time.zero", "≈ {t} until about 0.00%");
  }

  function weightErr(unit) {
    var mn = unit === "lb" ? LB_MIN : KG_MIN, mx = unit === "lb" ? LB_MAX : KG_MAX;
    showError("tool.err.weight", "Enter a body weight between {min} and {max} {unit}.",
      { min: mn, max: mx, unit: unit });
  }

  function calculate() {
    var sex = radioVal("sex") === "female" ? "female" : "male";
    var unit = radioVal("wunit") === "lb" ? "lb" : "kg";
    var wRaw = weightEl.value.trim();
    var weight = wRaw === "" ? NaN : Number(wRaw);
    var hasWeight = !(wRaw === "" || isNaN(weight));
    var hasDrinks = rowsWrap.querySelectorAll(".bac-drink-row").length > 0;

    // empty input → explicit notice (no silent fail)
    if (!hasWeight && !hasDrinks) {
      showError("tool.err.empty", "Add your weight and at least one drink to see an estimate.");
      return;
    }
    if (!hasDrinks) {
      showError("tool.err.nodrinks", "Add at least one drink to see an estimate.");
      return;
    }
    if (!hasWeight) { weightErr(unit); return; }

    var mn = unit === "lb" ? LB_MIN : KG_MIN, mx = unit === "lb" ? LB_MAX : KG_MAX;
    if (weight < mn || weight > mx) { weightErr(unit); return; }

    var hRaw = hoursEl.value.trim();
    var hours = hRaw === "" ? 0 : Number(hRaw);
    if (isNaN(hours) || hours < 0 || hours > HOURS_MAX) {
      showError("tool.err.hours", "Enter the hours elapsed between 0 and 24.");
      return;
    }

    var weightKg = unit === "lb" ? weight * LB_TO_KG : weight;
    var res = computeBAC({ sex: sex, weightKg: weightKg, drinks: readDrinks(), hours: hours });
    render(res);
    persist();
  }

  function syncUnit() {
    var unit = radioVal("wunit") === "lb" ? "lb" : "kg";
    weightEl.min = unit === "lb" ? LB_MIN : KG_MIN;
    weightEl.max = unit === "lb" ? LB_MAX : KG_MAX;
  }

  // ---- wiring ----
  addBtn.addEventListener("click", function () { rowsWrap.appendChild(makeRow()); persist(); });
  calcBtn.addEventListener("click", calculate);
  hoursEl.addEventListener("keydown", function (e) { if (e.key === "Enter") calculate(); });
  weightEl.addEventListener("keydown", function (e) { if (e.key === "Enter") calculate(); });
  weightEl.addEventListener("input", persist);
  hoursEl.addEventListener("input", persist);
  (function bindRadios() {
    var rs = document.querySelectorAll('input[name="sex"], input[name="wunit"]');
    for (var i = 0; i < rs.length; i++) {
      rs[i].addEventListener("change", function () { syncUnit(); persist(); });
    }
  })();

  // restore last inputs (localStorage — never sent to a server)
  (function restore() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { p = null; }
    if (p) {
      if (p.sex === "male" || p.sex === "female") setRadio("sex", p.sex);
      if (p.unit === "kg" || p.unit === "lb") setRadio("wunit", p.unit);
      if (p.weight != null && p.weight !== "") weightEl.value = p.weight;
      if (p.hours != null && p.hours !== "") hoursEl.value = p.hours;
    }
    var drinks = (p && p.drinks && p.drinks.length) ? p.drinks : [{ type: "beer", qty: 1, vol: "", abv: "" }];
    for (var i = 0; i < drinks.length; i++) rowsWrap.appendChild(makeRow(drinks[i]));
    syncUnit();
  })();

  // re-render dynamic (substituted) strings on language change; static data-i18n nodes
  // (labels, options, placeholders) are handled by the i18n engine's own apply().
  document.addEventListener("i18n:change", function () {
    if (!last) return;
    if (last.kind === "error") showError(last.key, last.fb, last.args);
    else render(last.res);
  });
  // TOOLJS:END
})();
