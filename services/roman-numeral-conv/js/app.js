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
  var SLUG = cfg.slug || "roman-numeral-conv";
  var LS_MODE = SLUG + ":mode";        // 상태 저장은 "<slug>:" prefix 만 사용 (mode 만 저장, 입력값은 저장 안 함)
  var MAX = 3999999;                   // 지원 상한 (vinculum 표기)
  var OVERLINE = "̅";             // 결합 윗줄 (복사·정규형 텍스트 보존용)

  /* ============================================================
     순수 계산 (node 단위 검증 대상 — module.exports 로 노출)
     ============================================================ */
  var TABLE = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
  ];
  var BASE = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

  // 0..3999 → 로마자 문자열 (0 → "")
  function basicRoman(num) {
    var out = "";
    for (var i = 0; i < TABLE.length; i++) {
      while (num >= TABLE[i][0]) { out += TABLE[i][1]; num -= TABLE[i][0]; }
    }
    return out;
  }

  // n → 세그먼트 [{text, over}] : n<4000 은 단일 일반, n>=4000 은 천단위(윗줄)+나머지
  function romanSegments(n) {
    if (n < 4000) return [{ text: basicRoman(n), over: false }];
    var th = Math.floor(n / 1000), rem = n % 1000;
    var segs = [{ text: basicRoman(th), over: true }];
    if (rem > 0) segs.push({ text: basicRoman(rem), over: false });
    return segs;
  }
  // 세그먼트 → 복사·정규형 텍스트 (윗줄 문자는 각 글자 뒤 U+0305)
  function segPlain(segs) {
    var o = "";
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      for (var j = 0; j < s.text.length; j++) o += s.text[j] + (s.over ? OVERLINE : "");
    }
    return o;
  }
  function toRomanPlain(n) { return segPlain(romanSegments(n)); }

  // 로마자 문자열 토큰화 (윗줄 문자 = ×1000). 허용 외 문자면 null.
  function tokenizeRoman(s) {
    var tokens = [], norm = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (!Object.prototype.hasOwnProperty.call(BASE, ch)) return null;
      var over = false;
      while (i + 1 < s.length && (s[i + 1] === "̅" || s[i + 1] === "̄")) { over = true; i++; }
      tokens.push({ v: BASE[ch] * (over ? 1000 : 1) });
      norm += ch + (over ? OVERLINE : "");
    }
    return { tokens: tokens, norm: norm };
  }

  // 로마자 → 숫자. 감산 표기 파싱 후 재인코딩으로 정규형 검증.
  function romanToNumber(raw) {
    var s = String(raw == null ? "" : raw).toUpperCase().replace(/\s+/g, "");
    if (s === "") return { empty: true };
    var tk = tokenizeRoman(s);
    if (tk === null || !tk.tokens.length) return { error: "badChars" };
    var total = 0, t = tk.tokens;
    for (var i = 0; i < t.length; i++) {
      var cur = t[i].v, nxt = (i + 1 < t.length) ? t[i + 1].v : 0;
      if (cur < nxt) total -= cur; else total += cur;
    }
    if (total < 1 || total > MAX) return { error: "notRomanPlain" };
    if (toRomanPlain(total) !== tk.norm) return { error: "notRoman", suggestion: total };
    return { value: total };
  }

  // 숫자 입력 분류 (Number 모드) — 자동 절삭 금지, 명시 안내
  function classifyNumber(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (s === "") return { empty: true };
    var stripped = s.replace(/[,\s]/g, "");        // 자릿수 구분 쉼표/공백만 제거
    if (/^[+]?\d+$/.test(stripped)) {
      var n = parseInt(stripped, 10);
      if (n === 0) return { error: "zeroNeg" };
      if (n > MAX) return { error: "tooBig" };
      return { value: n };
    }
    if (/^-\d+$/.test(stripped)) return { error: "zeroNeg" };
    if (/^[+-]?(\d+\.\d*|\.\d+|\d+\.)$/.test(stripped)) return { error: "notWhole" };
    return { error: "notNumber" };
  }

  // 십진 자릿수별 분해 (단계별 분해 패널용) → [{value, roman, over}]
  function decomposeTerms(n) {
    var terms = [];
    function pushDigits(str, scale, over) {
      for (var i = 0; i < str.length; i++) {
        var d = +str[i];
        if (!d) continue;
        var placeVal = d * Math.pow(10, str.length - 1 - i);
        terms.push({ value: placeVal * scale, roman: basicRoman(placeVal), over: over });
      }
    }
    if (n >= 4000) {
      var th = Math.floor(n / 1000), rem = n % 1000;
      pushDigits(String(th), 1000, true);
      if (rem > 0) pushDigits(String(rem), 1, false);
    } else {
      pushDigits(String(n), 1, false);
    }
    return terms;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      basicRoman: basicRoman, toRomanPlain: toRomanPlain, romanToNumber: romanToNumber,
      classifyNumber: classifyNumber, decomposeTerms: decomposeTerms, MAX: MAX
    };
  }

  /* ============================================================
     DOM / 뷰
     ============================================================ */
  function $(id) { return document.getElementById(id); }
  var tabN2R = $("tab-n2r"), tabR2N = $("tab-r2n");
  var input = $("conv-input"), label = $("conv-label"), swapBtn = $("swap-btn");
  var resultMain = $("result-main"), copyBtn = $("copy-btn"), errorEl = $("result-error");
  var stepsWrap = $("result-steps"), stepsBody = $("steps-body");
  if (!tabN2R || !tabR2N || !input || !resultMain) return;

  function tr(key, fallback) {
    try { if (window.I18N) { var v = window.I18N.t(key); if (v != null) return v; } }
    catch (e) { /* i18n 부재 폴백 */ }
    return fallback;
  }
  function esc(str) {
    return String(str).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function group(n) { return Number(n).toLocaleString("en-US"); }
  function segHTML(segs) {
    var o = "";
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      o += s.over ? '<span style="text-decoration:overline;">' + esc(s.text) + "</span>" : esc(s.text);
    }
    return o;
  }
  function termHTML(t) {
    return t.over ? '<span style="text-decoration:overline;">' + esc(t.roman) + "</span>" : esc(t.roman);
  }

  /* ---- 상태 ---- */
  var mode = "n2r";               // n2r | r2n
  var copyText = "";              // 현재 성공 결과의 복사값
  var lastOut = { n2r: "", r2n: "" }; // 방향 스왑용 마지막 성공 출력 (n2r→로마 plain, r2n→숫자)

  /* ---- 결과 렌더 ---- */
  function clearResult(dash) {
    resultMain.textContent = dash ? "—" : "";
    copyBtn.hidden = true;
    errorEl.hidden = true; errorEl.textContent = "";
    stepsWrap.hidden = true; stepsBody.innerHTML = "";
    copyText = "";
  }
  function showError(key, suggestion) {
    resultMain.textContent = "—";
    copyBtn.hidden = true;
    stepsWrap.hidden = true; stepsBody.innerHTML = "";
    copyText = "";
    if (key === "notRoman" && suggestion != null) {
      var msg = tr("tool.err.notRoman", "Not a valid Roman numeral. Did you mean {x}?");
      errorEl.innerHTML = esc(msg).replace("{x}", "<b>" + segHTML(romanSegments(suggestion)) + "</b>");
    } else {
      errorEl.textContent = tr("tool.err." + key, key);
    }
    errorEl.hidden = false;
  }
  function renderBreakdown(n, direction) {
    var terms = decomposeTerms(n), parts = [], i;
    var romanFull = segHTML(romanSegments(n));
    if (direction === "n2r") {
      for (i = 0; i < terms.length; i++) parts.push(group(terms[i].value) + " (" + termHTML(terms[i]) + ")");
      stepsBody.innerHTML = group(n) + " = " + parts.join(" + ") + " = " + romanFull;
    } else {
      for (i = 0; i < terms.length; i++) parts.push(termHTML(terms[i]) + " (" + group(terms[i].value) + ")");
      stepsBody.innerHTML = romanFull + " = " + parts.join(" + ") + " = " + group(n);
    }
    stepsWrap.hidden = false;
  }

  /* ---- 변환 ---- */
  function convert() {
    var raw = input.value;
    if (mode === "n2r") {
      var r = classifyNumber(raw);
      if (r.empty) { clearResult(true); return; }
      if (r.error) { showError(r.error); return; }
      var segs = romanSegments(r.value);
      resultMain.innerHTML = segHTML(segs);
      copyText = segPlain(segs);
      copyBtn.hidden = false;
      errorEl.hidden = true;
      renderBreakdown(r.value, "n2r");
      lastOut.n2r = copyText;
    } else {
      var q = romanToNumber(raw);
      if (q.empty) { clearResult(true); return; }
      if (q.error) { showError(q.error, q.suggestion); return; }
      resultMain.textContent = group(q.value);
      copyText = String(q.value);
      copyBtn.hidden = false;
      errorEl.hidden = true;
      renderBreakdown(q.value, "r2n");
      lastOut.r2n = copyText;
    }
  }

  /* ---- 모드 적용 ---- */
  function applyMode(next, keepInput) {
    mode = (next === "r2n") ? "r2n" : "n2r";
    var on = mode === "n2r";
    tabN2R.setAttribute("aria-selected", on ? "true" : "false");
    tabR2N.setAttribute("aria-selected", on ? "false" : "true");
    tabN2R.style.background = on ? "var(--accent)" : "transparent";
    tabN2R.style.color = on ? "#fff" : "var(--ink)";
    tabR2N.style.background = on ? "transparent" : "var(--accent)";
    tabR2N.style.color = on ? "var(--ink)" : "#fff";
    input.setAttribute("inputmode", on ? "numeric" : "text");
    input.setAttribute("data-i18n-placeholder", on ? "tool.phNumber" : "tool.phRoman");
    label.setAttribute("data-i18n", on ? "tool.labelNumber" : "tool.labelRoman");
    label.textContent = tr(on ? "tool.labelNumber" : "tool.labelRoman", label.textContent);
    input.placeholder = tr(on ? "tool.phNumber" : "tool.phRoman", input.placeholder);
    if (!keepInput) { input.value = ""; clearResult(true); }
    try { localStorage.setItem(LS_MODE, mode); } catch (e) { /* private mode — 세션 한정 */ }
  }

  /* ---- 방향 스왑: 현재 결과를 반대 모드 입력으로 ---- */
  function swap() {
    var target = mode === "n2r" ? "r2n" : "n2r";
    var carry = mode === "n2r" ? lastOut.n2r : lastOut.r2n; // 현재 모드의 마지막 성공 출력
    applyMode(target, true);
    input.value = carry || "";
    convert();
    input.focus();
  }

  /* ---- 복사 (clipboard 실패 시 textarea 폴백) ---- */
  function flashCopied() {
    var orig = tr("tool.copy", "Copy");
    copyBtn.textContent = tr("tool.copied", "Copied!");
    setTimeout(function () { copyBtn.textContent = orig; }, 1300);
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      flashCopied();
    } catch (e) { /* 복사 불가 환경 — 조용히 무시(결과는 화면에 그대로 노출) */ }
  }
  function doCopy() {
    if (!copyText) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(copyText).then(flashCopied, function () { fallbackCopy(copyText); });
    } else {
      fallbackCopy(copyText);
    }
  }

  /* ---- 이벤트 ---- */
  tabN2R.addEventListener("click", function () { if (mode !== "n2r") applyMode("n2r", false); });
  tabR2N.addEventListener("click", function () { if (mode !== "r2n") applyMode("r2n", false); });
  input.addEventListener("input", function () {
    if (mode === "r2n") {
      var up = input.value.toUpperCase();
      if (up !== input.value) input.value = up; // 로마 모드 자동 대문자화
    }
    convert();
  });
  swapBtn.addEventListener("click", swap);
  copyBtn.addEventListener("click", doCopy);

  // 언어 전환 시 동적 문구(라벨·플레이스홀더·에러·결과) 재렌더
  document.addEventListener("i18n:change", function () {
    var on = mode === "n2r";
    label.textContent = tr(on ? "tool.labelNumber" : "tool.labelRoman", label.textContent);
    input.placeholder = tr(on ? "tool.phNumber" : "tool.phRoman", input.placeholder);
    convert();
  });

  /* ---- 초기화: 저장된 모드 복원 (입력값은 저장하지 않음) ---- */
  var savedMode = null;
  try { savedMode = localStorage.getItem(LS_MODE); } catch (e) { /* noop */ }
  applyMode(savedMode === "r2n" ? "r2n" : "n2r", true);
  clearResult(true);
  // TOOLJS:END
})();
