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
  var LAST_KEY    = "base64-conv:last";     // 마지막 Text 입력
  var URLSAFE_KEY = "base64-conv:urlsafe";  // URL-safe 옵션
  var MAX_IMG     = 10 * 1024 * 1024;       // 대용량 이미지 경고 임계 (10MB)

  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }

  /* ---------- 핵심 변환 (UTF-8 안전, 전부 브라우저 로컬) ---------- */

  // Text → Base64. urlSafe 시 Base64URL(RFC 4648 §5) 로 변환.
  function encodeText(str, urlSafe) {
    if (str === "") return "";
    var bytes = new TextEncoder().encode(str);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var out = btoa(bin);
    if (urlSafe) out = out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return out;
  }

  // Base64(표준/URL-safe, 공백·개행 허용) → Text. 잘못된 입력은 throw.
  function decodeText(b64) {
    var s = b64.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    if (s === "") return "";
    while (s.length % 4) s += "=";
    var bin = atob(s); // 알파벳 밖 문자면 InvalidCharacterError throw
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  /* ---------- 공통: 클립보드 복사 ---------- */

  function copyText(value, feedbackEl) {
    if (!value) { showMsg(feedbackEl, t("tool.msg.nothingToCopy"), "warn"); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(
        function () { showMsg(feedbackEl, t("tool.msg.copied"), "ok"); },
        function () { fallbackCopy(value, feedbackEl); }
      );
    } else {
      fallbackCopy(value, feedbackEl);
    }
  }

  function fallbackCopy(value, feedbackEl) {
    try {
      var ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      showMsg(feedbackEl, ok ? t("tool.msg.copied") : t("tool.msg.copyError"), ok ? "ok" : "err");
    } catch (e) {
      showMsg(feedbackEl, t("tool.msg.copyError"), "err");
    }
  }

  // feedback/error <p> 요소에 메시지 표시. kind: ok | warn | err
  var timerStore = [];
  function showMsg(el, msg, kind) {
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
    el.style.color = kind === "err" ? "#b91c1c" : (kind === "warn" ? "#b45309" : "var(--accent)");
    // 임시 메시지(ok/warn)는 자동 숨김, 에러는 다음 액션까지 유지
    clearElTimer(el);
    if (kind !== "err") {
      var id = setTimeout(function () { el.hidden = true; }, 2400);
      timerStore.push({ el: el, id: id });
    }
  }
  function clearElTimer(el) {
    for (var i = timerStore.length - 1; i >= 0; i--) {
      if (timerStore[i].el === el) { clearTimeout(timerStore[i].id); timerStore.splice(i, 1); }
    }
  }
  function hide(el) { if (el) { el.hidden = true; el.textContent = ""; } }

  /* ============================ TEXT 탭 ============================ */

  var textEl    = document.getElementById("b64-text");
  var b64El     = document.getElementById("b64-b64");
  var urlSafeEl = document.getElementById("b64-urlsafe");
  var encodeBtn = document.getElementById("dir-encode");
  var decodeBtn = document.getElementById("dir-decode");
  var clearBtn  = document.getElementById("b64-clear");
  var textErr   = document.getElementById("text-error");
  var textFb    = document.getElementById("text-feedback");

  var dir = "encode"; // "encode" | "decode"

  function styleDirBtn(btn, active) {
    if (!btn) return;
    btn.style.background  = active ? "var(--accent)" : "var(--bg)";
    btn.style.color       = active ? "#fff" : "var(--ink)";
    btn.style.borderColor = active ? "var(--accent)" : "var(--line)";
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }
  function setDir(next) {
    dir = next;
    styleDirBtn(encodeBtn, dir === "encode");
    styleDirBtn(decodeBtn, dir === "decode");
  }

  // 현재 방향으로 변환 실행. 빈 입력은 조용히 통과(에러 아님), 디코드 실패는 명시적 안내.
  function convert() {
    hide(textErr);
    if (dir === "encode") {
      b64El.value = encodeText(textEl.value, urlSafeEl.checked);
    } else {
      if (b64El.value.trim() === "") { textEl.value = ""; return; }
      try {
        textEl.value = decodeText(b64El.value);
      } catch (e) {
        textEl.value = "";
        showMsg(textErr, t("tool.msg.invalidB64"), "err");
      }
    }
  }

  function saveState() {
    try { localStorage.setItem(LAST_KEY, textEl.value); } catch (e) { /* private mode */ }
    try { localStorage.setItem(URLSAFE_KEY, urlSafeEl.checked ? "1" : "0"); } catch (e) { /* noop */ }
  }

  if (textEl) {
    textEl.addEventListener("input", function () {
      if (dir !== "encode") setDir("encode");
      convert();
      saveState();
    });
  }
  if (b64El) {
    b64El.addEventListener("input", function () {
      if (dir !== "decode") setDir("decode");
      convert();
      // 디코드 소스(Base64)는 저장하지 않음 — :last 는 Text 입력만
      try { localStorage.setItem(LAST_KEY, textEl.value); } catch (e) { /* noop */ }
    });
  }
  if (encodeBtn) encodeBtn.addEventListener("click", function () { setDir("encode"); convert(); saveState(); });
  if (decodeBtn) decodeBtn.addEventListener("click", function () { setDir("decode"); convert(); });
  if (urlSafeEl) urlSafeEl.addEventListener("change", function () {
    if (dir === "encode") convert();
    saveState();
  });
  if (clearBtn) clearBtn.addEventListener("click", function () {
    textEl.value = "";
    b64El.value = "";
    hide(textErr);
    setDir("encode");
    try { localStorage.removeItem(LAST_KEY); } catch (e) { /* noop */ }
    if (textEl.focus) textEl.focus();
  });

  /* ============================ IMAGE 탭 ============================ */

  var fileEl     = document.getElementById("img-file");
  var dropEl     = document.getElementById("img-drop");
  var encOut     = document.getElementById("img-enc-out");
  var previewEl  = document.getElementById("img-preview");
  var infoEl     = document.getElementById("img-info");
  var dataUriEl  = document.getElementById("img-datauri");
  var rawEl      = document.getElementById("img-raw");
  var decInEl    = document.getElementById("img-decode-in");
  var decBtn     = document.getElementById("img-decode-btn");
  var downloadEl = document.getElementById("img-download");
  var decPrevWrap= document.getElementById("img-dec-preview");
  var decodedImg = document.getElementById("img-decoded");
  var imgErr     = document.getElementById("img-error");
  var imgFb      = document.getElementById("img-feedback");

  function handleFile(file) {
    hide(imgErr); hide(imgFb);
    if (!file) return;
    if (!/^image\//.test(file.type || "")) { showMsg(imgErr, t("tool.msg.notImageFile"), "err"); return; }
    if (file.size > MAX_IMG) { showMsg(imgFb, t("tool.msg.largeImage"), "warn"); }
    var reader = new FileReader();
    reader.onload = function () {
      var uri = String(reader.result || "");
      previewEl.src = uri;
      dataUriEl.value = uri;
      var comma = uri.indexOf(",");
      rawEl.value = comma >= 0 ? uri.slice(comma + 1) : uri;
      infoEl.textContent = (file.type || "image") + " · " + formatSize(file.size);
      encOut.hidden = false;
    };
    reader.onerror = function () { showMsg(imgErr, t("tool.msg.readError"), "err"); };
    try { reader.readAsDataURL(file); }
    catch (e) { showMsg(imgErr, t("tool.msg.readError"), "err"); }
  }

  if (fileEl) fileEl.addEventListener("change", function () {
    handleFile(fileEl.files && fileEl.files[0]);
  });
  if (dropEl) {
    ["dragenter", "dragover"].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault(); dropEl.style.borderColor = "var(--accent)"; dropEl.style.color = "var(--accent)";
      });
    });
    ["dragleave", "dragend", "drop"].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault(); dropEl.style.borderColor = "var(--line)"; dropEl.style.color = "var(--muted)";
      });
    });
    dropEl.addEventListener("drop", function (e) {
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) handleFile(dt.files[0]);
    });
    dropEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileEl.click(); }
    });
  }

  function decodeImage() {
    hide(imgErr); hide(imgFb);
    decPrevWrap.hidden = true;
    downloadEl.hidden = true;
    var raw = (decInEl.value || "").trim();
    if (!raw) { showMsg(imgErr, t("tool.msg.pasteFirst"), "err"); return; }
    var src = /^data:/i.test(raw) ? raw : ("data:image/png;base64," + raw.replace(/\s+/g, ""));
    decodedImg.onload = function () {
      decPrevWrap.hidden = false;
      downloadEl.hidden = false;
      downloadEl.href = src;
      var mime = (src.match(/^data:([^;,]+)/i) || [])[1] || "image/png";
      var ext = (mime.split("/")[1] || "png").split("+")[0];
      downloadEl.setAttribute("download", "image." + ext);
    };
    decodedImg.onerror = function () {
      decPrevWrap.hidden = true;
      downloadEl.hidden = true;
      showMsg(imgErr, t("tool.msg.notImage"), "err");
    };
    decodedImg.src = src;
  }
  if (decBtn) decBtn.addEventListener("click", decodeImage);

  /* ---------- 복사 버튼 (양 패널 공통) ---------- */

  var copyBtns = document.querySelectorAll(".b64-copy");
  for (var ci = 0; ci < copyBtns.length; ci++) {
    copyBtns[ci].addEventListener("click", function () {
      var target = document.getElementById(this.getAttribute("data-copy"));
      var fb = (this.closest && this.closest("#panel-image")) ? imgFb : textFb;
      copyText(target ? target.value : "", fb);
    });
  }

  /* ============================ 탭 전환 ============================ */

  var tabText  = document.getElementById("tab-text");
  var tabImage = document.getElementById("tab-image");
  var panelText  = document.getElementById("panel-text");
  var panelImage = document.getElementById("panel-image");

  function selectTab(which) {
    var isText = which === "text";
    panelText.hidden = !isText;
    panelImage.hidden = isText;
    styleTab(tabText, isText);
    styleTab(tabImage, !isText);
  }
  function styleTab(btn, active) {
    if (!btn) return;
    btn.style.background  = active ? "var(--accent)" : "var(--bg)";
    btn.style.color       = active ? "#fff" : "var(--ink)";
    btn.style.borderColor = active ? "var(--accent)" : "var(--line)";
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }
  if (tabText)  tabText.addEventListener("click",  function () { selectTab("text"); });
  if (tabImage) tabImage.addEventListener("click", function () { selectTab("image"); });

  /* ---------- 언어 전환 시 인라인 에러 문구 재적용 ---------- */
  document.addEventListener("i18n:change", function () {
    if (!textErr.hidden && dir === "decode") showMsg(textErr, t("tool.msg.invalidB64"), "err");
  });

  /* ============================ 초기화 ============================ */
  (function init() {
    try {
      var us = localStorage.getItem(URLSAFE_KEY);
      if (us === "1" && urlSafeEl) urlSafeEl.checked = true;
    } catch (e) { /* noop */ }
    try {
      var last = localStorage.getItem(LAST_KEY);
      if (typeof last === "string" && last.length > 0 && textEl) textEl.value = last;
    } catch (e) { /* 손상값 무시 */ }
    setDir("encode");
    convert(); // 복원된 텍스트를 즉시 인코딩
  })();
  // TOOLJS:END
})();
