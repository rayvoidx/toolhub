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
  /* CSS Gradient Generator — 시각적 컬러 스톱 에디터로 linear/radial/conic
     그라디언트를 만들고 즉시 미리보고 CSS 를 복사한다. 외부 API 없음, 전부 로컬 계산. */

  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "gradient-generator";
  var SKEY = SLUG + ":state";
  var MAX_STOPS = 8;
  var MIN_STOPS = 2;

  function t(key, fallback) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null || v === key ? (fallback == null ? key : fallback) : v;
  }

  // ============================================================
  //  순수 계산 (DOM 비의존 — node 단위 검증 대상)
  // ============================================================
  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }

  // 스톱을 위치순으로 정렬한 사본 반환 (에디터의 입력 순서는 건드리지 않는다)
  function sortedStops(stops) {
    return stops.slice().sort(function (a, b) { return a.pos - b.pos; });
  }

  // 그라디언트 함수 문자열 생성 (linear/radial/conic 공통 진입점)
  function buildGradientFn(type, angle, shape, stops) {
    var list = sortedStops(stops).map(function (s) {
      return s.color + " " + Math.round(clamp(s.pos, 0, 100)) + "%";
    }).join(", ");
    if (type === "radial") return "radial-gradient(" + shape + ", " + list + ")";
    if (type === "conic") return "conic-gradient(from " + Math.round(clamp(angle, 0, 360)) + "deg, " + list + ")";
    return "linear-gradient(" + Math.round(clamp(angle, 0, 360)) + "deg, " + list + ")";
  }

  // 완성된 CSS 블록 (배경색 폴백 + background-image)
  function buildCss(type, angle, shape, stops) {
    var sorted = sortedStops(stops);
    var fallback = sorted.length ? sorted[0].color : "#000000";
    return "background-color: " + fallback + ";\nbackground-image: " + buildGradientFn(type, angle, shape, stops) + ";";
  }

  // HSL → HEX (랜덤/프리셋용 — 채도·명도를 고정해 보기 좋은 색만 나오게 함)
  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    function f(n) {
      var k = (n + h / 30) % 12;
      var a = s * Math.min(l, 1 - l);
      var c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
      return Math.round(c * 255);
    }
    function hex2(n) { var x = n.toString(16); return x.length === 1 ? "0" + x : x; }
    return "#" + hex2(f(0)) + hex2(f(8)) + hex2(f(4));
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      clamp: clamp, sortedStops: sortedStops, buildGradientFn: buildGradientFn,
      buildCss: buildCss, hslToHex: hslToHex
    };
    return;
  }

  // ============================================================
  //  프리셋 (탐색용 — 색은 고정, 라벨은 i18n)
  // ============================================================
  var PRESETS = [
    { key: "sunset",  type: "linear", angle: 135, shape: "circle", stops: [{ color: "#ff512f", pos: 0 }, { color: "#f09819", pos: 100 }] },
    { key: "ocean",   type: "linear", angle: 120, shape: "circle", stops: [{ color: "#2193b0", pos: 0 }, { color: "#6dd5ed", pos: 100 }] },
    { key: "purple",  type: "linear", angle: 135, shape: "circle", stops: [{ color: "#a21caf", pos: 0 }, { color: "#f472b6", pos: 100 }] },
    { key: "mint",    type: "linear", angle: 90,  shape: "circle", stops: [{ color: "#00b09b", pos: 0 }, { color: "#96c93d", pos: 100 }] },
    { key: "radial",  type: "radial", angle: 90,  shape: "circle", stops: [{ color: "#fceabb", pos: 0 }, { color: "#f8b500", pos: 100 }] },
    { key: "conic",   type: "conic",  angle: 0,   shape: "circle", stops: [
      { color: "#ff1493", pos: 0 }, { color: "#ff8c00", pos: 25 }, { color: "#ffd700", pos: 50 },
      { color: "#2e8b57", pos: 75 }, { color: "#1e90ff", pos: 100 }
    ] }
  ];

  // ============================================================
  //  DOM
  // ============================================================
  function $(id) { return document.getElementById(id); }
  var typeWrap   = $("gg-type");
  var angleField = $("gg-angle-field");
  var angleEl    = $("gg-angle");
  var angleValEl = $("gg-angle-val");
  var shapeField = $("gg-shape-field");
  var shapeEl    = $("gg-shape");
  var previewEl  = $("gg-preview");
  var stopsEl    = $("gg-stops");
  var addBtn     = $("gg-add");
  var maxHintEl  = $("gg-max-hint");
  var cssEl      = $("gg-css");
  var copyBtn    = $("gg-copy");
  var randomBtn  = $("gg-random");
  var presetsEl  = $("gg-presets");
  var toastEl    = $("gg-toast");
  if (!typeWrap || !stopsEl || !cssEl) return;

  // ---- 단일 진실 원천 ----
  var idSeq = 0;
  function nextId() { idSeq += 1; return idSeq; }
  var state = {
    type: "linear",   // linear | radial | conic
    angle: 90,
    shape: "circle",  // circle | ellipse (radial 전용)
    stops: [
      { id: nextId(), color: "#a21caf", pos: 0 },
      { id: nextId(), color: "#fb923c", pos: 100 }
    ]
  };

  // ---- 저장/복원 ----
  function persist() {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        type: state.type, angle: state.angle, shape: state.shape,
        stops: state.stops.map(function (s) { return { color: s.color, pos: s.pos }; })
      }));
    } catch (e) { /* private mode — 저장만 실패, 편집은 계속 가능 */ }
  }
  function isHex(v) { return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v); }
  function sanitizeStops(raw) {
    if (!Array.isArray(raw)) return null;
    var out = [];
    for (var i = 0; i < raw.length && i < MAX_STOPS; i++) {
      var s = raw[i];
      if (!s || !isHex(s.color)) continue;
      var pos = clamp(Math.round(Number(s.pos)), 0, 100);
      if (!isFinite(pos)) pos = 0;
      out.push({ id: nextId(), color: s.color.toLowerCase(), pos: pos });
    }
    return out.length >= MIN_STOPS ? out : null;
  }
  function restore() {
    var raw = null;
    try { raw = localStorage.getItem(SKEY); } catch (e) { return; }
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      if (parsed.type === "linear" || parsed.type === "radial" || parsed.type === "conic") state.type = parsed.type;
      if (parsed.shape === "circle" || parsed.shape === "ellipse") state.shape = parsed.shape;
      var angle = Math.round(Number(parsed.angle));
      if (isFinite(angle)) state.angle = clamp(angle, 0, 360);
      var stops = sanitizeStops(parsed.stops);
      if (stops) state.stops = stops;
    } catch (e) { /* 손상된 저장값 — 기본값 유지 */ }
  }

  // ---- 클립보드 ----
  var toastTimer = null;
  function showToast(msg, isError) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = "gg-toast " + (isError ? "is-error" : "is-ok");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.textContent = ""; toastEl.className = "gg-toast"; }, 2200);
  }
  function legacyCopy(text, onOk, onErr) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) onOk(); else onErr();
    } catch (e) { onErr(); }
  }
  function copyText(text, onOk, onErr) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onOk, function () { legacyCopy(text, onOk, onErr); });
    } else {
      legacyCopy(text, onOk, onErr);
    }
  }

  // ---- 렌더 ----
  function renderTypeButtons() {
    var btns = typeWrap.querySelectorAll(".gg-type-btn");
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute("data-type") === state.type;
      btns[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    angleField.hidden = state.type === "radial";
    shapeField.hidden = state.type !== "radial";
  }

  function renderPreview() {
    previewEl.style.backgroundImage = buildGradientFn(state.type, state.angle, state.shape, state.stops);
  }

  function renderCss() {
    cssEl.value = buildCss(state.type, state.angle, state.shape, state.stops);
  }

  function renderStops() {
    stopsEl.innerHTML = "";
    var frag = document.createDocumentFragment();
    for (var i = 0; i < state.stops.length; i++) {
      (function (stop, idx) {
        var row = document.createElement("div");
        row.className = "gg-stop";
        row.setAttribute("data-id", String(stop.id));

        var colorEl = document.createElement("input");
        colorEl.type = "color";
        colorEl.className = "gg-stop-color";
        colorEl.value = stop.color;
        colorEl.setAttribute("aria-label", t("tool.stop.colorAria", "Color for stop {n}").replace("{n}", String(idx + 1)));
        colorEl.addEventListener("input", function () {
          stop.color = colorEl.value;
          renderPreview(); renderCss(); persist();
        });

        var posEl = document.createElement("input");
        posEl.type = "range";
        posEl.className = "gg-stop-pos";
        posEl.min = "0"; posEl.max = "100"; posEl.step = "1"; posEl.value = String(stop.pos);
        posEl.setAttribute("aria-label", t("tool.stop.posAria", "Position for stop {n}").replace("{n}", String(idx + 1)));

        var posValEl = document.createElement("span");
        posValEl.className = "gg-stop-posval";
        posValEl.textContent = stop.pos + "%";
        posEl.addEventListener("input", function () {
          stop.pos = clamp(parseInt(posEl.value, 10) || 0, 0, 100);
          posValEl.textContent = stop.pos + "%";
          renderPreview(); renderCss(); persist();
        });

        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "gg-stop-remove";
        removeBtn.textContent = "✕";
        removeBtn.setAttribute("aria-label", t("tool.stop.remove", "Remove this color stop"));
        removeBtn.disabled = state.stops.length <= MIN_STOPS;
        removeBtn.addEventListener("click", function () {
          if (state.stops.length <= MIN_STOPS) return;
          state.stops = state.stops.filter(function (s) { return s.id !== stop.id; });
          renderAll(); persist();
        });

        row.appendChild(colorEl);
        row.appendChild(posEl);
        row.appendChild(posValEl);
        row.appendChild(removeBtn);
        frag.appendChild(row);
      })(state.stops[i], i);
    }
    stopsEl.appendChild(frag);
    addBtn.disabled = state.stops.length >= MAX_STOPS;
    if (maxHintEl) maxHintEl.hidden = state.stops.length < MAX_STOPS;
  }

  function renderPresets() {
    presetsEl.innerHTML = "";
    var frag = document.createDocumentFragment();
    for (var i = 0; i < PRESETS.length; i++) {
      (function (preset) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "gg-preset-btn";
        btn.style.backgroundImage = buildGradientFn(preset.type, preset.angle, preset.shape, preset.stops);
        var label = t("tool.preset." + preset.key, preset.key);
        btn.title = label;
        btn.setAttribute("aria-label", label);
        btn.addEventListener("click", function () { applyPreset(preset); });
        frag.appendChild(btn);
      })(PRESETS[i]);
    }
    presetsEl.appendChild(frag);
  }

  function renderAll() {
    renderTypeButtons();
    renderPreview();
    renderCss();
    renderStops();
  }

  // ---- 프리셋/랜덤 적용 ----
  function applyPreset(preset) {
    state.type = preset.type;
    state.angle = preset.angle;
    state.shape = preset.shape;
    state.stops = preset.stops.map(function (s) { return { id: nextId(), color: s.color, pos: s.pos }; });
    if (angleEl) angleEl.value = String(state.angle);
    if (angleValEl) angleValEl.textContent = state.angle + "°";
    if (shapeEl) shapeEl.value = state.shape;
    renderAll(); persist();
  }

  function randomGradient() {
    var types = ["linear", "linear", "linear", "radial", "conic"]; // linear 가중치를 높게
    var type = types[Math.floor(Math.random() * types.length)];
    var count = 2 + Math.floor(Math.random() * 4); // 2~5 (랜덤은 읽기 좋은 범위 유지)
    var baseHue = Math.floor(Math.random() * 360);
    var spreadHue = 40 + Math.floor(Math.random() * 180); // 유사색~보색까지 폭넓게
    var stops = [];
    for (var i = 0; i < count; i++) {
      var pos = count === 1 ? 0 : Math.round((100 * i) / (count - 1));
      var hue = baseHue + (spreadHue * i) / Math.max(1, count - 1);
      stops.push({ id: nextId(), color: hslToHex(hue, 65 + Math.random() * 20, 45 + Math.random() * 15), pos: pos });
    }
    state.type = type;
    state.angle = Math.floor(Math.random() * 360);
    state.shape = Math.random() < 0.5 ? "circle" : "ellipse";
    state.stops = stops;
    if (angleEl) angleEl.value = String(state.angle);
    if (angleValEl) angleValEl.textContent = state.angle + "°";
    if (shapeEl) shapeEl.value = state.shape;
    renderAll(); persist();
  }

  // ---- 새 스톱 추가: 가장 큰 빈틈의 중앙에, 색은 이웃의 혼합 ----
  function mixHex(a, b) {
    function toRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
    function hex2(n) { var x = Math.round(n).toString(16); return x.length === 1 ? "0" + x : x; }
    var ra = toRgb(a), rb = toRgb(b);
    return "#" + hex2((ra[0] + rb[0]) / 2) + hex2((ra[1] + rb[1]) / 2) + hex2((ra[2] + rb[2]) / 2);
  }
  function addStop() {
    if (state.stops.length >= MAX_STOPS) return;
    var sorted = sortedStops(state.stops);
    var bestGap = -1, bestIdx = 0;
    for (var i = 0; i < sorted.length - 1; i++) {
      var gap = sorted[i + 1].pos - sorted[i].pos;
      if (gap > bestGap) { bestGap = gap; bestIdx = i; }
    }
    var left = sorted[bestIdx], right = sorted[bestIdx + 1] || sorted[bestIdx];
    var pos = Math.round((left.pos + right.pos) / 2);
    var color = mixHex(left.color, right.color);
    state.stops.push({ id: nextId(), color: color, pos: pos });
    renderAll(); persist();
  }

  // ============================================================
  //  이벤트
  // ============================================================
  typeWrap.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest(".gg-type-btn") : null;
    if (!btn) return;
    state.type = btn.getAttribute("data-type");
    renderAll(); persist();
  });

  if (angleEl) {
    angleEl.addEventListener("input", function () {
      state.angle = clamp(parseInt(angleEl.value, 10) || 0, 0, 360);
      if (angleValEl) angleValEl.textContent = state.angle + "°";
      renderPreview(); renderCss(); persist();
    });
  }

  if (shapeEl) {
    shapeEl.addEventListener("change", function () {
      state.shape = shapeEl.value === "ellipse" ? "ellipse" : "circle";
      renderPreview(); renderCss(); persist();
    });
  }

  addBtn.addEventListener("click", addStop);

  copyBtn.addEventListener("click", function () {
    copyText(cssEl.value, function () {
      showToast(t("tool.copied", "Copied!"), false);
    }, function () {
      showToast(t("tool.copyError", "Copy failed — select the text and copy manually"), true);
      try { cssEl.focus(); cssEl.select(); } catch (e) { /* noop */ }
    });
  });

  randomBtn.addEventListener("click", randomGradient);

  // 언어 전환 → 동적으로 세팅된 aria-label/프리셋 이름 재적용
  document.addEventListener("i18n:change", function () { renderAll(); renderPresets(); });

  // ============================================================
  //  초기화
  // ============================================================
  restore();
  if (angleEl) angleEl.value = String(state.angle);
  if (angleValEl) angleValEl.textContent = state.angle + "°";
  if (shapeEl) shapeEl.value = state.shape;
  renderAll();
  renderPresets();
  // TOOLJS:END
})();
