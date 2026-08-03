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
  /* GCF and LCM Calculator — 2~6개의 양의 정수를 입력받아 최대공약수(GCF/GCD)와
     최소공배수(LCM)를 계산한다. 방법을 함께 보여준다: 각 숫자의 소인수분해 +
     연속된 두 숫자쌍마다의 유클리드 호제법 단계, 그리고 정확히 두 숫자일 때만 성립하는
     gcf×lcm = a×b 항등식. 상태: localStorage "<slug>:state" 에 마지막 입력 문자열만
     저장. 외부 API 없음, 전부 로컬 계산(BigInt로 정밀 연산). */

  var MIN_COUNT = 2;                 // 최소 입력 개수
  var MAX_COUNT = 10;                // 최대 입력 개수
  var MAX_VALUE = 1000000000;        // 숫자 상한 (10억) — 소인수분해가 항상 빠르게 끝나도록
  var MAX_VALUE_BIG = 1000000000n;
  var SCAN_LIMIT = 500;              // 극단적으로 큰 붙여넣기 방지 — 이후 토큰은 무시
  var NUM_RE = /^[0-9]+$/;
  var LARGE_LCM_DIGITS = 15;         // 이 자릿수 이상이면 "왜 이렇게 큰가" 안내

  /* ---- 순수 파싱·계산 (node 단위 검증 대상) ---- */

  // 콤마·공백(줄바꿈 포함)을 구분자로 관대하게 토큰화. 부호/소수점이 있으면 무효 토큰으로
  // 카운트만 하고 조용히 버리지 않는다(호출부가 안내 문구로 보여줌).
  function parseNumbers(raw) {
    var tokens = String(raw == null ? "" : raw).split(/[,\s]+/);
    var valid = [], invalidCount = 0, scanned = 0, truncated = false;
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i].trim();
      if (tok === "") continue;
      if (scanned >= SCAN_LIMIT) { truncated = true; break; }
      scanned++;
      if (NUM_RE.test(tok)) {
        var big;
        try { big = BigInt(tok); } catch (e) { invalidCount++; continue; }
        if (big >= 1n && big <= MAX_VALUE_BIG) {
          valid.push({ str: tok, big: big, num: Number(tok) });
          continue;
        }
      }
      invalidCount++;
    }
    return { valid: valid, invalidCount: invalidCount, truncated: truncated };
  }

  // 유클리드 호제법 — 나눗셈 단계를 기록하며 gcd 반환. 표시가 자연스럽도록 큰 값을 먼저 둔다.
  function gcdStepsBig(a, b) {
    var x = a > b ? a : b, y = a > b ? b : a;
    var steps = [];
    while (y !== 0n) {
      var q = x / y, r = x % y;
      steps.push({ a: x, b: y, q: q, r: r });
      x = y; y = r;
    }
    return { gcd: x, steps: steps };
  }

  // 단계 기록 없이 gcd만 (내부 LCM 계산용)
  function gcdBig(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }

  // 2~6개 값을 왼쪽부터 순서대로 pairwise 축약. GCF 체인은 단계를 기록하고,
  // LCM 체인은 별도의 누적값으로 독립 계산한다(둘 다 결합법칙이 성립하므로 순서 무관하게 정확).
  function computeChain(valuesBig) {
    var gcfCurrent = valuesBig[0];
    var lcmCurrent = valuesBig[0];
    var blocks = [];
    for (var i = 1; i < valuesBig.length; i++) {
      var stepsRes = gcdStepsBig(gcfCurrent, valuesBig[i]);
      blocks.push({ steps: stepsRes.steps, result: stepsRes.gcd, a: gcfCurrent, b: valuesBig[i] });
      gcfCurrent = stepsRes.gcd;

      var g = gcdBig(lcmCurrent, valuesBig[i]);
      lcmCurrent = (lcmCurrent / g) * valuesBig[i];
    }
    return { gcf: gcfCurrent, lcm: lcmCurrent, blocks: blocks };
  }

  // 소인수분해 (n <= MAX_VALUE 이므로 시험 나눗셈으로 항상 빠르게 끝난다)
  function factorizeSmall(n) {
    var factors = [];
    var m = n;
    if (m % 2 === 0) {
      var e2 = 0;
      while (m % 2 === 0) { m = m / 2; e2++; }
      factors.push({ p: 2, e: e2 });
    }
    for (var p = 3; p * p <= m; p += 2) {
      if (m % p === 0) {
        var e = 0;
        while (m % p === 0) { m = m / p; e++; }
        factors.push({ p: p, e: e });
      }
    }
    if (m > 1) factors.push({ p: m, e: 1 });
    return factors;
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseNumbers: parseNumbers, gcdStepsBig: gcdStepsBig, gcdBig: gcdBig,
      computeChain: computeChain, factorizeSmall: factorizeSmall,
      MIN_COUNT: MIN_COUNT, MAX_COUNT: MAX_COUNT, MAX_VALUE: MAX_VALUE
    };
    return;
  }

  /* ---- i18n · 숫자 포맷 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "gcf-lcm-calc") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  // {name} 스타일 치환 — 같은 자리표시자가 반복돼도 전부 채운다
  function tpl(str, map) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : m;
    });
  }
  // 로케일을 존중하는 작은 정수 표시 (입력값·소인수처럼 안전 정수 범위 안의 값)
  function fmtSmall(n) {
    try { return Number(n).toLocaleString(uiLang(), { maximumFractionDigits: 0 }); }
    catch (e) { return String(n); }
  }
  // 임의 정밀도 BigInt 표시 — GCF/LCM은 2^53을 넘을 수 있어 로케일 포맷 대신 천단위 콤마로 통일
  function fmtBig(big) {
    var neg = big < 0n;
    var s = (neg ? -big : big).toString();
    var grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + grouped;
  }
  var SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  function toSuper(n) {
    var s = String(n), out = "";
    for (var i = 0; i < s.length; i++) out += SUP[s[i]] || s[i];
    return out;
  }

  function factorLine(numVal) {
    var label = fmtSmall(numVal);
    if (numVal === 1) return tr("tool.factor.one", "1 has no prime factors — it divides every whole number.");
    var factors = factorizeSmall(numVal);
    if (factors.length === 1 && factors[0].e === 1) {
      return tpl(tr("tool.factor.prime", "{n} is already a prime number."), { n: label });
    }
    var parts = factors.map(function (f) {
      return fmtSmall(f.p) + (f.e > 1 ? toSuper(f.e) : "");
    });
    return label + " = " + parts.join(" × ");
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var inputEl = $("numbers-input");
  var resultEmpty = $("result-empty"), resultError = $("result-error");
  var resultGrid = $("gl-grid"), copyHintEl = $("copy-hint"), glNote = $("gl-note");
  var relationBlock = $("relation-block"), relationHeading = $("relation-heading");
  var relationText = $("relation-text"), relationOnlyTwo = $("relation-only-two");
  var factorWrap = $("factor-wrap"), factorList = $("factor-list");
  var euclidWrap = $("euclid-wrap"), euclidChainNote = $("euclid-chain-note"), euclidSteps = $("euclid-steps");
  if (!inputEl || !resultGrid) return;
  var cards = resultGrid.querySelectorAll(".stat-card");

  function setCard(key, text) {
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute("data-copy") === key) {
        var valEl = cards[i].querySelector(".stat-val");
        if (valEl) valEl.textContent = text;
        cards[i].setAttribute("data-value", text);
      }
    }
  }

  function hideResultBlocks() {
    resultGrid.hidden = true;
    copyHintEl.hidden = true;
    relationBlock.hidden = true;
    factorWrap.hidden = true;
    euclidWrap.hidden = true;
    glNote.hidden = true;
  }

  /* ---- 렌더 ---- */
  function render() {
    var raw = inputEl.value.trim();
    var parsed = parseNumbers(inputEl.value);

    if (raw === "") {
      hideResultBlocks();
      resultError.hidden = true;
      resultEmpty.hidden = false;
      return;
    }
    resultEmpty.hidden = true;

    if (parsed.valid.length < MIN_COUNT) {
      hideResultBlocks();
      resultError.textContent = tr("tool.err.tooFew", "Enter at least 2 valid whole numbers to calculate.");
      resultError.hidden = false;
      return;
    }
    if (parsed.valid.length > MAX_COUNT) {
      hideResultBlocks();
      resultError.textContent = tpl(tr("tool.err.tooMany", "Enter at most 10 numbers — you entered {n}. Remove {extra} to continue."), {
        n: String(parsed.valid.length), extra: String(parsed.valid.length - MAX_COUNT)
      });
      resultError.hidden = false;
      return;
    }
    resultError.hidden = true;

    var valuesBig = parsed.valid.map(function (v) { return v.big; });
    var chain = computeChain(valuesBig);

    setCard("gcf", fmtBig(chain.gcf));
    setCard("lcm", fmtBig(chain.lcm));
    resultGrid.hidden = false;
    copyHintEl.hidden = false;

    // 관계식: 정확히 두 숫자일 때만 gcf x lcm = a x b 가 성립
    relationHeading.hidden = false;
    if (parsed.valid.length === 2) {
      var a = valuesBig[0], b = valuesBig[1];
      var product = a * b;
      relationText.textContent = tpl(tr("tool.relation.text", "{gcf} × {lcm} = {product} and {a} × {b} = {product}, so GCF × LCM equals the product of the two numbers."), {
        gcf: fmtBig(chain.gcf), lcm: fmtBig(chain.lcm), product: fmtBig(product), a: fmtBig(a), b: fmtBig(b)
      });
      relationText.hidden = false;
      relationOnlyTwo.hidden = true;
    } else {
      relationText.hidden = true;
      relationOnlyTwo.hidden = false;
    }
    relationBlock.hidden = false;

    // 소인수분해 (입력 순서대로)
    factorList.innerHTML = "";
    var frag1 = document.createDocumentFragment();
    parsed.valid.forEach(function (v) {
      var li = document.createElement("li");
      li.textContent = factorLine(v.num);
      frag1.appendChild(li);
    });
    factorList.appendChild(frag1);
    factorWrap.hidden = false;

    // 유클리드 호제법 단계 (연속 쌍마다 블록)
    euclidSteps.innerHTML = "";
    var frag2 = document.createDocumentFragment();
    chain.blocks.forEach(function (blk, idx) {
      var div = document.createElement("div");
      div.className = "gl-euclid-block";
      var h = document.createElement("p");
      h.className = "gl-step-heading";
      h.textContent = tpl(tr("tool.euclid.step", "Step {i}: gcd({a}, {b})"), {
        i: String(idx + 1), a: fmtBig(blk.steps[0].a), b: fmtBig(blk.steps[0].b)
      });
      div.appendChild(h);
      blk.steps.forEach(function (s) {
        var p = document.createElement("p");
        p.className = "gl-eq";
        p.textContent = tpl(tr("tool.euclid.line", "{a} = {b} × {q} + {r}"), {
          a: fmtBig(s.a), b: fmtBig(s.b), q: fmtBig(s.q), r: fmtBig(s.r)
        });
        div.appendChild(p);
      });
      var res = document.createElement("p");
      res.className = "gl-eq-result";
      res.textContent = tpl(tr("tool.euclid.done", "Remainder 0 — GCD = {g}"), { g: fmtBig(blk.result) });
      div.appendChild(res);
      frag2.appendChild(div);
    });
    euclidSteps.appendChild(frag2);
    euclidChainNote.hidden = parsed.valid.length <= 2;
    euclidWrap.hidden = false;

    // 안내 문구
    var notes = [];
    if (parsed.invalidCount > 0) {
      notes.push(tpl(tr("tool.note.ignored", "{n} item(s) ignored — not a valid whole number"), { n: String(parsed.invalidCount) }));
    }
    if (chain.gcf === 1n) {
      notes.push(tr("tool.note.coprime", "These numbers share no common factor other than 1 — they are coprime."));
    }
    var lcmDigits = chain.lcm.toString().length;
    if (lcmDigits >= LARGE_LCM_DIGITS) {
      notes.push(tpl(tr("tool.note.veryLarge", "This LCM has {digits} digits because the numbers share few or no common factors — that's mathematically expected, not an error."), { digits: String(lcmDigits) }));
    }
    if (notes.length > 0) {
      glNote.textContent = notes.join(" · ");
      glNote.hidden = false;
    } else {
      glNote.hidden = true;
    }
  }

  /* ---- 클릭 복사 ---- */
  var copiedTimers = {};
  function flashCopied(card) {
    var labelEl = card.querySelector(".stat-label");
    if (!labelEl) return;
    var key = card.getAttribute("data-copy");
    labelEl.textContent = tr("tool.copied", "Copied");
    if (copiedTimers[key]) clearTimeout(copiedTimers[key]);
    copiedTimers[key] = setTimeout(function () {
      labelEl.textContent = tr("tool.res." + key, labelEl.textContent);
    }, 1100);
  }
  function legacyCopy(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { /* 복사 미지원 — 표시값은 그대로 남는다 */ }
  }
  function copyCard(card) {
    var rawVal = card.getAttribute("data-value");
    if (rawVal == null) return;
    var done = function () { flashCopied(card); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(rawVal).then(done, function () { legacyCopy(rawVal, done); });
      } else {
        legacyCopy(rawVal, done);
      }
    } catch (e) {
      legacyCopy(rawVal, done);
    }
  }
  for (var i = 0; i < cards.length; i++) {
    cards[i].addEventListener("click", function () { copyCard(this); });
  }

  /* ---- 저장/복원 (private mode 등 저장 실패는 조용히 무시, 계산엔 영향 없음) ---- */
  function saveState() {
    try { localStorage.setItem(SKEY, inputEl.value); } catch (e) { /* noop */ }
  }
  function loadState() {
    try {
      var v = localStorage.getItem(SKEY);
      if (typeof v === "string" && v.length > 0) inputEl.value = v;
    } catch (e) { /* noop */ }
  }

  /* ---- 이벤트 ---- */
  inputEl.addEventListener("input", function () { render(); saveState(); });
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); render(); }
  });
  // 언어 전환 시 숫자 포맷·문구 재적용
  document.addEventListener("i18n:change", render);

  loadState();
  render();
  // TOOLJS:END
})();
