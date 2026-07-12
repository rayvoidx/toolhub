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
  // TOOLJS:START — Random number generator + lottery quick pick.
  //   Engine: crypto.getRandomValues + rejection sampling (uniform, no modulo bias, no Math.random).
  //   Everything runs in-browser; only the last settings are persisted to localStorage.
  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "random-number-gen";
  var OPTS_KEY = SLUG + ":opts";
  var CLAMP = 999999999;            // |min|,|max| hard limit
  var SMALL_RANGE = 20000;          // partial Fisher-Yates below this; Set rejection above

  // Lottery presets — static rule tables, current as of 2026-07.
  var PRESETS = {
    powerball: { main: { count: 5, min: 1, max: 69 }, bonus: { count: 1, min: 1, max: 26, color: "#dc2626", fg: "#fff", star: false } },
    mega:      { main: { count: 5, min: 1, max: 70 }, bonus: { count: 1, min: 1, max: 24, color: "#f59e0b", fg: "#1f2937", star: false } },
    euro:      { main: { count: 5, min: 1, max: 50 }, bonus: { count: 2, min: 1, max: 12, color: "#eab308", fg: "#3a2e00", star: true } },
    lotto645:  { main: { count: 6, min: 1, max: 45, korean: true }, bonus: null }
  };

  // Official Donghaeng Lottery ball colors for Lotto 6/45.
  function lottoColor(n) {
    if (n <= 10) return { bg: "#fbc400", fg: "#1f2937" };
    if (n <= 20) return { bg: "#69c8f2", fg: "#1f2937" };
    if (n <= 30) return { bg: "#ff7272", fg: "#fff" };
    if (n <= 40) return { bg: "#aaaaaa", fg: "#fff" };
    return { bg: "#b0d840", fg: "#1f2937" };
  }

  // DOM refs
  var $ = function (id) { return document.getElementById(id); };
  var tabRange = $("tab-range"), tabLottery = $("tab-lottery");
  var panelRange = $("panel-range"), panelLottery = $("panel-lottery");
  var minEl = $("rng-min"), maxEl = $("rng-max"), countEl = $("rng-count");
  var dupEl = $("rng-dup"), sortEl = $("rng-sort");
  var genBtn = $("rng-generate"), copyBtn = $("rng-copy"), regenBtn = $("rng-regen");
  var rngNotice = $("rng-notice"), rngNumbers = $("rng-numbers"), rngActions = $("rng-actions");
  var presetEl = $("lot-preset"), playsEl = $("lot-plays"), pickBtn = $("lot-pick");
  var lotCopyBtn = $("lot-copy"), lotRules = $("lot-rules"), lotPlaysOut = $("lot-plays-out"), lotActions = $("lot-actions");
  if (!minEl || !presetEl) return;   // markup missing — bail out quietly

  // i18n helpers -------------------------------------------------------------
  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v != null ? v : key;
  }
  function fill(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, function (m, k) { return params[k] != null ? params[k] : m; });
  }
  var numAsc = function (a, b) { return a - b; };

  // Cryptographic uniform integer in [0, max) via rejection sampling ---------
  function secureRandInt(max) {
    if (max <= 1) return 0;
    var arr = new Uint32Array(1);
    var limit = Math.floor(4294967296 / max) * max;   // largest multiple of max ≤ 2^32
    do { crypto.getRandomValues(arr); } while (arr[0] >= limit);
    return arr[0] % max;
  }
  function randInRange(min, max) { return min + secureRandInt(max - min + 1); }

  function drawWithDup(min, max, k) {
    var out = [];
    for (var i = 0; i < k; i++) out.push(randInRange(min, max));
    return out;
  }
  function drawUnique(min, max, k) {
    var size = max - min + 1;
    if (k > size) k = size;
    if (size <= SMALL_RANGE) {                         // partial Fisher-Yates (small range)
      var pool = new Array(size);
      for (var i = 0; i < size; i++) pool[i] = min + i;
      var out = [];
      for (var j = 0; j < k; j++) {
        var idx = j + secureRandInt(size - j);
        var tmp = pool[j]; pool[j] = pool[idx]; pool[idx] = tmp;
        out.push(pool[j]);
      }
      return out;
    }
    var seen = {}, res = [];                            // Set rejection (large range, k ≤ 100)
    while (res.length < k) {
      var v = randInRange(min, max);
      if (!seen[v]) { seen[v] = 1; res.push(v); }
    }
    return res;
  }

  // Number range -------------------------------------------------------------
  var rangeState = null;   // { numbers:[...], notices:[{key,params}] }

  function parseField(el, def) {
    var raw = (el.value || "").replace(/^\s+|\s+$/g, "");
    var n = Number(raw);
    if (raw === "" || !isFinite(n)) return { val: def, reset: true, trunc: false };
    var tr = Math.trunc(n);
    return { val: tr, reset: false, trunc: tr !== n };
  }

  function readRange() {
    var notices = [];
    var a = parseField(minEl, 1), b = parseField(maxEl, 100), c = parseField(countEl, 1);
    if (a.reset || b.reset || c.reset) notices.push({ key: "tool.notice.invalid" });
    if (a.trunc || b.trunc || c.trunc) notices.push({ key: "tool.notice.trunc" });
    var min = a.val, max = b.val, count = c.val;

    var clamped = false;
    if (min > CLAMP) { min = CLAMP; clamped = true; } else if (min < -CLAMP) { min = -CLAMP; clamped = true; }
    if (max > CLAMP) { max = CLAMP; clamped = true; } else if (max < -CLAMP) { max = -CLAMP; clamped = true; }
    if (clamped) notices.push({ key: "tool.notice.clampRange" });

    if (min > max) { var tmp = min; min = max; max = tmp; notices.push({ key: "tool.notice.swap" }); }

    if (count < 1) { count = 1; notices.push({ key: "tool.notice.countLow" }); }
    if (count > 100) { count = 100; notices.push({ key: "tool.notice.countHigh" }); }

    var allowDup = dupEl.checked;
    var size = max - min + 1;
    if (!allowDup && count > size) { count = size; notices.push({ key: "tool.notice.countReduced", params: { n: size } }); }

    // reflect sanitized values back into the inputs
    minEl.value = min; maxEl.value = max; countEl.value = count;
    return { min: min, max: max, count: count, allowDup: allowDup, sort: sortEl.checked, notices: notices };
  }

  function generateRange() {
    var r = readRange();
    var nums = r.allowDup ? drawWithDup(r.min, r.max, r.count) : drawUnique(r.min, r.max, r.count);
    if (r.sort) nums.sort(numAsc);
    rangeState = { numbers: nums, notices: r.notices };
    renderRange();
    saveOpts();
  }

  function renderRange() {
    if (!rangeState) return;
    rngNotice.innerHTML = "";
    for (var i = 0; i < rangeState.notices.length; i++) {
      var nt = rangeState.notices[i];
      var d = document.createElement("div");
      d.textContent = fill(t(nt.key), nt.params);
      rngNotice.appendChild(d);
    }
    rngNotice.hidden = rangeState.notices.length === 0;

    rngNumbers.innerHTML = "";
    for (var j = 0; j < rangeState.numbers.length; j++) {
      var s = document.createElement("span");
      s.className = "rng-num";
      s.textContent = String(rangeState.numbers[j]);
      rngNumbers.appendChild(s);
    }
    rngActions.hidden = false;
  }

  // Lottery ------------------------------------------------------------------
  var lottoState = null;   // { presetKey, plays:[{main:[],bonus:[]}] }

  function pickLottery() {
    var key = presetEl.value;
    var preset = PRESETS[key] || PRESETS.powerball;
    var plays = parseInt(playsEl.value, 10);
    if (!isFinite(plays) || plays < 1) plays = 1;
    if (plays > 5) plays = 5;
    playsEl.value = plays;

    var rows = [];
    for (var i = 0; i < plays; i++) {
      var main = drawUnique(preset.main.min, preset.main.max, preset.main.count).sort(numAsc);
      var bonus = preset.bonus ? drawUnique(preset.bonus.min, preset.bonus.max, preset.bonus.count).sort(numAsc) : [];
      rows.push({ main: main, bonus: bonus });
    }
    lottoState = { presetKey: key, plays: rows };
    renderLottery();
    saveOpts();
  }

  function buildRulesText(key) {
    var p = PRESETS[key];
    var s = fill(t("tool.lottery.pickMain"), { count: p.main.count, min: p.main.min, max: p.main.max });
    if (p.bonus) s += " " + fill(t("tool.lottery.pickBonus"), { count: p.bonus.count, min: p.bonus.min, max: p.bonus.max });
    return s + " · " + t("tool.lottery.rulesAsOf");
  }

  function makeBall(n, bg, fg, star) {
    var el = document.createElement("span");
    el.className = "rng-ball" + (star ? " rng-star" : "");
    el.textContent = String(n);
    el.style.background = bg;
    el.style.color = fg;
    return el;
  }

  function renderLottery() {
    if (!lottoState) return;
    var preset = PRESETS[lottoState.presetKey];
    lotRules.textContent = buildRulesText(lottoState.presetKey);
    lotPlaysOut.innerHTML = "";
    var multi = lottoState.plays.length > 1;
    for (var i = 0; i < lottoState.plays.length; i++) {
      var play = lottoState.plays[i];
      var row = document.createElement("div");
      row.className = "rng-play";
      if (multi) {
        var lab = document.createElement("span");
        lab.className = "rng-play-label";
        lab.textContent = fill(t("tool.lottery.play"), { n: i + 1 });
        row.appendChild(lab);
      }
      for (var m = 0; m < play.main.length; m++) {
        var n = play.main[m];
        if (preset.main.korean) { var c = lottoColor(n); row.appendChild(makeBall(n, c.bg, c.fg, false)); }
        else row.appendChild(makeBall(n, "#64748b", "#fff", false));
      }
      if (play.bonus.length) {
        var plus = document.createElement("span");
        plus.textContent = "+";
        plus.style.cssText = "font-weight:800;color:var(--muted);margin:0 3px;";
        row.appendChild(plus);
        for (var b = 0; b < play.bonus.length; b++) {
          row.appendChild(makeBall(play.bonus[b], preset.bonus.color, preset.bonus.fg, preset.bonus.star));
        }
      }
      lotPlaysOut.appendChild(row);
    }
    lotActions.hidden = false;
  }

  // Copy (Clipboard API → execCommand → visible textarea, 3-tier fallback) ----
  function copyText(text, btn, labelKey) {
    function done() {
      btn.textContent = t("tool.copied");
      setTimeout(function () { btn.textContent = t(labelKey); }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { execCopy(text, done, btn); });
    } else {
      execCopy(text, done, btn);
    }
  }
  function execCopy(text, done, btn) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) { done(); return; }
      visibleCopy(text, btn);
    } catch (e) {
      visibleCopy(text, btn);
    }
  }
  function visibleCopy(text, btn) {           // last resort: show the text for manual copy
    var host = btn.parentNode;
    if (!host.querySelector(".rng-copyfail")) {
      var msg = document.createElement("p");
      msg.className = "rng-copyfail";
      msg.style.cssText = "color:var(--accent-strong);font-size:13px;font-weight:600;margin:10px 0 4px;";
      msg.textContent = t("tool.copyFail");
      var ta = document.createElement("textarea");
      ta.className = "rng-copyfail-ta";
      ta.value = text; ta.readOnly = true; ta.rows = 2;
      ta.style.cssText = "width:100%;";
      host.appendChild(msg);
      host.appendChild(ta);
    } else {
      host.querySelector(".rng-copyfail-ta").value = text;
    }
    var t2 = host.querySelector(".rng-copyfail-ta");
    t2.focus(); t2.select();
  }

  // Persistence (settings only — never the drawn numbers) --------------------
  function saveOpts() {
    try {
      localStorage.setItem(OPTS_KEY, JSON.stringify({
        tab: panelLottery.hidden ? "range" : "lottery",
        min: minEl.value, max: maxEl.value, count: countEl.value,
        dup: dupEl.checked, sort: sortEl.checked,
        preset: presetEl.value, plays: playsEl.value
      }));
    } catch (e) { /* private mode — settings just won't persist */ }
  }
  function loadOpts() {
    try {
      var raw = localStorage.getItem(OPTS_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (o == null || typeof o !== "object") return null;
      if (o.min != null) minEl.value = o.min;
      if (o.max != null) maxEl.value = o.max;
      if (o.count != null) countEl.value = o.count;
      if (typeof o.dup === "boolean") dupEl.checked = o.dup;
      if (typeof o.sort === "boolean") sortEl.checked = o.sort;
      if (PRESETS[o.preset]) presetEl.value = o.preset;
      if (o.plays != null) playsEl.value = o.plays;
      return o;
    } catch (e) { return null; }
  }

  // Tabs ---------------------------------------------------------------------
  function setTab(which) {
    var lottery = which === "lottery";
    panelLottery.hidden = !lottery;
    panelRange.hidden = lottery;
    tabLottery.setAttribute("aria-selected", lottery ? "true" : "false");
    tabRange.setAttribute("aria-selected", lottery ? "false" : "true");
    saveOpts();
  }

  tabRange.addEventListener("click", function () { setTab("range"); });
  tabLottery.addEventListener("click", function () { setTab("lottery"); });
  genBtn.addEventListener("click", generateRange);
  regenBtn.addEventListener("click", generateRange);
  copyBtn.addEventListener("click", function () { if (rangeState) copyText(rangeState.numbers.join(", "), copyBtn, "tool.range.copy"); });
  pickBtn.addEventListener("click", pickLottery);
  presetEl.addEventListener("change", pickLottery);
  lotCopyBtn.addEventListener("click", function () {
    if (!lottoState) return;
    var multi = lottoState.plays.length > 1;
    var lines = lottoState.plays.map(function (p, i) {
      var s = p.main.join(", ");
      if (p.bonus.length) s += " + " + p.bonus.join(", ");
      return multi ? fill(t("tool.lottery.play"), { n: i + 1 }) + ": " + s : s;
    });
    copyText(lines.join("\n"), lotCopyBtn, "tool.lottery.copy");
  });

  // Re-localize dynamic output when the language changes.
  document.addEventListener("i18n:change", function () { renderRange(); renderLottery(); });

  // Init ---------------------------------------------------------------------
  var opts = loadOpts();
  generateRange();     // always show an initial range result
  pickLottery();       // pre-fill the lottery panel too
  setTab(opts && opts.tab === "lottery" ? "lottery" : "range");
  // TOOLJS:END
})();
