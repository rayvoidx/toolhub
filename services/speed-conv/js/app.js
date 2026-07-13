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
  var LS_KEY = (cfg.slug || "speed-conv") + ":units";

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상, 초속 m/s 기준 환산 계수)
  // Mach 는 해수면·15°C 표준음속 기준 참고값. km/h·mph·ft/s·knot 는 정의상 정확값.
  var FACTOR = {
    mps: 1,
    kmh: 0.2777777777777778,   // 1000 m / 3600 s
    mph: 0.44704,              // 1609.344 m / 3600 s
    fps: 0.3048,               // 1 ft / s
    knot: 0.5144444444444444,  // 1852 m / 3600 s (1 nautical mile/h)
    mach: 340.29               // sea level, 15°C reference
  };
  var UNITS = ["mps", "kmh", "mph", "fps", "knot", "mach"];

  // value(from 단위) → to 단위 : m/s 를 매개로 환산
  function convert(value, from, to) {
    return value * FACTOR[from] / FACTOR[to];
  }

  // 지수 표기 없는 십진 문자열 (유효숫자 반올림된 값 가정) — 후행 0 제거
  function plain(n) {
    if (n === 0) return "0";
    var neg = n < 0;
    var s = Math.abs(n).toExponential(); // 최소 자릿수 지수표기
    var p = s.split("e");
    var mant = p[0].replace(".", "");
    var exp = parseInt(p[1], 10);
    var pointPos = 1 + exp;
    var out;
    if (pointPos <= 0) {
      out = "0." + new Array(-pointPos + 1).join("0") + mant;
    } else if (pointPos >= mant.length) {
      out = mant + new Array(pointPos - mant.length + 1).join("0");
    } else {
      out = mant.slice(0, pointPos) + "." + mant.slice(pointPos);
    }
    if (out.indexOf(".") !== -1) out = out.replace(/0+$/, "").replace(/\.$/, "");
    return (neg ? "-" : "") + out;
  }

  // 표시 포맷: 유효숫자 10자리 → 후행 0 제거. 극단값은 지수 표기 폴백.
  function fmt(v) {
    if (!isFinite(v)) return null;
    if (v === 0) return "0";
    var a = Math.abs(v);
    var rounded = Number(v.toPrecision(10));
    if (a >= 1e15 || a < 1e-9) return rounded.toExponential();
    return plain(rounded);
  }
  // calc-core:end

  function $(id) { return document.getElementById(id); }
  var valEl = $("sc-value");
  var fromEl = $("sc-from");
  var toEl = $("sc-to");
  var swapEl = $("sc-swap");
  var eqEl = $("sc-eq");
  var copyEl = $("sc-copy");
  var noteEl = $("sc-note");
  if (!valEl || !fromEl || !toEl || !eqEl || !noteEl) return;

  var ABBR = { mps: "m/s", kmh: "km/h", mph: "mph", fps: "ft/s", knot: "kn", mach: "Mach" };

  function t(key, fb) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fb : v;
  }

  var state = { kind: "empty" }; // kind: empty | error | ok

  function saveUnits() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ from: fromEl.value, to: toEl.value }));
    } catch (e) { /* private mode — 저장 실패는 무시 */ }
  }

  function setActiveRows() {
    var f = fromEl.value, tt = toEl.value;
    for (var i = 0; i < UNITS.length; i++) {
      var r = document.querySelector('tr[data-unit="' + UNITS[i] + '"]');
      if (r) r.className = (UNITS[i] === f || UNITS[i] === tt) ? "sc-active" : "";
    }
  }

  function clearTable() {
    for (var i = 0; i < UNITS.length; i++) {
      var c = $("cell-" + UNITS[i]);
      if (c) c.textContent = "—";
    }
  }

  function showEmpty() {
    eqEl.textContent = "—";
    if (copyEl) copyEl.hidden = true;
    noteEl.hidden = false;
    noteEl.textContent = t("tool.result.placeholder", "Enter a number to see it in every speed unit.");
    clearTable();
  }

  function showError() {
    eqEl.textContent = "—";
    if (copyEl) copyEl.hidden = true;
    noteEl.hidden = false;
    noteEl.textContent = t("tool.err.negative", "Enter a value of 0 or more.");
    clearTable();
  }

  function render() {
    setActiveRows();
    var raw = valEl.value.trim();
    if (raw === "") { state = { kind: "empty" }; showEmpty(); return; }
    var num = Number(raw);
    if (isNaN(num) || !isFinite(num)) { state = { kind: "empty" }; showEmpty(); return; }
    if (num < 0) { state = { kind: "error" }; showError(); return; }

    // 정상 계산
    state = { kind: "ok" };
    var from = fromEl.value, to = toEl.value;
    eqEl.textContent = fmt(num) + " " + ABBR[from] + " = " + fmt(convert(num, from, to)) + " " + ABBR[to];
    if (copyEl) copyEl.hidden = false;
    noteEl.hidden = true;

    var mps = num * FACTOR[from]; // 입력값을 m/s 로 환산 후 전 단위 동시 표시
    for (var i = 0; i < UNITS.length; i++) {
      var u = UNITS[i];
      var c = $("cell-" + u);
      if (c) c.textContent = fmt(mps / FACTOR[u]);
    }
  }

  // 클립보드 실패 시 텍스트 선택 폴백
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
        copyEl.textContent = t("tool.copied", "Copied ✓");
        setTimeout(function () { copyEl.textContent = t("tool.copy", "Copy"); }, 1200);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { selectText(eqEl); });
      } else {
        selectText(eqEl);
      }
    });
  }

  valEl.addEventListener("input", render);
  fromEl.addEventListener("change", function () { saveUnits(); render(); });
  toEl.addEventListener("change", function () { saveUnits(); render(); });
  if (swapEl) {
    swapEl.addEventListener("click", function () {
      var f = fromEl.value;
      fromEl.value = toEl.value;
      toEl.value = f;
      saveUnits();
      render();
    });
  }

  // 언어 전환 시 동적 문구(안내·오류·복사 라벨) 재적용 — 단위명·정적 라벨은 엔진이 처리
  document.addEventListener("i18n:change", function () {
    if (state.kind === "empty") showEmpty();
    else if (state.kind === "error") showError();
    else if (state.kind === "ok" && copyEl) copyEl.textContent = t("tool.copy", "Copy");
  });

  // 단위 쌍만 복원 (입력값은 저장·복원하지 않음 — spec)
  (function restoreUnits() {
    try {
      var s = localStorage.getItem(LS_KEY);
      if (!s) return;
      var p = JSON.parse(s);
      if (p && FACTOR[p.from]) fromEl.value = p.from;
      if (p && FACTOR[p.to]) toEl.value = p.to;
    } catch (e) { /* 접근 불가·파싱 실패 — 기본 쌍(km/h→mph)으로 시작 */ }
  })();

  render();
  // TOOLJS:END
})();
