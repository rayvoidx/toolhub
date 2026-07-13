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
  var cfg  = window.APP_CONFIG || {};
  var SLUG = cfg.slug || "color-picker";
  var DEFAULT_HEX = "#d946ef"; // 스킨 accent — 최초 방문 기본 색

  // ---- i18n 헬퍼 (누락 키는 원문/폴백) ----
  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }

  // ============================================================
  //  색 계산 (순수 함수 — DOM 비의존, node 단위 검증 대상)
  // ============================================================
  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }
  function toByte(n) { return clamp(Math.round(n), 0, 255); }
  function hex2(n) { var s = toByte(n).toString(16); return s.length === 1 ? "0" + s : s; }

  function rgbToHex(r, g, b) { return "#" + hex2(r) + hex2(g) + hex2(b); }
  function rgbaToHex8(r, g, b, a) { return "#" + hex2(r) + hex2(g) + hex2(b) + hex2(Math.round(clamp(a, 0, 1) * 255)); }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0, s = 0, l = (max + min) / 2;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r)      h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else                h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [Math.round(h) % 360, Math.round(s * 100), Math.round(l * 100)];
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0, s = max === 0 ? 0 : d / max, v = max;
    if (d !== 0) {
      if (max === r)      h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else                h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [Math.round(h) % 360, Math.round(s * 100), Math.round(v * 100)];
  }

  function rgbToCmyk(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var k = 1 - Math.max(r, g, b);
    if (k >= 1) return [0, 0, 0, 100]; // 순수 검정
    var c = (1 - r - k) / (1 - k);
    var m = (1 - g - k) / (1 - k);
    var y = (1 - b - k) / (1 - k);
    return [Math.round(c * 100), Math.round(m * 100), Math.round(y * 100), Math.round(k * 100)];
  }

  // WCAG 상대 휘도 + 대비비
  function relLuminance(r, g, b) {
    function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }
  function contrastRatio(l1, l2) {
    var hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }
  function wcagLevel(ratio) {
    if (ratio >= 7)   return { key: "tool.wcagAAA",     pass: true };
    if (ratio >= 4.5) return { key: "tool.wcagAA",      pass: true };
    if (ratio >= 3)   return { key: "tool.wcagAALarge", pass: true };
    return { key: "tool.wcagFail", pass: false };
  }

  // 알파 문자열 (최대 소수 2자리, 불필요한 0 제거)
  function alphaStr(a) { return String(Math.round(clamp(a, 0, 1) * 100) / 100); }

  // ---- CSS 이름 색 (정확히 일치할 때만 표시) ----
  var NAMED = {
    aliceblue:"#f0f8ff",antiquewhite:"#faebd7",aqua:"#00ffff",aquamarine:"#7fffd4",azure:"#f0ffff",beige:"#f5f5dc",bisque:"#ffe4c4",black:"#000000",blanchedalmond:"#ffebcd",blue:"#0000ff",blueviolet:"#8a2be2",brown:"#a52a2a",burlywood:"#deb887",cadetblue:"#5f9ea0",chartreuse:"#7fff00",chocolate:"#d2691e",coral:"#ff7f50",cornflowerblue:"#6495ed",cornsilk:"#fff8dc",crimson:"#dc143c",cyan:"#00ffff",darkblue:"#00008b",darkcyan:"#008b8b",darkgoldenrod:"#b8860b",darkgray:"#a9a9a9",darkgreen:"#006400",darkkhaki:"#bdb76b",darkmagenta:"#8b008b",darkolivegreen:"#556b2f",darkorange:"#ff8c00",darkorchid:"#9932cc",darkred:"#8b0000",darksalmon:"#e9967a",darkseagreen:"#8fbc8f",darkslateblue:"#483d8b",darkslategray:"#2f4f4f",darkturquoise:"#00ced1",darkviolet:"#9400d3",deeppink:"#ff1493",deepskyblue:"#00bfff",dimgray:"#696969",dodgerblue:"#1e90ff",firebrick:"#b22222",floralwhite:"#fffaf0",forestgreen:"#228b22",fuchsia:"#ff00ff",gainsboro:"#dcdcdc",ghostwhite:"#f8f8ff",gold:"#ffd700",goldenrod:"#daa520",gray:"#808080",green:"#008000",greenyellow:"#adff2f",honeydew:"#f0fff0",hotpink:"#ff69b4",indianred:"#cd5c5c",indigo:"#4b0082",ivory:"#fffff0",khaki:"#f0e68c",lavender:"#e6e6fa",lavenderblush:"#fff0f5",lawngreen:"#7cfc00",lemonchiffon:"#fffacd",lightblue:"#add8e6",lightcoral:"#f08080",lightcyan:"#e0ffff",lightgoldenrodyellow:"#fafad2",lightgray:"#d3d3d3",lightgreen:"#90ee90",lightpink:"#ffb6c1",lightsalmon:"#ffa07a",lightseagreen:"#20b2aa",lightskyblue:"#87cefa",lightslategray:"#778899",lightsteelblue:"#b0c4de",lightyellow:"#ffffe0",lime:"#00ff00",limegreen:"#32cd32",linen:"#faf0e6",magenta:"#ff00ff",maroon:"#800000",mediumaquamarine:"#66cdaa",mediumblue:"#0000cd",mediumorchid:"#ba55d3",mediumpurple:"#9370db",mediumseagreen:"#3cb371",mediumslateblue:"#7b68ee",mediumspringgreen:"#00fa9a",mediumturquoise:"#48d1cc",mediumvioletred:"#c71585",midnightblue:"#191970",mintcream:"#f5fffa",mistyrose:"#ffe4e1",moccasin:"#ffe4b5",navajowhite:"#ffdead",navy:"#000080",oldlace:"#fdf5e6",olive:"#808000",olivedrab:"#6b8e23",orange:"#ffa500",orangered:"#ff4500",orchid:"#da70d6",palegoldenrod:"#eee8aa",palegreen:"#98fb98",paleturquoise:"#afeeee",palevioletred:"#db7093",papayawhip:"#ffefd5",peachpuff:"#ffdab9",peru:"#cd853f",pink:"#ffc0cb",plum:"#dda0dd",powderblue:"#b0e0e6",purple:"#800080",rebeccapurple:"#663399",red:"#ff0000",rosybrown:"#bc8f8f",royalblue:"#4169e1",saddlebrown:"#8b4513",salmon:"#fa8072",sandybrown:"#f4a460",seagreen:"#2e8b57",seashell:"#fff5ee",sienna:"#a0522d",silver:"#c0c0c0",skyblue:"#87ceeb",slateblue:"#6a5acd",slategray:"#708090",snow:"#fffafa",springgreen:"#00ff7f",steelblue:"#4682b4",tan:"#d2b48c",teal:"#008080",thistle:"#d8bfd8",tomato:"#ff6347",turquoise:"#40e0d0",violet:"#ee82ee",wheat:"#f5deb3",white:"#ffffff",whitesmoke:"#f5f5f5",yellow:"#ffff00",yellowgreen:"#9acd32"
  };
  var NAMED_REV = (function () {
    var m = {}; for (var k in NAMED) { if (NAMED.hasOwnProperty(k) && !m[NAMED[k]]) m[NAMED[k]] = k; } return m;
  })();
  function cssName(r, g, b, a) {
    if (a < 1) return null;
    return NAMED_REV[rgbToHex(r, g, b)] || null;
  }

  // ============================================================
  //  파싱 — canvas 로 임의의 CSS 색을 안전하게 해석 (이름색 포함)
  // ============================================================
  var pctx = null;
  try {
    var cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    pctx = cv.getContext && cv.getContext("2d", { willReadFrequently: true });
  } catch (e) { pctx = null; }

  function parseWithCanvas(input) {
    if (!pctx) return null;
    // 유효성: 두 서로 다른 초기값에 input 을 대입해 둘 다 같은 값이 나오면 유효
    pctx.fillStyle = "#000";
    pctx.fillStyle = input;
    var s1 = pctx.fillStyle;
    pctx.fillStyle = "#fff";
    pctx.fillStyle = input;
    var s2 = pctx.fillStyle;
    if (s1 !== s2) return null; // 브라우저가 거부 → 무효
    // 정규화된 문자열은 "#rrggbb"(불투명) 또는 "rgba(r, g, b, a)"
    if (s1.charAt(0) === "#") {
      return { r: parseInt(s1.slice(1, 3), 16), g: parseInt(s1.slice(3, 5), 16), b: parseInt(s1.slice(5, 7), 16), a: 1 };
    }
    var m = s1.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    var p = m[1].split(",");
    return {
      r: toByte(parseFloat(p[0])), g: toByte(parseFloat(p[1])), b: toByte(parseFloat(p[2])),
      a: p.length > 3 ? clamp(parseFloat(p[3]), 0, 1) : 1
    };
  }

  // canvas 미지원 환경용 최소 폴백 (hex/rgb/hsl + 이름색)
  function parseFallback(input) {
    input = input.toLowerCase().trim();
    if (NAMED[input]) input = NAMED[input];
    var m = input.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
      else if (h.length === 4) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]+h[3]+h[3];
      if (h.length === 6) return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16), a: 1 };
      if (h.length === 8) return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16), a: parseInt(h.slice(6,8),16)/255 };
      return null;
    }
    m = input.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      var p = m[1].split(",");
      if (p.length < 3) return null;
      return { r: toByte(parseFloat(p[0])), g: toByte(parseFloat(p[1])), b: toByte(parseFloat(p[2])), a: p.length > 3 ? clamp(parseFloat(p[3]),0,1) : 1 };
    }
    return null;
  }

  function parseColor(input) {
    input = String(input == null ? "" : input).trim();
    if (!input) return null;
    return parseWithCanvas(input) || parseFallback(input);
  }

  // ============================================================
  //  DOM
  // ============================================================
  var swatchEl   = document.getElementById("cp-swatch");
  var previewEl  = document.getElementById("cp-swatch-preview");
  var contrastEl = document.getElementById("cp-contrast");
  var textEl     = document.getElementById("cp-text");
  var invalidEl  = document.getElementById("cp-invalid");
  var alphaEl    = document.getElementById("cp-alpha");
  var alphaValEl = document.getElementById("cp-alpha-val");
  var eyeBtn     = document.getElementById("cp-eyedropper");
  var eyeNoteEl  = document.getElementById("cp-eyedropper-note");
  var rowsEl     = document.getElementById("cp-rows");
  var shadesTgl  = document.getElementById("cp-shades-toggle");
  var shadesEl   = document.getElementById("cp-shades");
  var toastEl    = document.getElementById("cp-toast");

  // 단일 진실 원천
  var model = { r: 217, g: 70, b: 239, a: 1 };

  // ---- 클립보드 ----
  var toastTimer = null;
  function showToast(msg, isError) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = "cp-toast " + (isError ? "is-error" : "is-ok");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.textContent = ""; toastEl.className = "cp-toast"; }, 2000);
  }
  function copyText(text, onOk) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onOk, function () { fallbackCopy(text, onOk); });
    } else { fallbackCopy(text, onOk); }
  }
  function fallbackCopy(text, onOk) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok && onOk) onOk(); else showToast(t("tool.copyError"), true);
    } catch (e) { showToast(t("tool.copyError"), true); }
  }

  // ---- 출력 포맷 목록 만들기 ----
  function buildFormats() {
    var r = model.r, g = model.g, b = model.b, a = model.a;
    var hsl = rgbToHsl(r, g, b), hsv = rgbToHsv(r, g, b), cmyk = rgbToCmyk(r, g, b);
    var out = [];
    out.push({ label: "HEX", value: rgbToHex(r, g, b) });
    if (a < 1) out.push({ label: "HEX8", value: rgbaToHex8(r, g, b, a) });
    out.push({ label: "RGB", value: a < 1
      ? "rgba(" + r + ", " + g + ", " + b + ", " + alphaStr(a) + ")"
      : "rgb(" + r + ", " + g + ", " + b + ")" });
    out.push({ label: "HSL", value: a < 1
      ? "hsla(" + hsl[0] + ", " + hsl[1] + "%, " + hsl[2] + "%, " + alphaStr(a) + ")"
      : "hsl(" + hsl[0] + ", " + hsl[1] + "%, " + hsl[2] + "%)" });
    out.push({ label: "HSV", value: "hsv(" + hsv[0] + ", " + hsv[1] + "%, " + hsv[2] + "%)" });
    out.push({ label: "CMYK", value: "cmyk(" + cmyk[0] + "%, " + cmyk[1] + "%, " + cmyk[2] + "%, " + cmyk[3] + "%)" });
    var nm = cssName(r, g, b, a);
    if (nm) out.push({ label: t("tool.nameRow"), value: nm });
    return out;
  }

  function renderRows() {
    var formats = buildFormats();
    rowsEl.innerHTML = "";
    var frag = document.createDocumentFragment();
    for (var i = 0; i < formats.length; i++) {
      var f = formats[i];
      var row = document.createElement("div");
      row.className = "cp-row";
      var lab = document.createElement("span");
      lab.className = "cp-row-label"; lab.textContent = f.label;
      var val = document.createElement("code");
      val.className = "cp-row-value"; val.textContent = f.value;
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "cp-copy";
      btn.textContent = t("tool.copy");
      btn.setAttribute("data-value", f.value);
      btn.setAttribute("aria-label", t("tool.copyAria").replace("{label}", f.label));
      row.appendChild(lab); row.appendChild(val); row.appendChild(btn);
      frag.appendChild(row);
    }
    rowsEl.appendChild(frag);
  }

  function renderContrast() {
    var lum = relLuminance(model.r, model.g, model.b);
    var vsBlack = contrastRatio(lum, 0);        // 검정 텍스트
    var vsWhite = contrastRatio(lum, 1);        // 흰색 텍스트
    var cells = [
      { name: t("tool.onColorBlack"), ratio: vsBlack, best: vsBlack >= vsWhite },
      { name: t("tool.onColorWhite"), ratio: vsWhite, best: vsWhite > vsBlack }
    ];
    contrastEl.innerHTML = "";
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var lvl = wcagLevel(c.ratio);
      var cell = document.createElement("div");
      cell.className = "cp-contrast-cell";
      var nameRow = document.createElement("div");
      nameRow.className = "cp-contrast-name";
      var nameSpan = document.createElement("span"); nameSpan.textContent = c.name;
      nameRow.appendChild(nameSpan);
      if (c.best) {
        var pill = document.createElement("span");
        pill.className = "cp-best"; pill.textContent = t("tool.best");
        nameRow.appendChild(pill);
      }
      var ratioRow = document.createElement("div");
      ratioRow.className = "cp-contrast-ratio";
      var lvlSpan = document.createElement("span");
      lvlSpan.className = "cp-level " + (lvl.pass ? "is-pass" : "is-fail");
      lvlSpan.textContent = t(lvl.key);
      ratioRow.appendChild(document.createTextNode((Math.round(c.ratio * 100) / 100).toFixed(2) + ":1 · "));
      ratioRow.appendChild(lvlSpan);
      cell.appendChild(nameRow); cell.appendChild(ratioRow);
      contrastEl.appendChild(cell);
    }
  }

  function renderShades() {
    if (shadesEl.hidden) return;
    var hsl = rgbToHsl(model.r, model.g, model.b);
    shadesEl.innerHTML = "";
    var STEPS = 10;
    for (var i = 0; i < STEPS; i++) {
      var l = Math.round(8 + (84 * i) / (STEPS - 1)); // 8% → 92% 밝기 램프
      var hex = hslToHex(hsl[0], hsl[1], l);
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "cp-shade";
      btn.style.background = hex;
      btn.setAttribute("data-color", hex);
      btn.setAttribute("aria-label", hex);
      btn.title = hex;
      shadesEl.appendChild(btn);
    }
  }

  // HSL → hex (틴트/셰이드 스트립 생성용)
  function hslToHex(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    function hue(p, q, tt) {
      if (tt < 0) tt += 1; if (tt > 1) tt -= 1;
      if (tt < 1/6) return p + (q - p) * 6 * tt;
      if (tt < 1/2) return q;
      if (tt < 2/3) return p + (q - p) * (2/3 - tt) * 6;
      return p;
    }
    var r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue(p, q, h + 1/3); g = hue(p, q, h); b = hue(p, q, h - 1/3);
    }
    return rgbToHex(r * 255, g * 255, b * 255);
  }

  // ---- 전체 렌더 ----
  function render(origin) {
    var solidHex = rgbToHex(model.r, model.g, model.b);
    var rgbaCss = "rgba(" + model.r + ", " + model.g + ", " + model.b + ", " + alphaStr(model.a) + ")";
    // 미리보기
    previewEl.style.background = rgbaCss;
    // 네이티브 스와치 (알파 없음 → 불투명 hex)
    if (origin !== "swatch") swatchEl.value = solidHex;
    // 알파 슬라이더/표시
    if (origin !== "alpha") alphaEl.value = String(Math.round(model.a * 100));
    alphaValEl.textContent = Math.round(model.a * 100) + "%";
    // 텍스트 필드 (입력 중이 아닐 때만 갱신 — 커서 튐 방지)
    if (origin !== "text") textEl.value = model.a < 1 ? rgbaToHex8(model.r, model.g, model.b, model.a) : solidHex;
    renderRows();
    renderContrast();
    renderShades();
  }

  // ---- 모델 반영 + 저장 + URL 갱신 ----
  var urlTimer = null;
  function persist() {
    try { localStorage.setItem(SLUG + ":last", model.a < 1 ? rgbaToHex8(model.r, model.g, model.b, model.a) : rgbToHex(model.r, model.g, model.b)); } catch (e) { /* private mode */ }
    if (urlTimer) clearTimeout(urlTimer);
    urlTimer = setTimeout(function () {
      try {
        var hex = (model.a < 1 ? rgbaToHex8(model.r, model.g, model.b, model.a) : rgbToHex(model.r, model.g, model.b)).slice(1);
        var u = new URL(location.href);
        u.searchParams.set("color", hex);
        history.replaceState(null, "", u.toString());
      } catch (e) { /* URL API 미지원 — 무시 */ }
    }, 300);
  }

  function setColor(rgba, origin) {
    if (!rgba) return;
    model = { r: toByte(rgba.r), g: toByte(rgba.g), b: toByte(rgba.b), a: clamp(rgba.a == null ? 1 : rgba.a, 0, 1) };
    render(origin);
    persist();
  }

  // ============================================================
  //  이벤트
  // ============================================================
  // 네이티브 스와치
  swatchEl.addEventListener("input", function () {
    var p = parseColor(swatchEl.value);
    if (p) { p.a = model.a; setColor(p, "swatch"); } // 알파 유지
    hideInvalid();
  });

  // 알파 슬라이더
  alphaEl.addEventListener("input", function () {
    var a = clamp(parseInt(alphaEl.value, 10) / 100, 0, 1);
    setColor({ r: model.r, g: model.g, b: model.b, a: a }, "alpha");
  });

  // 자유 텍스트 (디바운스 + Enter)
  var textTimer = null;
  function commitText() {
    var raw = textEl.value;
    if (!raw.trim()) { showInvalid(); return; } // 빈 값: 마지막 색 유지 + 명시적 안내 (조용한 실패 금지)
    var p = parseColor(raw);
    if (p) { hideInvalid(); setColor(p, "text"); }
    else { showInvalid(); } // 무효: 마지막 색 유지 + 명시적 안내
  }
  function showInvalid() { if (invalidEl) invalidEl.hidden = false; }
  function hideInvalid() { if (invalidEl) invalidEl.hidden = true; }
  textEl.addEventListener("input", function () {
    if (textTimer) clearTimeout(textTimer);
    textTimer = setTimeout(commitText, 200);
  });
  textEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); if (textTimer) clearTimeout(textTimer); commitText(); }
  });
  textEl.addEventListener("blur", function () { if (textTimer) clearTimeout(textTimer); commitText(); });

  // 행별 복사 (이벤트 위임)
  rowsEl.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest(".cp-copy") : null;
    if (!btn) return;
    var val = btn.getAttribute("data-value");
    if (val == null) return;
    copyText(val, function () {
      btn.textContent = t("tool.copied");
      btn.classList.add("is-copied");
      setTimeout(function () { btn.textContent = t("tool.copy"); btn.classList.remove("is-copied"); }, 1500);
    });
  });

  // 틴트/셰이드 클릭 → 현재 색으로 로드 (알파 유지)
  shadesEl.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest(".cp-shade") : null;
    if (!btn) return;
    var p = parseColor(btn.getAttribute("data-color"));
    if (p) { p.a = model.a; setColor(p, null); }
  });

  // 셰이드 토글 (환경설정 저장)
  shadesTgl.addEventListener("change", function () {
    shadesEl.hidden = !shadesTgl.checked;
    try { localStorage.setItem(SLUG + ":showShades", shadesTgl.checked ? "1" : "0"); } catch (e) { /* noop */ }
    renderShades();
  });

  // EyeDropper — 지원 브라우저에서만 노출
  if (typeof window.EyeDropper === "function") {
    eyeBtn.hidden = false;
    eyeBtn.addEventListener("click", function () {
      var ed;
      try { ed = new window.EyeDropper(); } catch (e) { return; }
      ed.open().then(function (res) {
        var p = parseColor(res && res.sRGBHex);
        if (p) { p.a = model.a; setColor(p, null); hideInvalid(); }
      }).catch(function () { /* 사용자가 취소/거부 — 현재 색 유지 (조용한 no-op) */ });
    });
  } else {
    eyeBtn.hidden = true;
    if (eyeNoteEl) eyeNoteEl.hidden = false; // 미지원 안내 명시
  }

  // 언어 전환 → 동적 문구(복사 버튼/대비 라벨/이름 행) 재렌더
  document.addEventListener("i18n:change", function () { render(null); });

  // ============================================================
  //  초기화 — URL ?color= → localStorage → 기본 accent
  // ============================================================
  (function init() {
    // 셰이드 환경설정 복원
    try {
      var sh = localStorage.getItem(SLUG + ":showShades");
      if (sh === "1") { shadesTgl.checked = true; shadesEl.hidden = false; }
    } catch (e) { /* noop */ }

    var start = null;
    try {
      var q = new URLSearchParams(location.search).get("color");
      if (q) start = parseColor(q.charAt(0) === "#" ? q : "#" + q) || parseColor(q);
    } catch (e) { /* noop */ }
    if (!start) {
      try { var saved = localStorage.getItem(SLUG + ":last"); if (saved) start = parseColor(saved); } catch (e) { /* noop */ }
    }
    if (!start) start = parseColor(DEFAULT_HEX);
    setColor(start, null);
  })();
  // TOOLJS:END
})();
