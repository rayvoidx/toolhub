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
  /* Color Contrast Checker — 전경(텍스트)·배경 두 색을 hex/rgb로 입력받아 WCAG 2.1
     상대휘도 공식으로 명암비를 계산, AA/AAA × 일반/큰글씨 4개 기준 pass/fail 배지 +
     실시간 텍스트 미리보기 + (AA 일반 미달 시) 텍스트 색 밝게/어둡게 조정한 최단 통과안 제시.
     외부 API 없음, 모든 계산은 로컬. 상태: localStorage "<slug>:state" 만. */

  var DEFAULT_FG = "#777777";
  var DEFAULT_BG = "#ffffff";

  /* ---- 색 파싱 (node 단위 검증 대상) ---- */
  // "#abc" / "abc" / "#aabbcc" / "aabbcc" / "rgb(r,g,b)" / "rgba(r,g,b,a)" 를 {r,g,b} 로.
  // 알파는 무시(불투명 가정 — 대비 계산은 배경 위 최종 렌더 색을 전제로 한다). 실패 시 null.
  function parseColor(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s) return null;
    var m = s.match(/^#?([0-9a-fA-F]{3})$/);
    if (m) {
      var h3 = m[1];
      return {
        r: parseInt(h3[0] + h3[0], 16),
        g: parseInt(h3[1] + h3[1], 16),
        b: parseInt(h3[2] + h3[2], 16)
      };
    }
    m = s.match(/^#?([0-9a-fA-F]{6})$/);
    if (m) {
      var h6 = m[1];
      return {
        r: parseInt(h6.slice(0, 2), 16),
        g: parseInt(h6.slice(2, 4), 16),
        b: parseInt(h6.slice(4, 6), 16)
      };
    }
    m = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i);
    if (m) {
      var r = clamp255(parseInt(m[1], 10)), g = clamp255(parseInt(m[2], 10)), b = clamp255(parseInt(m[3], 10));
      return { r: r, g: g, b: b };
    }
    return null;
  }
  function clamp255(n) {
    if (!isFinite(n)) return 0;
    return n < 0 ? 0 : (n > 255 ? 255 : n);
  }
  function toHex(rgb) {
    function h2(n) { var s = clamp255(Math.round(n)).toString(16); return s.length < 2 ? "0" + s : s; }
    return "#" + h2(rgb.r) + h2(rgb.g) + h2(rgb.b);
  }
  function sameColor(a, b) { return a.r === b.r && a.g === b.g && a.b === b.b; }

  /* ---- WCAG 2.1 상대휘도 · 명암비 (순수 계산, node 단위 검증 대상) ---- */
  function srgbToLinear(c) {
    var v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function relLuminance(rgb) {
    return 0.2126 * srgbToLinear(rgb.r) + 0.7152 * srgbToLinear(rgb.g) + 0.0722 * srgbToLinear(rgb.b);
  }
  function contrastRatio(rgbA, rgbB) {
    var lA = relLuminance(rgbA), lB = relLuminance(rgbB);
    var lighter = Math.max(lA, lB), darker = Math.min(lA, lB);
    return (lighter + 0.05) / (darker + 0.05);
  }

  var LEVELS = [
    { key: "aaNormal", min: 4.5 },
    { key: "aaaNormal", min: 7 },
    { key: "aaLarge", min: 3 },
    { key: "aaaLarge", min: 4.5 }
  ];
  var SUGGEST_TARGET = 4.5; // AA·일반 텍스트 기준으로 제안

  /* ---- HSL 변환 (제안 탐색용) ---- */
  function rgbToHsl(rgb) {
    var r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    var d = max - min;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      switch (max) {
        case r: h = 60 * (((g - b) / d) % 6); break;
        case g: h = 60 * ((b - r) / d + 2); break;
        default: h = 60 * ((r - g) / d + 4);
      }
      if (h < 0) h += 360;
    }
    return { h: h, s: s * 100, l: l * 100 };
  }
  function hslToRgb(hsl) {
    var h = ((hsl.h % 360) + 360) % 360, s = hsl.s / 100, l = hsl.l / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var r1 = 0, g1 = 0, b1 = 0;
    if (h < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }
    return {
      r: clamp255(Math.round((r1 + m) * 255)),
      g: clamp255(Math.round((g1 + m) * 255)),
      b: clamp255(Math.round((b1 + m) * 255))
    };
  }

  // 고정된 배경(bgRgb) 대비, fgRgb 의 명도(L)를 dir 방향(+1=밝게/-1=어둡게)으로 1%씩
  // 옮기며 target 명암비를 처음 만족하는 지점을 찾는다. 흑/백 극단에서 항상 한쪽은
  // 통과가 보장된다(증명: 배경 휘도 L_bg 에 대해 흰 글자 대비 = 1.05/(L_bg+0.05),
  // 검은 글자 대비 = (L_bg+0.05)/0.05 — 둘 중 하나는 항상 4.5 이상).
  function searchNearest(fgRgb, bgRgb, target, dir) {
    var hsl = rgbToHsl(fgRgb);
    for (var i = 1; i <= 100; i++) {
      var candL = dir > 0 ? Math.min(100, hsl.l + i) : Math.max(0, hsl.l - i);
      var cand = hslToRgb({ h: hsl.h, s: hsl.s, l: candL });
      var ratio = contrastRatio(cand, bgRgb);
      if (ratio >= target) {
        if (sameColor(cand, fgRgb)) return null; // 이미 그 색 — 실질적 대안 아님
        return { rgb: cand, ratio: ratio, steps: i };
      }
      if (candL === 0 || candL === 100) break;
    }
    return null;
  }
  function suggestShades(fgRgb, bgRgb, target) {
    return {
      lighter: searchNearest(fgRgb, bgRgb, target, 1),
      darker: searchNearest(fgRgb, bgRgb, target, -1)
    };
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseColor: parseColor, toHex: toHex, relLuminance: relLuminance,
      contrastRatio: contrastRatio, rgbToHsl: rgbToHsl, hslToRgb: hslToRgb,
      suggestShades: suggestShades, LEVELS: LEVELS, SUGGEST_TARGET: SUGGEST_TARGET
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "color-contrast-checker") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtRatio(n) {
    try { return new Intl.NumberFormat(uiLang(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }
    catch (e) { return n.toFixed(2); }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var fgHex = $("fg-hex"), fgPicker = $("fg-picker"), fgErr = $("fg-err");
  var bgHex = $("bg-hex"), bgPicker = $("bg-picker"), bgErr = $("bg-err");
  var swapBtn = $("swap-btn");
  var ratioValueEl = $("ratio-value"), ratioNoteEl = $("ratio-note");
  var previewNormal = $("preview-normal"), previewLarge = $("preview-large");
  var suggestWrap = $("suggest-wrap"), suggestNone = $("suggest-none");
  var suggestLighter = $("suggest-lighter"), suggestDarker = $("suggest-darker");
  var targetSel = $("target-level");
  var TARGET_LABEL_KEY = { "4.5": "tool.badge.aaNormal", "7": "tool.badge.aaaNormal", "3": "tool.badge.aaLarge" };
  // 선택된 제안 목표 명암비. 값이 없거나 이상하면 기존 기본값(AA·일반 4.5) 유지.
  function targetRatio() {
    var v = targetSel ? parseFloat(targetSel.value) : NaN;
    return isFinite(v) && v > 1 ? v : SUGGEST_TARGET;
  }
  var badgeEls = {
    aaNormal: $("badge-aa-normal"), aaaNormal: $("badge-aaa-normal"),
    aaLarge: $("badge-aa-large"), aaaLarge: $("badge-aaa-large")
  };
  if (!fgHex || !bgHex || !ratioValueEl) return;

  /* ---- 상태 저장/복원 ---- */
  function loadState() {
    try {
      var raw = localStorage.getItem(SKEY);
      if (!raw) return null;
      var st = JSON.parse(raw);
      if (st && parseColor(st.fg) && parseColor(st.bg)) return st;
    } catch (e) { /* private mode 또는 손상된 값 — 기본값 사용 */ }
    return null;
  }
  function saveState(fg, bg) {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        fg: fg, bg: bg, target: targetSel ? targetSel.value : undefined
      }));
    } catch (e) { /* noop */ }
  }

  /* ---- 배지 렌더 ---- */
  function renderBadge(el, pass) {
    if (!el) return;
    el.classList.remove("ccc-pass", "ccc-fail");
    el.classList.add(pass ? "ccc-pass" : "ccc-fail");
    var statusEl = el.querySelector(".ccc-badge-status");
    if (statusEl) statusEl.textContent = tr(pass ? "tool.pass" : "tool.fail", pass ? "Pass" : "Fail");
    el.setAttribute("aria-label",
      (el.getAttribute("data-badge-name") || "") + ": " + tr(pass ? "tool.pass" : "tool.fail", pass ? "Pass" : "Fail"));
  }

  /* ---- 제안 스와치 렌더 ---- */
  function renderSuggestion(el, data, labelKey, fallbackLabel) {
    if (!el) return;
    if (!data) { el.hidden = true; return; }
    el.hidden = false;
    var swatch = el.querySelector(".ccc-suggest-swatch");
    var hexEl = el.querySelector(".ccc-suggest-hex");
    var ratioEl = el.querySelector(".ccc-suggest-ratio");
    var labelEl = el.querySelector(".ccc-suggest-label");
    var hex = toHex(data.rgb);
    if (swatch) swatch.style.background = hex;
    if (hexEl) hexEl.textContent = hex.toUpperCase();
    if (ratioEl) ratioEl.textContent = fmtRatio(data.ratio) + ":1";
    if (labelEl) labelEl.textContent = tr(labelKey, fallbackLabel);
    el.setAttribute("data-hex", hex);
  }

  /* ---- 메인 렌더 ---- */
  var lastValidFg = null, lastValidBg = null;

  function render() {
    var fgRgb = parseColor(fgHex.value);
    var bgRgb = parseColor(bgHex.value);

    var fgOk = !!fgRgb, bgOk = !!bgRgb;
    if (fgErr) fgErr.hidden = fgOk;
    if (bgErr) bgErr.hidden = bgOk;
    fgHex.setAttribute("aria-invalid", fgOk ? "false" : "true");
    bgHex.setAttribute("aria-invalid", bgOk ? "false" : "true");

    if (fgOk) { lastValidFg = fgRgb; fgPicker.value = toHex(fgRgb); }
    if (bgOk) { lastValidBg = bgRgb; bgPicker.value = toHex(bgRgb); }

    if (!fgOk || !bgOk) {
      // 하나라도 무효면 계산은 멈추되, 마지막 유효 색으로 미리보기는 유지(조용한 실패 방지 + 입력 중 깜빡임 완화)
      return;
    }

    saveState(fgHex.value.trim(), bgHex.value.trim());

    var ratio = contrastRatio(fgRgb, bgRgb);
    ratioValueEl.textContent = fmtRatio(ratio);
    ratioNoteEl.textContent = tr("tool.ratio.sub", "{fg} on {bg}")
      .replace("{fg}", toHex(fgRgb).toUpperCase())
      .replace("{bg}", toHex(bgRgb).toUpperCase());

    for (var i = 0; i < LEVELS.length; i++) {
      var lv = LEVELS[i];
      renderBadge(badgeEls[lv.key], ratio >= lv.min);
    }

    // 미리보기
    [previewNormal, previewLarge].forEach(function (box) {
      if (!box) return;
      box.style.color = toHex(fgRgb);
      box.style.background = toHex(bgRgb);
    });

    // 제안: 선택한 목표(기본 AA·일반 4.5) 미달일 때만
    var target = targetRatio();
    if (ratio >= target) {
      if (suggestNone) {
        var tKey = targetSel ? TARGET_LABEL_KEY[targetSel.value] : null;
        var tName = tKey ? tr(tKey, "AA · Normal text") : "AA · Normal text";
        suggestNone.textContent = tr("tool.suggest.noneFor", "Already passes {target} — no adjustment needed.")
          .replace("{target}", tName);
        suggestNone.hidden = false;
      }
      if (suggestLighter) suggestLighter.hidden = true;
      if (suggestDarker) suggestDarker.hidden = true;
    } else {
      if (suggestNone) suggestNone.hidden = true;
      var shades = suggestShades(fgRgb, bgRgb, target);
      renderSuggestion(suggestLighter, shades.lighter, "tool.suggest.lighter", "Lighter");
      renderSuggestion(suggestDarker, shades.darker, "tool.suggest.darker", "Darker");
      // 높은 목표(AAA 등) + 중간 밝기 배경이면 어느 명도로도 도달 불가 — 조용히 비우지 않는다
      if (!shades.lighter && !shades.darker && suggestNone) {
        var nKey = targetSel ? TARGET_LABEL_KEY[targetSel.value] : null;
        suggestNone.textContent = tr("tool.suggest.impossible",
          "No shade of this text color reaches {target} on this background — change the background too.")
          .replace("{target}", nKey ? tr(nKey, "AA · Normal text") : "AA · Normal text");
        suggestNone.hidden = false;
      }
    }
  }

  /* ---- 이벤트 ---- */
  fgHex.addEventListener("input", render);
  bgHex.addEventListener("input", render);
  fgPicker.addEventListener("input", function () { fgHex.value = fgPicker.value; render(); });
  bgPicker.addEventListener("input", function () { bgHex.value = bgPicker.value; render(); });

  if (targetSel) targetSel.addEventListener("change", render);

  if (swapBtn) {
    swapBtn.addEventListener("click", function () {
      var f = fgHex.value;
      fgHex.value = bgHex.value;
      bgHex.value = f;
      render();
    });
  }

  [suggestLighter, suggestDarker].forEach(function (el) {
    if (!el) return;
    el.addEventListener("click", function () {
      var hex = el.getAttribute("data-hex");
      if (!hex) return;
      fgHex.value = hex;
      render();
      if (fgHex.focus) fgHex.focus();
    });
  });

  // 언어 전환 시 동적 문구(배지 pass/fail, 제안 라벨, 명암비 부연) 재적용
  document.addEventListener("i18n:change", render);

  /* ---- 초기화 ---- */
  var initial = loadState();
  fgHex.value = (initial && initial.fg) || DEFAULT_FG;
  bgHex.value = (initial && initial.bg) || DEFAULT_BG;
  if (targetSel && initial && TARGET_LABEL_KEY[initial.target]) targetSel.value = initial.target;
  render();
  // TOOLJS:END
})();
