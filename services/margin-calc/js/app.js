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
  /* Margin Calculator — 원가(cost)·매출(revenue)·마진율(margin%)·마크업율(markup%) 네 값 중
     "가장 최근에 편집한 유효한 2개"를 입력으로 보고 나머지 2개 + 이익을 즉시 계산한다.
     margin·markup 두 퍼센트만 채워진 경우는 서로가 서로를 완전히 결정하므로(원가/매출 없이는
     절대금액을 구할 수 없음) 상호검증(교차확인) 전용으로 처리한다. 통화 무관(숫자만), 외부
     API 없음, 모든 계산은 로컬. */

  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "margin-calc") + ":state";
  var FIELDS = ["cost", "revenue", "margin", "markup"]; // canonical 정렬 우선순위(고정)

  /* ---- calc-core:start — 순수 계산(node 단위검증 대상, DOM 의존 없음) ---- */
  // 유한화 가드 — Infinity/NaN 을 안전한 유한값으로 (거대 입력에서도 화면이 깨지지 않게)
  function safeNum(v) {
    var CAP = 1e15;
    if (typeof v !== "number" || isNaN(v)) return { v: 0, clipped: true };
    if (v === Infinity) return { v: CAP, clipped: true };
    if (v === -Infinity) return { v: -CAP, clipped: true };
    if (v > CAP) return { v: CAP, clipped: true };
    if (v < -CAP) return { v: -CAP, clipped: true };
    return { v: v, clipped: false };
  }
  // 두 필드(비정렬) → canonical pair 키("cost-revenue" 등, FIELDS 우선순위로 정렬) + 값 재배열
  function canonicalPair(f1, v1, f2, v2) {
    var i1 = FIELDS.indexOf(f1), i2 = FIELDS.indexOf(f2);
    if (i1 <= i2) return { pair: f1 + "-" + f2, a: v1, b: v2 };
    return { pair: f2 + "-" + f1, a: v2, b: v1 };
  }
  // 원가·매출·마진율·마크업율 중 2개(a,b) → 나머지 + 이익. pair 는 canonicalPair() 결과 형식.
  // margin = 이익/매출×100 (판매가 기준) · markup = 이익/원가×100 (원가 기준) — 이 둘을 혼동하는
  // 것이 이 계산기가 풀어주는 "고전적인 착각"이다.
  function solvePair(pair, a, b) {
    switch (pair) {
      case "cost-revenue": {
        var cost = a, revenue = b;
        if (cost < 0 || revenue < 0) return { ok: false, reason: "negative" };
        var profit = revenue - cost;
        return {
          ok: true, cost: cost, revenue: revenue, profit: profit,
          margin: revenue > 0 ? profit / revenue * 100 : null,
          markup: cost > 0 ? profit / cost * 100 : null
        };
      }
      case "cost-margin": {
        var cost2 = a, margin2 = b;
        if (cost2 < 0) return { ok: false, reason: "negative" };
        if (margin2 >= 100) return { ok: false, reason: "marginTooHigh" };
        var revenue2 = cost2 / (1 - margin2 / 100);
        var profit2 = revenue2 - cost2;
        return {
          ok: true, cost: cost2, revenue: revenue2, profit: profit2, margin: margin2,
          markup: cost2 > 0 ? profit2 / cost2 * 100 : null
        };
      }
      case "cost-markup": {
        var cost3 = a, markup3 = b;
        if (cost3 < 0) return { ok: false, reason: "negative" };
        if (markup3 <= -100) return { ok: false, reason: "markupTooLow" };
        var revenue3 = cost3 * (1 + markup3 / 100);
        var profit3 = revenue3 - cost3;
        return {
          ok: true, cost: cost3, revenue: revenue3, profit: profit3, markup: markup3,
          margin: revenue3 > 0 ? profit3 / revenue3 * 100 : null
        };
      }
      case "revenue-margin": {
        var revenue4 = a, margin4 = b;
        if (revenue4 < 0) return { ok: false, reason: "negative" };
        if (margin4 > 100) return { ok: false, reason: "marginOver100" };
        var cost4 = revenue4 * (1 - margin4 / 100);
        var profit4 = revenue4 - cost4;
        return {
          ok: true, cost: cost4, revenue: revenue4, profit: profit4, margin: margin4,
          markup: cost4 > 0 ? profit4 / cost4 * 100 : null
        };
      }
      case "revenue-markup": {
        var revenue5 = a, markup5 = b;
        if (revenue5 < 0) return { ok: false, reason: "negative" };
        if (markup5 <= -100) return { ok: false, reason: "markupTooLow" };
        var cost5 = revenue5 / (1 + markup5 / 100);
        var profit5 = revenue5 - cost5;
        return {
          ok: true, cost: cost5, revenue: revenue5, profit: profit5, markup: markup5,
          margin: revenue5 > 0 ? profit5 / revenue5 * 100 : null
        };
      }
      case "margin-markup": {
        // margin·markup 은 같은 이익을 서로 다른 분모(매출 vs 원가)로 나눈 값이라 하나가 다른
        // 하나를 그대로 결정한다. 원가/매출/이익의 절대값은 기준 금액이 없어 알 수 없으므로
        // 상호검증(교차확인)만 수행한다.
        var margin6 = a, markup6 = b;
        var kFromM = margin6 < 100 ? (margin6 / (100 - margin6) * 100) : null;
        var mFromK = markup6 > -100 ? (markup6 / (100 + markup6) * 100) : null;
        var consistent = kFromM != null && Math.abs(kFromM - markup6) < 0.05;
        return {
          ok: true, cost: null, revenue: null, profit: null, margin: margin6, markup: markup6,
          crossCheck: true, kFromM: kFromM, mFromK: mFromK, consistent: consistent
        };
      }
      default:
        return { ok: false, reason: "empty" };
    }
  }
  /* ---- calc-core:end ---- */

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { solvePair: solvePair, canonicalPair: canonicalPair, safeNum: safeNum, FIELDS: FIELDS };
    return;
  }

  /* ---- i18n · Intl 헬퍼 ---- */
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function nf(opts) {
    try { return new Intl.NumberFormat(uiLang(), opts); }
    catch (e) { return new Intl.NumberFormat("en", opts); }
  }
  // 통화 무관(숫자만) — 그룹기호·소수점만 로케일 존중, 통화기호는 붙이지 않는다
  function fmtMoney(n) {
    var s = safeNum(n);
    try { return nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(s.v); }
    catch (e) { return String(s.v); }
  }
  function fmtPct(p) {
    if (p == null) return null;
    var s = safeNum(p);
    try { return nf({ style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(s.v / 100); }
    catch (e) { return String(s.v) + "%"; }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var els = {
    cost: $("cost-input"), revenue: $("revenue-input"),
    margin: $("margin-input"), markup: $("markup-input")
  };
  var clearBtn = $("clear-btn");
  var emptyEl = $("result-empty"), gridEl = $("result-grid"), fromEl = $("result-from");
  var cmpNoteEl = $("compare-note"), clippedEl = $("note-clipped");
  var cards = gridEl ? gridEl.querySelectorAll(".mc-card") : [];
  if (!els.cost || !els.revenue || !els.margin || !els.markup || !gridEl) return;

  /* ---- 금액 입력: 콤마 그룹핑 자동 포맷 · 파싱(소수점=".") — cagr-calc 패턴 재사용 ---- */
  function parseMoney(el) {
    if (!el) return null;
    var raw = String(el.value);
    var neg = raw.trim().charAt(0) === "-";
    var s = raw.replace(/[^0-9.]/g, "");
    var fd = s.indexOf(".");
    if (fd !== -1) s = s.slice(0, fd + 1) + s.slice(fd + 1).replace(/\./g, "");
    if (s === "" || s === ".") return null;
    var v = Number((neg ? "-" : "") + s);
    return isFinite(v) ? v : null;
  }
  function reformatMoney(el) {
    var raw = el.value;
    var caret = el.selectionStart == null ? raw.length : el.selectionStart;
    var digitsBefore = (raw.slice(0, caret).match(/[0-9]/g) || []).length;
    var neg = raw.trim().charAt(0) === "-";
    var cleaned = raw.replace(/[^0-9.]/g, "");
    var fd = cleaned.indexOf(".");
    if (fd !== -1) cleaned = cleaned.slice(0, fd + 1) + cleaned.slice(fd + 1).replace(/\./g, "");
    var segs = cleaned.split(".");
    var intPart = segs[0].replace(/^0+(?=\d)/, "");
    var grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var out = (neg ? "-" : "") + grouped + (segs.length > 1 ? "." + segs[1] : "");
    if (out !== raw) {
      el.value = out;
      var pos = neg ? 1 : 0, seen = 0;
      while (pos < out.length && seen < digitsBefore) {
        if (/[0-9]/.test(out.charAt(pos))) seen++;
        pos++;
      }
      try { el.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
    }
  }
  // 퍼센트 입력: 콤마 없이 소수·음수만 허용
  function parsePercent(el) {
    if (!el) return null;
    var s = String(el.value).trim();
    if (s === "" || s === "-" || s === ".") return null;
    var v = Number(s);
    return isFinite(v) ? v : null;
  }
  function fieldValue(key) {
    return (key === "cost" || key === "revenue") ? parseMoney(els[key]) : parsePercent(els[key]);
  }

  /* ---- 최근 편집 2개 = 활성 입력 (그 외 2개는 계산 결과로 채워짐) ---- */
  var order = []; // 오래된 → 최신, 최대 길이 2
  function touch(key, valid) {
    var idx = order.indexOf(key);
    if (idx !== -1) order.splice(idx, 1);
    if (valid) {
      order.push(key);
      if (order.length > 2) order.shift();
    }
  }

  /* ---- 결과 카드 ---- */
  function setCard(key, value, isPct) {
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute("data-field") === key) {
        var valEl = cards[i].querySelector(".mc-val");
        if (!valEl) continue;
        if (value == null) {
          valEl.textContent = "—"; // —
        } else {
          valEl.textContent = isPct ? fmtPct(value) : fmtMoney(value);
        }
        if (key === "profit" && value != null) {
          valEl.className = "mc-val " + (value >= 0 ? "mc-pos" : "mc-neg");
        }
      }
    }
  }

  function updateFieldNotes() {
    for (var i = 0; i < FIELDS.length; i++) {
      var key = FIELDS[i];
      var noteEl = $("note-" + key);
      if (!noteEl) continue;
      var val = fieldValue(key);
      var active = order.indexOf(key) !== -1;
      if (val != null && !active && order.length === 2) {
        noteEl.hidden = false;
        noteEl.textContent = tr("tool.notUsed", "Not used for this calculation.");
      } else {
        noteEl.hidden = true;
      }
      if (els[key]) {
        if (active) els[key].classList.add("is-active");
        else els[key].classList.remove("is-active");
      }
    }
  }

  function render() {
    updateFieldNotes();

    if (order.length < 2) {
      emptyEl.hidden = false;
      emptyEl.textContent = order.length === 1
        ? tr("tool.placeholderOne", "Enter one more value to calculate.")
        : tr("tool.placeholder", "Enter any two values above to see cost, revenue, profit, margin and markup.");
      gridEl.hidden = true;
      fromEl.hidden = true;
      cmpNoteEl.hidden = true;
      clippedEl.hidden = true;
      return;
    }

    var f1 = order[0], f2 = order[1];
    var v1 = fieldValue(f1), v2 = fieldValue(f2);
    if (v1 == null || v2 == null) { // 방어적 처리 — 정상 흐름에선 발생하지 않음
      touch(f1, v1 != null); touch(f2, v2 != null);
      return render();
    }

    var cp = canonicalPair(f1, v1, f2, v2);
    var r = solvePair(cp.pair, cp.a, cp.b);

    if (!r.ok) {
      emptyEl.hidden = false;
      emptyEl.textContent = tr("tool.err." + r.reason, "Please check your values.");
      gridEl.hidden = true;
      fromEl.hidden = true;
      cmpNoteEl.hidden = true;
      clippedEl.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    gridEl.hidden = false;

    var anyClipped = false;
    function withClip(v) {
      if (v == null) return null;
      var s = safeNum(v);
      if (s.clipped) anyClipped = true;
      return s.v;
    }

    setCard("cost", withClip(r.cost), false);
    setCard("revenue", withClip(r.revenue), false);
    setCard("profit", withClip(r.profit), false);
    setCard("margin", withClip(r.margin), true);
    setCard("markup", withClip(r.markup), true);

    fromEl.hidden = false;
    fromEl.textContent = tr("tool.result.from", "Calculated from {a} and {b}.")
      .replace("{a}", tr("tool." + f1 + ".short", f1))
      .replace("{b}", tr("tool." + f2 + ".short", f2));

    if (r.crossCheck) {
      cmpNoteEl.hidden = false;
      var parts = [tr("tool.compare.needAnchor", "Add a cost or revenue amount above to see the actual profit in numbers.")];
      if (r.consistent) {
        parts.unshift(tr("tool.compare.consistent", "These match — a {margin} margin is the same relationship as a {markup} markup.")
          .replace("{margin}", fmtPct(r.margin)).replace("{markup}", fmtPct(r.markup)));
      } else if (r.kFromM != null) {
        parts.unshift(tr("tool.compare.mismatch", "A {margin} margin actually equals a {expected} markup, not {given}. Margin and markup describe the same profit two different ways, so only one of them is independent — the other is always implied.")
          .replace("{margin}", fmtPct(r.margin)).replace("{expected}", fmtPct(r.kFromM)).replace("{given}", fmtPct(r.markup)));
      }
      cmpNoteEl.textContent = parts.join(" ");
    } else {
      cmpNoteEl.hidden = true;
    }

    clippedEl.hidden = !anyClipped;
  }

  /* ---- 이벤트 ---- */
  function onFieldInput(key) {
    if (key === "cost" || key === "revenue") reformatMoney(els[key]);
    var v = fieldValue(key);
    touch(key, v != null);
    persist();
    render();
  }
  els.cost.addEventListener("input", function () { onFieldInput("cost"); });
  els.revenue.addEventListener("input", function () { onFieldInput("revenue"); });
  els.margin.addEventListener("input", function () { onFieldInput("margin"); });
  els.markup.addEventListener("input", function () { onFieldInput("markup"); });

  // Enter — 실시간 계산이라 재계산일 뿐이지만 명시적 "실행" 동작을 제공
  function onEnter(e) { if (e.key === "Enter") render(); }
  FIELDS.forEach(function (k) { if (els[k]) els[k].addEventListener("keydown", onEnter); });

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      FIELDS.forEach(function (k) { if (els[k]) els[k].value = ""; });
      order = [];
      persist();
      render();
      if (els.cost) { try { els.cost.focus(); } catch (e) { /* noop */ } }
    });
  }

  /* ---- 영속화 (마지막 입력값 + 활성 순서) ---- */
  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        cost: els.cost.value, revenue: els.revenue.value,
        margin: els.margin.value, markup: els.markup.value, order: order
      }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }
  (function restore() {
    var saved = null;
    try { var s = localStorage.getItem(LS_KEY); if (s) saved = JSON.parse(s); } catch (e) { saved = null; }
    if (saved) {
      if (saved.cost) els.cost.value = saved.cost;
      if (saved.revenue) els.revenue.value = saved.revenue;
      if (saved.margin) els.margin.value = saved.margin;
      if (saved.markup) els.markup.value = saved.markup;
      if (Array.isArray(saved.order)) {
        order = saved.order.filter(function (k) {
          return FIELDS.indexOf(k) !== -1 && fieldValue(k) != null;
        }).slice(-2);
      }
    }
  })();

  // 언어 전환 시 통화 무관 숫자 포맷·동적 문구 재적용
  document.addEventListener("i18n:change", render);

  render();
  // TOOLJS:END
})();
