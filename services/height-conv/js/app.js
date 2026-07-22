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
  /* Height Converter — cm ⇄ feet+inches ⇄ meters ⇄ inches-only, all live-synced.
     5개 입력(cm, m, ft, in, inches-only) 중 하나를 고치면 나머지 전부 즉시 재계산된다.
     ft 필드는 5'11" 같은 합성 표기 붙여넣기도 파싱한다. 상태: localStorage "<slug>:state" 만.
     외부 API 없음, 모든 계산은 로컬. */

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상, Math 외 의존 없음)
  var CM_PER_IN = 2.54;
  var IN_PER_FT = 12;
  var MAX_CM = 100000; // 1,000 m — 극단값 캡(사람 키를 훌쩍 넘는 값도 UI가 깨지지 않게)

  function totalInFromCm(cm) { return cm / CM_PER_IN; }
  function cmFromTotalIn(ti) { return ti * CM_PER_IN; }
  function ftInToTotalIn(ft, inch) { return ft * IN_PER_FT + inch; }

  // 총 인치 → {ft, in} : 소수 첫째 자리까지, 반올림으로 인치가 12가 되면 피트로 올림(캐리)
  function splitFtIn(totalIn) {
    if (!(totalIn >= 0)) totalIn = 0;
    var ft = Math.floor(totalIn / IN_PER_FT + 1e-9);
    var inch = Math.round((totalIn - ft * IN_PER_FT) * 10) / 10;
    if (inch >= IN_PER_FT) { ft += 1; inch = 0; }
    if (inch < 0) inch = 0; // 부동소수 잡음 가드
    return { ft: ft, in: inch };
  }

  // "Feet" 입력창 파싱: 5'11" / 5' 11" / 5ft 11in / 5 ft 11 in 같은 합성 표기를 감지.
  // 매치 시 {ft, in} 둘 다 반환(합성으로 취급) — 매치 안 되면 순수 숫자로 보고 in:null(별도 in 필드값 사용).
  function parseFeetField(raw) {
    if (raw == null) return { ft: null, in: null };
    var s = String(raw).trim();
    if (s === "") return { ft: null, in: null };
    var m = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft\.?|feet)\s*(-?\d+(?:\.\d+)?)?\s*(?:"|''|in\.?|inch(?:es)?)?\s*$/i);
    if (m) {
      var ft = parseFloat(m[1]);
      var inch = m[2] != null ? parseFloat(m[2]) : 0;
      return { ft: isFinite(ft) ? ft : null, in: isFinite(inch) ? inch : 0 };
    }
    var n = parseFloat(s.replace(/,/g, ""));
    return { ft: isFinite(n) ? n : null, in: null };
  }
  // calc-core:end

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      CM_PER_IN: CM_PER_IN, IN_PER_FT: IN_PER_FT,
      totalInFromCm: totalInFromCm, cmFromTotalIn: cmFromTotalIn,
      ftInToTotalIn: ftInToTotalIn, splitFtIn: splitFtIn, parseFeetField: parseFeetField
    };
    return;
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var cmEl = $("hc-cm"), mEl = $("hc-m"), ftEl = $("hc-ft"), inEl = $("hc-in"), inOnlyEl = $("hc-inonly");
  var eqEl = $("hc-eq"), copyEl = $("hc-copy"), noteEl = $("hc-note");
  var tbody = $("hc-tbody");
  if (!cmEl || !mEl || !ftEl || !inEl || !inOnlyEl || !eqEl || !noteEl || !tbody) return;

  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "height-conv") + ":state";
  var TABLE_CM = [150, 155, 160, 165, 170, 175, 180, 185, 190, 195, 200];
  var state = "empty"; // "empty" | "error" | "ok"
  var lastCm = null;

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
    var s = n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return s === "-0" ? "0" : s;
  }

  /* ---- 다섯 입력을 canonical cm 기준으로 재렌더 (skipGroup 은 건드리지 않음 — 타이핑 커서 보호) ---- */
  function setFieldsFromCm(cm, skipGroup) {
    var ti = totalInFromCm(cm);
    var r = splitFtIn(ti);
    if (skipGroup !== "cm") cmEl.value = trimNumSafe(cm);
    if (skipGroup !== "m") mEl.value = trimNumSafe(cm / 100);
    if (skipGroup !== "ftin") { ftEl.value = trimNumSafe(r.ft); inEl.value = trimNumSafe(r.in); }
    if (skipGroup !== "inonly") inOnlyEl.value = trimNumSafe(ti);
  }

  function renderEq(cm) {
    var ti = totalInFromCm(cm);
    var r = splitFtIn(ti);
    eqEl.textContent = fmtNum(cm, 2) + " cm = " + fmtNum(r.ft, 0) + "' " + fmtNum(r.in, 1) + '" = ' +
      fmtNum(cm / 100, 2) + " m = " + fmtNum(ti, 2) + " in";
  }

  function highlightTable(cm) {
    var rows = tbody.querySelectorAll("tr");
    for (var i = 0; i < rows.length; i++) {
      var v = Number(rows[i].getAttribute("data-cm"));
      rows[i].className = (cm != null && Math.round(cm) === v) ? "hc-active" : "";
    }
  }

  function persist(cm) {
    try {
      if (cm == null) localStorage.removeItem(LS_KEY);
      else localStorage.setItem(LS_KEY, JSON.stringify({ cm: cm }));
    } catch (e) { /* private mode — 저장 실패 무시 */ }
  }

  function showEmpty() {
    state = "empty"; lastCm = null;
    eqEl.textContent = "—";
    if (copyEl) copyEl.hidden = true;
    noteEl.hidden = false;
    noteEl.textContent = tr("tool.result.placeholder", "Enter a height in any field — every other field updates instantly.");
    highlightTable(null);
  }

  function showError() {
    state = "error"; lastCm = null;
    eqEl.textContent = "—";
    if (copyEl) copyEl.hidden = true;
    noteEl.hidden = false;
    noteEl.textContent = tr("tool.err.negative", "Enter a value of 0 or more.");
    highlightTable(null);
  }

  function showOk(cm, skipGroup) {
    var capped = false;
    if (cm > MAX_CM) { cm = MAX_CM; capped = true; }
    state = "ok"; lastCm = cm;
    setFieldsFromCm(cm, skipGroup);
    renderEq(cm);
    if (copyEl) copyEl.hidden = false;
    if (capped) {
      noteEl.hidden = false;
      noteEl.textContent = tr("tool.note.capped", "Value capped at 1,000 m for display.");
    } else {
      noteEl.hidden = true;
    }
    highlightTable(cm);
    persist(cm);
  }

  function resetAll() {
    cmEl.value = ""; mEl.value = ""; ftEl.value = ""; inEl.value = ""; inOnlyEl.value = "";
    showEmpty();
    persist(null);
  }

  /* ---- 필드별 입력 핸들러 ---- */
  function onCm() {
    var raw = cmEl.value.trim();
    if (raw === "") { resetAll(); return; }
    var n = Number(raw);
    if (!isFinite(n)) { resetAll(); return; }
    if (n < 0) { showError(); return; }
    showOk(n, "cm");
  }
  function onM() {
    var raw = mEl.value.trim();
    if (raw === "") { resetAll(); return; }
    var n = Number(raw);
    if (!isFinite(n)) { resetAll(); return; }
    if (n < 0) { showError(); return; }
    showOk(n * 100, "m");
  }
  function onInOnly() {
    var raw = inOnlyEl.value.trim();
    if (raw === "") { resetAll(); return; }
    var n = Number(raw);
    if (!isFinite(n)) { resetAll(); return; }
    if (n < 0) { showError(); return; }
    showOk(cmFromTotalIn(n), "inonly");
  }
  // ft 필드: 합성 표기(5'11") 감지 시 ft·in 둘 다 canonical 로 정리해 다시 쓴다(구두점 정리).
  // 순수 숫자(예: "6")면 in 필드는 건드리지 않고 그대로의 값을 합산에 사용한다.
  function onFt() {
    var raw = ftEl.value;
    if (raw.trim() === "") {
      if (inEl.value.trim() === "") { resetAll(); return; }
      var inchOnly = Number(inEl.value.trim());
      if (!isFinite(inchOnly)) inchOnly = 0;
      if (inchOnly < 0) { showError(); return; }
      showOk(cmFromTotalIn(ftInToTotalIn(0, inchOnly)), "ftin");
      return;
    }
    var parsed = parseFeetField(raw);
    if (parsed.ft == null) { resetAll(); return; }
    var ft = parsed.ft;
    if (parsed.in != null) { // 합성 표기 — 전량 재작성(파싱된 순수 숫자로 정리)
      if (ft < 0 || parsed.in < 0) { showError(); return; }
      showOk(cmFromTotalIn(ftInToTotalIn(ft, parsed.in)), null);
      return;
    }
    var rawIn = inEl.value.trim();
    var inch = rawIn === "" ? 0 : Number(rawIn);
    if (!isFinite(inch)) inch = 0;
    if (ft < 0 || inch < 0) { showError(); return; }
    showOk(cmFromTotalIn(ftInToTotalIn(ft, inch)), "ftin");
  }
  function onIn() {
    var ftRaw = ftEl.value.trim();
    var inRaw = inEl.value.trim();
    if (ftRaw === "" && inRaw === "") { resetAll(); return; }
    var parsedFt = parseFeetField(ftRaw);
    var ft = parsedFt.ft == null ? 0 : parsedFt.ft;
    var inch = inRaw === "" ? 0 : Number(inRaw);
    if (!isFinite(inch)) inch = 0;
    if (ft < 0 || inch < 0) { showError(); return; }
    showOk(cmFromTotalIn(ftInToTotalIn(ft, inch)), "ftin");
  }
  // blur 시 ft/in 쌍을 canonical 값으로 최종 정리(구두점·이월 인치를 자연스러운 형태로)
  function normalizeFtIn() {
    if (lastCm == null) return;
    var r = splitFtIn(totalInFromCm(lastCm));
    ftEl.value = trimNumSafe(r.ft);
    inEl.value = trimNumSafe(r.in);
  }

  /* ---- 빠른 참조 표 (150–200cm, 5cm 간격) ---- */
  function buildTable() {
    tbody.textContent = "";
    for (var i = 0; i < TABLE_CM.length; i++) {
      var cmVal = TABLE_CM[i];
      var ti = totalInFromCm(cmVal);
      var r = splitFtIn(ti);
      var row = document.createElement("tr");
      row.setAttribute("data-cm", String(cmVal));
      var td1 = document.createElement("td");
      td1.textContent = fmtNum(cmVal, 0) + " cm";
      var td2 = document.createElement("td");
      td2.textContent = fmtNum(r.ft, 0) + "' " + fmtNum(r.in, 1) + '"';
      var td3 = document.createElement("td");
      td3.className = "hc-val";
      td3.textContent = fmtNum(ti, 2) + " in";
      row.appendChild(td1); row.appendChild(td2); row.appendChild(td3);
      row.addEventListener("click", function () { showOk(Number(this.getAttribute("data-cm")), null); });
      tbody.appendChild(row);
    }
    highlightTable(state === "ok" ? lastCm : null);
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
  cmEl.addEventListener("input", onCm);
  mEl.addEventListener("input", onM);
  inOnlyEl.addEventListener("input", onInOnly);
  ftEl.addEventListener("input", onFt);
  inEl.addEventListener("input", onIn);
  ftEl.addEventListener("blur", normalizeFtIn);
  inEl.addEventListener("blur", normalizeFtIn);
  function onEnter(e) { if (e.key === "Enter") this.blur(); }
  [cmEl, mEl, ftEl, inEl, inOnlyEl].forEach(function (el) { el.addEventListener("keydown", onEnter); });

  // 언어 전환: 동적 문구·Intl 포맷 숫자를 새 로케일로 재렌더
  document.addEventListener("i18n:change", function () {
    if (state === "empty") showEmpty();
    else if (state === "error") showError();
    else if (state === "ok" && lastCm != null) {
      renderEq(lastCm);
      if (copyEl) copyEl.textContent = tr("tool.copy", "Copy");
    }
    buildTable();
  });

  /* ---- 초기화 · 복원 ---- */
  (function init() {
    var saved = null;
    try { var s = localStorage.getItem(LS_KEY); if (s) saved = JSON.parse(s); } catch (e) { saved = null; }
    buildTable();
    if (saved && typeof saved.cm === "number" && isFinite(saved.cm) && saved.cm >= 0) {
      showOk(saved.cm, null);
    } else {
      showEmpty();
    }
  })();
  // TOOLJS:END
})();
