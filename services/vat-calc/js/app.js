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
  /* VAT Calculator — net→gross(add) 또는 gross→net(remove) 양방향 계산.
     통화 무관(순수 배수 연산이라 어떤 통화든 그대로 적용). 외부 API 없음, 모든 계산은 로컬.
     핵심 함정: gross→net 은 rate% 를 "빼기"가 아니라 (1+rate/100) 으로 "나누기". */

  var RATE_MIN = 0, RATE_MAX = 100;
  // EU 표준세율 상단(23 PT/PL/IE, 24 FI/GR, 27 HU)이 빠져 있어 해당 국가 사용자가 프리셋을 벗어났다 — 추가.
  // 22 (IT/SI) 이 21↔23 사이에 빠져 있어 이탈리아·슬로베니아 사용자가 프리셋을 벗어났다 — 추가.
  var PRESET_RATES = [5, 7, 10, 15, 19, 20, 21, 22, 23, 24, 25, 27];

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // 금액 파싱: 콤마 제거, 숫자 아니면 NaN (빈 입력과 잘못된 입력을 구분해야 하므로 0 폴백 금지)
  function parseAmount(raw) {
    if (raw == null) return NaN;
    var s = String(raw).replace(/,/g, "").trim();
    if (s === "") return NaN;
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }
  // 세율 파싱: 콤마·% 기호 제거
  function parseRate(raw) {
    if (raw == null) return NaN;
    var s = String(raw).replace(/[,%]/g, "").trim();
    if (s === "") return NaN;
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }
  // 부동소수 오차 제거 후 소수 둘째 자리 반올림
  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }
  // VAT 핵심 계산. mode "add": amount = 세전(net) 입력 → 세금 가산.
  //                mode "remove": amount = 세후(gross) 입력 → 나눠서(1+rate/100) 세전을 역산.
  // (총액에서 rate% 를 그냥 빼면 틀린다 — FAQ의 고전적 실수.)
  function computeVat(amount, ratePct, mode) {
    var net, vat, gross;
    if (mode === "remove") {
      gross = amount;
      net = gross / (1 + ratePct / 100);
      vat = gross - net;
    } else {
      net = amount;
      vat = net * ratePct / 100;
      gross = net + vat;
    }
    return { net: round2(net), vat: round2(vat), gross: round2(gross), rate: ratePct };
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseAmount: parseAmount, parseRate: parseRate, round2: round2,
      computeVat: computeVat, RATE_MIN: RATE_MIN, RATE_MAX: RATE_MAX, PRESET_RATES: PRESET_RATES
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "vat-calc") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmt(n) {
    try { return Number(n).toLocaleString(uiLang(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    catch (e) { return String(n); }
  }
  function fmtPct(p) {
    try { return new Intl.NumberFormat(uiLang(), { maximumFractionDigits: 2 }).format(p) + "%"; }
    catch (e) { return String(p) + "%"; }
  }
  // 총액 ÷ (1+rate/100) 의 나눗셈 인수를 사람이 읽는 소수로 (예: 20% → "1.2")
  function fmtFactor(p) {
    var f = 1 + p / 100;
    try { return new Intl.NumberFormat(uiLang(), { maximumFractionDigits: 4 }).format(f); }
    catch (e) { return String(f); }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var amountEl = $("amount"), rateEl = $("rate");
  var presetsWrap = $("rate-presets");
  var emptyEl = $("result-empty"), gridEl = $("result-grid"), errEl = $("err");
  var formulaEl = $("formula-note"), copyHintEl = $("copy-hint");
  if (!amountEl || !rateEl || !gridEl) return;
  var presetBtns = presetsWrap ? presetsWrap.querySelectorAll(".rate-preset") : [];
  var cards = gridEl.querySelectorAll(".res-card");

  /* ---- 상태 저장/복원 (마지막 입력 — private mode 는 조용히 건너뜀) ---- */
  function saveState() {
    try {
      var mode = document.querySelector('input[name="mode"]:checked');
      localStorage.setItem(SKEY, JSON.stringify({
        mode: mode ? mode.value : "add",
        rate: rateEl.value
      }));
    } catch (e) { /* noop */ }
  }
  function restoreState() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(SKEY)); } catch (e) { s = null; }
    if (!s) return;
    if (s.mode === "add" || s.mode === "remove") {
      var r = document.querySelector('input[name="mode"][value="' + s.mode + '"]');
      if (r) r.checked = true;
    }
    if (s.rate != null && parseRate(s.rate) >= RATE_MIN && parseRate(s.rate) <= RATE_MAX) {
      rateEl.value = s.rate;
    }
  }

  function currentMode() {
    var r = document.querySelector('input[name="mode"]:checked');
    return r ? r.value : "add";
  }

  /* ---- 프리셋 활성 표시 ---- */
  function syncPresetActive() {
    var cur = rateEl.value.trim();
    for (var i = 0; i < presetBtns.length; i++) {
      var b = presetBtns[i];
      var on = cur !== "" && parseFloat(cur) === parseFloat(b.getAttribute("data-rate"));
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.style.background = on ? "var(--accent)" : "var(--muted)";
    }
  }
  function onPresetClick() {
    rateEl.value = this.getAttribute("data-rate");
    render();
  }
  function renderPresets() {
    if (!presetsWrap) return;
    presetsWrap.textContent = "";
    for (var i = 0; i < PRESET_RATES.length; i++) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "rate-preset";
      b.setAttribute("data-rate", String(PRESET_RATES[i]));
      b.setAttribute("aria-pressed", "false");
      b.style.cssText = "flex:0 0 auto;padding:9px 12px;border:none;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;background:var(--muted);color:#fff;";
      b.textContent = fmtPct(PRESET_RATES[i]);
      b.addEventListener("click", onPresetClick);
      presetsWrap.appendChild(b);
    }
    presetBtns = presetsWrap.querySelectorAll(".rate-preset");
    syncPresetActive();
  }

  /* ---- 카드 값 세팅 ---- */
  function setCard(key, value) {
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute("data-copy") === key) {
        var valEl = cards[i].querySelector(".rc-value");
        if (valEl) valEl.textContent = fmt(value);
        cards[i].setAttribute("data-value", String(value));
      }
    }
  }

  /* ---- 렌더 ---- */
  function render() {
    var amount = parseAmount(amountEl.value);
    var rate = parseRate(rateEl.value);
    var mode = currentMode();

    saveState();
    syncPresetActive();

    if (isNaN(amount)) {
      gridEl.hidden = true;
      errEl.hidden = true;
      if (copyHintEl) copyHintEl.hidden = true;
      if (formulaEl) formulaEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.textContent = tr("tool.placeholder", "Enter an amount");
      return;
    }
    if (amount < 0) {
      gridEl.hidden = true;
      emptyEl.hidden = true;
      if (copyHintEl) copyHintEl.hidden = true;
      if (formulaEl) formulaEl.hidden = true;
      errEl.hidden = false;
      errEl.textContent = tr("tool.err.positive", "The amount must be zero or greater.");
      return;
    }
    if (isNaN(rate) || rate < RATE_MIN || rate > RATE_MAX) {
      gridEl.hidden = true;
      emptyEl.hidden = true;
      if (copyHintEl) copyHintEl.hidden = true;
      if (formulaEl) formulaEl.hidden = true;
      errEl.hidden = false;
      errEl.textContent = tr("tool.err.rate", "The VAT rate must be between 0% and 100%.");
      return;
    }

    var r = computeVat(amount, rate, mode);
    setCard("net", r.net);
    setCard("vat", r.vat);
    setCard("gross", r.gross);

    emptyEl.hidden = true;
    errEl.hidden = true;
    gridEl.hidden = false;
    if (copyHintEl) copyHintEl.hidden = false;

    if (formulaEl) {
      var key = mode === "remove" ? "tool.formula.remove" : "tool.formula.add";
      formulaEl.textContent = tr(key, "")
        .replace(/\{rate\}/g, fmtPct(rate))
        .replace(/\{factor\}/g, fmtFactor(rate));
      formulaEl.hidden = false;
    }
  }

  /* ---- 클릭 복사 ---- */
  var copiedTimers = {};
  function flashCopied(card) {
    var labelEl = card.querySelector(".rc-label");
    if (!labelEl) return;
    var key = card.getAttribute("data-copy");
    labelEl.textContent = tr("tool.copied", "Copied");
    if (copiedTimers[key]) clearTimeout(copiedTimers[key]);
    copiedTimers[key] = setTimeout(function () {
      labelEl.textContent = tr("tool.res." + key, labelEl.textContent);
    }, 1100);
  }
  function legacyCopy(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { /* 복사 미지원 — 표시값은 그대로 남는다 */ }
  }
  function copyCard(card) {
    var raw = card.getAttribute("data-value");
    if (raw == null) return;
    var done = function () { flashCopied(card); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(raw).then(done, function () { legacyCopy(raw, done); });
      } else {
        legacyCopy(raw, done);
      }
    } catch (e) {
      legacyCopy(raw, done);
    }
  }

  /* ---- 이벤트 ---- */
  amountEl.addEventListener("input", render);
  rateEl.addEventListener("input", render);
  Array.prototype.forEach.call(document.querySelectorAll('input[name="mode"]'), function (r) {
    r.addEventListener("change", render);
  });
  for (var i = 0; i < cards.length; i++) {
    cards[i].addEventListener("click", function () { copyCard(this); });
  }
  document.addEventListener("i18n:change", function () {
    renderPresets();
    render();
  });

  restoreState();
  renderPresets();
  render();
  // TOOLJS:END
})();
