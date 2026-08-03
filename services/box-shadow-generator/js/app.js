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
  /* Box Shadow Generator — 슬라이더로 x/y offset·blur·spread·color+alpha·inset 를 조절해
     최대 4개의 레이어를 쌓고, 조정 가능한 배경의 미리보기 카드에 실시간 반영 + CSS 복사.
     프리셋 갤러리(soft/material/neumorphic/hard) 제공. 외부 API 없음, 전부 로컬 계산. */

  var cfg = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "box-shadow-generator";
  var SKEY = SLUG + ":state";
  var MAX_LAYERS = 6;
  var MIN_LAYERS = 1;

  function t(key, fallback) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null || v === key ? (fallback == null ? key : fallback) : v;
  }

  // ============================================================
  //  순수 계산 (DOM 비의존 — node 단위 검증 대상)
  // ============================================================
  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }

  function isHex(v) { return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v); }

  // #rrggbb → {r,g,b} (실패 시 null — 호출부가 안전한 기본값으로 대체)
  function hexToRgb(hex) {
    if (!isHex(hex)) return null;
    var n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  // 색상 + 불투명도(0~1) → CSS rgba() 문자열 (소수점 둘째 자리까지)
  function hexToRgba(hex, alpha) {
    var rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
    var a = Math.round(clamp(Number(alpha) || 0, 0, 1) * 100) / 100;
    return "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", " + a + ")";
  }

  // 레이어 1개 → box-shadow 값 조각 ("inset " 은 켜져 있을 때만)
  function buildShadowValue(l) {
    return (l.inset ? "inset " : "") + l.x + "px " + l.y + "px " + l.blur + "px " + l.spread + "px " + hexToRgba(l.color, l.alpha);
  }

  // 레이어 배열(입력 순서 유지 = 렌더 순서 = 위에 쌓이는 순서) → 완성된 CSS 선언
  function buildCss(layers) {
    var list = (layers || []).map(buildShadowValue);
    if (!list.length) return "box-shadow: none;";
    return "box-shadow: " + list.join(",\n            ") + ";";
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      clamp: clamp, isHex: isHex, hexToRgb: hexToRgb, hexToRgba: hexToRgba,
      buildShadowValue: buildShadowValue, buildCss: buildCss
    };
    return;
  }

  // ============================================================
  //  프리셋 (탐색용 — 값은 고정, 라벨은 i18n)
  // ============================================================
  var PRESETS = [
    { key: "soft", bg: "#ffffff", layers: [
      { x: 0, y: 2, blur: 8, spread: 0, color: "#0f172a", alpha: 0.08, inset: false },
      { x: 0, y: 1, blur: 2, spread: 0, color: "#0f172a", alpha: 0.06, inset: false }
    ] },
    { key: "material", bg: "#ffffff", layers: [
      { x: 0, y: 4, blur: 5, spread: -2, color: "#000000", alpha: 0.20, inset: false },
      { x: 0, y: 7, blur: 10, spread: 1, color: "#000000", alpha: 0.14, inset: false },
      { x: 0, y: 2, blur: 16, spread: 1, color: "#000000", alpha: 0.12, inset: false }
    ] },
    { key: "neumorphic", bg: "#e0e5ec", layers: [
      { x: 9, y: 9, blur: 16, spread: 0, color: "#a3b1c6", alpha: 0.55, inset: false },
      { x: -9, y: -9, blur: 16, spread: 0, color: "#ffffff", alpha: 0.90, inset: false }
    ] },
    { key: "hard", bg: "#fde68a", layers: [
      { x: 6, y: 6, blur: 0, spread: 0, color: "#000000", alpha: 1, inset: false }
    ] }
  ];

  // ============================================================
  //  DOM
  // ============================================================
  function $(id) { return document.getElementById(id); }
  var previewEl   = $("bx-preview");
  var bgEl        = $("bx-bg");
  var swatchesEl  = $("bx-swatches");
  var presetsEl   = $("bx-presets");
  var layersEl    = $("bx-layers");
  var addBtn      = $("bx-add");
  var maxHintEl   = $("bx-max-hint");
  var cssEl       = $("bx-css");
  var copyBtn     = $("bx-copy");
  var toastEl     = $("bx-toast");
  if (!previewEl || !layersEl || !cssEl) return;

  // ---- 단일 진실 원천 ----
  var idSeq = 0;
  function nextId() { idSeq += 1; return idSeq; }
  function freshLayer(overrides) {
    var base = { x: 0, y: 4, blur: 6, spread: -1, color: "#000000", alpha: 0.10, inset: false };
    var l = { id: nextId() };
    var k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) l[k] = base[k];
    if (overrides) for (k in overrides) if (Object.prototype.hasOwnProperty.call(overrides, k)) l[k] = overrides[k];
    return l;
  }
  var state = {
    bg: "#ffffff",
    layers: [freshLayer()]
  };

  // ---- 저장/복원 ----
  function persist() {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        bg: state.bg,
        layers: state.layers.map(function (l) {
          return { x: l.x, y: l.y, blur: l.blur, spread: l.spread, color: l.color, alpha: l.alpha, inset: !!l.inset };
        })
      }));
    } catch (e) { /* private mode — 저장만 실패, 편집은 계속 가능 */ }
  }
  function sanitizeLayers(raw) {
    if (!Array.isArray(raw)) return null;
    var out = [];
    for (var i = 0; i < raw.length && i < MAX_LAYERS; i++) {
      var s = raw[i];
      if (!s) continue;
      var x = clamp(Math.round(Number(s.x)) || 0, -50, 50);
      var y = clamp(Math.round(Number(s.y)) || 0, -50, 50);
      var blur = clamp(Math.round(Number(s.blur)) || 0, 0, 100);
      var spread = clamp(Math.round(Number(s.spread)) || 0, -50, 50);
      var color = isHex(s.color) ? s.color.toLowerCase() : "#000000";
      var alpha = Number(s.alpha);
      alpha = isFinite(alpha) ? clamp(Math.round(alpha * 100) / 100, 0, 1) : 0.1;
      out.push({ id: nextId(), x: x, y: y, blur: blur, spread: spread, color: color, alpha: alpha, inset: !!s.inset });
    }
    return out.length >= MIN_LAYERS ? out : null;
  }
  function restore() {
    var raw = null;
    try { raw = localStorage.getItem(SKEY); } catch (e) { return; }
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      if (isHex(parsed.bg)) state.bg = parsed.bg.toLowerCase();
      var layers = sanitizeLayers(parsed.layers);
      if (layers) state.layers = layers;
    } catch (e) { /* 손상된 저장값 — 기본값 유지 */ }
  }

  // ---- 클립보드 ----
  var toastTimer = null;
  function showToast(msg, isError) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = "bx-toast " + (isError ? "is-error" : "is-ok");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.textContent = ""; toastEl.className = "bx-toast"; }, 2200);
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
  function renderPreview() {
    previewEl.style.background = state.bg;
    previewEl.style.boxShadow = state.layers.length ? state.layers.map(buildShadowValue).join(", ") : "none";
  }
  function renderCss() {
    cssEl.value = buildCss(state.layers);
  }
  function syncSwatchActive() {
    if (!swatchesEl) return;
    var btns = swatchesEl.querySelectorAll(".bx-swatch");
    for (var i = 0; i < btns.length; i++) {
      var on = (btns[i].getAttribute("data-color") || "").toLowerCase() === state.bg.toLowerCase();
      btns[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function renderLayers() {
    layersEl.innerHTML = "";
    var frag = document.createDocumentFragment();
    for (var i = 0; i < state.layers.length; i++) {
      (function (layer, idx) {
        var n = idx + 1;
        var card = document.createElement("div");
        card.className = "bx-layer";
        card.setAttribute("data-id", String(layer.id));

        // 헤더: 레이어 번호 · inset 토글 · 삭제
        var head = document.createElement("div");
        head.className = "bx-layer-head";

        var title = document.createElement("span");
        title.className = "bx-layer-title";
        title.textContent = t("tool.layer.title", "Shadow {n}").replace("{n}", String(n));
        head.appendChild(title);

        var insetLabel = document.createElement("label");
        insetLabel.className = "bx-inset-toggle";
        var insetInput = document.createElement("input");
        insetInput.type = "checkbox";
        insetInput.className = "bx-inset";
        insetInput.checked = !!layer.inset;
        insetInput.setAttribute("aria-label", t("tool.layer.inset", "Inset") + " " + n);
        insetInput.addEventListener("change", function () {
          layer.inset = insetInput.checked;
          renderPreview(); renderCss(); persist();
        });
        var insetText = document.createElement("span");
        insetText.textContent = t("tool.layer.inset", "Inset");
        insetLabel.appendChild(insetInput);
        insetLabel.appendChild(insetText);
        head.appendChild(insetLabel);

        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "bx-layer-remove";
        removeBtn.textContent = "✕";
        removeBtn.setAttribute("aria-label", t("tool.layer.remove", "Remove this shadow layer") + " " + n);
        removeBtn.disabled = state.layers.length <= MIN_LAYERS;
        removeBtn.addEventListener("click", function () {
          if (state.layers.length <= MIN_LAYERS) return;
          state.layers = state.layers.filter(function (l) { return l.id !== layer.id; });
          renderAll(); persist();
        });
        head.appendChild(removeBtn);
        card.appendChild(head);

        // 슬라이더 행 생성 헬퍼 (x/y/blur/spread 공용)
        function sliderRow(field, min, max, labelKey, labelFallback, ariaKey, ariaFallback, unit) {
          var row = document.createElement("div");
          row.className = "bx-row";
          var lab = document.createElement("label");
          var labText = document.createElement("span");
          labText.textContent = t(labelKey, labelFallback) + (unit ? " (" + unit + ")" : "");
          // 정확한 값 입력용 숫자 필드 (슬라이더 범위를 벗어난 값은 min/max 로 클램프)
          var valText = document.createElement("input");
          valText.type = "number";
          valText.className = "bx-val bx-num";
          valText.min = String(min); valText.max = String(max); valText.step = "1";
          valText.value = String(layer[field]);
          valText.setAttribute("aria-label", t(ariaKey, ariaFallback).replace("{n}", String(n)));
          lab.appendChild(labText);
          lab.appendChild(valText);
          row.appendChild(lab);
          var input = document.createElement("input");
          input.type = "range";
          input.className = "bx-" + field;
          input.min = String(min); input.max = String(max); input.step = "1";
          input.value = String(layer[field]);
          input.setAttribute("aria-label", t(ariaKey, ariaFallback).replace("{n}", String(n)));
          input.addEventListener("input", function () {
            layer[field] = clamp(parseInt(input.value, 10) || 0, min, max);
            valText.value = String(layer[field]);
            renderPreview(); renderCss(); persist();
          });
          // 숫자 입력: 빈 값/비숫자는 상태를 바꾸지 않고, blur 시 마지막 유효값으로 되돌린다
          valText.addEventListener("input", function () {
            var v = parseInt(valText.value, 10);
            if (!isFinite(v)) return;
            layer[field] = clamp(v, min, max);
            input.value = String(layer[field]);
            renderPreview(); renderCss(); persist();
          });
          valText.addEventListener("change", function () {
            valText.value = String(layer[field]);
          });
          row.appendChild(input);
          return row;
        }

        card.appendChild(sliderRow("x", -50, 50, "tool.x.label", "Horizontal offset (X)", "tool.x.aria", "Horizontal offset for shadow {n}", "px"));
        card.appendChild(sliderRow("y", -50, 50, "tool.y.label", "Vertical offset (Y)", "tool.y.aria", "Vertical offset for shadow {n}", "px"));
        card.appendChild(sliderRow("blur", 0, 100, "tool.blur.label", "Blur radius", "tool.blur.aria", "Blur radius for shadow {n}", "px"));
        card.appendChild(sliderRow("spread", -50, 50, "tool.spread.label", "Spread radius", "tool.spread.aria", "Spread radius for shadow {n}", "px"));

        // 색상 + 불투명도 행
        var colorRow = document.createElement("div");
        colorRow.className = "bx-row bx-color-row";
        var colorLab = document.createElement("label");
        colorLab.textContent = t("tool.color.label", "Shadow color");
        colorRow.appendChild(colorLab);
        var colorControls = document.createElement("div");
        colorControls.className = "bx-color-controls";
        var colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.className = "bx-color";
        colorInput.value = layer.color;
        colorInput.setAttribute("aria-label", t("tool.color.aria", "Color for shadow {n}").replace("{n}", String(n)));
        colorInput.addEventListener("input", function () {
          layer.color = colorInput.value;
          renderPreview(); renderCss(); persist();
        });
        var alphaInput = document.createElement("input");
        alphaInput.type = "range";
        alphaInput.className = "bx-alpha";
        alphaInput.min = "0"; alphaInput.max = "100"; alphaInput.step = "1";
        alphaInput.value = String(Math.round(layer.alpha * 100));
        alphaInput.setAttribute("aria-label", t("tool.alpha.aria", "Opacity for shadow {n}").replace("{n}", String(n)));
        var alphaVal = document.createElement("span");
        alphaVal.className = "bx-val bx-alpha-val";
        alphaVal.textContent = Math.round(layer.alpha * 100) + "%";
        alphaInput.addEventListener("input", function () {
          layer.alpha = clamp(parseInt(alphaInput.value, 10) || 0, 0, 100) / 100;
          alphaVal.textContent = Math.round(layer.alpha * 100) + "%";
          renderPreview(); renderCss(); persist();
        });
        colorControls.appendChild(colorInput);
        colorControls.appendChild(alphaInput);
        colorControls.appendChild(alphaVal);
        colorRow.appendChild(colorControls);
        card.appendChild(colorRow);

        frag.appendChild(card);
      })(state.layers[i], i);
    }
    layersEl.appendChild(frag);
    addBtn.disabled = state.layers.length >= MAX_LAYERS;
    if (maxHintEl) maxHintEl.hidden = state.layers.length < MAX_LAYERS;
  }

  function renderPresets() {
    if (!presetsEl) return;
    presetsEl.innerHTML = "";
    var frag = document.createDocumentFragment();
    for (var i = 0; i < PRESETS.length; i++) {
      (function (preset) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bx-preset-btn";
        btn.style.background = preset.bg;
        btn.style.boxShadow = preset.layers.map(buildShadowValue).join(", ");
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
    renderPreview();
    renderCss();
    renderLayers();
    syncSwatchActive();
    if (bgEl) bgEl.value = state.bg;
  }

  // ---- 프리셋 적용 ----
  function applyPreset(preset) {
    state.bg = preset.bg;
    state.layers = preset.layers.map(function (l) {
      return freshLayer(l);
    });
    renderAll(); persist();
  }

  // ---- 레이어 추가: 기본값으로 새 레이어 하나 추가 ----
  function addLayer() {
    if (state.layers.length >= MAX_LAYERS) return;
    state.layers.push(freshLayer());
    renderAll(); persist();
  }

  // ============================================================
  //  이벤트
  // ============================================================
  if (bgEl) {
    bgEl.addEventListener("input", function () {
      state.bg = bgEl.value;
      renderPreview(); syncSwatchActive(); persist();
    });
  }
  if (swatchesEl) {
    swatchesEl.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest(".bx-swatch") : null;
      if (!btn) return;
      state.bg = btn.getAttribute("data-color");
      if (bgEl) bgEl.value = state.bg;
      renderPreview(); syncSwatchActive(); persist();
    });
  }

  addBtn.addEventListener("click", addLayer);

  copyBtn.addEventListener("click", function () {
    copyText(cssEl.value, function () {
      showToast(t("tool.copied", "Copied!"), false);
    }, function () {
      showToast(t("tool.copyError", "Copy failed — select the text and copy manually"), true);
      try { cssEl.focus(); cssEl.select(); } catch (e) { /* noop */ }
    });
  });

  // 언어 전환 → 동적으로 세팅된 라벨/aria-label/프리셋 이름 재적용
  document.addEventListener("i18n:change", function () { renderLayers(); renderPresets(); });

  // ============================================================
  //  초기화
  // ============================================================
  restore();
  renderAll();
  renderPresets();
  // TOOLJS:END
})();
