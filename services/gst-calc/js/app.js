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
  /* GST Calculator — add GST to a net amount or remove GST from a gross total, at any
     rate. Quick chips cover India's four slabs (5/12/18/28%) and the flat Australia/NZ/
     Singapore rates (10/15/9%). India mode additionally splits the GST amount into an
     equal CGST + SGST half each (intra-state convention). No external API — everything
     below is pure arithmetic; state is localStorage "<slug>:state" only. */

  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "gst-calc") + ":state";
  var SAFE = 1e15; // 표시 자릿수 폭주(지수표기) 방지용 캡

  function $(id) { return document.getElementById(id); }
  var amountEl = $("amount"), rateEl = $("rate"), splitEl = $("india-split");
  var calcBtn = $("calc-btn");
  var resultEl = $("result"), emptyEl = $("result-empty"), gridEl = $("result-grid");
  var splitCardsEl = $("split-cards"), subEl = $("r-sub"), errEl = $("err");
  var indiaChipsWrap = $("india-chips"), otherChipsWrap = $("other-chips");
  if (!amountEl || !rateEl || !gridEl || !calcBtn) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function nf(opts) { try { return new Intl.NumberFormat(uiLang(), opts); } catch (e) { return new Intl.NumberFormat("en", opts); } }

  // 유한화 가드 — Infinity/NaN 을 안전한 유한값으로
  function safe(v) {
    if (typeof v !== "number" || isNaN(v)) return 0;
    if (v === Infinity) return SAFE;
    if (v === -Infinity) return -SAFE;
    if (v > SAFE) return SAFE;
    if (v < -SAFE) return -SAFE;
    return v;
  }
  function money(v) {
    var s = safe(v);
    try { return nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(s); }
    catch (e) { return String(Math.round(s * 100) / 100); }
  }
  function pct(r) {
    try { return nf({ maximumFractionDigits: 2 }).format(r) + "%"; }
    catch (e) { return String(r) + "%"; }
  }
  // 입력 파싱: 통화기호·콤마·공백 제거, 마이너스 부호는 허용해 명시적 오류로 이어지게 한다
  function num(el) {
    if (!el) return NaN;
    var raw = String(el.value == null ? "" : el.value).replace(/[^0-9.\-]/g, "").trim();
    if (raw === "" || raw === "-" || raw === ".") return NaN;
    var v = Number(raw);
    return isFinite(v) ? v : NaN;
  }
  function mode() {
    var r = document.querySelector('input[name="mode"]:checked');
    return r ? r.value : "add";
  }

  // calc-core:start — 순수 계산 (node 단위검증 대상, DOM 의존 없음)
  // Add: net 이 입력값 → GST = net × rate/100, gross = net + GST
  // Remove: gross 가 입력값 → net = gross ÷ (1 + rate/100), GST = gross − net (뺄셈이 아니라 나눗셈이 핵심)
  // India CGST/SGST: 동일 주 내 거래는 GST 를 정확히 절반씩 나눠 각각 부과 — 세율 합은 그대로.
  function calcGst(amount, rate, isRemove) {
    var net, gst, gross;
    if (isRemove) {
      gross = amount;
      net = gross / (1 + rate / 100);
      gst = gross - net;
    } else {
      net = amount;
      gst = net * rate / 100;
      gross = net + gst;
    }
    return { net: net, gst: gst, gross: gross, cgst: gst / 2, sgst: gst / 2 };
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { calcGst: calcGst };
    return;
  }
  // calc-core:end

  /* ---- 칩 활성 표시 (India / Other 두 그룹, 값 중복 없음) ---- */
  function syncChipActive() {
    var cur = rateEl.value.trim();
    var curNum = cur === "" ? null : parseFloat(cur);
    [indiaChipsWrap, otherChipsWrap].forEach(function (wrap) {
      if (!wrap) return;
      var chips = wrap.querySelectorAll(".chip");
      for (var i = 0; i < chips.length; i++) {
        var on = curNum != null && parseFloat(chips[i].getAttribute("data-rate")) === curNum;
        chips[i].classList.toggle("is-active", on);
        chips[i].setAttribute("aria-pressed", on ? "true" : "false");
      }
    });
  }
  function onChipClick() {
    rateEl.value = this.getAttribute("data-rate");
    if (splitEl) splitEl.checked = this.getAttribute("data-india") === "1";
    calculate();
  }
  [indiaChipsWrap, otherChipsWrap].forEach(function (wrap) {
    if (!wrap) return;
    var chips = wrap.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) chips[i].addEventListener("click", onChipClick);
  });

  /* ---- 결과 카드 세팅 ---- */
  function setVal(id, v) { var el = $(id); if (el) el.textContent = money(v); }

  function showEmpty() {
    emptyEl.hidden = false;
    gridEl.hidden = true;
    splitCardsEl.hidden = true;
    subEl.hidden = true;
    errEl.hidden = true;
  }
  function showError(key, fallback) {
    emptyEl.hidden = true;
    gridEl.hidden = true;
    splitCardsEl.hidden = true;
    subEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }

  function calculate() {
    persist();
    syncChipActive();

    var amtRaw = amountEl.value.trim();
    if (amtRaw === "") return showEmpty();

    var amt = num(amountEl);
    if (isNaN(amt)) return showError("tool.err.empty", "Enter an amount to calculate GST.");
    if (amt <= 0) return showError("tool.err.positive", "Enter an amount greater than 0.");

    var rate = num(rateEl);
    if (isNaN(rate) || rate < 0 || rate > 100) return showError("tool.err.rate", "Enter a GST rate between 0 and 100.");

    var isRemove = mode() === "remove";
    var r = calcGst(amt, rate, isRemove);

    setVal("r-net", r.net);
    setVal("r-gst", r.gst);
    setVal("r-gross", r.gross);

    var showSplit = !!(splitEl && splitEl.checked);
    if (showSplit) {
      setVal("r-cgst", r.cgst);
      setVal("r-sgst", r.sgst);
    }
    splitCardsEl.hidden = !showSplit;

    subEl.hidden = false;
    subEl.textContent = isRemove
      ? t("tool.r.sub.remove", "{rate}% GST removed from a gross total of {gross}.")
          .replace("{rate}", pct(rate)).replace("{gross}", money(r.gross))
      : t("tool.r.sub.add", "{rate}% GST added to a net amount of {net}.")
          .replace("{rate}", pct(rate)).replace("{net}", money(r.net));

    emptyEl.hidden = true;
    errEl.hidden = true;
    gridEl.hidden = false;
  }

  /* ---- 상태 저장/복원 ---- */
  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        amount: amountEl.value, rate: rateEl.value, mode: mode(),
        split: !!(splitEl && splitEl.checked)
      }));
    } catch (e) { /* private mode — 저장 실패는 계산에 영향 없음 */ }
  }
  function restore() {
    var s = null;
    try { var raw = localStorage.getItem(LS_KEY); if (raw) s = JSON.parse(raw); } catch (e) { s = null; }
    if (!s) return;
    if (s.amount) amountEl.value = s.amount;
    if (s.rate) rateEl.value = s.rate;
    if (s.mode === "add" || s.mode === "remove") {
      var r = document.querySelector('input[name="mode"][value="' + s.mode + '"]');
      if (r) r.checked = true;
    }
    if (splitEl) splitEl.checked = !!s.split;
  }

  /* ---- 이벤트 ---- */
  amountEl.addEventListener("input", calculate);
  rateEl.addEventListener("input", calculate);
  if (splitEl) splitEl.addEventListener("change", calculate);
  Array.prototype.forEach.call(document.querySelectorAll('input[name="mode"]'), function (r) {
    r.addEventListener("change", calculate);
  });
  calcBtn.addEventListener("click", calculate);
  function onEnter(e) { if (e.key === "Enter") calculate(); }
  amountEl.addEventListener("keydown", onEnter);
  rateEl.addEventListener("keydown", onEnter);

  // 언어 전환 시 통화 서식·동적 문구를 새 로케일로 재렌더
  document.addEventListener("i18n:change", function () { calculate(); });

  restore();
  calculate();
  // TOOLJS:END
})();
