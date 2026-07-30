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
  /* Fuel Economy Converter — MPG (US) ⇄ MPG (UK) ⇄ L/100km ⇄ km/L, all live-synced.
     4개 입력 중 하나를 고치면 나머지 전부 즉시 재계산된다. 캐노니컬 값은 km/L(kmL).
     L/100km 는 다른 셋과 반대 방향(값이 낮을수록 효율적)이라 별도 힌트를 노출한다.
     상태: localStorage "<slug>:state" 만. 외부 API 없음, 모든 계산은 로컬. */

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상, Math 외 의존 없음)
  var KM_PER_MILE = 1.609344;      // 정의값(mile → km)
  var L_PER_US_GAL = 3.785411784;  // 정의값(US liquid gallon → liter)
  var L_PER_UK_GAL = 4.54609;      // 정의값(UK imperial gallon → liter)
  var MAX_KML = 500;               // 극단값 캡(오토바이·극단 하이브리드도 커버하는 여유값)

  function kmLFromMpgUs(m) { return m * KM_PER_MILE / L_PER_US_GAL; }
  function kmLFromMpgUk(m) { return m * KM_PER_MILE / L_PER_UK_GAL; }
  function kmLFromL100km(l) { return 100 / l; } // l>0 가정(호출부가 <=0 을 걸러낸다)
  function mpgUsFromKmL(k) { return k * L_PER_US_GAL / KM_PER_MILE; }
  function mpgUkFromKmL(k) { return k * L_PER_UK_GAL / KM_PER_MILE; }
  function l100kmFromKmL(k) { return 100 / k; } // k>0 가정
  // calc-core:end

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      KM_PER_MILE: KM_PER_MILE, L_PER_US_GAL: L_PER_US_GAL, L_PER_UK_GAL: L_PER_UK_GAL,
      kmLFromMpgUs: kmLFromMpgUs, kmLFromMpgUk: kmLFromMpgUk, kmLFromL100km: kmLFromL100km,
      mpgUsFromKmL: mpgUsFromKmL, mpgUkFromKmL: mpgUkFromKmL, l100kmFromKmL: l100kmFromKmL
    };
    return;
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var mpgUsEl = $("fc-mpgus"), mpgUkEl = $("fc-mpguk"), l100kmEl = $("fc-l100km"), kmLEl = $("fc-kml");
  var eqEl = $("fc-eq"), copyEl = $("fc-copy"), noteEl = $("fc-note");
  var tbody = $("fc-tbody");
  if (!mpgUsEl || !mpgUkEl || !l100kmEl || !kmLEl || !eqEl || !noteEl || !tbody) return;

  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "fuel-economy-conv") + ":state";
  var TABLE_MPGUS = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80]; // 흔히 검색되는 US MPG 값 기준
  var state = "empty"; // "empty" | "error" | "ok"
  var lastKmL = null;

  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtNum(n, maxDec) {
    if (!isFinite(n)) return "—";
    try { return new Intl.NumberFormat(uiLang(), { maximumFractionDigits: maxDec }).format(n); }
    catch (e) { var p = Math.pow(10, maxDec); return String(Math.round(n * p) / p); }
  }
  // 입력창에 되쓸 순수 ASCII 숫자 문자열(로케일 자릿수 기호 없음 — number input 은 로케일 숫자를 못 받는다)
  function trimNumSafe(n) {
    if (!isFinite(n)) return "";
    var s = n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
    return s === "-0" ? "0" : s;
  }

  /* ---- 네 입력을 canonical km/L 기준으로 재렌더 (skipGroup 은 건드리지 않음 — 타이핑 커서 보호) ---- */
  function setFieldsFromKmL(kmL, skipGroup) {
    if (skipGroup !== "mpgus") mpgUsEl.value = trimNumSafe(mpgUsFromKmL(kmL));
    if (skipGroup !== "mpguk") mpgUkEl.value = trimNumSafe(mpgUkFromKmL(kmL));
    if (skipGroup !== "l100km") l100kmEl.value = trimNumSafe(l100kmFromKmL(kmL));
    if (skipGroup !== "kml") kmLEl.value = trimNumSafe(kmL);
  }

  function renderEq(kmL) {
    eqEl.textContent = fmtNum(mpgUsFromKmL(kmL), 1) + " MPG (US) = " +
      fmtNum(mpgUkFromKmL(kmL), 1) + " MPG (UK) = " +
      fmtNum(l100kmFromKmL(kmL), 2) + " L/100km = " +
      fmtNum(kmL, 2) + " km/L";
  }

  function highlightTable(kmL) {
    var rows = tbody.querySelectorAll("tr");
    for (var i = 0; i < rows.length; i++) {
      var v = Number(rows[i].getAttribute("data-kml"));
      rows[i].className = (kmL != null && Math.abs(kmL - v) < 0.005) ? "fc-active" : "";
    }
  }

  function persist(kmL) {
    try {
      if (kmL == null) localStorage.removeItem(LS_KEY);
      else localStorage.setItem(LS_KEY, JSON.stringify({ kmL: kmL }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }

  function showEmpty() {
    state = "empty"; lastKmL = null;
    eqEl.textContent = "—";
    if (copyEl) copyEl.hidden = true;
    noteEl.hidden = false;
    noteEl.textContent = tr("tool.result.placeholder", "Enter a fuel economy value in any field — every other unit updates instantly.");
    highlightTable(null);
  }

  function showError() {
    state = "error"; lastKmL = null;
    eqEl.textContent = "—";
    if (copyEl) copyEl.hidden = true;
    noteEl.hidden = false;
    noteEl.textContent = tr("tool.err.nonpositive", "Enter a value greater than 0. Fuel economy can't be zero or negative.");
    highlightTable(null);
  }

  function showOk(kmL, skipGroup) {
    var capped = false;
    if (kmL > MAX_KML) { kmL = MAX_KML; capped = true; }
    state = "ok"; lastKmL = kmL;
    setFieldsFromKmL(kmL, skipGroup);
    renderEq(kmL);
    if (copyEl) copyEl.hidden = false;
    if (capped) {
      noteEl.hidden = false;
      noteEl.textContent = tr("tool.note.capped", "Value capped at {x} km/L for display.").replace("{x}", fmtNum(MAX_KML, 0));
    } else {
      noteEl.hidden = true;
    }
    highlightTable(kmL);
    persist(kmL);
  }

  function resetAll() {
    mpgUsEl.value = ""; mpgUkEl.value = ""; l100kmEl.value = ""; kmLEl.value = "";
    showEmpty();
    persist(null);
  }

  /* ---- 필드별 입력 핸들러 (0 이하는 전부 오류 — L/100km=0 은 무한 km/L, km/L=0 은 무한 L/100km 라
     의미가 없으므로 애초에 차단한다) ---- */
  function onMpgUs() {
    var raw = mpgUsEl.value.trim();
    if (raw === "") { resetAll(); return; }
    var n = Number(raw);
    if (!isFinite(n)) { resetAll(); return; }
    if (n <= 0) { showError(); return; }
    showOk(kmLFromMpgUs(n), "mpgus");
  }
  function onMpgUk() {
    var raw = mpgUkEl.value.trim();
    if (raw === "") { resetAll(); return; }
    var n = Number(raw);
    if (!isFinite(n)) { resetAll(); return; }
    if (n <= 0) { showError(); return; }
    showOk(kmLFromMpgUk(n), "mpguk");
  }
  function onL100km() {
    var raw = l100kmEl.value.trim();
    if (raw === "") { resetAll(); return; }
    var n = Number(raw);
    if (!isFinite(n)) { resetAll(); return; }
    if (n <= 0) { showError(); return; }
    showOk(kmLFromL100km(n), "l100km");
  }
  function onKmL() {
    var raw = kmLEl.value.trim();
    if (raw === "") { resetAll(); return; }
    var n = Number(raw);
    if (!isFinite(n)) { resetAll(); return; }
    if (n <= 0) { showError(); return; }
    showOk(n, "kml");
  }

  /* ---- 빠른 참조 표 (흔한 US MPG 기준) ---- */
  function buildTable() {
    tbody.textContent = "";
    for (var i = 0; i < TABLE_MPGUS.length; i++) {
      var mpgUsVal = TABLE_MPGUS[i];
      var k = kmLFromMpgUs(mpgUsVal);
      var row = document.createElement("tr");
      row.setAttribute("data-kml", String(k));
      var td1 = document.createElement("td");
      td1.textContent = fmtNum(mpgUsVal, 0);
      var td2 = document.createElement("td");
      td2.textContent = fmtNum(mpgUkFromKmL(k), 1);
      var td3 = document.createElement("td");
      td3.className = "fc-val";
      td3.textContent = fmtNum(l100kmFromKmL(k), 2);
      var td4 = document.createElement("td");
      td4.className = "fc-val";
      td4.textContent = fmtNum(k, 2);
      row.appendChild(td1); row.appendChild(td2); row.appendChild(td3); row.appendChild(td4);
      row.addEventListener("click", function () { showOk(Number(this.getAttribute("data-kml")), null); });
      tbody.appendChild(row);
    }
    highlightTable(state === "ok" ? lastKmL : null);
  }

  /* ---- 클립보드 복사 ---- */
  function selectText(el) {
    try {
      var r = document.createRange();
      r.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (e) { /* 선택 미지원 — 무시 */ }
  }
  if (copyEl) {
    copyEl.addEventListener("click", function () {
      var text = eqEl.textContent;
      if (!text || text === "—") return;
      function done() {
        copyEl.textContent = tr("tool.copied", "Copied ✓");
        setTimeout(function () { copyEl.textContent = tr("tool.copy", "Copy"); }, 1200);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { selectText(eqEl); });
      } else {
        selectText(eqEl);
      }
    });
  }

  /* ---- 이벤트 배선 ---- */
  mpgUsEl.addEventListener("input", onMpgUs);
  mpgUkEl.addEventListener("input", onMpgUk);
  l100kmEl.addEventListener("input", onL100km);
  kmLEl.addEventListener("input", onKmL);
  function onEnter(e) { if (e.key === "Enter") this.blur(); }
  [mpgUsEl, mpgUkEl, l100kmEl, kmLEl].forEach(function (el) { el.addEventListener("keydown", onEnter); });

  // 언어 전환: 동적 문구·Intl 포맷 숫자를 새 로케일로 재렌더
  document.addEventListener("i18n:change", function () {
    if (state === "empty") showEmpty();
    else if (state === "error") showError();
    else if (state === "ok" && lastKmL != null) {
      renderEq(lastKmL);
      if (copyEl) copyEl.textContent = tr("tool.copy", "Copy");
    }
    buildTable();
  });

  /* ---- 초기화 · 복원 ---- */
  (function init() {
    var saved = null;
    try { var s = localStorage.getItem(LS_KEY); if (s) saved = JSON.parse(s); } catch (e) { saved = null; }
    buildTable();
    if (saved && typeof saved.kmL === "number" && isFinite(saved.kmL) && saved.kmL > 0) {
      showOk(saved.kmL, null);
    } else {
      showEmpty();
    }
  })();
  // TOOLJS:END
})();
