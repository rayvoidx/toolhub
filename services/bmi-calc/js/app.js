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
  var SLUG = cfg.slug || "bmi-calc";
  var LS_KEY = SLUG + ":last";    // 캐노니컬(cm·kg)로 저장 — 단위 전환과 무관하게 호환
  var LS_UNITS = SLUG + ":units"; // "metric" | "imperial"
  var LS_STD = SLUG + ":std";     // "asia" | "who"

  var heightInput = document.getElementById("height-input");
  var heightFt = document.getElementById("height-ft");
  var heightIn = document.getElementById("height-in");
  var weightInput = document.getElementById("weight-input");
  var weightLabel = document.getElementById("weight-label");
  var groupMetric = document.getElementById("height-metric");
  var groupImperial = document.getElementById("height-imperial");
  var unitHint = document.getElementById("unit-hint");
  var unitBtns = document.querySelectorAll(".unit-btn");
  var calcBtn = document.getElementById("calc-btn");
  var resultEl = document.getElementById("result");

  if (!heightInput || !weightInput || !resultEl) return;

  var LB_PER_KG = 2.2046226218;
  var CM_PER_IN = 2.54;
  var GMIN = 15, GMAX = 40;   // 게이지 표시 범위

  var PAGE_LANG = document.documentElement.getAttribute("lang") || "ko";
  var TOOL_URL = (function () {
    var c = document.querySelector('link[rel="canonical"]');
    return (c && c.href) || (location.origin + location.pathname);
  })();

  /* ---------- 단위계·기준의 국가 분기 (정적 데이터 — 연 1회 갱신으로 수렴, 실시간 조회 없음) ---------- */

  // 신체 치수를 야드파운드법으로 쓰는 지역
  var IMPERIAL_REGIONS = ["US", "GB", "LR", "MM"];
  // 아시아·태평양 BMI 기준(대한비만학회 2022 / WHO 서태평양) 적용 지역
  var ASIA_REGIONS = ["KR", "JP", "CN", "TW", "HK", "MO", "SG", "IN", "ID", "MY", "TH",
                      "VN", "PH", "BD", "PK", "LK", "NP", "MM", "KH", "LA", "BN", "MN"];
  // 언어 태그에 지역이 없을 때의 폴백
  var LANG_REGION = { ko: "KR", ja: "JP", zh: "CN", hi: "IN", bn: "BD", id: "ID",
                      ur: "PK", ru: "RU", de: "DE", fr: "FR", vi: "VN", th: "TH" };

  function regionFromLangTag(tag) {
    var m = String(tag || "").match(/[-_]([A-Za-z]{2})(?:$|[-_])/);
    return m ? m[1].toUpperCase() : "";
  }

  function regionFromTZ(tz) {
    if (!tz) return "";
    if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Juneau|Sitka|Nome|Adak|Menominee|Indiana|Kentucky|North_Dakota)/.test(tz)) return "US";
    if (tz === "Pacific/Honolulu") return "US";
    if (tz === "Europe/London") return "GB";
    if (tz === "Africa/Monrovia") return "LR";
    if (tz === "Asia/Yangon" || tz === "Asia/Rangoon") return "MM";
    if (tz === "Asia/Seoul") return "KR";
    if (tz === "Asia/Tokyo") return "JP";
    if (/^Asia\/(Shanghai|Chongqing|Harbin|Urumqi)/.test(tz)) return "CN";
    if (tz === "Asia/Taipei") return "TW";
    if (tz === "Asia/Hong_Kong") return "HK";
    if (tz === "Asia/Singapore") return "SG";
    if (/^Asia\/(Kolkata|Calcutta)/.test(tz)) return "IN";
    if (/^Asia\/(Jakarta|Makassar|Pontianak|Jayapura)/.test(tz)) return "ID";
    if (tz === "Asia/Kuala_Lumpur") return "MY";
    if (tz === "Asia/Bangkok") return "TH";
    if (/^Asia\/(Ho_Chi_Minh|Saigon)/.test(tz)) return "VN";
    if (tz === "Asia/Manila") return "PH";
    if (tz === "Asia/Dhaka") return "BD";
    if (tz === "Asia/Karachi") return "PK";
    if (tz === "Asia/Colombo") return "LK";
    if (tz === "Asia/Kathmandu") return "NP";
    return "";
  }

  // 언어 태그의 지역 > 타임존 > 언어 폴백. (ko-KR 사용자는 어디에 있든 cm·kg 로 생각한다)
  function detectRegion() {
    var langs = (navigator.languages && navigator.languages.length)
      ? navigator.languages : [navigator.language || ""];
    var i, r;
    for (i = 0; i < langs.length; i++) {
      r = regionFromLangTag(langs[i]);
      if (r) return r;
    }
    var tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* 구형 브라우저 */ }
    r = regionFromTZ(tz);
    if (r) return r;
    for (i = 0; i < langs.length; i++) {
      var base = String(langs[i]).toLowerCase().split(/[-_]/)[0];
      if (LANG_REGION[base]) return LANG_REGION[base];
    }
    return "";
  }

  var REGION = detectRegion();

  function regionName(code) {
    if (!code) return "";
    try { return new Intl.DisplayNames([PAGE_LANG], { type: "region" }).of(code) || code; }
    catch (e) { return code; }
  }

  /* ---------- 분류 기준 ---------- */

  var BANDS = {
    who: [
      { max: 18.5,     label: "저체중", cls: "badge-blue",   seg: "g-blue" },
      { max: 25,       label: "정상",   cls: "badge-green",  seg: "g-green" },
      { max: 30,       label: "과체중", cls: "badge-orange", seg: "g-orange" },
      { max: Infinity, label: "비만",   cls: "badge-red",    seg: "g-red" }
    ],
    asia: [
      { max: 18.5,     label: "저체중",      cls: "badge-blue",   seg: "g-blue" },
      { max: 23,       label: "정상",        cls: "badge-green",  seg: "g-green" },
      { max: 25,       label: "비만 전단계", cls: "badge-orange", seg: "g-orange" },
      { max: 30,       label: "1단계 비만",  cls: "badge-red",    seg: "g-red" },
      { max: Infinity, label: "2단계 비만",  cls: "badge-red",    seg: "g-red2" }
    ]
  };
  var NORM_MAX = { who: 24.9, asia: 22.9 };   // 정상 표기 상한
  var NORM_TOP = { who: 25,   asia: 23 };     // 정상 경계
  var NORM_MIN = 18.5;

  function classify(bmi, std) {
    var b = BANDS[std], i;
    for (i = 0; i < b.length; i++) { if (bmi < b[i].max) return b[i]; }
    return b[b.length - 1];
  }
  function stdShort(std) { return std === "asia" ? "아시아·태평양" : "WHO"; }

  /* ---------- 활성 단위계에서 바로 검증 (경계 환산 오차로 인한 모순 안내 방지) ---------- */

  var LIMITS = {
    metric:   { hMin: 50, hMax: 250, wMin: 10, wMax: 300, hText: "50~250 cm", wText: "10~300 kg" },
    imperial: { hMin: 20, hMax: 98,  wMin: 22, wMax: 661, hText: "1′8″~8′2″", wText: "22~661 lb" }
  };

  /* ---------- 상태 ---------- */

  var savedUnits = null, savedStd = null;
  try { savedUnits = localStorage.getItem(LS_UNITS); } catch (e) { /* private mode */ }
  try { savedStd = localStorage.getItem(LS_STD); } catch (e) { /* private mode */ }

  var autoUnits = IMPERIAL_REGIONS.indexOf(REGION) >= 0 ? "imperial" : "metric";
  var units = (savedUnits === "metric" || savedUnits === "imperial") ? savedUnits : autoUnits;
  var std = (savedStd === "asia" || savedStd === "who")
    ? savedStd : (ASIA_REGIONS.indexOf(REGION) >= 0 ? "asia" : "who");
  var stdAuto = !(savedStd === "asia" || savedStd === "who");
  var lastCopy = "";

  /* ---------- 숫자 포맷 (표시 언어 기준 — 입력값에는 절대 쓰지 않는다) ---------- */

  function num(n, min, max) {
    try {
      return new Intl.NumberFormat(PAGE_LANG, {
        minimumFractionDigits: min, maximumFractionDigits: max
      }).format(n);
    } catch (e) { return n.toFixed(max); }
  }
  function fmt(n, d) { return num(n, d, d); }
  function tick(n) { return num(n, 0, 1); }

  function wUnit() { return units === "imperial" ? "lb" : "kg"; }
  function wDisp(kg) { return units === "imperial" ? kg * LB_PER_KG : kg; }
  function hDispText(cm) {
    if (units === "imperial") {
      var tot = cm / CM_PER_IN;
      var ft = Math.floor(tot / 12);
      return ft + "′" + num(tot - ft * 12, 0, 1) + "″";
    }
    return num(cm, 0, 1) + " cm";
  }

  /* ---------- 입력 읽기/쓰기 ---------- */

  function readState() {
    var L = LIMITS[units];
    var st = { hEmpty: false, wEmpty: false, hErr: "", wErr: "", hCm: NaN, wKg: NaN };

    if (units === "metric") {
      var raw = heightInput.value.trim();
      if (!raw || isNaN(parseFloat(raw))) st.hEmpty = true;
      else {
        var v = parseFloat(raw);
        if (v < L.hMin || v > L.hMax) st.hErr = "키를 " + L.hText + " 범위로 입력해 주세요.";
        else st.hCm = v;
      }
    } else {
      var rf = heightFt.value.trim(), ri = heightIn.value.trim();
      if (!rf && !ri) st.hEmpty = true;
      else {
        var tot = (parseFloat(rf) || 0) * 12 + (parseFloat(ri) || 0);
        if (!(tot > 0)) st.hEmpty = true;
        else if (tot < L.hMin || tot > L.hMax) st.hErr = "키를 " + L.hText + " 범위로 입력해 주세요.";
        else st.hCm = tot * CM_PER_IN;
      }
    }

    var rw = weightInput.value.trim();
    if (!rw || isNaN(parseFloat(rw))) st.wEmpty = true;
    else {
      var w = parseFloat(rw);
      if (w < L.wMin || w > L.wMax) st.wErr = "몸무게를 " + L.wText + " 범위로 입력해 주세요.";
      else st.wKg = units === "imperial" ? w / LB_PER_KG : w;
    }
    return st;
  }

  // 입력 필드에는 로케일 포맷을 쓰지 않는다 (number input 은 점 소수만 허용)
  function writeHeight(cm) {
    if (units === "imperial") {
      var tot = cm / CM_PER_IN;
      var ft = Math.floor(tot / 12);
      var inch = Math.round((tot - ft * 12) * 2) / 2;
      if (inch >= 12) { ft += 1; inch -= 12; }
      heightFt.value = String(ft);
      heightIn.value = String(inch);
    } else {
      heightInput.value = String(Math.round(cm * 10) / 10);
    }
  }
  function writeWeight(kg) {
    weightInput.value = String(units === "imperial"
      ? Math.round(kg * LB_PER_KG * 10) / 10
      : Math.round(kg * 10) / 10);
  }

  function applyUnitsUI() {
    var imp = units === "imperial";
    groupMetric.hidden = imp;
    groupImperial.hidden = !imp;
    weightLabel.textContent = imp ? "몸무게 (lb)" : "몸무게 (kg)";
    weightInput.setAttribute("aria-label", imp ? "몸무게 (lb)" : "몸무게 (kg)");
    weightInput.setAttribute("min", imp ? "22" : "10");
    weightInput.setAttribute("max", imp ? "661" : "300");
    weightInput.setAttribute("placeholder", imp ? "예: 143" : "예: 65");
    for (var i = 0; i < unitBtns.length; i++) {
      unitBtns[i].setAttribute("aria-pressed",
        unitBtns[i].getAttribute("data-units") === units ? "true" : "false");
    }
  }

  /* ---------- 결과 ---------- */

  function hideResult() {
    resultEl.hidden = true;
    resultEl.innerHTML = "";
    lastCopy = "";
  }
  function showGuide(msg) {
    resultEl.innerHTML = '<p class="result-error">' + msg + "</p>";
    resultEl.hidden = false;
    lastCopy = "";
  }
  function pct(bmi) {
    return Math.max(0, Math.min(100, (bmi - GMIN) / (GMAX - GMIN) * 100));
  }

  function buildGauge(bmi, bmiR, band) {
    var bands = BANDS[std], segs = "", ticks = "", prev = GMIN, i, top;
    for (i = 0; i < bands.length; i++) {
      top = Math.min(bands[i].max, GMAX);
      if (top > prev) {
        segs += '<span class="gauge-seg ' + bands[i].seg +
                '" style="width:' + ((top - prev) / (GMAX - GMIN) * 100).toFixed(3) + '%"></span>';
      }
      prev = top;
      if (prev >= GMAX) break;
    }
    for (i = 0; i < bands.length - 1; i++) {
      var v = bands[i].max;
      if (v > GMIN && v < GMAX) {
        ticks += '<span style="left:' + pct(v).toFixed(2) + '%">' + tick(v) + "</span>";
      }
    }
    var label = "BMI 게이지 — " + fmt(bmiR, 2) + ", " + stdShort(std) + " 기준 " +
                band.label + " 구간 (표시 범위 15~40)";
    return '<div class="gauge" role="img" aria-label="' + label + '">' +
             '<div class="gauge-bar">' +
               '<div class="gauge-track">' + segs + "</div>" +
               '<span class="gauge-marker" style="left:' + pct(bmi).toFixed(2) + '%"></span>' +
             "</div>" +
             '<div class="gauge-scale">' + ticks + "</div>" +
           "</div>";
  }

  // 숫자에 의미를 붙인다 — 어느 구간의 어디쯤인지 + 정상까지 남은 체중
  function buildVerdict(bmi, wKg, minKg, maxKg, band) {
    var sl = stdShort(std) + " 기준";
    var normMax = NORM_MAX[std];
    if (bmi < NORM_MIN) {
      return sl + ' <b class="v-blue">저체중</b> — 정상 하한(' + tick(NORM_MIN) + ')보다 ' +
             fmt(NORM_MIN - bmi, 1) + " 낮습니다. 정상 범위에 들려면 약 " +
             fmt(wDisp(minKg - wKg), 1) + " " + wUnit() + " 증량이 필요합니다.";
    }
    if (bmi < NORM_TOP[std]) {
      var third = (normMax - NORM_MIN) / 3;
      var pos, tail;
      if (bmi < NORM_MIN + third) {
        pos = "하단";
        tail = "정상 하한(" + tick(NORM_MIN) + ")보다 " + fmt(bmi - NORM_MIN, 1) + " 높습니다.";
      } else if (bmi < NORM_MIN + third * 2) {
        pos = "중간";
        tail = "정상 범위 한가운데로, 가장 안정적인 구간입니다.";
      } else {
        pos = "상단";
        tail = "정상 상한(" + tick(normMax) + ")까지 " + fmt(normMax - bmi, 1) + " 남았습니다.";
      }
      return sl + ' <b class="v-green">정상 ' + pos + "</b> — " + tail;
    }
    return sl + ' <b class="' + (bmi < 30 ? "v-orange" : "v-red") + '">' + band.label +
           "</b> — 정상 상한(" + tick(normMax) + ")보다 " + fmt(bmi - normMax, 1) +
           " 높습니다. 정상 범위에 들려면 약 " + fmt(wDisp(wKg - maxKg), 1) + " " +
           wUnit() + " 감량이 필요합니다.";
  }

  function stdNote() {
    var otherStd = std === "asia" ? "who" : "asia";
    var rn = regionName(REGION);
    var src = stdAuto ? (rn ? rn + " 자동 감지" : "기본값") : "직접 선택";
    return "해석 기준: <b>" + stdShort(std) + "</b> (" + src +
           ') · <button type="button" class="link-btn" id="std-toggle">' +
           stdShort(otherStd) + " 기준으로 보기</button>";
  }

  function renderResult(hCm, wKg) {
    var hM = hCm / 100;
    var bmi = wKg / (hM * hM);
    var bmiR = Math.round(bmi * 100) / 100;
    var other = std === "asia" ? "who" : "asia";
    var pBand = classify(bmi, std);
    var oBand = classify(bmi, other);
    var minKg = NORM_MIN * hM * hM;
    var maxKg = NORM_MAX[std] * hM * hM;

    var warn = "";
    if (bmi < 10 || bmi > 60) {
      warn = '<p class="result-warning">비정상적인 수치일 수 있습니다. 키와 몸무게를 다시 확인해 주세요.</p>';
    }

    resultEl.innerHTML = warn +
      '<div class="bmi-number">BMI <strong>' + fmt(bmiR, 2) + "</strong></div>" +
      buildGauge(bmi, bmiR, pBand) +
      '<p class="verdict">' + buildVerdict(bmi, wKg, minKg, maxKg, pBand) + "</p>" +
      '<div class="badge-row">' +
        '<span class="badge ' + pBand.cls + '">' + stdShort(std) + ": " + pBand.label + "</span>" +
        '<span class="badge ' + oBand.cls + '">' + stdShort(other) + ": " + oBand.label + "</span>" +
      "</div>" +
      '<p class="healthy-range">건강 체중 범위(' + stdShort(std) + " 정상): <b>" +
        fmt(wDisp(minKg), 1) + " ~ " + fmt(wDisp(maxKg), 1) + " " + wUnit() + "</b></p>" +
      '<p class="std-note">' + stdNote() + "</p>" +
      '<button type="button" class="copy-btn" id="copy-btn">결과 복사</button>';
    resultEl.hidden = false;

    lastCopy = [
      "BMI " + fmt(bmiR, 2) + " — " + stdShort(std) + " 기준 " + pBand.label +
        " (" + stdShort(other) + " 기준 " + oBand.label + ")",
      "키 " + hDispText(hCm) + " · 몸무게 " + fmt(wDisp(wKg), 1) + " " + wUnit(),
      "건강 체중 범위 " + fmt(wDisp(minKg), 1) + " ~ " + fmt(wDisp(maxKg), 1) + " " + wUnit(),
      TOOL_URL
    ].join("\n");
  }

  function calculate(opts) {
    var explicit = !!(opts && opts.explicit);
    var st = readState();

    // 아직 입력하지 않은 상태는 실패가 아니다 — 실시간 계산 중에는 결과를 감춘다.
    // 버튼/Enter 로 명시 요청했을 때는 반드시 안내한다 (조용한 실패 금지).
    if (st.hEmpty || st.wEmpty) {
      if (explicit) showGuide("키와 몸무게를 입력해 주세요.");
      else hideResult();
      return;
    }
    if (st.hErr) { showGuide(st.hErr); return; }
    if (st.wErr) { showGuide(st.wErr); return; }

    renderResult(st.hCm, st.wKg);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        height: Math.round(st.hCm * 100) / 100,
        weight: Math.round(st.wKg * 100) / 100
      }));
    } catch (e) { /* private mode */ }
  }

  /* ---------- 복사 ---------- */

  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function doCopy(btn) {
    if (!lastCopy) return;
    var original = "결과 복사";
    function done(msg) {
      btn.textContent = msg;
      setTimeout(function () { btn.textContent = original; }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastCopy).then(
        function () { done("복사됨 ✓"); },
        function () { done(legacyCopy(lastCopy) ? "복사됨 ✓" : "복사 실패 — 직접 선택해 주세요"); }
      );
    } else {
      done(legacyCopy(lastCopy) ? "복사됨 ✓" : "복사 실패 — 직접 선택해 주세요");
    }
  }

  /* ---------- 이벤트 ---------- */

  function setUnits(next) {
    if (next === units || !LIMITS[next]) return;
    var st = readState();                       // 전환 전 값을 캐노니컬로 확보
    units = next;
    applyUnitsUI();
    if (!isNaN(st.hCm)) writeHeight(st.hCm);    // 값이 있으면 환산해 옮긴다 (재입력 불필요)
    if (!isNaN(st.wKg)) writeWeight(st.wKg);
    try { localStorage.setItem(LS_UNITS, units); } catch (e) { /* private mode */ }
    if (unitHint) unitHint.hidden = true;
    calculate({ explicit: false });
  }

  for (var b = 0; b < unitBtns.length; b++) {
    unitBtns[b].addEventListener("click", function () {
      setUnits(this.getAttribute("data-units"));
    });
  }

  resultEl.addEventListener("click", function (e) {
    var t = e.target;
    while (t && t !== resultEl && t.nodeName !== "BUTTON") { t = t.parentNode; }
    if (!t || t.nodeName !== "BUTTON") return;
    if (t.id === "copy-btn") {
      doCopy(t);
    } else if (t.id === "std-toggle") {
      std = std === "asia" ? "who" : "asia";
      stdAuto = false;
      try { localStorage.setItem(LS_STD, std); } catch (e2) { /* private mode */ }
      calculate({ explicit: true });
    }
  });

  var timer = null;
  function onInput() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { calculate({ explicit: false }); }, 280);
  }
  function onEnter(e) {
    if (e.key === "Enter") { if (timer) clearTimeout(timer); calculate({ explicit: true }); }
  }
  [heightInput, heightFt, heightIn, weightInput].forEach(function (el) {
    if (!el) return;
    el.addEventListener("input", onInput);
    el.addEventListener("keydown", onEnter);
  });
  if (calcBtn) {
    calcBtn.addEventListener("click", function () {
      if (timer) clearTimeout(timer);
      calculate({ explicit: true });
    });
  }

  /* ---------- 초기화 ---------- */

  applyUnitsUI();

  // 자동 감지로 야드파운드법을 골랐을 때만 이유를 알린다 (미터법 사용자에겐 소음)
  if (!savedUnits && units === "imperial" && unitHint) {
    var rn0 = regionName(REGION);
    unitHint.textContent = (rn0 ? rn0 + " 지역으로 감지해 " : "") +
      "야드파운드법(ft·in·lb)을 기본으로 뒀습니다. 위 버튼으로 미터법으로 바꿀 수 있어요.";
    unitHint.hidden = false;
  }

  (function restoreLast() {
    var saved = null;
    try { saved = localStorage.getItem(LS_KEY); } catch (e) { return; }
    if (!saved) return;
    try {
      var p = JSON.parse(saved);
      var h = parseFloat(p && p.height), w = parseFloat(p && p.weight);
      if (h > 0) writeHeight(h);   // 저장은 항상 cm·kg — 표시 단위로 환산해 복원
      if (w > 0) writeWeight(w);
    } catch (e) { /* 손상된 값은 무시 */ }
  })();

  calculate({ explicit: false });   // 복원된 값이 있으면 재방문 즉시 결과 표시

  // 도구 전용 스킨 — 공통 style.css 를 건드리지 않기 위해 주입 (related.js 선례)
  (function injectStyle() {
    if (document.getElementById("bmi-tool-style")) return;
    var st = document.createElement("style");
    st.id = "bmi-tool-style";
    st.textContent =
      '#tool{--c-blue:#1d4ed8;--c-green:#047857;--c-orange:#b45309;--c-red:#b91c1c}' +
      '[data-theme="dark"] #tool{--c-blue:#93c5fd;--c-green:#6ee7b7;--c-orange:#fcd34d;--c-red:#fca5a5}' +
      '@media (prefers-color-scheme:dark){[data-theme="auto"] #tool{--c-blue:#93c5fd;--c-green:#6ee7b7;--c-orange:#fcd34d;--c-red:#fca5a5}}' +
      '#tool .unit-switch{display:inline-flex;gap:2px;border:1px solid var(--line);border-radius:10px;padding:3px;background:var(--bg)}' +
      '#tool .unit-btn{-webkit-appearance:none;appearance:none;border:0;background:transparent;color:var(--muted);font-family:inherit;font-size:13px;font-weight:600;line-height:1.2;padding:7px 12px;border-radius:8px;cursor:pointer}' +
      '#tool .unit-btn[aria-pressed="true"]{background:var(--surface);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.1)}' +
      '#tool .unit-btn:focus-visible{outline:2px solid var(--accent);outline-offset:1px}' +
      '#tool .unit-hint{margin:10px 0 0;font-size:13px;line-height:1.5;color:var(--muted)}' +
      '#tool .ftin-row{display:flex;align-items:center;gap:8px}' +
      '#tool .ftin-row input{flex:1 1 0;min-width:0}' +
      '#tool .ftin-row span{font-size:14px;font-weight:700;color:var(--muted)}' +
      '#tool .bmi-number{font-size:16px;line-height:1.3;color:var(--muted)}' +
      '#tool .gauge{margin:14px 0 12px}' +
      '#tool .gauge-bar{position:relative;height:18px;display:flex;align-items:center}' +
      '#tool .gauge-track{display:flex;width:100%;height:10px;border-radius:999px;overflow:hidden;background:var(--line)}' +
      '#tool .gauge-seg{height:100%}' +
      '#tool .g-blue{background:#60a5fa}#tool .g-green{background:#34d399}#tool .g-orange{background:#fbbf24}#tool .g-red{background:#f87171}#tool .g-red2{background:#dc2626}' +
      '#tool .gauge-marker{position:absolute;top:0;bottom:0;width:3px;border-radius:2px;background:var(--ink);box-shadow:0 0 0 2px var(--surface);transform:translateX(-50%)}' +
      '#tool .gauge-scale{position:relative;height:15px;margin-top:3px}' +
      '#tool .gauge-scale span{position:absolute;transform:translateX(-50%);font-size:11px;white-space:nowrap;color:var(--muted)}' +
      '#tool .verdict{margin:10px 0 0;font-size:15px;line-height:1.6;color:var(--ink)}' +
      '#tool .verdict b{font-weight:800}' +
      '#tool .v-blue{color:var(--c-blue)}#tool .v-green{color:var(--c-green)}#tool .v-orange{color:var(--c-orange)}#tool .v-red{color:var(--c-red)}' +
      '#tool .badge-row{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0}' +
      '#tool .badge{display:inline-block;font-size:13px;font-weight:700;line-height:1.35;padding:5px 11px;border-radius:999px}' +
      '#tool .badge-blue{background:color-mix(in srgb,#3b82f6 15%,var(--surface));color:var(--c-blue)}' +
      '#tool .badge-green{background:color-mix(in srgb,#10b981 15%,var(--surface));color:var(--c-green)}' +
      '#tool .badge-orange{background:color-mix(in srgb,#f59e0b 18%,var(--surface));color:var(--c-orange)}' +
      '#tool .badge-red{background:color-mix(in srgb,#ef4444 15%,var(--surface));color:var(--c-red)}' +
      '#tool .healthy-range{margin:12px 0 0;font-size:15px;color:var(--ink)}' +
      '#tool .healthy-range b{font-weight:800;color:var(--accent-strong)}' +
      '[data-theme="dark"] #tool .healthy-range b{color:var(--accent)}' +
      '@media (prefers-color-scheme:dark){[data-theme="auto"] #tool .healthy-range b{color:var(--accent)}}' +
      '#tool .std-note{margin:8px 0 0;font-size:12.5px;line-height:1.6;color:var(--muted)}' +
      '#tool .std-note b{font-weight:700;color:var(--ink)}' +
      '#tool .link-btn{-webkit-appearance:none;appearance:none;background:none;border:0;padding:0;font:inherit;font-size:12.5px;color:var(--accent);text-decoration:underline;cursor:pointer}' +
      '#tool .copy-btn{-webkit-appearance:none;appearance:none;margin-top:14px;padding:9px 16px;font-family:inherit;font-size:13.5px;font-weight:700;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--ink);cursor:pointer}' +
      '#tool .copy-btn:hover{border-color:var(--accent);color:var(--accent-strong)}' +
      '#tool .result-error{margin:0;font-size:14.5px;line-height:1.6;color:var(--muted)}' +
      '#tool .result-warning{margin:0 0 10px;font-size:14.5px;font-weight:600;line-height:1.6;color:var(--c-orange)}';
    document.head.appendChild(st);
  })();
  // TOOLJS:END
})();
