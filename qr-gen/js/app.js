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
  // TOOLJS:START — QR 생성 도구 (엔진: vendor/qrcode.js, 100% 브라우저 내 처리)
  var cfg = window.APP_CONFIG || {};
  var OPTS_KEY = (cfg.slug || "qr-gen") + ":opts";   // 설정만 저장 — 입력 본문은 저장하지 않음 (프라이버시)
  var DEBOUNCE_MS = 250;

  var input = document.getElementById("qr-text");
  var sizeSel = document.getElementById("qr-size");
  var ecSel = document.getElementById("qr-ec");
  var msgEl = document.getElementById("qr-message");
  var wrapEl = document.getElementById("qr-preview-wrap");
  var canvas = document.getElementById("qr-canvas");
  var statsEl = document.getElementById("qr-stats");
  var dlBtn = document.getElementById("qr-download");
  if (!input || !sizeSel || !ecSel || !msgEl || !wrapEl || !canvas || !statsEl || !dlBtn) return;

  var lastQR = null;    // 마지막 생성 결과 (재렌더용 파생 캐시 — 복원용 상태 아님)
  var timer = null;

  // i18n 카탈로그가 없을 때(단일 언어 폴백)를 위한 최소 문구 — baked en 과 동일
  var FALLBACK = {
    "tool.empty": "Enter a URL or text above and your QR code will appear instantly.",
    "tool.overflow": "Input is too long — shorten the text or lower the error correction level.",
    "tool.engineError": "The QR engine failed to load. Please refresh the page.",
    "tool.downloadError": "Could not create the PNG file. Please try a different browser.",
    "tool.stats": "Version {version} · {modules}×{modules} modules · {bytes} bytes"
  };
  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v != null ? v : (FALLBACK[key] || key);
  }

  function setMessage(key, isError) {
    msgEl.setAttribute("data-i18n", key);            // 언어 전환 시 i18n 엔진이 재번역
    msgEl.textContent = t(key);
    msgEl.style.color = isError ? "#dc2626" : "";
    msgEl.style.fontWeight = isError ? "600" : "";
    msgEl.hidden = false;
  }

  function showFailure(key) {                        // 빈 입력·용량 초과·엔진 실패 — 조용한 실패 금지
    lastQR = null;
    wrapEl.hidden = true;
    dlBtn.disabled = true;
    setMessage(key, key !== "tool.empty");
  }

  function loadOpts() {
    try {
      var raw = localStorage.getItem(OPTS_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o && (o.size === "256" || o.size === "512" || o.size === "1024")) sizeSel.value = o.size;
      if (o && (o.ec === "L" || o.ec === "M" || o.ec === "Q" || o.ec === "H")) ecSel.value = o.ec;
    } catch (e) { /* 손상된 저장값·프라이빗 모드 — 기본값 유지 */ }
  }
  function saveOpts() {
    try { localStorage.setItem(OPTS_KEY, JSON.stringify({ size: sizeSel.value, ec: ecSel.value })); }
    catch (e) { /* 프라이빗 모드 — 저장 생략, 기능에는 영향 없음 */ }
  }

  function updateStats() {
    if (!lastQR) { statsEl.textContent = ""; return; }
    statsEl.textContent = t("tool.stats")
      .replace(/\{version\}/g, String(lastQR.version))
      .replace(/\{modules\}/g, String(lastQR.size))
      .replace(/\{bytes\}/g, String(lastQR.byteLength));
  }

  function draw() {
    if (!lastQR) return;
    var px = parseInt(sizeSel.value, 10) || 512;
    canvas.width = px;                               // 선택 크기 그대로 = 다운로드 파일 크기
    canvas.height = px;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";                       // 흰 배경 (스캔 대비 확보)
    ctx.fillRect(0, 0, px, px);
    var n = lastQR.size;
    var scale = Math.max(1, Math.floor(px / (n + 8)));   // 모듈당 정수 픽셀 + quiet zone 4모듈 × 양쪽
    var offset = Math.floor((px - n * scale) / 2);       // 중앙 정렬 → 여백 ≥ 4모듈 보장
    ctx.fillStyle = "#000000";
    for (var r = 0; r < n; r++) {
      var row = lastQR.modules[r];
      for (var c = 0; c < n; c++) {
        if (row[c]) ctx.fillRect(offset + c * scale, offset + r * scale, scale, scale);
      }
    }
    updateStats();
  }

  function generate() {
    if (!window.QRCode || typeof window.QRCode.generate !== "function") {
      showFailure("tool.engineError");               // 엔진 로드 실패 — 빈 화면 금지
      return;
    }
    var text = input.value.replace(/^\s+|\s+$/g, ""); // trim 후 빈 입력 취급 (스펙)
    if (!text) { showFailure("tool.empty"); return; }
    var qr;
    try {
      qr = window.QRCode.generate(text, ecSel.value); // UTF-8 바이트 모드 (비ASCII·이모지 포함)
    } catch (e) {
      showFailure("tool.overflow");                  // 용량 초과 (L 기준 최대 2,953바이트)
      return;
    }
    lastQR = qr;
    msgEl.hidden = true;
    wrapEl.hidden = false;
    dlBtn.disabled = false;
    draw();
  }

  function download() {
    if (!lastQR) return;
    try {
      var a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");        // 서버 왕복 없는 PNG 다운로드
      a.download = "qr-code.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      setMessage("tool.downloadError", true);
    }
  }

  input.addEventListener("input", function () {      // 250ms 디바운스 실시간 생성
    if (timer) clearTimeout(timer);
    timer = setTimeout(generate, DEBOUNCE_MS);
  });
  sizeSel.addEventListener("change", function () { saveOpts(); if (lastQR) draw(); });
  ecSel.addEventListener("change", function () { saveOpts(); generate(); });
  dlBtn.addEventListener("click", download);
  document.addEventListener("i18n:change", updateStats); // 언어 전환 시 동적 문구 갱신

  loadOpts();   // localStorage "qr-gen:opts" 에서 크기·레벨 복원
  generate();   // 초기 상태를 명시적으로 표시 (빈 입력 안내 또는 엔진 오류 안내)
  // TOOLJS:END
})();
