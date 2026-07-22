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
  /* Scientific Calculator — button/keyboard driven token stream, evaluated by a
     hand-written shunting-yard parser (infix tokens → RPN → stack eval). NO eval(),
     NO Function() constructor anywhere in this file. State (current entry, deg/rad
     mode, memory) and calculation history (last 20) persist to localStorage only. */

  /* ---- token constructors (pure) ----
     num   : { t:'num', v:'12.5' }                 — literal number being typed
     num   : { t:'num', const:'pi'|'e', neg:bool }  — constant (π / e)
     op    : { t:'op', v:'+'|'-'|'*'|'/'|'^' }      — binary operator
     postop: { t:'postop', v:'%' }                  — postfix percent (÷100)
     lparen/rparen: { t:'lparen' } / { t:'rparen' }
     func  : { t:'func', v:'sin'|'cos'|'tan'|'sqrt'|'log'|'ln' } — always followed by an lparen token */
  function newNum(v) { return { t: "num", v: v }; }
  function newConst(name) { return { t: "num", const: name, neg: false }; }
  function newOp(v) { return { t: "op", v: v }; }
  function newFunc(name) { return { t: "func", v: name }; }
  function isCompletedValue(tok) {
    return !!tok && (tok.t === "num" || tok.t === "rparen" || tok.t === "postop");
  }
  function netOpenParens(toks) {
    var n = 0;
    for (var i = 0; i < toks.length; i++) {
      if (toks[i].t === "lparen") n++;
      else if (toks[i].t === "rparen") n--;
    }
    return n;
  }
  // 숫자 토큰의 실제 값 (상수는 Math.PI/E, ±기호 반영)
  function numTokenValue(tok) {
    if (tok.const) {
      var v = tok.const === "pi" ? Math.PI : Math.E;
      return tok.neg ? -v : v;
    }
    var n = parseFloat(tok.v);
    return isFinite(n) ? n : null;
  }

  /* ---- 오류 코드 (i18n 키는 DOM 영역에서 매핑) ---- */
  function CalcError(code) { this.code = code; this.message = code; }
  CalcError.prototype = Object.create(Error.prototype);
  CalcError.prototype.constructor = CalcError;

  /* ---- shunting-yard: infix 토큰 → RPN (역폴란드 표기) ----
     우선순위: postfix % 최고(출력 큐로 즉시 이동) > ^(우결합) > × ÷(좌결합) > + −(좌결합).
     함수는 스택에 쌓았다가 대응하는 ')' 에서 좌괄호 제거 직후 함께 pop — 표준 shunting-yard 함수 처리 방식. */
  function toRPN(toks) {
    var PREC = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };
    var RIGHT = { "^": true };
    var output = [], stack = [], i, tok;
    for (i = 0; i < toks.length; i++) {
      tok = toks[i];
      if (tok.t === "num") {
        output.push(tok);
      } else if (tok.t === "func") {
        stack.push(tok);
      } else if (tok.t === "postop") {
        output.push(tok); // 후위 연산자는 왼쪽 피연산자가 이미 출력 큐에 있으므로 바로 이동
      } else if (tok.t === "op") {
        while (stack.length) {
          var top = stack[stack.length - 1];
          if (top.t === "op" && (
            (!RIGHT[tok.v] && PREC[top.v] >= PREC[tok.v]) ||
            (RIGHT[tok.v] && PREC[top.v] > PREC[tok.v])
          )) {
            output.push(stack.pop());
          } else break;
        }
        stack.push(tok);
      } else if (tok.t === "lparen") {
        stack.push(tok);
      } else if (tok.t === "rparen") {
        var found = false;
        while (stack.length) {
          var t2 = stack.pop();
          if (t2.t === "lparen") { found = true; break; }
          output.push(t2);
        }
        if (!found) throw new CalcError("parens");
        if (stack.length && stack[stack.length - 1].t === "func") output.push(stack.pop());
      }
    }
    while (stack.length) {
      var rem = stack.pop();
      if (rem.t === "lparen") throw new CalcError("parens");
      output.push(rem);
    }
    return output;
  }

  // RPN 스택 평가 (일반 계산기 관용 오류: 0 나눗셈, 음수 제곱근, 0 이하 로그, 발산값)
  function evalRPN(rpn) {
    var stack = [], i, tok;
    for (i = 0; i < rpn.length; i++) {
      tok = rpn[i];
      if (tok.t === "num") {
        var v = numTokenValue(tok);
        if (v == null) throw new CalcError("malformed");
        stack.push(v);
      } else if (tok.t === "op") {
        if (stack.length < 2) throw new CalcError("malformed");
        var b = stack.pop(), a = stack.pop(), r;
        if (tok.v === "+") r = a + b;
        else if (tok.v === "-") r = a - b;
        else if (tok.v === "*") r = a * b;
        else if (tok.v === "/") { if (b === 0) throw new CalcError("divzero"); r = a / b; }
        else if (tok.v === "^") r = Math.pow(a, b);
        stack.push(r);
      } else if (tok.t === "postop") {
        if (stack.length < 1) throw new CalcError("malformed");
        stack.push(stack.pop() / 100);
      } else if (tok.t === "func") {
        if (stack.length < 1) throw new CalcError("malformed");
        var x = stack.pop(), r2;
        if (tok.v === "sin") r2 = Math.sin(toRadInternal(x));
        else if (tok.v === "cos") r2 = Math.cos(toRadInternal(x));
        else if (tok.v === "tan") r2 = Math.tan(toRadInternal(x));
        else if (tok.v === "sqrt") { if (x < 0) throw new CalcError("negsqrt"); r2 = Math.sqrt(x); }
        else if (tok.v === "log") { if (x <= 0) throw new CalcError("nonpositive"); r2 = Math.log(x) / Math.LN10; }
        else if (tok.v === "ln") { if (x <= 0) throw new CalcError("nonpositive"); r2 = Math.log(x); }
        stack.push(r2);
      }
    }
    if (stack.length !== 1) throw new CalcError("malformed");
    var result = stack[0];
    if (!isFinite(result)) throw new CalcError("infinite");
    return result;
  }
  // deg/rad 모드는 DOM 영역의 가변 상태이므로 함수 참조만 여기 두고 아래에서 재정의한다.
  var toRadInternal = function (x) { return x; };

  // 완결성(닫힌 괄호·완결된 마지막 토큰) 검사 후 평가 — 순수 함수, DOM 비의존
  function evaluateTokens(toks) {
    if (!toks.length) throw new CalcError("empty");
    var last = toks[toks.length - 1];
    if (last.t === "op" || last.t === "lparen" || last.t === "func") throw new CalcError("incomplete");
    if (last.t === "num" && !last.const && (last.v === "-" || last.v === "." || last.v === "-.")) {
      throw new CalcError("incomplete");
    }
    if (netOpenParens(toks) !== 0) throw new CalcError("parens");
    return evalRPN(toRPN(toks));
  }

  // n 을 유효숫자 sig 자리로 반올림 (부동소수 잡음 제거: 0.1+0.2 → 0.3)
  function roundSig(n, sig) {
    if (n === 0 || !isFinite(n)) return n;
    var d = Math.ceil(Math.log10(Math.abs(n)));
    var magnitude = Math.pow(10, sig - d);
    return Math.round(n * magnitude) / magnitude;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다 (DOM 코드는 아래에서 시작)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      newNum: newNum, newConst: newConst, newOp: newOp, newFunc: newFunc,
      isCompletedValue: isCompletedValue, netOpenParens: netOpenParens,
      numTokenValue: numTokenValue, CalcError: CalcError,
      toRPN: toRPN, evalRPN: evalRPN, evaluateTokens: evaluateTokens, roundSig: roundSig
    };
    return;
  }

  /* ---- DOM / 상태 영역 ---- */
  var CFG = window.APP_CONFIG || {};
  var SLUG = CFG.slug || "calculator";
  var STATE_KEY = SLUG + ":state";
  var HIST_KEY = SLUG + ":history";
  var MAX_DIGITS = 18;
  var MAX_HISTORY = 20;

  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }

  var ERR_KEYS = {
    empty: "tool.err.empty",
    incomplete: "tool.err.incomplete",
    parens: "tool.err.parens",
    divzero: "tool.err.divzero",
    negsqrt: "tool.err.negsqrt",
    nonpositive: "tool.err.nonpositive",
    infinite: "tool.err.infinite",
    malformed: "tool.err.malformed"
  };

  function formatNumber(n) {
    if (n == null || !isFinite(n)) return tr(ERR_KEYS.infinite, "Error");
    var r = roundSig(n, 12);
    if (Object.is(r, -0)) r = 0;
    var abs = Math.abs(r);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) {
      return r.toExponential(6).replace("e+", "×10^").replace("e-", "×10^−");
    }
    try { return new Intl.NumberFormat(uiLang(), { maximumFractionDigits: 10 }).format(r); }
    catch (e) { return String(r); }
  }

  var OP_DISPLAY = { "+": " + ", "-": " − ", "*": " × ", "/": " ÷ ", "^": "^" };
  var FUNC_DISPLAY = { sin: "sin", cos: "cos", tan: "tan", sqrt: "√", log: "log", ln: "ln" };
  function tokenDisplay(tok) {
    if (tok.t === "num") {
      if (tok.const) return (tok.neg ? "-" : "") + (tok.const === "pi" ? "π" : "e");
      return tok.v;
    }
    if (tok.t === "op") return OP_DISPLAY[tok.v] != null ? OP_DISPLAY[tok.v] : tok.v;
    if (tok.t === "postop") return "%";
    if (tok.t === "lparen") return "(";
    if (tok.t === "rparen") return ")";
    if (tok.t === "func") return FUNC_DISPLAY[tok.v] || tok.v;
    return "";
  }
  function exprString(toks) {
    var s = "";
    for (var i = 0; i < toks.length; i++) s += tokenDisplay(toks[i]);
    return s;
  }

  /* ---- 가변 상태 ---- */
  var tokens = [];
  var justEvaluated = false;
  var lastExprDisplay = "";
  var degMode = true;
  var memory = 0;
  var history = [];
  var errorMsg = "";

  toRadInternal = function (x) { return degMode ? (x * Math.PI / 180) : x; };

  /* ---- 영속화 ---- */
  function loadState() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (Array.isArray(s.tokens)) tokens = s.tokens;
      justEvaluated = !!s.justEvaluated;
      lastExprDisplay = typeof s.lastExprDisplay === "string" ? s.lastExprDisplay : "";
      degMode = s.deg !== false;
      memory = (typeof s.memory === "number" && isFinite(s.memory)) ? s.memory : 0;
    } catch (e) { /* private mode / 손상된 저장값 — 빈 상태로 시작 */ }
  }
  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        tokens: tokens, justEvaluated: justEvaluated,
        lastExprDisplay: lastExprDisplay, deg: degMode, memory: memory
      }));
    } catch (e) { /* noop */ }
  }
  function loadHistory() {
    try {
      var raw = localStorage.getItem(HIST_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveHistory() {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(history.slice(0, MAX_HISTORY))); }
    catch (e) { /* noop */ }
  }

  /* ---- DOM refs ---- */
  function $(id) { return document.getElementById(id); }
  var padEl = $("calc-pad");
  var mainEl = $("calc-main"), prevEl = $("calc-prev"), errEl = $("calc-error");
  var degradBtn = $("calc-degrad"), memBadge = $("calc-mem-badge");
  var histListEl = $("calc-history-list"), histClearBtn = $("calc-history-clear");
  if (!padEl || !mainEl) return;

  /* ---- 렌더 ---- */
  function syncScroll(el) { if (el) el.scrollLeft = el.scrollWidth; }
  function render() {
    if (justEvaluated) {
      prevEl.textContent = lastExprDisplay + " =";
      mainEl.textContent = formatNumber(numTokenValue(tokens[0]));
    } else {
      prevEl.textContent = "";
      mainEl.textContent = tokens.length ? exprString(tokens) : "0";
    }
    if (errorMsg) {
      errEl.textContent = tr(ERR_KEYS[errorMsg] || ERR_KEYS.malformed, "Error");
      errEl.hidden = false;
    } else {
      errEl.textContent = "";
      errEl.hidden = true;
    }
    if (degradBtn) {
      degradBtn.textContent = degMode ? tr("tool.degrad.deg", "DEG") : tr("tool.degrad.rad", "RAD");
      degradBtn.setAttribute("aria-pressed", degMode ? "true" : "false");
    }
    if (memBadge) memBadge.hidden = memory === 0;
    syncScroll(mainEl); syncScroll(prevEl);
  }
  function commit() { errorMsg = ""; render(); saveState(); }

  /* ---- 히스토리 렌더 ---- */
  function renderHistory() {
    if (!histListEl) return;
    histListEl.textContent = "";
    if (!history.length) {
      var p = document.createElement("p");
      p.className = "calc-hist-empty";
      p.textContent = tr("tool.history.empty", "No calculations yet");
      histListEl.appendChild(p);
      return;
    }
    for (var i = 0; i < history.length; i++) {
      (function (item) {
        var row = document.createElement("button");
        row.type = "button";
        row.className = "calc-hist-row";
        var exprSpan = document.createElement("span");
        exprSpan.className = "calc-hist-expr";
        exprSpan.textContent = item.expr;
        var resSpan = document.createElement("span");
        resSpan.className = "calc-hist-res";
        resSpan.textContent = formatNumber(item.result);
        row.appendChild(exprSpan);
        row.appendChild(resSpan);
        row.setAttribute("aria-label", item.expr + " = " + formatNumber(item.result));
        row.addEventListener("click", function () { startValue(newNum(String(item.result))); commit(); });
        histListEl.appendChild(row);
      })(history[i]);
    }
  }
  function pushHistory(expr, result) {
    history.unshift({ expr: expr, result: result, ts: Date.now() });
    history = history.slice(0, MAX_HISTORY);
    saveHistory();
    renderHistory();
  }
  if (histClearBtn) {
    histClearBtn.addEventListener("click", function () {
      history = [];
      saveHistory();
      renderHistory();
    });
  }

  /* ---- 입력 도우미 ---- */
  function lastToken() { return tokens.length ? tokens[tokens.length - 1] : null; }
  // 값(숫자·상수·함수·괄호 열기)을 새로 시작 — justEvaluated 리셋 + 완결된 값 뒤라면 암시적 곱셈(2π, (3+4)5 등) 삽입
  function startValue(tok) {
    if (justEvaluated) { tokens = []; justEvaluated = false; lastExprDisplay = ""; }
    if (isCompletedValue(lastToken())) tokens.push(newOp("*"));
    tokens.push(tok);
  }

  function pressDigit(d) {
    if (justEvaluated) { tokens = []; justEvaluated = false; lastExprDisplay = ""; tokens.push(newNum(d)); commit(); return; }
    var last = lastToken();
    if (last && last.t === "num" && !last.const) {
      var bare = last.v.replace("-", "");
      if (bare.length < MAX_DIGITS) last.v += d;
    } else if (isCompletedValue(last)) {
      tokens.push(newOp("*"));
      tokens.push(newNum(d));
    } else {
      tokens.push(newNum(d));
    }
    commit();
  }
  function pressDecimal() {
    if (justEvaluated) { tokens = []; justEvaluated = false; lastExprDisplay = ""; tokens.push(newNum("0.")); commit(); return; }
    var last = lastToken();
    if (last && last.t === "num" && !last.const) {
      if (last.v.indexOf(".") === -1) last.v += ".";
    } else if (isCompletedValue(last)) {
      tokens.push(newOp("*"));
      tokens.push(newNum("0."));
    } else {
      tokens.push(newNum("0."));
    }
    commit();
  }
  function pressOp(sym) {
    if (justEvaluated) {
      justEvaluated = false; lastExprDisplay = "";
      tokens.push(newOp(sym));
      commit(); return;
    }
    var last = lastToken();
    if (!last) {
      if (sym === "-") { tokens.push(newNum("-")); commit(); }
      return;
    }
    if (last.t === "op") { last.v = sym; commit(); return; }
    if (last.t === "lparen" || last.t === "func") {
      if (sym === "-") { tokens.push(newNum("-")); commit(); }
      return;
    }
    tokens.push(newOp(sym));
    commit();
  }
  function pressPercent() {
    if (justEvaluated) { justEvaluated = false; lastExprDisplay = ""; }
    if (!isCompletedValue(lastToken())) return;
    tokens.push({ t: "postop", v: "%" });
    commit();
  }
  function pressParenOpen() {
    startValue({ t: "lparen" });
    commit();
  }
  function pressParenClose() {
    if (justEvaluated) return;
    if (netOpenParens(tokens) <= 0) return;
    if (!isCompletedValue(lastToken())) return;
    tokens.push({ t: "rparen" });
    commit();
  }
  function pressFunc(name) {
    startValue(newFunc(name));
    tokens.push({ t: "lparen" });
    commit();
  }
  function pressConst(name) {
    startValue(newConst(name));
    commit();
  }
  function pressSign() {
    if (justEvaluated) {
      var chainTok = tokens[0];
      chainTok.v = chainTok.v.charAt(0) === "-" ? chainTok.v.slice(1) : "-" + chainTok.v;
      render(); saveState();
      return;
    }
    var last = lastToken();
    if (last && last.t === "num") {
      if (last.const) last.neg = !last.neg;
      else last.v = last.v.charAt(0) === "-" ? last.v.slice(1) : "-" + last.v;
      commit(); return;
    }
    if (!last || last.t === "op" || last.t === "lparen" || last.t === "func") {
      tokens.push(newNum("-"));
      commit(); return;
    }
    // rparen / postop 뒤 — 그룹 전체의 부호 반전은 ×(-1) 삽입으로 표현
    tokens.push(newOp("*"));
    tokens.push(newNum("-1"));
    commit();
  }
  function pressClear() {
    tokens = []; justEvaluated = false; lastExprDisplay = ""; errorMsg = "";
    render(); saveState();
  }
  function pressBack() {
    if (justEvaluated) { pressClear(); return; }
    if (!tokens.length) return;
    var last = tokens[tokens.length - 1];
    if (last.t === "num" && !last.const && last.v.length > 1) {
      last.v = last.v.slice(0, -1);
    } else {
      tokens.pop();
      if (last.t === "lparen") {
        var prev = tokens.length ? tokens[tokens.length - 1] : null;
        if (prev && prev.t === "func") tokens.pop(); // sin( 을 한 덩어리로 지우기
      }
    }
    commit();
  }
  function pressEquals() {
    if (justEvaluated) { commit(); return; }
    try {
      var result = evaluateTokens(tokens);
      var display = exprString(tokens);
      var rounded = roundSig(result, 12);
      pushHistory(display, rounded);
      tokens = [newNum(String(rounded))];
      justEvaluated = true;
      lastExprDisplay = display;
      errorMsg = "";
    } catch (e) {
      errorMsg = (e instanceof CalcError) ? e.code : "malformed";
    }
    render(); saveState();
  }
  function currentValue() {
    if (justEvaluated) return numTokenValue(tokens[0]);
    try { return evaluateTokens(tokens); } catch (e) { return null; }
  }
  function pressMemory(action) {
    if (action === "mc") { memory = 0; commit(); return; }
    if (action === "mr") { startValue(newNum(String(memory))); commit(); return; }
    var v = currentValue();
    if (v == null) return; // 완결되지 않은 식 — 조용히 무시(오류 아님, 아직 계산할 값이 없을 뿐)
    if (action === "m+") memory += v;
    else if (action === "m-") memory -= v;
    commit();
  }
  function pressDegRad() { degMode = !degMode; commit(); }

  function handleAction(action, value) {
    if (action === "digit") pressDigit(value);
    else if (action === "decimal") pressDecimal();
    else if (action === "op") pressOp(value);
    else if (action === "percent") pressPercent();
    else if (action === "paren-open") pressParenOpen();
    else if (action === "paren-close") pressParenClose();
    else if (action === "func") pressFunc(value);
    else if (action === "const") pressConst(value);
    else if (action === "sign") pressSign();
    else if (action === "clear") pressClear();
    else if (action === "back") pressBack();
    else if (action === "equals") pressEquals();
    else if (action === "degrad") pressDegRad();
    else if (action === "mem") pressMemory(value);
  }

  /* ---- 이벤트: 버튼 ---- */
  var padButtons = padEl.querySelectorAll("button[data-action]");
  for (var pi = 0; pi < padButtons.length; pi++) {
    (function (btn) {
      btn.addEventListener("click", function () {
        handleAction(btn.getAttribute("data-action"), btn.getAttribute("data-value"));
      });
    })(padButtons[pi]);
  }

  /* ---- 이벤트: 키보드 ---- */
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k >= "0" && k <= "9") { pressDigit(k); e.preventDefault(); return; }
    if (k === ".") { pressDecimal(); e.preventDefault(); return; }
    if (k === "+" || k === "-" || k === "*" || k === "/" || k === "^") { pressOp(k); e.preventDefault(); return; }
    if (k === "%") { pressPercent(); e.preventDefault(); return; }
    if (k === "(") { pressParenOpen(); e.preventDefault(); return; }
    if (k === ")") { pressParenClose(); e.preventDefault(); return; }
    if (k === "Enter" || k === "=") { pressEquals(); e.preventDefault(); return; }
    if (k === "Backspace") { pressBack(); e.preventDefault(); return; }
    if (k === "Escape") { pressClear(); e.preventDefault(); return; }
  });

  /* ---- 언어 전환 시 갱신 ---- */
  document.addEventListener("i18n:change", function () { render(); renderHistory(); });

  /* ---- 부트 ---- */
  loadState();
  history = loadHistory();
  render();
  renderHistory();
  // TOOLJS:END
})();
