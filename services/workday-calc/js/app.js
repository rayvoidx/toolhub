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
  var SLUG = cfg.slug || "workday-calc";
  var STATE_KEY = SLUG + ":state";
  var MAX_SPAN_DAYS = 3653; // ~10 years

  /* ---- Public-holiday data (observed dates, 2025–2027). Names are baked data. ---- */
  var HOLIDAYS = {
    us: {
      "2025-01-01": "New Year's Day", "2025-01-20": "Martin Luther King Jr. Day",
      "2025-02-17": "Presidents' Day", "2025-05-26": "Memorial Day",
      "2025-06-19": "Juneteenth", "2025-07-04": "Independence Day",
      "2025-09-01": "Labor Day", "2025-10-13": "Columbus Day",
      "2025-11-11": "Veterans Day", "2025-11-27": "Thanksgiving", "2025-12-25": "Christmas Day",
      "2026-01-01": "New Year's Day", "2026-01-19": "Martin Luther King Jr. Day",
      "2026-02-16": "Presidents' Day", "2026-05-25": "Memorial Day",
      "2026-06-19": "Juneteenth", "2026-07-03": "Independence Day (observed)",
      "2026-09-07": "Labor Day", "2026-10-12": "Columbus Day",
      "2026-11-11": "Veterans Day", "2026-11-26": "Thanksgiving", "2026-12-25": "Christmas Day",
      "2027-01-01": "New Year's Day", "2027-01-18": "Martin Luther King Jr. Day",
      "2027-02-15": "Presidents' Day", "2027-05-31": "Memorial Day",
      "2027-06-18": "Juneteenth (observed)", "2027-07-05": "Independence Day (observed)",
      "2027-09-06": "Labor Day", "2027-10-11": "Columbus Day",
      "2027-11-11": "Veterans Day", "2027-11-25": "Thanksgiving", "2027-12-24": "Christmas Day (observed)"
    },
    uk: {
      "2025-01-01": "New Year's Day", "2025-04-18": "Good Friday", "2025-04-21": "Easter Monday",
      "2025-05-05": "Early May bank holiday", "2025-05-26": "Spring bank holiday",
      "2025-08-25": "Summer bank holiday", "2025-12-25": "Christmas Day", "2025-12-26": "Boxing Day",
      "2026-01-01": "New Year's Day", "2026-04-03": "Good Friday", "2026-04-06": "Easter Monday",
      "2026-05-04": "Early May bank holiday", "2026-05-25": "Spring bank holiday",
      "2026-08-31": "Summer bank holiday", "2026-12-25": "Christmas Day", "2026-12-28": "Boxing Day (substitute)",
      "2027-01-01": "New Year's Day", "2027-03-26": "Good Friday", "2027-03-29": "Easter Monday",
      "2027-05-03": "Early May bank holiday", "2027-05-31": "Spring bank holiday",
      "2027-08-30": "Summer bank holiday", "2027-12-27": "Christmas Day (substitute)", "2027-12-28": "Boxing Day (substitute)"
    },
    kr: {
      "2025-01-01": "New Year's Day", "2025-01-27": "Temporary Holiday",
      "2025-01-28": "Korean New Year (Seollal)", "2025-01-29": "Korean New Year (Seollal)", "2025-01-30": "Korean New Year (Seollal)",
      "2025-03-01": "Independence Movement Day", "2025-03-03": "Substitute Holiday",
      "2025-05-05": "Children's Day / Buddha's Birthday", "2025-05-06": "Substitute Holiday",
      "2025-06-06": "Memorial Day", "2025-08-15": "Liberation Day",
      "2025-10-03": "National Foundation Day", "2025-10-05": "Chuseok (Korean Thanksgiving)",
      "2025-10-06": "Chuseok (Korean Thanksgiving)", "2025-10-07": "Chuseok (Korean Thanksgiving)",
      "2025-10-08": "Substitute Holiday", "2025-10-09": "Hangeul Day", "2025-12-25": "Christmas Day",
      "2026-01-01": "New Year's Day",
      "2026-02-16": "Korean New Year (Seollal)", "2026-02-17": "Korean New Year (Seollal)", "2026-02-18": "Korean New Year (Seollal)",
      "2026-03-01": "Independence Movement Day", "2026-03-02": "Substitute Holiday",
      "2026-05-05": "Children's Day", "2026-05-24": "Buddha's Birthday", "2026-05-25": "Substitute Holiday",
      "2026-06-06": "Memorial Day", "2026-08-15": "Liberation Day", "2026-08-17": "Substitute Holiday",
      "2026-09-24": "Chuseok (Korean Thanksgiving)", "2026-09-25": "Chuseok (Korean Thanksgiving)",
      "2026-09-26": "Chuseok (Korean Thanksgiving)", "2026-09-28": "Substitute Holiday",
      "2026-10-03": "National Foundation Day", "2026-10-05": "Substitute Holiday",
      "2026-10-09": "Hangeul Day", "2026-12-25": "Christmas Day",
      "2027-01-01": "New Year's Day",
      "2027-02-05": "Korean New Year (Seollal)", "2027-02-06": "Korean New Year (Seollal)", "2027-02-07": "Korean New Year (Seollal)",
      "2027-02-08": "Substitute Holiday", "2027-03-01": "Independence Movement Day",
      "2027-05-05": "Children's Day", "2027-05-13": "Buddha's Birthday",
      "2027-06-06": "Memorial Day", "2027-08-15": "Liberation Day", "2027-08-16": "Substitute Holiday",
      "2027-09-14": "Chuseok (Korean Thanksgiving)", "2027-09-15": "Chuseok (Korean Thanksgiving)",
      "2027-09-16": "Chuseok (Korean Thanksgiving)", "2027-10-03": "National Foundation Day",
      "2027-10-04": "Substitute Holiday", "2027-10-09": "Hangeul Day", "2027-10-11": "Substitute Holiday",
      "2027-12-25": "Christmas Day", "2027-12-27": "Substitute Holiday"
    }
  };
  var DATA_MIN_YEAR = 2025, DATA_MAX_YEAR = 2027;

  /* ---- i18n helper ---- */
  function tr(key, fallback) {
    try {
      if (window.I18N) { var v = window.I18N.t(key); if (v != null) return v; }
    } catch (e) { /* i18n absent */ }
    return fallback;
  }
  function curLang() {
    try { if (window.I18N && window.I18N.lang) return window.I18N.lang() || "en"; } catch (e) {}
    return "en";
  }
  function fmt(s, map) {
    return String(s).replace(/\{(\w+)\}/g, function (_, k) { return map[k] != null ? map[k] : "{" + k + "}"; });
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---- Date helpers (local midnight — never UTC parsing) ---- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function toKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseDate(str) { var p = String(str).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function isValid(str) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str || "")) return false;
    var d = parseDate(str); return !isNaN(d.getTime());
  }
  function fmtLong(d) {
    try { return new Intl.DateTimeFormat(curLang(), { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(d); }
    catch (e) { return toKey(d); }
  }
  function fmtShort(d) {
    try { return new Intl.DateTimeFormat(curLang(), { year: "numeric", month: "short", day: "numeric" }).format(d); }
    catch (e) { return toKey(d); }
  }
  function weekendSet(def) { return def === "frisat" ? { 5: 1, 6: 1 } : { 0: 1, 6: 1 }; }

  /* ---- storage (localStorage prefix or session fallback) ---- */
  var storageOk = true, storageWarned = false, sessionState = {};
  (function () { try { localStorage.setItem(SLUG + ":_t", "1"); localStorage.removeItem(SLUG + ":_t"); } catch (e) { storageOk = false; } })();
  function readState() {
    if (storageOk) { try { var r = localStorage.getItem(STATE_KEY); return r ? JSON.parse(r) : {}; } catch (e) { return {}; } }
    return sessionState;
  }
  var state = readState();
  if (!Array.isArray(state.custom)) state.custom = [];
  function persist() {
    if (storageOk) { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* quota */ } }
    else { sessionState = state; }
  }
  function loadCustom() { return state.custom.slice(); }

  /* ---- combined holiday map (preset + custom) ---- */
  function holidayMap(preset) {
    var map = {}, base = (preset === "none") ? {} : (HOLIDAYS[preset] || {}), k;
    for (k in base) if (base.hasOwnProperty(k)) map[k] = base[k];
    var custom = state.custom, cname = tr("tool.customName", "Custom holiday");
    for (var i = 0; i < custom.length; i++) { if (map[custom[i]] == null) map[custom[i]] = cname; }
    return map;
  }

  /* ---- core: days between two dates ---- */
  function computeRange() {
    var s = startEl.value, e = endEl.value;
    if (!s || !e || !isValid(s) || !isValid(e)) return { error: "empty" };
    var sd = parseDate(s), ed = parseDate(e);
    if (sd.getTime() > ed.getTime()) return { error: "afterEnd" };
    if (Math.round((ed - sd) / 86400000) > MAX_SPAN_DAYS) return { error: "tooLong" };
    var wknd = weekendSet(weekendEl.value), preset = presetEl.value, hmap = holidayMap(preset);
    var incStart = incStartEl.checked, incEnd = incEndEl.checked;
    var work = 0, weekend = 0, holiday = 0, total = 0, warn = false, skipped = [];
    var d = new Date(sd.getTime());
    while (d.getTime() <= ed.getTime()) {
      var scope = true;
      if (d.getTime() === sd.getTime() && !incStart) scope = false;
      if (d.getTime() === ed.getTime() && !incEnd) scope = false;
      if (scope) {
        total++;
        var y = d.getFullYear();
        if (preset !== "none" && (y < DATA_MIN_YEAR || y > DATA_MAX_YEAR)) warn = true;
        if (wknd[d.getDay()]) { weekend++; }
        else {
          var key = toKey(d);
          if (hmap[key] != null) { holiday++; skipped.push({ date: new Date(d.getTime()), name: hmap[key] }); }
          else { work++; }
        }
      }
      d.setDate(d.getDate() + 1);
    }
    return { work: work, weekend: weekend, holiday: holiday, total: total, skipped: skipped, warn: warn };
  }

  /* ---- core: add / subtract business days ---- */
  function computeAdd() {
    var s = start2El.value;
    if (!s || !isValid(s)) return { error: "emptyStart" };
    var n = parseInt(nEl.value, 10);
    if (!(n >= 1 && n <= 365) || String(nEl.value).indexOf(".") >= 0) return { error: "badCount" };
    var dir = dirEl.value, step = (dir === "before") ? -1 : 1;
    var wknd = weekendSet(weekendEl.value), preset = presetEl.value, hmap = holidayMap(preset);
    var d = parseDate(s), counted = 0, warn = false, guard = 0, maxGuard = n * 12 + 500;
    while (counted < n && guard < maxGuard) {
      guard++;
      d.setDate(d.getDate() + step);
      var y = d.getFullYear();
      if (preset !== "none" && (y < DATA_MIN_YEAR || y > DATA_MAX_YEAR)) warn = true;
      if (wknd[d.getDay()]) continue;
      if (hmap[toKey(d)] != null) continue;
      counted++;
    }
    if (counted < n) return { error: "tooLong" };
    return { date: new Date(d.getTime()), startDate: parseDate(s), n: n, dir: dir, warn: warn };
  }

  /* ---- DOM refs ---- */
  var tabBtn1 = document.getElementById("tabbtn-1"), tabBtn2 = document.getElementById("tabbtn-2");
  var panel1 = document.getElementById("panel-1"), panel2 = document.getElementById("panel-2");
  var presetEl = document.getElementById("in-preset"), weekendEl = document.getElementById("in-weekend");
  var startEl = document.getElementById("in-start"), endEl = document.getElementById("in-end");
  var incStartEl = document.getElementById("in-inc-start"), incEndEl = document.getElementById("in-inc-end");
  var calcBtn = document.getElementById("calc-btn");
  var start2El = document.getElementById("in-start2"), nEl = document.getElementById("in-n"), dirEl = document.getElementById("in-dir");
  var findBtn = document.getElementById("find-btn");
  var customInput = document.getElementById("in-custom"), customAddBtn = document.getElementById("custom-add-btn");
  var customListEl = document.getElementById("custom-list"), customMsgEl = document.getElementById("custom-msg");
  var resultEl = document.getElementById("result"), storeNoteEl = document.getElementById("store-note");

  var activeTab = (state.tab === 2) ? 2 : 1;
  var lastResult = null; // { kind, data } — re-rendered on language change

  /* ---- rendering ---- */
  function warnBadge() {
    return '<p style="margin-top:12px;padding:8px 12px;border-radius:8px;background:color-mix(in srgb,#f59e0b 15%,var(--surface));border:1px solid color-mix(in srgb,#f59e0b 45%,var(--line));font-size:13px;color:var(--ink);">&#9888; ' +
      esc(tr("tool.res.warn", "Public holidays are unavailable for some years here (2025-2027 only). Weekends are still counted.")) + "</p>";
  }
  function renderRange(r) {
    var html = '<div style="text-align:center;">';
    html += '<div style="font-size:clamp(40px,11vw,64px);font-weight:900;letter-spacing:-0.04em;line-height:1;color:var(--accent);">' + r.work + "</div>";
    html += '<div style="font-weight:600;color:var(--muted);margin-top:4px;">' + esc(tr("tool.res.businessDays", "business days")) + "</div></div>";
    html += '<p style="text-align:center;margin:14px 0 0;font-size:15px;">' +
      esc(fmt(tr("tool.res.breakdown", "{total} total days = {work} business + {weekend} weekend + {holiday} public holiday"),
        { total: r.total, work: r.work, weekend: r.weekend, holiday: r.holiday })) + "</p>";
    if (r.warn) html += warnBadge();
    if (r.skipped.length) {
      html += '<details style="margin-top:14px;"><summary style="cursor:pointer;font-weight:600;">' +
        esc(fmt(tr("tool.res.skipped", "Skipped public holidays ({n})"), { n: r.skipped.length })) + "</summary>";
      html += '<ul style="margin:10px 0 0;padding-left:18px;color:var(--muted);font-size:14px;">';
      r.skipped.forEach(function (h) { html += "<li>" + esc(fmtShort(h.date)) + " &mdash; " + esc(h.name) + "</li>"; });
      html += "</ul></details>";
    } else {
      html += '<p style="text-align:center;margin-top:10px;color:var(--muted);font-size:14px;">' +
        esc(tr("tool.res.skippedNone", "No public holidays fell within this range.")) + "</p>";
    }
    return html;
  }
  function renderAdd(r) {
    var html = '<div style="text-align:center;">';
    html += '<div style="font-size:clamp(22px,6vw,34px);font-weight:800;letter-spacing:-0.02em;line-height:1.2;color:var(--accent);">' + esc(fmtLong(r.date)) + "</div>";
    var key = (r.dir === "before") ? "tool.res.sentenceBefore" : "tool.res.sentenceAfter";
    var def = (r.dir === "before") ? "{n} business days before {date}" : "{n} business days after {date}";
    html += '<p style="margin:10px 0 0;color:var(--muted);font-size:15px;">' +
      esc(fmt(tr(key, def), { n: r.n, date: fmtShort(r.startDate) })) + "</p></div>";
    if (r.warn) html += warnBadge();
    return html;
  }
  function showError(key, def, withSwap) {
    var html = '<p style="margin:0;font-size:15px;">' + esc(tr(key, def)) + "</p>";
    if (withSwap) html += '<button class="btn" id="swap-btn" type="button" style="margin-top:12px;background:var(--muted);">' + esc(tr("tool.swapBtn", "Swap dates")) + "</button>";
    resultEl.innerHTML = html; resultEl.hidden = false;
    if (withSwap) {
      var sb = document.getElementById("swap-btn");
      if (sb) sb.addEventListener("click", function () { var t = startEl.value; startEl.value = endEl.value; endEl.value = t; persist(); runRange(true); });
    }
  }

  function runRange(explicit) {
    lastError = null;
    var r = computeRange();
    if (r.error) {
      lastResult = null;
      if (r.error === "empty") { if (!explicit) { resultEl.hidden = true; return; } lastError = { k: "tool.msg.empty", d: "Select a start and end date.", swap: false }; return showError(lastError.k, lastError.d, false); }
      if (r.error === "afterEnd") { lastError = { k: "tool.msg.afterEnd", d: "The start date is after the end date.", swap: true }; return showError(lastError.k, lastError.d, true); }
      if (r.error === "tooLong") { lastError = { k: "tool.msg.tooLong", d: "That range is too long - up to 10 years is supported.", swap: false }; return showError(lastError.k, lastError.d, false); }
      return;
    }
    lastError = null;
    lastResult = { kind: "range", data: r };
    resultEl.innerHTML = renderRange(r); resultEl.hidden = false;
  }
  function runAdd(explicit) {
    lastError = null;
    var r = computeAdd();
    if (r.error) {
      lastResult = null;
      if (r.error === "emptyStart") { if (!explicit) { resultEl.hidden = true; return; } lastError = { k: "tool.msg.emptyStart", d: "Select a start date.", swap: false }; return showError(lastError.k, lastError.d, false); }
      if (r.error === "badCount") { lastError = { k: "tool.msg.badCount", d: "Enter a whole number of business days from 1 to 365.", swap: false }; return showError(lastError.k, lastError.d, false); }
      if (r.error === "tooLong") { lastError = { k: "tool.msg.tooLong", d: "That range is too long - up to 10 years is supported.", swap: false }; return showError(lastError.k, lastError.d, false); }
      return;
    }
    lastResult = { kind: "add", data: r };
    resultEl.innerHTML = renderAdd(r); resultEl.hidden = false;
  }
  var lastError = null;
  function recompute() { if (activeTab === 1) runRange(false); else runAdd(false); }

  /* ---- custom holidays ---- */
  var customMsgTimer = null;
  function flashCustom(key, def) {
    if (!customMsgEl) return;
    customMsgEl.textContent = tr(key, def);
    clearTimeout(customMsgTimer);
    customMsgTimer = setTimeout(function () { customMsgEl.textContent = ""; }, 3200);
  }
  function renderCustom() {
    if (!customListEl) return;
    var list = state.custom.slice().sort();
    if (!list.length) {
      customListEl.innerHTML = '<p style="color:var(--muted);font-size:13px;margin:0;">' + esc(tr("tool.customEmpty", "No custom holidays added yet.")) + "</p>";
      return;
    }
    var html = '<div style="display:flex;flex-wrap:wrap;gap:8px;">';
    list.forEach(function (dstr) {
      html += '<span style="display:inline-flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:4px 6px 4px 12px;font-size:13px;">' +
        esc(fmtShort(parseDate(dstr))) +
        '<button type="button" class="cust-del" data-d="' + esc(dstr) + '" aria-label="' + esc(tr("tool.removeAria", "Remove holiday")) +
        '" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;line-height:1;padding:0 2px;">&times;</button></span>';
    });
    html += "</div>";
    customListEl.innerHTML = html;
    var dels = customListEl.querySelectorAll(".cust-del");
    for (var i = 0; i < dels.length; i++) {
      dels[i].addEventListener("click", function () {
        var d = this.getAttribute("data-d"), idx = state.custom.indexOf(d);
        if (idx >= 0) { state.custom.splice(idx, 1); persist(); renderCustom(); recompute(); }
      });
    }
  }
  function addCustom() {
    var v = customInput ? customInput.value : "";
    if (!v || !isValid(v)) { flashCustom("tool.msg.emptyStart", "Select a date first."); return; }
    if (weekendSet(weekendEl.value)[parseDate(v).getDay()]) { flashCustom("tool.msg.weekendSkip", "That date is a weekend - it's already excluded."); return; }
    if (state.custom.indexOf(v) >= 0) { flashCustom("tool.msg.dup", "That date is already excluded."); return; }
    state.custom.push(v); persist();
    if (customInput) customInput.value = "";
    if (customMsgEl) customMsgEl.textContent = "";
    renderCustom(); recompute();
  }

  /* ---- tabs ---- */
  function switchTab(n) {
    activeTab = n; state.tab = n; persist();
    var on = "var(--accent)", onC = "#fff", off = "transparent", offC = "var(--ink)";
    tabBtn1.style.background = n === 1 ? on : off; tabBtn1.style.color = n === 1 ? onC : offC;
    tabBtn2.style.background = n === 2 ? on : off; tabBtn2.style.color = n === 2 ? onC : offC;
    tabBtn1.setAttribute("aria-selected", n === 1 ? "true" : "false");
    tabBtn2.setAttribute("aria-selected", n === 2 ? "true" : "false");
    panel1.hidden = n !== 1; panel2.hidden = n !== 2;
    resultEl.hidden = true; lastResult = null; lastError = null;
    recompute();
  }

  /* ---- wire events ---- */
  if (tabBtn1) tabBtn1.addEventListener("click", function () { switchTab(1); });
  if (tabBtn2) tabBtn2.addEventListener("click", function () { switchTab(2); });
  if (calcBtn) calcBtn.addEventListener("click", function () { runRange(true); });
  if (findBtn) findBtn.addEventListener("click", function () { runAdd(true); });
  if (customAddBtn) customAddBtn.addEventListener("click", addCustom);
  [startEl, endEl, incStartEl, incEndEl].forEach(function (el) { if (el) el.addEventListener("input", function () { persistSettings(); if (activeTab === 1) runRange(false); }); });
  [start2El, nEl, dirEl].forEach(function (el) { if (el) el.addEventListener("input", function () { persistSettings(); if (activeTab === 2) runAdd(false); }); });
  [presetEl, weekendEl].forEach(function (el) { if (el) el.addEventListener("change", function () { persistSettings(); recompute(); }); });

  function persistSettings() {
    state.preset = presetEl.value; state.weekend = weekendEl.value;
    state.incStart = incStartEl.checked; state.incEnd = incEndEl.checked;
    state.dir = dirEl.value; persist();
  }

  /* ---- language change: re-render dynamic strings ---- */
  document.addEventListener("i18n:change", function () {
    renderCustom();
    if (lastResult) {
      resultEl.innerHTML = (lastResult.kind === "range") ? renderRange(lastResult.data) : renderAdd(lastResult.data);
      resultEl.hidden = false;
    } else if (lastError) {
      showError(lastError.k, lastError.d, lastError.swap);
    }
    if (storeNoteEl && !storageOk) storeNoteEl.textContent = tr("tool.msg.noStorage", "Settings can't be saved in private mode - they'll last for this session only.");
  });

  /* ---- init: restore settings ---- */
  (function init() {
    if (state.preset && presetEl.querySelector('option[value="' + state.preset + '"]')) presetEl.value = state.preset;
    if (state.weekend) weekendEl.value = state.weekend;
    if (typeof state.incStart === "boolean") incStartEl.checked = state.incStart;
    if (typeof state.incEnd === "boolean") incEndEl.checked = state.incEnd;
    if (state.dir) dirEl.value = state.dir;
    if (!storageOk && storeNoteEl) {
      storeNoteEl.hidden = false;
      storeNoteEl.textContent = tr("tool.msg.noStorage", "Settings can't be saved in private mode - they'll last for this session only.");
    }
    switchTab(activeTab);
    renderCustom();
  })();
  // TOOLJS:END
})();
