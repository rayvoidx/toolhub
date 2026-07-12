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
  var LAST_KEY = "url-encoder:last";  // 마지막 Text 입력
  var MODE_KEY = "url-encoder:mode";  // "component" | "full"
  var FORM_KEY = "url-encoder:form";  // "1" | "0"

  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }

  /* ---------- DOM ---------- */
  var textEl    = document.getElementById("ue-text");
  var urlEl     = document.getElementById("ue-url");
  var modeCompEl= document.getElementById("mode-component");
  var modeFullEl= document.getElementById("mode-full");
  var formEl    = document.getElementById("ue-form");
  var encodeBtn = document.getElementById("dir-encode");
  var decodeBtn = document.getElementById("dir-decode");
  var clearBtn  = document.getElementById("ue-clear");
  var textErr   = document.getElementById("text-error");
  var textFb    = document.getElementById("text-feedback");
  var queryWrap = document.getElementById("ue-query");
  var queryBody = document.getElementById("ue-query-body");

  if (!textEl || !urlEl) return; // 마크업이 없으면 조용히 중단(셸은 계속 동작)

  var dir = "encode"; // "encode" | "decode"
  function mode() { return (modeFullEl && modeFullEl.checked) ? "full" : "component"; }

  /* ---------- 핵심 변환 (전부 브라우저 로컬, UTF-8 안전) ---------- */

  // Text → 퍼센트 인코딩. mode=full 은 encodeURI(구조문자 보존), 아니면 encodeURIComponent.
  // form 옵션이면 %20 → '+' (application/x-www-form-urlencoded).
  function encode(str) {
    if (str === "") return "";
    var out = mode() === "full" ? encodeURI(str) : encodeURIComponent(str);
    if (formEl && formEl.checked) out = out.replace(/%20/g, "+");
    return out;
  }

  // 퍼센트 인코딩 → Text. form 옵션이면 먼저 '+' → 공백. 무효 입력은 URIError throw.
  function decode(str) {
    if (str === "") return "";
    var s = (formEl && formEl.checked) ? str.replace(/\+/g, " ") : str;
    return mode() === "full" ? decodeURI(s) : decodeURIComponent(s);
  }

  // 쿼리 값 한 칸 디코딩 (항상 컴포넌트 디코딩 + form 옵션). 실패는 {ok:false}.
  function decodeCell(raw) {
    try {
      var s = (formEl && formEl.checked) ? raw.replace(/\+/g, " ") : raw;
      return { text: decodeURIComponent(s), ok: true };
    } catch (e) {
      return { text: raw, ok: false };
    }
  }

  /* ---------- 쿼리스트링 분해 표 (차별점) ---------- */
  function makeCell(res, raw) {
    var td = document.createElement("td");
    td.style.padding = ".35rem .55rem";
    td.style.borderBottom = "1px solid var(--line)";
    td.style.wordBreak = "break-all";
    td.style.fontFamily = "ui-monospace,SFMono-Regular,Menlo,monospace";
    td.style.fontSize = ".85rem";
    if (res.ok) {
      td.textContent = res.text === "" ? "—" : res.text;
      if (res.text === "") td.style.color = "var(--muted)";
    } else {
      td.textContent = raw === "" ? "—" : raw;
      td.style.color = "var(--muted)";
      td.title = t("tool.msg.cellDecodeFail");
    }
    return td;
  }

  function renderQuery(src) {
    if (!queryWrap || !queryBody) return;
    var s = String(src || "");
    // 파라미터 신호가 전혀 없으면 숨김
    if (s.indexOf("?") < 0 && s.indexOf("&") < 0) { queryWrap.hidden = true; queryBody.innerHTML = ""; return; }
    var qs = s;
    var qi = s.indexOf("?");
    if (qi >= 0) qs = s.slice(qi + 1);
    var hi = qs.indexOf("#");
    if (hi >= 0) qs = qs.slice(0, hi);
    var pairs = qs.split("&");
    queryBody.innerHTML = "";
    var rows = 0;
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i];
      if (p === "") continue;
      var eq = p.indexOf("=");
      var rawKey = eq >= 0 ? p.slice(0, eq) : p;
      var rawVal = eq >= 0 ? p.slice(eq + 1) : "";
      var tr = document.createElement("tr");
      tr.appendChild(makeCell(decodeCell(rawKey), rawKey));
      tr.appendChild(makeCell(decodeCell(rawVal), rawVal));
      queryBody.appendChild(tr);
      rows++;
    }
    queryWrap.hidden = rows === 0;
  }

  /* ---------- 방향 표시 ---------- */
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

  /* ---------- 변환 실행 ---------- */
  // 빈 입력은 조용히 통과(에러 아님). 디코드/인코드 실패는 인라인 경고로 명시.
  function convert() {
    hide(textErr);
    if (dir === "encode") {
      try {
        urlEl.value = encode(textEl.value);
      } catch (e) {
        // 짝 없는 서로게이트 등 → encodeURIComponent/encodeURI 가 URIError throw
        urlEl.value = "";
        showMsg(textErr, t("tool.msg.encodeError"), "err");
      }
    } else {
      if (urlEl.value.trim() === "") {
        textEl.value = "";
      } else {
        try {
          textEl.value = decode(urlEl.value);
        } catch (e) {
          textEl.value = "";
          showMsg(textErr, t("tool.msg.invalidUrl"), "err");
        }
      }
    }
    renderQuery(urlEl.value);
  }

  function saveState() {
    try { localStorage.setItem(LAST_KEY, textEl.value); } catch (e) { /* private mode */ }
    try { localStorage.setItem(MODE_KEY, mode()); } catch (e) { /* noop */ }
    try { localStorage.setItem(FORM_KEY, (formEl && formEl.checked) ? "1" : "0"); } catch (e) { /* noop */ }
  }

  /* ---------- 메시지 & 복사 ---------- */
  var timerStore = [];
  function showMsg(el, msg, kind) {
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
    el.style.color = kind === "err" ? "#b91c1c" : (kind === "warn" ? "#b45309" : "var(--accent)");
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

  /* ---------- 이벤트 ---------- */
  textEl.addEventListener("input", function () {
    if (dir !== "encode") setDir("encode");
    convert();
    saveState();
  });
  urlEl.addEventListener("input", function () {
    if (dir !== "decode") setDir("decode");
    convert();
    // 디코드 소스(URL 인코딩)는 저장하지 않음 — :last 는 Text 입력만
    try { localStorage.setItem(LAST_KEY, textEl.value); } catch (e) { /* noop */ }
  });
  if (encodeBtn) encodeBtn.addEventListener("click", function () { setDir("encode"); convert(); saveState(); });
  if (decodeBtn) decodeBtn.addEventListener("click", function () { setDir("decode"); convert(); });
  function onOption() { convert(); saveState(); }
  if (modeCompEl) modeCompEl.addEventListener("change", onOption);
  if (modeFullEl) modeFullEl.addEventListener("change", onOption);
  if (formEl)     formEl.addEventListener("change", onOption);
  if (clearBtn) clearBtn.addEventListener("click", function () {
    textEl.value = "";
    urlEl.value = "";
    hide(textErr);
    if (queryWrap) { queryWrap.hidden = true; queryBody.innerHTML = ""; }
    setDir("encode");
    try { localStorage.removeItem(LAST_KEY); } catch (e) { /* noop */ }
    if (textEl.focus) textEl.focus();
  });

  var copyBtns = document.querySelectorAll(".ue-copy");
  for (var ci = 0; ci < copyBtns.length; ci++) {
    copyBtns[ci].addEventListener("click", function () {
      var target = document.getElementById(this.getAttribute("data-copy"));
      copyText(target ? target.value : "", textFb);
    });
  }

  /* ---------- 언어 전환 시 인라인 문구 재적용 ---------- */
  document.addEventListener("i18n:change", function () {
    if (textErr && !textErr.hidden) {
      showMsg(textErr, t(dir === "encode" ? "tool.msg.encodeError" : "tool.msg.invalidUrl"), "err");
    }
    renderQuery(urlEl.value); // 실패 셀 tooltip 재적용
  });

  /* ---------- 초기화 ---------- */
  (function init() {
    try {
      var m = localStorage.getItem(MODE_KEY);
      if (m === "full" && modeFullEl) modeFullEl.checked = true;
      else if (m === "component" && modeCompEl) modeCompEl.checked = true;
    } catch (e) { /* noop */ }
    try {
      var f = localStorage.getItem(FORM_KEY);
      if (f === "1" && formEl) formEl.checked = true;
    } catch (e) { /* noop */ }
    try {
      var last = localStorage.getItem(LAST_KEY);
      if (typeof last === "string" && last.length > 0) textEl.value = last;
    } catch (e) { /* 손상값 무시 */ }
    setDir("encode");
    convert(); // 복원된 텍스트를 즉시 인코딩
  })();
  // TOOLJS:END
})();
