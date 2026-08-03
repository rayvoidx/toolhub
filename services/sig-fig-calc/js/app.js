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

  // Cloudflare Web Analytics — 쿠키리스·페이지뷰만. 토큰 설정 시에만 로드.
  // 실패해도 본 기능에 영향 없게 격리 (safeTrack 원칙 — 부가 기능은 본 기능과 격리, 철칙 5)
  // 수집 범위는 privacy.html §3 과 일치해야 한다. 도구 입력값은 절대 실리지 않는다(§1 약속).
  if (cfg.analytics && cfg.analytics.cfBeaconToken) {
    try {
      var s = document.createElement("script");
      s.defer = true;
      s.src = "https://static.cloudflareinsights.com/beacon.min.js";
      s.setAttribute("data-cf-beacon", JSON.stringify({ token: cfg.analytics.cfBeaconToken }));
      document.head.appendChild(s);
    } catch (e) { /* 분석 실패는 조용히 무시 — 본 기능에 영향 없음 */ }
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
  var $ = function (id) { return document.getElementById(id); };
  var num = $("num"), figs = $("figs"), tz = $("tz");
  var result = $("result"), errEl = $("err"), noteEl = $("r-note");
  if (!num || !figs) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var NUM_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  /* 규칙: 0이 아닌 숫자는 항상 유효, 유효숫자 사이에 낀 0도 유효, 앞자리 0은 절대 유효하지 않고,
     끝자리 0은 소수점이나 지수 표기가 있을 때만 유효하다. 지수 표기의 가수는 전부 유효로 본다. */
  function analyze(raw, trailingSig) {
    var s = String(raw).replace(/[\s,_]/g, "");
    if (!s) return { err: "tool.err.empty" };
    if (!NUM_RE.test(s)) return { err: "tool.err.invalid" };

    var eAt = s.search(/[eE]/);
    var mant = eAt < 0 ? s : s.slice(0, eAt);
    var expStr = eAt < 0 ? "" : s.slice(eAt);
    var expVal = eAt < 0 ? 0 : parseInt(s.slice(eAt + 1), 10);
    if (Math.abs(expVal) > 300) return { err: "tool.err.range" };
    var v = parseFloat(s);
    if (!isFinite(v)) return { err: "tool.err.range" };

    var hasDot = mant.indexOf(".") >= 0;
    var dotPos = hasDot ? mant.indexOf(".") : mant.length;
    var idx = [], i, c;
    for (i = 0; i < mant.length; i++) { c = mant.charAt(i); if (c >= "0" && c <= "9") idx.push(i); }

    var first = -1, last = -1, ambiguous = false, zero = false;
    for (i = 0; i < idx.length; i++) { if (mant.charAt(idx[i]) !== "0") { first = idx[i]; break; } }
    if (first < 0) {
      zero = true;
      first = idx[idx.length - 1];
      last = first;
    } else if (hasDot || eAt >= 0) {
      last = idx[idx.length - 1];
    } else if (trailingSig) {
      last = idx[idx.length - 1];
    } else {
      for (i = idx.length - 1; i >= 0; i--) { if (mant.charAt(idx[i]) !== "0") { last = idx[i]; break; } }
      if (last !== idx[idx.length - 1]) ambiguous = true;
    }

    var sig = {}, count = 0, digits = "";
    for (i = 0; i < idx.length; i++) {
      if (idx[i] >= first && idx[i] <= last) { sig[idx[i]] = 1; count++; digits += mant.charAt(idx[i]); }
    }
    // 최상위 유효숫자를 1의 자리로 옮길 때 필요한 10의 거듭제곱
    var exp = (first < dotPos ? dotPos - first - 1 : dotPos - first) + expVal;
    // 덧셈·뺄셈 규칙에서 쓰는 소수점 아래 자릿수 (지수 표기는 펼친 기준)
    var frac = hasDot ? mant.length - dotPos - 1 : 0;
    var dp = Math.max(0, frac - expVal);
    return { mant: mant, expStr: expStr, sig: sig, count: count, digits: digits,
      ambiguous: ambiguous, zero: zero, exp: exp, dp: dp, value: v };
  }

  /* toExponential 이 반올림을 맡고, 자릿수를 되돌려 고정소수 표기를 만든다.
     0.00456 처럼 뒤따르는 0 을 살려야 하므로 toFixed 로 자릿수를 고정한다. */
  function roundTo(x, n) {
    var e = x.toExponential(n - 1);
    var p = e.split("e");
    var exp = parseInt(p[1], 10);
    var dec = n - 1 - exp;
    var fixed = null;
    if (dec >= 0 && dec <= 100 && exp > -7) fixed = Number(e).toFixed(dec);
    else if (dec < 0 && exp <= 20) fixed = Number(e).toFixed(0);
    return { fixed: fixed, mant: p[0], exp: exp };
  }

  function mantOf(d) { return d.length > 1 ? d.charAt(0) + "." + d.slice(1) : d; }

  function renderSci(el, mantStr, exp) {
    clear(el);
    el.appendChild(document.createTextNode(mantStr));
    if (exp !== 0) {
      el.appendChild(document.createTextNode(" × 10"));
      var sup = document.createElement("sup");
      sup.textContent = String(exp);
      el.appendChild(sup);
    }
  }

  function renderStrip(el, a) {
    clear(el);
    var i, sp;
    for (i = 0; i < a.mant.length; i++) {
      sp = document.createElement("span");
      sp.className = a.sig[i] ? "sig" : "insig";
      sp.textContent = a.mant.charAt(i);
      el.appendChild(sp);
    }
    if (a.expStr) {
      sp = document.createElement("span");
      sp.className = "insig";
      sp.textContent = a.expStr;
      el.appendChild(sp);
    }
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var a = analyze(num.value, !!(tz && tz.checked));
    if (a.err) return fail(a.err);

    var nRaw = String(figs.value).replace(/\s/g, "");
    var n = 0;
    if (nRaw) {
      n = Number(nRaw);
      if (!isFinite(n) || n !== Math.floor(n) || n < 1 || n > 15) return fail("tool.err.round");
    }

    $("r-count").textContent = String(a.count);
    renderStrip($("r-digits"), a);

    if (n) {
      var r = roundTo(a.value, n);
      $("r-rounded").textContent = r.fixed !== null ? r.fixed : r.mant + "e" + r.exp;
      renderSci($("r-sci"), r.mant, r.exp);
      $("r-dp").textContent = String(Math.max(0, n - 1 - r.exp));
    } else {
      $("r-rounded").textContent = "—";
      renderSci($("r-sci"), a.zero ? "0" : mantOf(a.digits), a.zero ? 0 : a.exp);
      $("r-dp").textContent = String(a.dp);
    }

    var noteKey = a.zero ? "tool.note.zero" : (a.ambiguous ? "tool.note.ambig" : "");
    noteEl.hidden = !noteKey;
    noteEl.textContent = noteKey ? t(noteKey) : "";

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  if (tz) tz.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  [num, figs].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
