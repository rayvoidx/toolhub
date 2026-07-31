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
  /* Blood Pressure Checker — 수축기/이완기 입력을 2017 ACC/AHA 가이드라인 5분류
     (Normal/Elevated/Stage1/Stage2/Crisis)로 판정한다. 교육용 정보이며 진단이 아니다.
     상태: localStorage "<slug>:state" 만. 외부 API 없음, 모든 계산은 로컬. */

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // 입력 파싱: 콤마 제거, 빈 문자열은 null(미입력), 숫자 아니면 NaN.
  function parseNum(raw) {
    if (raw == null) return null;
    var s = String(raw).replace(/,/g, "").trim();
    if (s === "") return null;
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }
  // ACC/AHA 2017 가이드라인 5분류 — 수축기·이완기 중 더 높은 등급이 전체 등급을 정한다.
  // (공식 표: Normal <120/<80, Elevated 120-129&<80, Stage1 130-139|80-89,
  //  Stage2 >=140|>=90, Crisis >180|>120 — "higher than", 등호 미포함)
  function categorize(sys, dia) {
    if (sys > 180 || dia > 120) return "crisis";
    if (sys >= 140 || dia >= 90) return "stage2";
    if (sys >= 130 || dia >= 80) return "stage1";
    if (sys >= 120 && dia < 80) return "elevated";
    return "normal";
  }
  // 저혈압 참고치(비공식 참고 정보 — ACC/AHA 5분류표에는 없음): 수축기 90 미만 또는 이완기 60 미만.
  function isLow(sys, dia) { return sys < 90 || dia < 60; }
  // 이완기가 수축기 이상 — 입력 실수일 가능성이 높은 조합(정상 생리에서는 이완기가 항상 더 낮다).
  function isBackwards(sys, dia) { return dia >= sys; }
  // 실제 측정 범위를 크게 벗어난 값 — 오타 의심(계산은 계속하되 경고만 표시).
  function isExtreme(sys, dia) { return sys > 300 || dia > 200 || sys < 50 || dia < 30; }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseNum: parseNum, categorize: categorize,
      isLow: isLow, isBackwards: isBackwards, isExtreme: isExtreme
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "blood-pressure-checker") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtInt(n) {
    try { return Number(n).toLocaleString(uiLang(), { maximumFractionDigits: 0 }); }
    catch (e) { return String(Math.round(n)); }
  }

  var CAT_COLOR = {
    normal: "#16a34a", elevated: "#ca8a04", stage1: "#ea580c",
    stage2: "#dc2626", crisis: "#7f1d1d"
  };

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var sysEl = $("systolic"), diaEl = $("diastolic");
  var emptyEl = $("result-empty"), errorEl = $("result-error"), bodyEl = $("result-body");
  var readingEl = $("r-reading"), badgeEl = $("r-badge");
  var crisisEl = $("r-crisis"), lowEl = $("r-low"), backEl = $("r-backwards"), extEl = $("r-extreme");
  var rows = document.querySelectorAll("#chart-table tbody tr");
  if (!sysEl || !diaEl || !bodyEl) return;

  /* ---- 상태 저장/복원 (마지막 입력값만 — private mode 는 조용히 실패) ---- */
  function save(sys, dia) {
    try { localStorage.setItem(SKEY, JSON.stringify({ s: sys, d: dia })); } catch (e) { /* noop */ }
  }
  function restore() {
    try {
      var raw = localStorage.getItem(SKEY);
      if (!raw) return;
      var v = JSON.parse(raw);
      if (v && v.s != null) sysEl.value = v.s;
      if (v && v.d != null) diaEl.value = v.d;
    } catch (e) { /* noop */ }
  }

  /* ---- 렌더 ---- */
  function setBadge(cat) {
    badgeEl.textContent = tr("tool.badge." + cat, cat);
    badgeEl.style.background = CAT_COLOR[cat] || "#6b7280";
  }
  function highlightRow(cat) {
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle("active", rows[i].getAttribute("data-cat") === cat);
    }
  }
  function render() {
    var sysRaw = parseNum(sysEl.value), diaRaw = parseNum(diaEl.value);

    // 둘 다 비었으면 안내 문구만
    if (sysRaw == null && diaRaw == null) {
      emptyEl.hidden = false; errorEl.hidden = true; bodyEl.hidden = true;
      highlightRow(null);
      return;
    }
    // 한쪽만 비었거나, 숫자가 아니거나, 0 이하 — 오류
    var invalid = sysRaw == null || diaRaw == null ||
      (typeof sysRaw === "number" && isNaN(sysRaw)) || (typeof diaRaw === "number" && isNaN(diaRaw)) ||
      sysRaw <= 0 || diaRaw <= 0;
    if (invalid) {
      emptyEl.hidden = true; errorEl.hidden = false; bodyEl.hidden = true;
      highlightRow(null);
      return;
    }

    var sys = sysRaw, dia = diaRaw;
    var cat = categorize(sys, dia);

    emptyEl.hidden = true; errorEl.hidden = true; bodyEl.hidden = false;
    readingEl.textContent = fmtInt(sys) + "/" + fmtInt(dia) + " " + tr("tool.unit", "mmHg");
    setBadge(cat);
    highlightRow(cat);

    crisisEl.hidden = cat !== "crisis";
    // 저혈압 안내는 카테고리가 이미 Normal 로 판정된 경우에만 보충 정보로 노출
    // (다른 수치가 이미 더 높은 등급을 끌어올린 경우엔 그 경고가 우선이므로 중복 노출하지 않는다)
    lowEl.hidden = !(isLow(sys, dia) && cat === "normal");
    backEl.hidden = !isBackwards(sys, dia);
    extEl.hidden = !isExtreme(sys, dia);

    save(sys, dia);
  }

  /* ---- 이벤트 ---- */
  sysEl.addEventListener("input", render);
  diaEl.addEventListener("input", render);
  // 언어 전환 시 배지·단위·안내 문구 재적용
  document.addEventListener("i18n:change", render);

  restore();
  render();
  // TOOLJS:END
})();
