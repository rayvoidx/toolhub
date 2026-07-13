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
  function $(id) { return document.getElementById(id); }
  var inputs = { c: $("c-input"), f: $("f-input"), k: $("k-input") };
  var placeholderEl = $("tc-placeholder");
  var summaryEl = $("tc-summary");
  var warnEl = $("tc-warn");
  var copyMsgEl = $("tc-copymsg");
  if (!inputs.c || !inputs.f || !inputs.k || !summaryEl || !warnEl) return;

  var UNITS = ["c", "f", "k"];
  var MAXLEN = 15;                 // 극단값: 입력 15자리 제한
  var last = { kind: "empty" };   // 마지막 렌더 상태 (언어 전환 재렌더용 — 영속 상태 아님)
  var copyTimer = null;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상)
  function toCelsius(unit, v) {
    if (unit === "f") return (v - 32) * 5 / 9;
    if (unit === "k") return v - 273.15;
    return v; // c
  }
  function fromCelsius(c) {
    return { c: c, f: c * 9 / 5 + 32, k: c + 273.15 };
  }
  function belowAbsoluteZero(unit, v) {
    if (unit === "f") return v < -459.67;
    if (unit === "k") return v < 0;
    return v < -273.15; // c
  }
  function fmt(n) {
    if (n == null || !isFinite(n)) return "";
    var s = (Math.round(n * 100) / 100).toFixed(2); // 소수 2자리 반올림
    s = s.replace(/0+$/, "").replace(/\.$/, "");    // 정수로 떨어지면 정수 표시
    if (s === "-0") s = "0";
    return s;
  }
  // calc-core:end

  function renderResult() {
    var s = last || { kind: "empty" };
    if (s.kind === "empty") {
      if (placeholderEl) placeholderEl.hidden = false;
      summaryEl.hidden = true;
      warnEl.hidden = true;
      return;
    }
    if (placeholderEl) placeholderEl.hidden = true;
    if (s.kind === "bad") {
      summaryEl.hidden = true;
      warnEl.hidden = false;
      warnEl.textContent = t("tool.warn.badinput", "Please enter a valid number.");
      return;
    }
    // kind === "ok" — 값 표시 (절대영도 미만이어도 값은 보여주고 경고만 덧붙임)
    summaryEl.hidden = false;
    summaryEl.textContent = t("tool.result.summary", "{c} °C  =  {f} °F  =  {k} K")
      .replace("{c}", fmt(s.c)).replace("{f}", fmt(s.f)).replace("{k}", fmt(s.k));
    if (s.below) {
      warnEl.hidden = false;
      warnEl.textContent = t("tool.warn.abszero",
        "Below absolute zero (−273.15 °C / −459.67 °F / 0 K) — colder than physically possible.");
    } else {
      warnEl.hidden = true;
    }
  }

  function clearAll() {
    for (var i = 0; i < UNITS.length; i++) inputs[UNITS[i]].value = "";
    last = { kind: "empty" };
    renderResult();
  }

  function convertFrom(unit) {
    var el = inputs[unit];
    if (el.value.length > MAXLEN) el.value = el.value.slice(0, MAXLEN); // 초과 자릿수 무시

    // 숫자 아님(badInput) → 계산하지 않고 경고 (조용한 실패 금지)
    if (el.validity && el.validity.badInput) {
      last = { kind: "bad" };
      renderResult();
      return;
    }
    var raw = el.value.trim();
    if (raw === "") { clearAll(); return; }   // 빈 입력 → 나머지도 비움 (0 표시 금지)

    var v = Number(raw);
    if (!isFinite(v)) { last = { kind: "bad" }; renderResult(); return; }

    var all = fromCelsius(toCelsius(unit, v));
    for (var i = 0; i < UNITS.length; i++) {
      var u = UNITS[i];
      if (u !== unit) inputs[u].value = fmt(all[u]); // 편집 중 필드는 덮어쓰지 않음
    }
    last = { kind: "ok", c: all.c, f: all.f, k: all.k, below: belowAbsoluteZero(unit, v) };
    renderResult();
  }

  function showCopyMsg(key, fallback) {
    if (!copyMsgEl) return;
    copyMsgEl.textContent = t(key, fallback);
    copyMsgEl.hidden = false;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(function () { copyMsgEl.hidden = true; }, 1600);
  }

  function copyValue(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var v = el.value.trim();
    if (v === "") { showCopyMsg("tool.copy.empty", "Nothing to copy yet — type a temperature first."); return; }
    var done = function () { showCopyMsg("tool.copy.done", "Copied to clipboard"); };
    var fail = function () { showCopyMsg("tool.copy.fail", "Couldn't copy. Please select and copy manually."); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(v).then(done, fail);
      } else {
        var ta = document.createElement("textarea");
        ta.value = v; ta.setAttribute("readonly", "");
        ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) { done(); } else { fail(); }
      }
    } catch (e) { fail(); }
  }

  // 어느 필드든 입력 즉시 나머지 2개 동기화 (마지막 입력 필드 기준)
  for (var iu = 0; iu < UNITS.length; iu++) {
    (function (u) {
      inputs[u].addEventListener("input", function () { convertFrom(u); });
    })(UNITS[iu]);
  }

  // 빠른 버튼 — 클릭 즉시 전체 변환
  var presets = document.querySelectorAll(".tc-preset");
  for (var p = 0; p < presets.length; p++) {
    presets[p].addEventListener("click", function () {
      var unit = this.getAttribute("data-unit");
      var val = this.getAttribute("data-val");
      if (!inputs[unit]) return;
      inputs[unit].value = val;
      convertFrom(unit);
      inputs[unit].focus();
    });
  }

  // 필드별 복사 버튼
  var copyBtns = document.querySelectorAll(".tc-copy");
  for (var q = 0; q < copyBtns.length; q++) {
    copyBtns[q].addEventListener("click", function () {
      copyValue(this.getAttribute("data-target"));
    });
  }

  // 언어 전환 시 동적 문구(요약·경고)만 재렌더 — 입력값은 유지
  document.addEventListener("i18n:change", function () { renderResult(); });

  renderResult(); // 초기: 안내 문구 노출
  // TOOLJS:END
})();
