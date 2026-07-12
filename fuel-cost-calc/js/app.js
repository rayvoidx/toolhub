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
  // fuel-cost-calc — trip fuel cost (spec: factory/state/fuel-cost-calc.yaml)
  // 전 계산을 metric base(리터·km)로 정규화. 실시간 유가 API 미사용 → 외부 호출 0.
  // 저장: 단위·통화·왕복 설정만 localStorage("fuel-cost-calc:prefs"). 숫자 입력값은 저장 안 함.
  var cfg = window.APP_CONFIG || {};
  var PREFS_KEY = (cfg.slug || "fuel-cost-calc") + ":prefs";

  var KM_PER_MI = 1.609344;
  var L_PER_US_GAL = 3.785411784;
  var L_PER_UK_GAL = 4.54609;

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

  /* ---- 파싱: 표시 문자열 → 숫자 (콤마 자릿구분 제거, 첫 소수점만 인정) ---- */
  function parseNum(str) {
    if (str == null) return NaN;
    var s = String(str).replace(/,/g, "").trim();
    if (s === "" || s === "-" || s === "." || s === "-." || s === "+") return NaN;
    if (!/^[-+]?\d*\.?\d*$/.test(s)) return NaN;
    return parseFloat(s);
  }

  /* ---- 표시 숫자 포맷 (스펙: Number(v.toPrecision(10)) 후 후행 0 제거,
         |v|>=1e12 또는 0<|v|<1e-4 는 지수 표기) ---- */
  function fmtNum(v) {
    if (v == null || typeof v !== "number" || !isFinite(v)) return null;
    var n = Number(v.toPrecision(10));
    var abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e12 || abs < 1e-4)) {
      // 지수 표기 + 가수부 후행 0 제거
      return n.toExponential(4).replace(/\.?0+e/, "e").replace(/e\+?/, "e");
    }
    var lang;
    try { lang = window.I18N && window.I18N.lang(); } catch (e) { /* noop */ }
    try {
      return n.toLocaleString(lang || undefined, { maximumFractionDigits: 12 });
    } catch (e) {
      return String(n);
    }
  }

  /* ---- 순수 계산 로직 (전부 metric base 로 정규화) ---- */

  /** 연비 단위 → 리터/km */
  function litersPerKm(eff, effUnit) {
    switch (effUnit) {
      case "l100":  return eff / 100;
      case "mpgUS": return L_PER_US_GAL / (eff * KM_PER_MI);
      case "mpgUK": return L_PER_UK_GAL / (eff * KM_PER_MI);
      case "kmL":
      default:      return 1 / eff;
    }
  }
  /** 유가 단위 → 리터당 가격 */
  function pricePerLiter(price, priceUnit) {
    switch (priceUnit) {
      case "usgal": return price / L_PER_US_GAL;
      case "ukgal": return price / L_PER_UK_GAL;
      case "perL":
      default:      return price;
    }
  }

  /**
   * 핵심 계산.
   * dist>=0, eff>0, price>=0, distUnit∈{km,mi}, people>=1 정수, roundTrip bool.
   * 반환: liters(주유량 L), totalCost, perPersonCost, costPerDist(선택 거리단위 1당 비용), gallons.
   */
  function compute(dist, distUnit, eff, effUnit, price, priceUnit, roundTrip, people, galUnit) {
    var distKm = dist * (distUnit === "mi" ? KM_PER_MI : 1);
    var lpkm = litersPerKm(eff, effUnit);
    var ppl = pricePerLiter(price, priceUnit);
    var factor = roundTrip ? 2 : 1;
    var liters = distKm * lpkm * factor;
    var totalCost = liters * ppl;
    var perPerson = totalCost / people;
    // 거리 1단위(선택한 km/mi)당 비용 = 리터당가 × 리터/km × (km/단위) — 편도·왕복·거리값 무관 rate
    var costPerDist = ppl * lpkm * (distUnit === "mi" ? KM_PER_MI : 1);
    var galLiters = (galUnit === "ukgal") ? L_PER_UK_GAL : L_PER_US_GAL;
    var gallons = liters / galLiters;
    return {
      liters: liters,
      gallons: gallons,
      totalCost: totalCost,
      perPerson: perPerson,
      costPerDist: costPerDist
    };
  }

  // node 단위 검증 훅 (UI 상태 아님)
  window.__FCC_TEST = {
    litersPerKm: litersPerKm, pricePerLiter: pricePerLiter,
    compute: compute, fmtNum: fmtNum, parseNum: parseNum,
    KM_PER_MI: KM_PER_MI, L_PER_US_GAL: L_PER_US_GAL, L_PER_UK_GAL: L_PER_UK_GAL
  };

  /* ---- DOM 참조 (node 검증 시 전부 null — 모든 사용처 가드) ---- */
  var distEl = document.getElementById("fcc-dist");
  var distUnitEl = document.getElementById("fcc-dist-unit");
  var effEl = document.getElementById("fcc-eff");
  var effUnitEl = document.getElementById("fcc-eff-unit");
  var priceEl = document.getElementById("fcc-price");
  var priceUnitEl = document.getElementById("fcc-price-unit");
  var currencyEl = document.getElementById("fcc-currency");
  var roundTripEl = document.getElementById("fcc-roundtrip");
  var peopleEl = document.getElementById("fcc-people");
  var minusBtn = document.getElementById("fcc-minus");
  var plusBtn = document.getElementById("fcc-plus");

  var msgEl = document.getElementById("fcc-msg");
  var outEl = document.getElementById("fcc-out");
  var totalEl = document.getElementById("fcc-total");
  var fuelCell = document.getElementById("fcc-fuel-cell");
  var fuelEl = document.getElementById("fcc-fuel");
  var perDistCell = document.getElementById("fcc-perdist-cell");
  var perDistLabel = document.getElementById("fcc-perdist-label");
  var perDistEl = document.getElementById("fcc-perdist");
  var perPersonCell = document.getElementById("fcc-perperson-cell");
  var perPersonEl = document.getElementById("fcc-perperson");
  var copyBtn = document.getElementById("fcc-copy");
  var statusEl = document.getElementById("fcc-status");
  var resultEl = document.getElementById("fcc-result");

  /* ---- 상태 저장/복원 (단위·통화·왕복만) ---- */
  function savePrefs() {
    try {
      var p = {
        distUnit: distUnitEl ? distUnitEl.value : "km",
        effUnit: effUnitEl ? effUnitEl.value : "kmL",
        priceUnit: priceUnitEl ? priceUnitEl.value : "perL",
        currency: currencyEl ? currencyEl.value : "$",
        roundTrip: roundTripEl ? !!roundTripEl.checked : false
      };
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch (e) { /* private mode — 저장 생략 */ }
  }
  function restorePrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) { p = null; }
    if (!p || typeof p !== "object") return;
    function setSel(el, val, allowed) {
      if (el && val != null && allowed.indexOf(val) !== -1) el.value = val;
    }
    setSel(distUnitEl, p.distUnit, ["km", "mi"]);
    setSel(effUnitEl, p.effUnit, ["kmL", "l100", "mpgUS", "mpgUK"]);
    setSel(priceUnitEl, p.priceUnit, ["perL", "usgal", "ukgal"]);
    setSel(currencyEl, p.currency, ["$", "€", "£", "¥", "₩", "₹"]);
    if (roundTripEl && typeof p.roundTrip === "boolean") roundTripEl.checked = p.roundTrip;
  }

  /* ---- 렌더 헬퍼 ---- */
  function showMsg(key, isErr) {
    if (msgEl) {
      msgEl.textContent = t(key);
      msgEl.className = "fcc-msg" + (isErr ? " is-err" : "");
      msgEl.hidden = false;
    }
    if (outEl) outEl.hidden = true;
  }

  function currentPeople() {
    if (!peopleEl) return 1;
    var pf = parseNum(peopleEl.value);
    if (isNaN(pf) || pf < 1) return 1;
    var p = Math.floor(pf);
    return p < 1 ? 1 : p;
  }

  function render() {
    if (!msgEl || !outEl) return;

    var distRaw = distEl ? distEl.value : "";
    var effRaw = effEl ? effEl.value : "";
    var priceRaw = priceEl ? priceEl.value : "";

    var dist = parseNum(distRaw);
    var eff = parseNum(effRaw);
    var price = parseNum(priceRaw);

    var hasDist = distRaw.trim() !== "" && !isNaN(dist);
    var hasEff = effRaw.trim() !== "" && !isNaN(eff);
    var hasPrice = priceRaw.trim() !== "" && !isNaN(price);

    // 빈 입력(거리/연비/유가 중 하나라도) → 안내만, 계산 중단
    if (!hasDist || !hasEff || !hasPrice) { showMsg("tool.n.empty", false); return; }

    // 연비 0 또는 음수 → 계산 중단 (0으로 나눗셈 차단)
    if (eff <= 0) { showMsg("tool.n.eff", true); return; }

    // 음수 거리·유가 → 안내 (0은 정상: 총비용 0)
    if (dist < 0 || price < 0) { showMsg("tool.n.neg", true); return; }

    var distUnit = distUnitEl ? distUnitEl.value : "km";
    var effUnit = effUnitEl ? effUnitEl.value : "kmL";
    var priceUnit = priceUnitEl ? priceUnitEl.value : "perL";
    var currency = currencyEl ? currencyEl.value : "$";
    var roundTrip = roundTripEl ? !!roundTripEl.checked : false;
    var people = currentPeople();
    var galUnit = (priceUnit === "ukgal") ? "ukgal" : "usgal";
    var galKey = (galUnit === "ukgal") ? "tool.galUK" : "tool.galUS";

    var r = compute(dist, distUnit, eff, effUnit, price, priceUnit, roundTrip, people, galUnit);

    // 극단값이라도 fmtNum 이 지수 표기로 처리. 비정상(Infinity)만 방어.
    var totalStr = fmtNum(r.totalCost);
    var litersStr = fmtNum(r.liters);
    var gallonsStr = fmtNum(r.gallons);
    var perDistStr = fmtNum(r.costPerDist);
    if (totalStr == null || litersStr == null || perDistStr == null) {
      showMsg("tool.n.empty", false);
      return;
    }

    // 총 유류비
    var totalDisplay = currency + totalStr;
    if (totalEl) {
      totalEl.textContent = totalDisplay;
      totalEl.setAttribute("data-copy", totalDisplay);
    }

    // 필요 주유량 (L + gal 병기)
    var fuelDisplay = litersStr + " L / " + (gallonsStr || "—") + " " + t(galKey);
    if (fuelEl) fuelEl.textContent = fuelDisplay;
    if (fuelCell) fuelCell.setAttribute("data-copy", fuelDisplay);

    // 거리당 비용 (선택 거리단위 기준)
    if (perDistLabel) perDistLabel.textContent = fmt(t("tool.res.perDist"), { unit: distUnit });
    var perDistDisplay = currency + perDistStr;
    if (perDistEl) perDistEl.textContent = perDistDisplay;
    if (perDistCell) perDistCell.setAttribute("data-copy", perDistDisplay);

    // 인원 > 1 이면 1인당 비용
    if (people > 1) {
      var perPersonStr = fmtNum(r.perPerson);
      var perPersonDisplay = currency + (perPersonStr != null ? perPersonStr : totalStr);
      if (perPersonEl) perPersonEl.textContent = perPersonDisplay;
      if (perPersonCell) {
        perPersonCell.hidden = false;
        perPersonCell.setAttribute("data-copy", perPersonDisplay);
      }
    } else if (perPersonCell) {
      perPersonCell.hidden = true;
    }

    // 복사 버튼: 요약 문구
    var summary = fmt(t("tool.copyMsg"), { total: totalDisplay, fuel: litersStr + " L" });
    if (copyBtn) copyBtn.setAttribute("data-copy", summary);

    msgEl.hidden = true;
    outEl.hidden = false;
  }

  /* ---- 복사 (Clipboard API → execCommand 폴백 → 실패 안내) ---- */
  function showStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.hidden = false;
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(function () {
      if (statusEl) { statusEl.hidden = true; statusEl.textContent = ""; }
    }, 1600);
  }
  function copyFallback(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      showStatus(ok ? t("tool.copied") : t("tool.copyFail"));
    } catch (e) { showStatus(t("tool.copyFail")); }
  }
  function copyText(text) {
    if (text == null || text === "") return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { showStatus(t("tool.copied")); },
        function () { copyFallback(text); }
      );
    } else {
      copyFallback(text);
    }
  }

  /* ---- 이벤트 ---- */
  function onNumInput() { render(); }
  function onPrefChange() { savePrefs(); render(); }

  if (distEl) distEl.addEventListener("input", onNumInput);
  if (effEl) effEl.addEventListener("input", onNumInput);
  if (priceEl) priceEl.addEventListener("input", onNumInput);
  if (peopleEl) peopleEl.addEventListener("input", onNumInput);

  if (distUnitEl) distUnitEl.addEventListener("change", onPrefChange);
  if (effUnitEl) effUnitEl.addEventListener("change", onPrefChange);
  if (priceUnitEl) priceUnitEl.addEventListener("change", onPrefChange);
  if (currencyEl) currencyEl.addEventListener("change", onPrefChange);
  if (roundTripEl) roundTripEl.addEventListener("change", onPrefChange);

  function stepPeople(delta) {
    if (!peopleEl) return;
    var cur = parseNum(peopleEl.value);
    if (isNaN(cur)) cur = (delta > 0) ? 0 : 2;
    var next = Math.max(1, Math.floor(cur) + delta);
    peopleEl.value = String(next);
    render();
  }
  if (minusBtn) minusBtn.addEventListener("click", function () { stepPeople(-1); });
  if (plusBtn) plusBtn.addEventListener("click", function () { stepPeople(1); });

  // 결과 영역의 복사 대상은 위임 처리 (data-copy)
  if (resultEl) {
    resultEl.addEventListener("click", function (ev) {
      var el = ev.target;
      while (el && el !== resultEl) {
        if (el.getAttribute && el.getAttribute("data-copy") != null && el.getAttribute("data-copy") !== "") {
          copyText(el.getAttribute("data-copy"));
          return;
        }
        el = el.parentNode;
      }
    });
    resultEl.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      var el = ev.target;
      if (el && el.getAttribute && el.getAttribute("data-copy") != null && el.getAttribute("data-copy") !== "") {
        ev.preventDefault();
        copyText(el.getAttribute("data-copy"));
      }
    });
  }

  // 언어 전환 시 결과·단위 의존 문구 재렌더
  document.addEventListener("i18n:change", render);

  // 초기화: 저장된 단위·통화·왕복 복원 → 렌더
  restorePrefs();
  render();
  // TOOLJS:END
})();
