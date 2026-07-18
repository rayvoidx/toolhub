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
  // exchange-rate-conv — global currency converter (spec: factory/state/exchange-rate-conv.yaml)
  // 환율 소스 3단 폴백: open.er-api.com → api.frankfurter.dev(ECB) → localStorage 캐시(24h) → 번들 스냅샷.
  // 모든 rate 는 USD 기준 크로스레이트. 상태는 localStorage("exchange-rate-conv:*") 와 URL 쿼리에만.
  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "exchange-rate-conv";

  var CODES = ["USD","EUR","JPY","GBP","CNY","INR","AUD","CAD","CHF","KRW","BRL","RUB","IDR","HKD","SGD","MXN"];
  var ZERO_DEC = { JPY: 1, KRW: 1, IDR: 1 };   // 소수 0자리 통화
  var MAX = 1e12;                               // 상한: 1조
  var CACHE_MS = 24 * 60 * 60 * 1000;           // 캐시 유효 24h
  var FETCH_TIMEOUT = 6000;

  // Intl.DisplayNames 미지원(구형) 폴백용 영문 통화명
  var NAME_FALLBACK = {
    USD:"US Dollar", EUR:"Euro", JPY:"Japanese Yen", GBP:"British Pound", CNY:"Chinese Yuan",
    INR:"Indian Rupee", AUD:"Australian Dollar", CAD:"Canadian Dollar", CHF:"Swiss Franc",
    KRW:"South Korean Won", BRL:"Brazilian Real", RUB:"Russian Ruble", IDR:"Indonesian Rupiah",
    HKD:"Hong Kong Dollar", SGD:"Singapore Dollar", MXN:"Mexican Peso"
  };

  // 빌드 시점 고정 번들 스냅샷 (오프라인·API 전멸 최종 폴백). USD 기준. 2026-07-11 open.er-api.com.
  var SNAPSHOT = {
    date: "2026-07-11",
    rates: {
      USD:1, EUR:0.875572, JPY:161.768905, GBP:0.745953, CNY:6.784818, INR:95.439158,
      AUD:1.438725, CAD:1.415327, CHF:0.80792, KRW:1502.980229, BRL:5.114592, RUB:76.398282,
      IDR:18097.745145, HKD:7.839827, SGD:1.291439, MXN:17.496301
    }
  };

  /* ---- i18n 헬퍼 ---- */
  function t(key) {
    var s = window.I18N && window.I18N.t(key);
    return s != null ? s : key;
  }
  function fmt(s, params) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] != null ? String(params[k]) : m;
    });
  }
  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function lang() {
    try { return (window.I18N && window.I18N.lang()) || "en"; } catch (e) { return "en"; }
  }

  /* ---- 순수 계산 로직 (통화 중립, node 검증 대상) ---- */

  /** 표시 문자열 → 숫자. 콤마(자릿구분) 제거, 첫 소수점만 인정. 실패 시 NaN */
  function parseAmount(str) {
    if (str == null) return NaN;
    var s = String(str).replace(/,/g, "").replace(/\s/g, "").trim();
    if (s === "" || s === "-" || s === "." || s === "-.") return NaN;
    if (!/^-?\d*\.?\d*$/.test(s)) return NaN;
    return parseFloat(s);
  }

  /** from→to 환산. rates 는 USD 기준. 통화 미존재 시 null (조용한 실패 금지 → 호출부에서 안내) */
  function convert(amount, from, to, rates) {
    if (!rates) return null;
    var rf = rates[from], rt = rates[to];
    if (rf == null || rt == null || !(rf > 0) || !(rt >= 0)) return null;
    return amount * (rt / rf);
  }
  /** 1 from = ? to */
  function unitRate(from, to, rates) {
    if (!rates) return null;
    var rf = rates[from], rt = rates[to];
    if (rf == null || rt == null || !(rf > 0) || !(rt >= 0)) return null;
    return rt / rf;
  }

  // node 단위 검증 훅
  window.__EXC_TEST = { parseAmount: parseAmount, convert: convert, unitRate: unitRate, CODES: CODES, MAX: MAX };

  /* ---- 숫자 포맷 (현재 언어, 지수표기 없음) ---- */
  function moneyDigits(code) { return ZERO_DEC[code] ? 0 : 2; }
  function fmtMoney(n, code) {
    var d = moneyDigits(code);
    try {
      return Number(n).toLocaleString(lang(), { minimumFractionDigits: d, maximumFractionDigits: d });
    } catch (e) {
      return Number(n).toFixed(d);
    }
  }
  /** 1단위 환율: 유효숫자 6자리 초과 표시 금지 */
  function fmtRate(r) {
    if (!isFinite(r)) return "—";
    try {
      return Number(r).toLocaleString(lang(), { maximumSignificantDigits: 6 });
    } catch (e) {
      return String(Number(r.toPrecision(6)));
    }
  }
  /** 입력 표시 정규화: 선행 '-' 유지(음수 안내 트리거), 정수부 콤마 그룹핑, 소수부 최대 4자리 */
  function cleanAmountInput(raw) {
    var neg = /^\s*-/.test(raw);
    var digitsDot = String(raw).replace(/[^\d.]/g, "");
    var firstDot = digitsDot.indexOf(".");
    var intPart, decPart = null;
    if (firstDot === -1) {
      intPart = digitsDot;
    } else {
      intPart = digitsDot.slice(0, firstDot);
      decPart = digitsDot.slice(firstDot + 1).replace(/\./g, "").slice(0, 4);
    }
    intPart = intPart.replace(/^0+(?=\d)/, "");
    var grouped = intPart === "" ? "" : intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var out = grouped;
    if (decPart !== null) out += "." + decPart;
    if (out === "" && decPart === null) return neg ? "-" : "";
    return (neg ? "-" : "") + out;
  }

  /* ---- 통화명 (Intl.DisplayNames, 언어 반영) ---- */
  function currencyName(code) {
    try {
      if (typeof Intl !== "undefined" && Intl.DisplayNames) {
        var dn = new Intl.DisplayNames([lang()], { type: "currency" });
        var n = dn.of(code);
        if (n && String(n).toUpperCase() !== code) return n;
      }
    } catch (e) { /* 미지원 → 폴백 */ }
    return NAME_FALLBACK[code] || code;
  }

  /* ---- DOM 참조 (node 검증 시 전부 null — 모든 사용처 가드) ---- */
  var amountEl = document.getElementById("exc-amount");
  var fromEl = document.getElementById("exc-from");
  var toEl = document.getElementById("exc-to");
  var swapBtn = document.getElementById("exc-swap");
  var quickEl = document.getElementById("exc-quick");
  var resultEl = document.getElementById("exc-result");

  /* ---- 환율 상태 ---- */
  // rateData: { date, provider, stale, rates }  provider: "open.er-api.com" | "ECB (Frankfurter)" | "cache" | "snapshot"
  var state = { rates: null, loading: false, failed: false };

  function pickRates(src) {
    var out = {};
    for (var i = 0; i < CODES.length; i++) {
      var c = CODES[i];
      if (src[c] != null && isFinite(src[c])) out[c] = Number(src[c]);
    }
    return out;
  }
  function todayStr() { return new Date().toISOString().slice(0, 10); }

  function readCache() {
    try {
      var raw = localStorage.getItem(SLUG + ":rates");
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.rates || !o.fetchedAt) return null;
      if (Date.now() - o.fetchedAt > CACHE_MS) return null;   // 24h 초과 → 무효
      return { date: o.date || todayStr(), provider: o.provider || "cache", stale: true, rates: pickRates(o.rates) };
    } catch (e) { return null; }
  }
  function writeCache(data) {
    try {
      localStorage.setItem(SLUG + ":rates", JSON.stringify({
        date: data.date, provider: data.provider, rates: data.rates, fetchedAt: Date.now()
      }));
    } catch (e) { /* private mode */ }
  }
  function snapshotData() {
    return { date: SNAPSHOT.date, provider: "snapshot", stale: true, rates: pickRates(SNAPSHOT.rates) };
  }

  /* ---- 라이브 페치 (3단 폴백, try/catch + 타임아웃) ---- */
  function fetchJSON(url) {
    try {
      var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
      var opts = ctrl ? { signal: ctrl.signal } : {};
      var timer = setTimeout(function () { if (ctrl) { try { ctrl.abort(); } catch (e) {} } }, FETCH_TIMEOUT);
      return fetch(url, opts).then(function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      }, function (e) { clearTimeout(timer); throw e; });
    } catch (e) {
      return Promise.reject(e);   // fetch 자체 미지원 등 동기 예외도 프로미스로 격리
    }
  }
  function fromERApi(d) {
    if (!d || d.result !== "success" || !d.rates) throw new Error("er-api bad");
    var date = d.time_last_update_unix
      ? new Date(d.time_last_update_unix * 1000).toISOString().slice(0, 10)
      : (d.time_last_update_utc ? new Date(d.time_last_update_utc).toISOString().slice(0, 10) : todayStr());
    return { date: date, provider: "open.er-api.com", stale: false, rates: pickRates(d.rates) };
  }
  function fromFrankfurter(d) {
    if (!d || !d.rates) throw new Error("frankfurter bad");
    var merged = {}; for (var k in d.rates) { if (d.rates.hasOwnProperty(k)) merged[k] = d.rates[k]; }
    merged.USD = 1;   // base=USD 는 응답 rates 에 포함되지 않음
    return { date: d.date || todayStr(), provider: "ECB (Frankfurter)", stale: false, rates: pickRates(merged) };
  }
  function fetchLive() {
    if (typeof fetch !== "function" || (typeof navigator !== "undefined" && navigator.onLine === false)) {
      // 네트워크 없음/오프라인: seed 된 stale 데이터 유지, 경고 배너 노출 (조용한 실패 아님)
      state.loading = false; state.failed = true; render();
      return Promise.resolve();
    }
    state.loading = true;
    render();
    return fetchJSON("https://open.er-api.com/v6/latest/USD").then(fromERApi)
      .catch(function () {
        return fetchJSON("https://api.frankfurter.dev/v1/latest?base=USD").then(fromFrankfurter);
      })
      .then(function (data) {
        // 성공: 우리가 쓰는 통화가 충분히 들어왔는지 최소 검증
        if (!data.rates.USD || Object.keys(data.rates).length < 2) throw new Error("empty rates");
        state.rates = data; state.loading = false; state.failed = false;
        writeCache(data);
        render();
      }, function () {
        // 전멸: 이미 seed 된 stale(cache/snapshot) 유지 + 경고·재시도 노출
        state.loading = false; state.failed = true;
        render();
      });
  }

  /* ---- 입력값 읽기/저장 ---- */
  function validCode(c) { return CODES.indexOf(c) !== -1 ? c : null; }
  function saveLast() {
    try {
      localStorage.setItem(SLUG + ":last", JSON.stringify({
        amount: amountEl ? amountEl.value : "",
        from: fromEl ? fromEl.value : "USD",
        to: toEl ? toEl.value : "EUR"
      }));
    } catch (e) { /* noop */ }
  }
  function loadLast() {
    try {
      var raw = localStorage.getItem(SLUG + ":last");
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function syncURL() {
    try {
      var p = new URLSearchParams(location.search);
      if (fromEl) p.set("from", fromEl.value);
      if (toEl) p.set("to", toEl.value);
      if (amountEl) p.set("amount", amountEl.value.replace(/,/g, ""));
      history.replaceState(null, "", location.pathname + "?" + p.toString());
    } catch (e) { /* history 미지원 */ }
  }

  /* ---- 렌더 ---- */
  function sourceLabel(data) {
    if (!data) return "";
    if (data.provider === "snapshot") return t("tool.src.snapshot");
    if (data.stale) {
      var base = (data.provider && data.provider !== "cache") ? data.provider + " · " : "";
      return base + t("tool.src.saved");
    }
    return data.provider;
  }

  function render() {
    if (!resultEl) return;
    var data = state.rates;
    var from = fromEl ? fromEl.value : "USD";
    var to = toEl ? toEl.value : "EUR";
    var raw = amountEl ? amountEl.value : "1";

    // 금액 해석 (엣지: 빈칸/0 = 에러 아님 → 0 취급)
    var amt = parseAmount(raw);
    var negative = false, ranged = false, blank = (raw.trim() === "" || isNaN(amt));
    if (blank) amt = 0;
    else if (amt < 0) negative = true;
    else if (amt > MAX) {
      amt = MAX; ranged = true;
      if (amountEl) { amountEl.value = cleanAmountInput(String(MAX)); saveLast(); }
    }

    var html = "";
    var warn = false;
    var notes = [];

    // 상태 배너
    if (state.loading) {
      html += '<p class="exc-asof">' + escHtml(t("tool.result.updating")) + "</p>";
    } else if (data && data.stale) {
      warn = true;
      var banner = state.failed ? t("tool.err.allfail") : t("tool.warn.saved");
      html += '<p class="exc-warn">&#9888; ' + escHtml(banner) + "</p>";
    }

    // 환율 확보 여부
    var rate = data ? unitRate(from, to, data.rates) : null;
    if (rate == null) {
      // 현재 소스에 해당 통화 없음 (예: 프랑크푸르터에 RUB 부재)
      html += '<p class="exc-note">&#9432; ' + escHtml(t("tool.err.missing")) + "</p>";
      if (data) html += '<p class="exc-asof">' + escHtml(fmt(t("tool.result.asof"), { date: data.date, source: sourceLabel(data) })) + "</p>";
    } else {
      // 큰 환산액 (음수는 계산 미실행 → 안내만)
      if (negative) {
        notes.push(t("tool.err.negative"));
      } else {
        var converted = convert(amt, from, to, data.rates);
        html += '<span class="exc-big">' + escHtml(fmtMoney(converted, to)) + " " + escHtml(to) + "</span>";
      }
      // 1단위 환율 (항상 노출)
      html += '<p class="exc-rate">' + escHtml(fmt(t("tool.result.rate"), { from: from, rate: fmtRate(rate), to: to })) + "</p>";
      // 기준일 + 소스 (상시)
      html += '<p class="exc-asof">' + escHtml(fmt(t("tool.result.asof"), { date: data.date, source: sourceLabel(data) })) + "</p>";

      if (from === to) notes.push(t("tool.same"));
      if (ranged) notes.push(t("tool.err.range"));
      for (var i = 0; i < notes.length; i++) {
        html += '<p class="exc-note">&#9432; ' + escHtml(notes[i]) + "</p>";
      }
    }

    // 재시도 버튼 (라이브 전멸 시)
    if (state.failed) {
      html += '<button type="button" class="btn exc-retry" id="exc-retry">' + escHtml(t("tool.retry")) + "</button>";
    }

    resultEl.className = "result" + (warn ? " result--warn" : "");
    resultEl.innerHTML = html;

    var retry = document.getElementById("exc-retry");
    if (retry) retry.addEventListener("click", function () { state.failed = false; fetchLive(); });
  }

  /* ---- 셀렉트 채우기 (통화명 언어 반영) ---- */
  function fillSelect(sel) {
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = "";
    for (var i = 0; i < CODES.length; i++) {
      var c = CODES[i];
      var o = document.createElement("option");
      o.value = c;
      o.textContent = c + " — " + currencyName(c);
      sel.appendChild(o);
    }
    if (cur && validCode(cur)) sel.value = cur;
  }

  /* ---- 초기화 ---- */
  function init() {
    if (!resultEl) return;   // node 검증 환경

    // 통화 셀렉트 구성
    fillSelect(fromEl); fillSelect(toEl);

    // 초기값: URL → localStorage last → 기본(USD→EUR, 1)
    var params;
    try { params = new URLSearchParams(location.search); } catch (e) { params = null; }
    var last = loadLast();
    var iFrom = validCode(params && params.get("from")) || validCode(last && last.from) || "USD";
    var iTo = validCode(params && params.get("to")) || validCode(last && last.to) || "EUR";
    var iAmt = (params && params.get("amount")) || (last && last.amount) || "1";

    if (fromEl) fromEl.value = iFrom;
    if (toEl) toEl.value = iTo;
    if (amountEl) amountEl.value = cleanAmountInput(iAmt) || "1";

    // 즉답: 오프라인 데이터(캐시<24h 또는 스냅샷)를 seed → 라이브 갱신 시도.
    // 첫 페인트는 fetchLive() 가 담당(loading 또는 offline 배너 + 즉시 환산액).
    state.rates = readCache() || snapshotData();
    fetchLive();

    // 이벤트
    if (amountEl) {
      amountEl.addEventListener("input", function () {
        var selStart = amountEl.selectionStart;
        var before = amountEl.value.slice(0, selStart == null ? amountEl.value.length : selStart);
        var digitsBefore = (before.replace(/[^\d]/g, "")).length;
        var cleaned = cleanAmountInput(amountEl.value);
        if (cleaned !== amountEl.value) {
          amountEl.value = cleaned;
          var pos = 0, seen = 0;
          while (pos < cleaned.length && seen < digitsBefore) {
            if (/\d/.test(cleaned[pos])) seen++;
            pos++;
          }
          try { amountEl.setSelectionRange(pos, pos); } catch (e) { /* 일부 브라우저 */ }
        }
        saveLast(); syncURL(); render();
      });
    }
    if (fromEl) fromEl.addEventListener("change", function () { saveLast(); syncURL(); render(); });
    if (toEl) toEl.addEventListener("change", function () { saveLast(); syncURL(); render(); });

    if (swapBtn) {
      swapBtn.addEventListener("click", function () {
        if (!fromEl || !toEl) return;
        var a = fromEl.value; fromEl.value = toEl.value; toEl.value = a;
        saveLast(); syncURL(); render();
      });
    }
    if (quickEl) {
      quickEl.addEventListener("click", function (ev) {
        var chip = ev.target.closest ? ev.target.closest(".exc-chip") : null;
        if (!chip) return;
        var f = validCode(chip.getAttribute("data-from"));
        var tc = validCode(chip.getAttribute("data-to"));
        if (fromEl && f) fromEl.value = f;
        if (toEl && tc) toEl.value = tc;
        saveLast(); syncURL(); render();
      });
    }

    // 언어 전환: 통화명·결과 문구 재구성
    document.addEventListener("i18n:change", function () {
      fillSelect(fromEl); fillSelect(toEl);
      render();
    });
  }

  init();
  // TOOLJS:END
})();
