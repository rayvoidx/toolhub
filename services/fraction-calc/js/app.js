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
  // fraction-calc — 부동소수 없는 정확한 BigInt 분수 산술 (spec: factory/state/fraction-calc.yaml)
  // 상태: localStorage "fraction-calc:state" (탭·입력·연산). 외부 API 없음.
  var cfg = window.APP_CONFIG || {};
  var STORE_KEY = (cfg.slug || "fraction-calc") + ":state";

  /* ---- i18n 헬퍼 ---- */
  function t(key) {
    var s = window.I18N && window.I18N.t(key);
    return (s != null) ? s : key;
  }
  function fmt(s, params) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return (params && params[k] != null) ? String(params[k]) : m;
    });
  }
  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ================= 순수 계산 코어 (BigInt — 부동소수 없음) ================= */
  function bAbs(x) { return x < 0n ? -x : x; }
  function bGcd(a, b) {
    a = bAbs(a); b = bAbs(b);
    while (b) { var r = a % b; a = b; b = r; }
    return a; // gcd(0,0)=0
  }
  /** 분모 부호를 항상 +로 정규화(음수는 분자에 싣는다) */
  function normSign(n, d) {
    if (d < 0n) { n = -n; d = -d; }
    return { n: n, d: d };
  }
  /** 기약분수로 약분. 반환 {n,d,g}. g=사용한 GCD. 0/x → 0/1(g=|x|). d=0 은 그대로 반환(호출부에서 차단) */
  function reduce(n, d) {
    if (d === 0n) return { n: n, d: 0n, g: 0n };
    var s = normSign(n, d);
    n = s.n; d = s.d;
    if (n === 0n) return { n: 0n, d: 1n, g: d };
    var g = bGcd(n, d);
    return { n: n / g, d: d / g, g: g };
  }
  /** 두 분수 연산(약분 전). 반환 {n,d} 또는 0으로 나누기 시 null */
  function applyOp(Na, Da, Nb, Db, op) {
    if (op === "+") return { n: Na * Db + Nb * Da, d: Da * Db };
    if (op === "-") return { n: Na * Db - Nb * Da, d: Da * Db };
    if (op === "*") return { n: Na * Nb, d: Da * Db };
    if (op === "/") {
      if (Nb === 0n) return null; // 0 으로 나누기
      return { n: Na * Db, d: Da * Nb };
    }
    return null;
  }
  /** BigInt n/d 의 소수 근사 (최대 6자리). d>0 가정. {text, exact} */
  function decimalString(n, d) {
    var neg = n < 0n;
    var a = bAbs(n);
    var intPart = a / d;
    var rem = a % d;
    if (rem === 0n) return { text: (neg ? "-" : "") + intPart.toString(), exact: true };
    var digits = "";
    var exact = false;
    for (var i = 0; i < 6; i++) {
      rem = rem * 10n;
      digits += (rem / d).toString();
      rem = rem % d;
      if (rem === 0n) { exact = true; break; }
    }
    return { text: (neg ? "-" : "") + intPart.toString() + "." + digits, exact: exact };
  }
  /** 가분수 → 대분수 문자열 "w r/d" (|n|>d 일 때만 의미). d>0 가정 */
  function mixedString(n, d) {
    var neg = n < 0n;
    var a = bAbs(n);
    var w = a / d;
    var rem = a % d;
    return (neg ? "-" : "") + w.toString() + " " + rem.toString() + "/" + d.toString();
  }
  function fracStr(n, d) { return (d === 1n) ? n.toString() : (n.toString() + "/" + d.toString()); }
  function opSym(op) { return op === "+" ? "+" : op === "-" ? "−" : op === "*" ? "×" : "÷"; }

  // node 단위 검증 훅 (UI 상태 아님)
  window.__FC_TEST = {
    gcd: bGcd, reduce: reduce, applyOp: applyOp,
    decimalString: decimalString, mixedString: mixedString, readFrac: null
  };

  /* ---- 입력 파싱 ---- */
  /** "정수" 문자열 파싱. {n:BigInt|null, empty:bool, bad:bool} */
  function parseIntStr(str) {
    var s = String(str == null ? "" : str).trim();
    if (s === "") return { n: null, empty: true, bad: false };
    if (/^[+-]?\d+$/.test(s)) return { n: BigInt(s), empty: false, bad: false };
    return { n: null, empty: false, bad: true }; // 소수·문자 → bad
  }
  /**
   * whole/num/den 세 칸 → 분수. 반환 {status, N, D}
   * status: "ok" | "empty" | "needDen" | "needNum" | "zeroDen" | "bad"
   * 대분수→가분수: 정수부 부호를 종합, 분모 부호는 분자로 흡수.
   */
  function readFrac(wv, nv, dv) {
    var W = parseIntStr(wv), N = parseIntStr(nv), D = parseIntStr(dv);
    if (W.bad || N.bad || D.bad) return { status: "bad" };
    var hasW = !W.empty, hasN = !N.empty, hasD = !D.empty;
    if (!hasW && !hasN && !hasD) return { status: "empty" };
    if (hasW && !hasN && !hasD) return { status: "ok", N: W.n, D: 1n }; // whole 만 → 정수
    if (!hasD) return { status: "needDen" };
    if (!hasN && !hasW) return { status: "needNum" }; // 분모만 입력
    if (D.n === 0n) return { status: "zeroDen" };
    var dsign = D.n < 0n ? -1n : 1n;
    var den = bAbs(D.n);
    var num = (hasN ? N.n : 0n) * dsign;
    if (hasW) {
      var wsign = W.n < 0n ? -1n : 1n;
      var wabs = bAbs(W.n);
      var numAbs = bAbs(num);
      return { status: "ok", N: wsign * (wabs * den + numAbs), D: den };
    }
    return { status: "ok", N: num, D: den };
  }
  window.__FC_TEST.readFrac = readFrac;

  /* ---- 풀이 단계 조립 ---- */
  function addReduceStep(steps, n, d) {
    var s = normSign(n, d);
    var r = reduce(s.n, s.d);
    if (r.g > 1n) {
      steps.push({ label: fmt(t("tool.step.reduce"), { g: r.g.toString() }), expr: "= " + fracStr(r.n, r.d) });
    } else {
      steps.push({ label: t("tool.step.lowest"), expr: "= " + fracStr(r.n, r.d) });
    }
  }
  function buildStepsCalc(Na, Da, Nb, Db, op, mixed) {
    var steps = [];
    if (mixed) {
      steps.push({ label: t("tool.step.improper"),
        expr: fracStr(Na, Da) + "   " + opSym(op) + "   " + fracStr(Nb, Db) });
    }
    if (op === "+" || op === "-") {
      var sym = (op === "+") ? "+" : "−";
      var combN = (op === "+") ? (Na * Db + Nb * Da) : (Na * Db - Nb * Da);
      var combD = Da * Db;
      steps.push({ label: t("tool.step.common"),
        expr: "(" + Na.toString() + "×" + Db.toString() + " " + sym + " " +
          Nb.toString() + "×" + Da.toString() + ") / (" + Da.toString() + "×" + Db.toString() + ")" });
      steps.push({ label: t("tool.step.combine"), expr: "= " + fracStr(combN, combD) });
      addReduceStep(steps, combN, combD);
    } else if (op === "*") {
      var mN = Na * Nb, mD = Da * Db;
      steps.push({ label: t("tool.step.across"),
        expr: Na.toString() + "×" + Nb.toString() + " / " + Da.toString() + "×" + Db.toString() +
          " = " + fracStr(mN, mD) });
      addReduceStep(steps, mN, mD);
    } else if (op === "/") {
      steps.push({ label: t("tool.step.reciprocal"),
        expr: fracStr(Na, Da) + " × " + fracStr(Db, Nb) + " = " + fracStr(Na * Db, Da * Nb) });
      addReduceStep(steps, Na * Db, Da * Nb);
    }
    return steps;
  }

  /* ================= 아래는 DOM 의존부 — node 검증에서는 실행되지 않는다 ================= */
  if (typeof document === "undefined" || !document.getElementById) return;

  var els = {
    tabs: document.querySelectorAll(".fc-tab"),
    panelCalc: document.getElementById("fc-panel-calc"),
    panelSimplify: document.getElementById("fc-panel-simplify"),
    aw: document.getElementById("fc-a-w"), an: document.getElementById("fc-a-n"), ad: document.getElementById("fc-a-d"),
    bw: document.getElementById("fc-b-w"), bn: document.getElementById("fc-b-n"), bd: document.getElementById("fc-b-d"),
    op: document.getElementById("fc-op"),
    sn: document.getElementById("fc-s-n"), sd: document.getElementById("fc-s-d"),
    result: document.getElementById("fc-result"),
    resultS: document.getElementById("fc-result-s")
  };
  if (!els.panelCalc) return; // 이 페이지에 도구가 없으면 종료
  var activeTab = "calc";

  function val(el) { return el ? el.value : ""; }

  /* ---- 결과 조각 렌더 ---- */
  function fracViewHtml(n, d) {
    if (d === 1n) return '<span class="fc-int">' + escHtml(n.toString()) + "</span>";
    return '<span class="fc-frac-view"><span class="fc-n">' + escHtml(n.toString()) +
      '</span><span class="fc-d">' + escHtml(d.toString()) + "</span></span>";
  }
  function copyString(n, d) { return (d === 1n) ? n.toString() : (n.toString() + "/" + d.toString()); }

  /** 결과 자릿수에 따른 축소 단계 클래스. 큰 글씨가 375px 카드를 넘지 않게 한다.
   *  줄바꿈(CSS overflow-wrap)이 최종 안전망이라 아래 임계값은 가독성 튜닝일 뿐이다. */
  function answerClass(n, d) {
    var isInt = (d === 1n);
    var len = isInt ? n.toString().length
      : Math.max(n.toString().length, d.toString().length);
    // 임계값은 375px(.fc-answer 가용 263px) 실측 기준 — 그 폭에서 한 줄에 들어가는 자릿수.
    var lo = isInt ? 9 : 10;    // 기본 크기(정수 44px / 분수 34px)
    var hi = isInt ? 15 : 17;   // is-long(정수 26px / 분수 21px)
    if (len > hi) return " is-xlong";
    if (len > lo) return " is-long";
    return "";
  }

  /** 결과 블록 HTML. r={n,d,g}. opts={showGcd, steps, note} */
  function resultHtml(r, opts) {
    opts = opts || {};
    var n = r.n, d = r.d, html = "";
    if (opts.note) html += '<p class="fc-note">ⓘ ' + escHtml(opts.note) + "</p>";
    html += '<div class="fc-answer' + answerClass(n, d) + '">' + fracViewHtml(n, d) + "</div>";
    if (d !== 1n && bAbs(n) > d) {
      html += '<p class="fc-line"><b>' + escHtml(t("tool.r.mixed")) + "</b><span>" +
        escHtml(mixedString(n, d)) + "</span></p>";
    }
    if (d !== 1n) {
      var dec = decimalString(n, d);
      html += '<p class="fc-line"><b>' + escHtml(t("tool.r.decimal")) + "</b><span>" +
        (dec.exact ? "= " : "≈ ") + escHtml(dec.text) + "</span></p>";
    }
    if (opts.showGcd) {
      html += '<p class="fc-line"><b>' + escHtml(t("tool.r.gcd")) + "</b><span>" +
        escHtml(r.g.toString()) + "</span></p>";
    }
    html += '<div class="fc-actions"><button type="button" class="btn fc-copy" data-copy="' +
      escHtml(copyString(n, d)) + '">' + escHtml(t("tool.r.copy")) +
      '</button><span class="fc-status" hidden></span></div>';
    if (opts.steps && opts.steps.length) {
      html += '<details class="fc-steps"><summary>' + escHtml(t("tool.r.steps")) + "</summary><ol>";
      for (var i = 0; i < opts.steps.length; i++) {
        var st = opts.steps[i];
        html += "<li>" + escHtml(st.label);
        if (st.expr) html += '<span class="fc-expr">' + escHtml(st.expr) + "</span>";
        html += "</li>";
      }
      html += "</ol></details>";
    }
    return html;
  }
  function msgHtml(msg) { return '<p class="fc-msg">' + escHtml(msg) + "</p>"; }
  function errHtml(msg) { return '<p class="fc-err">ⓘ ' + escHtml(msg) + "</p>"; }
  function statusToMsg(status, emptyKey) {
    if (status === "needDen") return t("tool.msg.needDen");
    if (status === "needNum") return t("tool.msg.needNum");
    return t(emptyKey);
  }

  /* ---- 렌더: Calculate 탭 ---- */
  function isMixedInput(wEl, nEl) {
    var w = parseIntStr(val(wEl)), n = parseIntStr(val(nEl));
    return (!w.empty && !n.empty); // whole + num 둘 다 → 대분수 입력
  }
  function renderCalc() {
    var out = els.result;
    if (!out) return;
    var A = readFrac(val(els.aw), val(els.an), val(els.ad));
    var B = readFrac(val(els.bw), val(els.bn), val(els.bd));
    var op = els.op ? els.op.value : "+";

    if (A.status === "bad" || B.status === "bad") {
      out.innerHTML = '<p class="fc-note">ⓘ ' + escHtml(t("tool.note.integers")) + "</p>" + msgHtml(t("tool.msg.empty"));
      return;
    }
    if (A.status === "empty" && B.status === "empty") { out.innerHTML = msgHtml(t("tool.msg.empty")); return; }
    if (A.status === "zeroDen" || B.status === "zeroDen") { out.innerHTML = errHtml(t("tool.err.zeroDen")); return; }
    if (A.status !== "ok" || B.status !== "ok") {
      var st = (A.status !== "ok") ? A.status : B.status;
      out.innerHTML = msgHtml(statusToMsg(st, "tool.msg.empty"));
      return;
    }
    if (op === "/" && B.N === 0n) { out.innerHTML = errHtml(t("tool.err.divZero")); return; }

    var res = applyOp(A.N, A.D, B.N, B.D, op);
    if (!res) { out.innerHTML = errHtml(t("tool.err.divZero")); return; }
    var r = reduce(res.n, res.d);
    var mixed = isMixedInput(els.aw, els.an) || isMixedInput(els.bw, els.bn);
    var steps = buildStepsCalc(A.N, A.D, B.N, B.D, op, mixed);
    out.innerHTML = resultHtml(r, { steps: steps });
  }

  /* ---- 렌더: Simplify 탭 ---- */
  function renderSimplify() {
    var out = els.resultS;
    if (!out) return;
    var S = readFrac("", val(els.sn), val(els.sd));

    if (S.status === "bad") {
      out.innerHTML = '<p class="fc-note">ⓘ ' + escHtml(t("tool.note.integers")) + "</p>" + msgHtml(t("tool.msg.emptySimplify"));
      return;
    }
    if (S.status === "empty") { out.innerHTML = msgHtml(t("tool.msg.emptySimplify")); return; }
    if (S.status === "zeroDen") { out.innerHTML = errHtml(t("tool.err.zeroDen")); return; }
    if (S.status !== "ok") { out.innerHTML = msgHtml(statusToMsg(S.status, "tool.msg.emptySimplify")); return; }

    var r = reduce(S.N, S.D);
    var steps = [];
    if (r.g > 1n) {
      steps.push({ label: fmt(t("tool.step.reduce"), { g: r.g.toString() }),
        expr: fracStr(S.N, S.D) + " = " + fracStr(r.n, r.d) });
    } else {
      steps.push({ label: t("tool.step.lowest"), expr: "= " + fracStr(r.n, r.d) });
    }
    out.innerHTML = resultHtml(r, { showGcd: true, steps: steps });
  }

  function renderAll() { renderCalc(); renderSimplify(); }

  /* ---- 복사 (Clipboard → execCommand 폴백 → 실패 안내) ---- */
  function showStatus(container, text) {
    var st = container ? container.querySelector(".fc-status") : null;
    if (!st) return;
    st.textContent = text; st.hidden = false;
    clearTimeout(st._t);
    st._t = setTimeout(function () { st.hidden = true; st.textContent = ""; }, 1600);
  }
  function copyFallback(text, container) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      showStatus(container, ok ? t("tool.copied") : t("tool.copyFail"));
    } catch (e) { showStatus(container, t("tool.copyFail")); }
  }
  function copyText(text, container) {
    if (text == null || text === "") return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { showStatus(container, t("tool.copied")); },
        function () { copyFallback(text, container); }
      );
    } else { copyFallback(text, container); }
  }
  function wireCopy(container) {
    if (!container) return;
    container.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest(".fc-copy") : null;
      if (b && b.getAttribute("data-copy") != null) copyText(b.getAttribute("data-copy"), container);
    });
  }
  wireCopy(els.result);
  wireCopy(els.resultS);

  /* ---- 탭 전환 ---- */
  function setTab(tab) {
    activeTab = (tab === "simplify") ? "simplify" : "calc";
    for (var i = 0; i < els.tabs.length; i++) {
      var b = els.tabs[i];
      var on = b.getAttribute("data-tab") === activeTab;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    }
    if (els.panelCalc) els.panelCalc.hidden = (activeTab !== "calc");
    if (els.panelSimplify) els.panelSimplify.hidden = (activeTab !== "simplify");
  }
  for (var ti = 0; ti < els.tabs.length; ti++) {
    els.tabs[ti].addEventListener("click", function () {
      setTab(this.getAttribute("data-tab"));
      saveState();
    });
  }

  /* ---- 입력 이벤트 ---- */
  var inputEls = [els.aw, els.an, els.ad, els.bw, els.bn, els.bd, els.sn, els.sd];
  for (var ii = 0; ii < inputEls.length; ii++) {
    if (inputEls[ii]) inputEls[ii].addEventListener("input", function () { renderAll(); saveState(); });
  }
  if (els.op) els.op.addEventListener("change", function () { renderCalc(); saveState(); });

  /* ---- 상태 저장/복원 (localStorage) ---- */
  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        tab: activeTab,
        a: { w: val(els.aw), n: val(els.an), d: val(els.ad) },
        b: { w: val(els.bw), n: val(els.bn), d: val(els.bd) },
        op: els.op ? els.op.value : "+",
        s: { n: val(els.sn), d: val(els.sd) }
      }));
    } catch (e) { /* private mode */ }
  }
  function restoreState() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { s = null; }
    if (!s) return;
    if (s.a) { if (els.aw) els.aw.value = s.a.w || ""; if (els.an) els.an.value = s.a.n || ""; if (els.ad) els.ad.value = s.a.d || ""; }
    if (s.b) { if (els.bw) els.bw.value = s.b.w || ""; if (els.bn) els.bn.value = s.b.n || ""; if (els.bd) els.bd.value = s.b.d || ""; }
    if (s.s) { if (els.sn) els.sn.value = s.s.n || ""; if (els.sd) els.sd.value = s.s.d || ""; }
    if (els.op && s.op) els.op.value = s.op;
    if (s.tab) activeTab = s.tab;
  }

  /* ---- 초기화 ---- */
  restoreState();
  setTab(activeTab);
  renderAll();

  // 언어 전환 시 결과·안내·단계 문구 재렌더
  document.addEventListener("i18n:change", renderAll);
  // TOOLJS:END
})();
