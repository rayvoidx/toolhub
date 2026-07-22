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
  /* Image Resizer — 100% 클라이언트 사이드 canvas 리사이즈.
     파일은 절대 업로드되지 않는다: FileReader → 매직바이트 스니핑(진짜 타입 확인) →
     Blob/ObjectURL → <img> 디코드 → <canvas> 그리기 → toBlob 인코딩 → 다운로드.
     상태: localStorage 에는 "환경설정"(마지막 모드/포맷/품질/잠금)만 저장한다 —
     이미지 데이터 자체는 어디에도 저장하지 않는다. */

  var MAX_DIM = 8000;                 // 입력 이미지 한 변 상한 (브라우저 메모리 보호)
  var MAX_BYTES = 40 * 1024 * 1024;   // 40MB — 이 이상은 디코드 전에 명시적으로 거부

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  function clampInt(raw, min, max, fallback) {
    var n = Math.round(Number(raw));
    if (!isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }
  function clampPct(raw) { return clampInt(raw, 1, 500, 100); }

  // 너비 기준 잠금 계산 — 비율 유지, 양변 모두 1..cap 로 클램프
  function dimsFromWidth(width, origW, origH, cap) {
    var w = clampInt(width, 1, cap, 1);
    var h = clampInt(Math.round((w * origH) / origW), 1, cap, 1);
    return { w: w, h: h, capped: Number(width) !== w };
  }
  // 높이 기준 잠금 계산
  function dimsFromHeight(height, origW, origH, cap) {
    var h = clampInt(height, 1, cap, 1);
    var w = clampInt(Math.round((h * origW) / origH), 1, cap, 1);
    return { w: w, h: h, capped: Number(height) !== h };
  }
  // 잠금 해제 상태: 두 값을 각각 독립적으로 클램프
  function dimsFree(width, height, origW, origH, cap) {
    var w = clampInt(width, 1, cap, origW > cap ? cap : origW);
    var h = clampInt(height, 1, cap, origH > cap ? cap : origH);
    var capped = Number(width) !== w || Number(height) !== h;
    return { w: w, h: h, capped: capped };
  }
  // 퍼센트 모드: 원본 비율을 항상 유지, 결과가 cap 을 넘으면 비율을 지키며 축소
  function dimsFromPercent(origW, origH, pctRaw, cap) {
    var pct = clampPct(pctRaw);
    var w = Math.max(1, Math.round((origW * pct) / 100));
    var h = Math.max(1, Math.round((origH * pct) / 100));
    var capped = false;
    if (w > cap || h > cap) {
      var scale = cap / Math.max(w, h);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      capped = true;
    }
    return { w: w, h: h, capped: capped, pct: pct };
  }
  function mimeForFormat(format, origMime) {
    if (format === "jpeg") return "image/jpeg";
    if (format === "png") return "image/png";
    if (format === "webp") return "image/webp";
    return origMime || "image/png"; // "keep"
  }
  function extForMime(mime) {
    if (mime === "image/jpeg") return "jpg";
    if (mime === "image/webp") return "webp";
    return "png";
  }
  function usesQuality(mime) { return mime === "image/jpeg" || mime === "image/webp"; }
  // 매직바이트 스니핑 — file.type/확장자는 거짓일 수 있어 실제 바이트로 판정한다
  function sniffMime(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
        bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) return "image/png";
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
    return null;
  }
  // 바이트 → 사람이 읽는 크기 문자열 (단위는 기술 약어라 번역하지 않는다 — KB/MB 는 국제 공용)
  function humanSize(bytes) {
    if (!(bytes >= 0)) return "0 B";
    var units = ["B", "KB", "MB", "GB"], n = bytes, i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    var digits = i === 0 ? 0 : (n < 10 ? 2 : (n < 100 ? 1 : 0));
    return n.toFixed(digits) + " " + units[i];
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      clampInt: clampInt, clampPct: clampPct, dimsFromWidth: dimsFromWidth, dimsFromHeight: dimsFromHeight,
      dimsFree: dimsFree, dimsFromPercent: dimsFromPercent, mimeForFormat: mimeForFormat, extForMime: extForMime,
      usesQuality: usesQuality, sniffMime: sniffMime, humanSize: humanSize
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SLUG = CFG.slug || "image-resizer";
  var PREFS_KEY = SLUG + ":prefs";

  function t(key, vars) {
    var s = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    if (s == null) s = key;
    if (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) s = s.split("{" + k + "}").join(String(vars[k]));
      }
    }
    return s;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtInt(n) {
    try { return Number(n).toLocaleString(uiLang()); } catch (e) { return String(n); }
  }
  function formatLabel(mime) {
    if (mime === "image/jpeg") return t("tool.format.jpeg");
    if (mime === "image/webp") return t("tool.format.webp");
    return t("tool.format.png");
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var elDrop = $("ir-drop"), elBrowse = $("ir-browse"), elFile = $("ir-file");
  var elError = $("ir-error"), elEmpty = $("ir-empty"), elWorkspace = $("ir-workspace");
  var elOrigImg = $("ir-orig-img"), elOrigDims = $("ir-orig-dims"), elOrigSize = $("ir-orig-size"), elReset = $("ir-reset");
  var elTabDims = $("ir-tab-dims"), elTabPct = $("ir-tab-pct"), elPaneDims = $("ir-pane-dims"), elPanePct = $("ir-pane-pct");
  var elWidth = $("ir-width"), elHeight = $("ir-height"), elLock = $("ir-lock");
  var elPct = $("ir-pct"), elPctChips = $("ir-pct-chips");
  var elFormat = $("ir-format"), elQualityField = $("ir-quality-field"), elQuality = $("ir-quality"),
      elQualityValue = $("ir-quality-value"), elQualityRow = elQuality ? elQuality.parentNode : null,
      elQualityPngNote = $("ir-quality-png-note");
  var elResizeBtn = $("ir-resize");
  var elResult = $("ir-result"), elResultImg = $("ir-result-img"), elResultDims = $("ir-result-dims"),
      elResultSize = $("ir-result-size"), elResultHint = $("ir-result-hint"), elDownload = $("ir-download");
  if (!elDrop || !elFile || !elWorkspace) return;

  /* ---- 환경설정 (이미지 데이터 자체는 절대 저장하지 않는다) ---- */
  var prefs = { mode: "dims", lock: true, format: "keep", quality: 90 };
  try {
    var raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      var p = JSON.parse(raw);
      if (p && typeof p === "object") {
        if (p.mode === "dims" || p.mode === "pct") prefs.mode = p.mode;
        if (typeof p.lock === "boolean") prefs.lock = p.lock;
        if (p.format === "keep" || p.format === "jpeg" || p.format === "png" || p.format === "webp") prefs.format = p.format;
        if (isFinite(p.quality)) prefs.quality = clampInt(p.quality, 1, 100, 90);
      }
    }
  } catch (e) { /* private mode / 손상된 값 → 기본값 */ }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* noop */ }
  }

  var mode = prefs.mode;
  var state = {
    img: null, origMime: null, origW: 0, origH: 0, origBytes: 0, origUrl: null,
    resultUrl: null, resultBytes: 0, resultW: 0, resultH: 0, resultMime: null, capped: false
  };

  function showError(msg) { elError.textContent = msg; elError.hidden = false; }
  function clearError() { elError.hidden = true; elError.textContent = ""; }

  /* ---- 포맷 셀렉트 채우기 (값 자체는 고정, 라벨만 번역) ---- */
  function fillFormatSelect() {
    var keep = elFormat.value || prefs.format;
    elFormat.innerHTML = "";
    var opts = [["keep", t("tool.format.keep")], ["jpeg", t("tool.format.jpeg")],
                ["png", t("tool.format.png")], ["webp", t("tool.format.webp")]];
    for (var i = 0; i < opts.length; i++) {
      var o = document.createElement("option");
      o.value = opts[i][0]; o.textContent = opts[i][1];
      elFormat.appendChild(o);
    }
    elFormat.value = keep || "keep";
  }

  function updateQualityVisibility() {
    var mime = mimeForFormat(elFormat.value, state.origMime);
    var show = usesQuality(mime);
    if (elQualityRow) elQualityRow.hidden = !show;
    elQualityPngNote.hidden = show;
  }

  /* ---- 탭 전환 ---- */
  function setMode(next) {
    mode = next;
    prefs.mode = next; savePrefs();
    var isPct = next === "pct";
    elTabDims.classList.toggle("is-on", !isPct);
    elTabPct.classList.toggle("is-on", isPct);
    elTabDims.setAttribute("aria-selected", String(!isPct));
    elTabPct.setAttribute("aria-selected", String(isPct));
    elPaneDims.hidden = isPct;
    elPanePct.hidden = !isPct;
  }
  elTabDims.addEventListener("click", function () { setMode("dims"); });
  elTabPct.addEventListener("click", function () { setMode("pct"); });

  /* ---- 너비/높이 상호 동기화 (잠금 시 미리보기 값만 갱신 — 최종 클램프는 리사이즈 실행 시) ---- */
  function onWidthInput() {
    if (!elLock.checked || !state.img) return;
    var w = parseFloat(elWidth.value);
    if (!isFinite(w) || w <= 0) return;
    var h = Math.round((w * state.origH) / state.origW);
    elHeight.value = String(h > 0 ? h : 1);
  }
  function onHeightInput() {
    if (!elLock.checked || !state.img) return;
    var h = parseFloat(elHeight.value);
    if (!isFinite(h) || h <= 0) return;
    var w = Math.round((h * state.origW) / state.origH);
    elWidth.value = String(w > 0 ? w : 1);
  }
  elWidth.addEventListener("input", onWidthInput);
  elHeight.addEventListener("input", onHeightInput);
  elLock.addEventListener("change", function () {
    prefs.lock = elLock.checked; savePrefs();
    if (elLock.checked) onWidthInput();
  });

  /* ---- 리사이즈 실행 ---- */
  function computeTarget() {
    if (mode === "pct") {
      var target = dimsFromPercent(state.origW, state.origH, parseFloat(elPct.value), MAX_DIM);
      elPct.value = String(target.pct);
      return target;
    }
    var wRaw = parseFloat(elWidth.value), hRaw = parseFloat(elHeight.value);
    var out;
    if (elLock.checked) {
      if (isFinite(wRaw) && wRaw > 0) out = dimsFromWidth(wRaw, state.origW, state.origH, MAX_DIM);
      else if (isFinite(hRaw) && hRaw > 0) out = dimsFromHeight(hRaw, state.origW, state.origH, MAX_DIM);
      else out = { w: clampInt(state.origW, 1, MAX_DIM, 1), h: clampInt(state.origH, 1, MAX_DIM, 1), capped: false };
    } else {
      out = dimsFree(isFinite(wRaw) ? wRaw : state.origW, isFinite(hRaw) ? hRaw : state.origH, state.origW, state.origH, MAX_DIM);
    }
    elWidth.value = String(out.w);
    elHeight.value = String(out.h);
    return out;
  }

  function doResize() {
    if (!state.img) return;
    clearError();
    var target = computeTarget();
    var mime = mimeForFormat(elFormat.value, state.origMime);
    var q = clampInt(elQuality.value, 1, 100, 90) / 100;

    var canvas;
    try {
      canvas = document.createElement("canvas");
      canvas.width = target.w;
      canvas.height = target.h;
      var ctx = canvas.getContext("2d");
      if (!ctx) { showError(t("tool.err.process")); return; }
      ctx.imageSmoothingEnabled = true;
      if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
      ctx.drawImage(state.img, 0, 0, target.w, target.h);
    } catch (e) { showError(t("tool.err.process")); return; }

    function onBlob(blob) {
      if (!blob) { showError(t("tool.err.process")); return; }
      if (state.resultUrl) { try { URL.revokeObjectURL(state.resultUrl); } catch (e2) { /* noop */ } }
      state.resultUrl = URL.createObjectURL(blob);
      state.resultBytes = blob.size;
      state.resultW = target.w; state.resultH = target.h;
      state.resultMime = mime; state.capped = target.capped;
      renderResult();
    }
    try {
      if (usesQuality(mime)) canvas.toBlob(onBlob, mime, q);
      else canvas.toBlob(onBlob, mime);
    } catch (e) { showError(t("tool.err.process")); }
  }

  function renderResult() {
    elResult.hidden = false;
    elResultImg.src = state.resultUrl;
    elResultDims.textContent = t("tool.result.dims", { w: fmtInt(state.resultW), h: fmtInt(state.resultH), fmt: formatLabel(state.resultMime) });
    elResultSize.textContent = t("tool.result.size", { size: humanSize(state.resultBytes) });

    var hint;
    if (state.origBytes > 0 && state.resultBytes < state.origBytes) {
      hint = t("tool.result.saved", { pct: Math.round((1 - state.resultBytes / state.origBytes) * 100) + "%" });
    } else if (state.origBytes > 0 && state.resultBytes > state.origBytes) {
      hint = t("tool.result.larger", { pct: Math.round((state.resultBytes / state.origBytes - 1) * 100) + "%" });
    } else {
      hint = t("tool.result.same");
    }
    if (state.capped) hint += " " + t("tool.hint.capped", { max: fmtInt(MAX_DIM) });
    elResultHint.textContent = hint;

    var ext = extForMime(state.resultMime);
    elDownload.href = state.resultUrl;
    elDownload.download = "resized-image." + ext;
  }

  elPct.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); doResize(); } });
  elWidth.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); doResize(); } });
  elHeight.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); doResize(); } });
  elResizeBtn.addEventListener("click", doResize);

  if (elPctChips) {
    var chips = elPctChips.querySelectorAll(".ir-chip");
    for (var ci = 0; ci < chips.length; ci++) {
      chips[ci].addEventListener("click", function () {
        elPct.value = this.getAttribute("data-pct");
        if (state.img) doResize();
      });
    }
  }

  elFormat.addEventListener("change", function () {
    prefs.format = elFormat.value; savePrefs();
    updateQualityVisibility();
  });
  elQuality.addEventListener("input", function () {
    elQualityValue.textContent = elQuality.value;
  });
  elQuality.addEventListener("change", function () {
    prefs.quality = clampInt(elQuality.value, 1, 100, 90); savePrefs();
  });

  /* ---- 이미지 로드 ---- */
  function resetToEmpty() {
    if (state.origUrl) { try { URL.revokeObjectURL(state.origUrl); } catch (e) { /* noop */ } }
    if (state.resultUrl) { try { URL.revokeObjectURL(state.resultUrl); } catch (e) { /* noop */ } }
    state = { img: null, origMime: null, origW: 0, origH: 0, origBytes: 0, origUrl: null,
              resultUrl: null, resultBytes: 0, resultW: 0, resultH: 0, resultMime: null, capped: false };
    elWorkspace.hidden = true;
    elResult.hidden = true;
    elEmpty.hidden = false;
    elFile.value = "";
    clearError();
  }

  function loadImageState(img, url, mime, w, h, bytes) {
    if (state.origUrl && state.origUrl !== url) { try { URL.revokeObjectURL(state.origUrl); } catch (e) { /* noop */ } }
    if (state.resultUrl) { try { URL.revokeObjectURL(state.resultUrl); } catch (e) { /* noop */ } }
    state.img = img; state.origUrl = url; state.origMime = mime;
    state.origW = w; state.origH = h; state.origBytes = bytes;
    state.resultUrl = null; state.resultBytes = 0; state.resultW = 0; state.resultH = 0; state.resultMime = null; state.capped = false;

    elOrigImg.src = url;
    elOrigDims.textContent = t("tool.orig.dims", { w: fmtInt(w), h: fmtInt(h), fmt: formatLabel(mime) });
    elOrigSize.textContent = t("tool.orig.size", { size: humanSize(bytes) });
    elWidth.value = String(w);
    elHeight.value = String(h);
    elPct.value = "100";
    elLock.checked = prefs.lock;
    fillFormatSelect();
    updateQualityVisibility();

    elWorkspace.hidden = false;
    elEmpty.hidden = true;
    elResult.hidden = true;
    clearError();
    setMode(mode);
  }

  function readFile(file) {
    if (!file) return;
    clearError();
    if (file.size > MAX_BYTES) {
      showError(t("tool.err.size", { size: humanSize(file.size), max: humanSize(MAX_BYTES) }));
      return;
    }
    var fr = new FileReader();
    fr.onerror = function () { showError(t("tool.err.decode")); };
    fr.onload = function () {
      var bytes;
      try { bytes = new Uint8Array(fr.result); }
      catch (e) { showError(t("tool.err.decode")); return; }
      var mime = sniffMime(bytes);
      if (!mime) { showError(t("tool.err.type")); return; }
      var blob, url;
      try {
        blob = new Blob([bytes], { type: mime });
        url = URL.createObjectURL(blob);
      } catch (e) { showError(t("tool.err.decode")); return; }
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { try { URL.revokeObjectURL(url); } catch (e3) { /* noop */ } showError(t("tool.err.decode")); return; }
        if (w > MAX_DIM || h > MAX_DIM) {
          try { URL.revokeObjectURL(url); } catch (e4) { /* noop */ }
          showError(t("tool.err.dims", { w: fmtInt(w), h: fmtInt(h), max: fmtInt(MAX_DIM) }));
          return;
        }
        loadImageState(img, url, mime, w, h, file.size);
      };
      img.onerror = function () {
        try { URL.revokeObjectURL(url); } catch (e5) { /* noop */ }
        showError(t("tool.err.decode"));
      };
      img.src = url;
    };
    fr.readAsArrayBuffer(file);
  }

  elBrowse.addEventListener("click", function () { elFile.click(); });
  elFile.addEventListener("change", function () { if (elFile.files && elFile.files[0]) readFile(elFile.files[0]); });
  ["dragenter", "dragover"].forEach(function (ev) {
    elDrop.addEventListener(ev, function (e) { e.preventDefault(); elDrop.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    elDrop.addEventListener(ev, function (e) { e.preventDefault(); elDrop.classList.remove("is-over"); });
  });
  elDrop.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  });
  elReset.addEventListener("click", resetToEmpty);

  document.addEventListener("i18n:change", function () {
    fillFormatSelect();
    if (state.img) {
      elOrigDims.textContent = t("tool.orig.dims", { w: fmtInt(state.origW), h: fmtInt(state.origH), fmt: formatLabel(state.origMime) });
      elOrigSize.textContent = t("tool.orig.size", { size: humanSize(state.origBytes) });
      updateQualityVisibility();
    }
    if (state.resultUrl) renderResult();
  });

  /* ---- 초기화 ---- */
  fillFormatSelect();
  elFormat.value = prefs.format;
  elLock.checked = prefs.lock;
  elQuality.value = String(prefs.quality);
  elQualityValue.textContent = String(prefs.quality);
  updateQualityVisibility();
  setMode(mode);
  // TOOLJS:END
})();
