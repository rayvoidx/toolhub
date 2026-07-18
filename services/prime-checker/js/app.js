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
  var LAST_KEY  = "prime-checker:last";   // 마지막 입력 (복원)
  var DEBOUNCE  = 150;                     // 실시간 재계산 디바운스(ms)
  var MAX_DIGITS = 30;                     // |n| 자릿수 상한 (hang 방지 가드)
  // Miller–Rabin 이 결정적인 상한. witness [2..37] 은 n < 3.317e24 에서 결정적.
  var DET_LIMIT = 3317044064679887385961981n;
  var RHO_TIME  = 4000;                    // Pollard-rho 총 시간 가드(ms)

  function t(key) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null ? key : v;
  }

  /* ===================== 정수론 엔진 (BigInt) ===================== */
  function absBig(x) { return x < 0n ? -x : x; }

  // modular exponentiation
  function powmod(base, exp, mod) {
    base %= mod;
    var r = 1n;
    while (exp > 0n) {
      if (exp & 1n) r = (r * base) % mod;
      base = (base * base) % mod;
      exp >>= 1n;
    }
    return r;
  }

  // gcd
  function gcd(a, b) { a = absBig(a); b = absBig(b); while (b) { var tt = a % b; a = b; b = tt; } return a; }

  var SMALL_PRIMES = [2n,3n,5n,7n,11n,13n,17n,19n,23n,29n,31n,37n];
  var DET_WITNESS  = [2n,3n,5n,7n,11n,13n,17n,19n,23n,29n,31n,37n];

  // Miller–Rabin. n<DET_LIMIT 이면 결정적(witness 고정), 그 이상은 20라운드 확률적.
  function isProbablePrime(n) {
    if (n < 2n) return false;
    for (var i = 0; i < SMALL_PRIMES.length; i++) {
      var p = SMALL_PRIMES[i];
      if (n === p) return true;
      if (n % p === 0n) return false;
    }
    // n-1 = d * 2^r
    var d = n - 1n, r = 0n;
    while ((d & 1n) === 0n) { d >>= 1n; r++; }
    var witnesses;
    if (n < DET_LIMIT) {
      witnesses = DET_WITNESS;
    } else {
      witnesses = [];
      for (var w = 0; w < 20; w++) witnesses.push(randBig(n - 3n) + 2n);
    }
    for (var j = 0; j < witnesses.length; j++) {
      var a = witnesses[j] % n;
      if (a < 2n) continue;
      var x = powmod(a, d, n);
      if (x === 1n || x === n - 1n) continue;
      var composite = true;
      for (var k = 0n; k < r - 1n; k++) {
        x = (x * x) % n;
        if (x === n - 1n) { composite = false; break; }
      }
      if (composite) return false;
    }
    return true;
  }

  // 0..max 범위의 임의 BigInt (확률적 라운드용, 암호 강도 불필요)
  function randBig(max) {
    if (max <= 0n) return 0n;
    var bits = max.toString(2).length;
    var bytes = Math.ceil(bits / 8);
    var r = 0n;
    var buf;
    if (window.crypto && window.crypto.getRandomValues) {
      buf = new Uint8Array(bytes);
      window.crypto.getRandomValues(buf);
    } else {
      buf = new Uint8Array(bytes);
      for (var i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
    }
    for (var b = 0; b < bytes; b++) r = (r << 8n) | BigInt(buf[b]);
    return r % (max + 1n);
  }

  // Pollard-rho (Brent). deadline 초과 시 0n 반환(실패 신호).
  function pollardRho(n, deadline) {
    if (n % 2n === 0n) return 2n;
    if (n % 3n === 0n) return 3n;
    while (true) {
      var c = randBig(n - 1n) + 1n;
      var x = randBig(n - 1n) + 1n;
      var y = x, d = 1n;
      var m = 128n, r = 1n, q = 1n, ys = x, gg = 1n;
      while (gg === 1n) {
        x = y;
        for (var i = 0n; i < r; i++) y = (y * y + c) % n;
        var k = 0n;
        while (k < r && gg === 1n) {
          ys = y;
          var lim = (m < (r - k)) ? m : (r - k);
          for (var j = 0n; j < lim; j++) {
            y = (y * y + c) % n;
            q = (q * absBig(x - y)) % n;
          }
          gg = gcd(q, n);
          k += m;
          if (Date.now() > deadline) return 0n;
        }
        r <<= 1n;
      }
      if (gg === n) {
        do {
          ys = (ys * ys + c) % n;
          gg = gcd(absBig(x - ys), n);
          if (Date.now() > deadline) return 0n;
        } while (gg === 1n);
      }
      if (gg !== n && gg !== 1n) return gg;
      if (Date.now() > deadline) return 0n;
    }
  }

  // 인수분해: factors 맵(prime->exp). partial=true 면 시간 가드로 중단됨.
  function factorize(n, deadline) {
    var factors = {};           // string(prime) -> BigInt exp
    var partial = false;
    function add(p) {
      var key = p.toString();
      factors[key] = (factors[key] || 0n) + 1n;
    }
    // 작은 소수 시분할
    for (var i = 0; i < SMALL_PRIMES.length; i++) {
      var p = SMALL_PRIMES[i];
      while (n % p === 0n) { add(p); n /= p; }
    }
    // 1e6 이하 나머지 소수까지 시분할 (odd 6k±1 스윕, 가벼운 상한)
    var f = 41n;
    while (f * f <= n && f < 1000000n) {
      if (n % f === 0n) { while (n % f === 0n) { add(f); n /= f; } }
      f += 2n;
      if (Date.now() > deadline) { partial = true; break; }
    }
    if (n === 1n) return { factors: factors, partial: partial };
    // 남은 cofactor 분해 (재귀 스택 대신 작업 리스트)
    var stack = [n];
    while (stack.length) {
      if (Date.now() > deadline) { partial = true; break; }
      var m = stack.pop();
      if (m === 1n) continue;
      if (isProbablePrime(m)) { add(m); continue; }
      var divisor = pollardRho(m, deadline);
      if (divisor === 0n || divisor === m) { partial = true; break; }
      stack.push(divisor);
      stack.push(m / divisor);
    }
    return { factors: factors, partial: partial };
  }

  // 약수 개수 Π(eᵢ+1)
  function divisorCount(factors) {
    var r = 1n;
    for (var k in factors) if (factors.hasOwnProperty(k)) r *= (factors[k] + 1n);
    return r;
  }
  // 약수 합 Π((pᵢ^(eᵢ+1)−1)/(pᵢ−1))
  function divisorSum(factors) {
    var r = 1n;
    for (var k in factors) if (factors.hasOwnProperty(k)) {
      var p = BigInt(k), e = factors[k];
      r *= (powmod2(p, e + 1n) - 1n) / (p - 1n);
    }
    return r;
  }
  // 순수 정수 거듭제곱 (mod 없음)
  function powmod2(base, exp) {
    var r = 1n;
    while (exp > 0n) { if (exp & 1n) r *= base; base *= base; exp >>= 1n; }
    return r;
  }

  /* ===================== 표시 유틸 ===================== */
  var SUP = { "0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹" };
  function toSuper(numStr) {
    var s = "";
    for (var i = 0; i < numStr.length; i++) s += SUP[numStr[i]] || numStr[i];
    return s;
  }
  // 천단위 콤마 (표시용) — BigInt 안전
  function groupDigits(bigStr) {
    var neg = bigStr[0] === "-";
    var body = neg ? bigStr.slice(1) : bigStr;
    body = body.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + body;
  }
  // factors 맵 → 정렬된 [prime(BigInt), exp(BigInt)] 배열
  function sortedFactors(factors) {
    var arr = [];
    for (var k in factors) if (factors.hasOwnProperty(k)) arr.push([BigInt(k), factors[k]]);
    arr.sort(function (a, b) { return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0); });
    return arr;
  }
  // "2³ × 3² × 5" 형태 (지수 1 은 생략)
  function factorString(factors) {
    var arr = sortedFactors(factors);
    if (!arr.length) return "";
    var parts = arr.map(function (pe) {
      var p = pe[0].toString(), e = pe[1];
      return e > 1n ? (p + toSuper(e.toString())) : p;
    });
    return parts.join(" × ");
  }

  /* ===================== DOM ===================== */
  var inputEl   = document.getElementById("pc-input");
  var badgeEl   = document.getElementById("pc-badge");
  var subjectEl = document.getElementById("pc-subject");
  var hintEl    = document.getElementById("pc-hint");
  var detailEl  = document.getElementById("pc-detail");
  var factorEl  = document.getElementById("pc-factor");
  var factorNote= document.getElementById("pc-factor-note");
  var divCountEl= document.getElementById("pc-divcount");
  var divSumEl  = document.getElementById("pc-divsum");
  var copyBtn   = document.getElementById("pc-copy-factor");
  var feedbackEl= document.getElementById("pc-feedback");

  var lastResult = null;   // { verdict, subject, factorText, note, divCount, divSum } — i18n 재적용용
  var copyPayload = "";    // 복사 대상 문자열

  /* ===================== 상태 표시 헬퍼 ===================== */
  function setBadge(kind, text) {
    // kind: "prime" | "notprime" | "neutral"
    badgeEl.textContent = text;
    if (kind === "prime") {
      badgeEl.style.background = "rgba(22,163,74,0.14)";
      badgeEl.style.color = "#15803d";
      badgeEl.style.borderColor = "rgba(22,163,74,0.4)";
    } else if (kind === "notprime") {
      badgeEl.style.background = "rgba(180,83,9,0.12)";
      badgeEl.style.color = "#b45309";
      badgeEl.style.borderColor = "rgba(180,83,9,0.35)";
    } else {
      badgeEl.style.background = "color-mix(in srgb, var(--accent) 14%, var(--surface))";
      badgeEl.style.color = "var(--accent-strong)";
      badgeEl.style.borderColor = "color-mix(in srgb, var(--accent) 30%, var(--line))";
    }
  }
  function showHint(msg, isError) {
    hintEl.hidden = false;
    hintEl.textContent = msg;
    hintEl.style.color = isError ? "#b91c1c" : "var(--muted)";
  }
  function hideDetail() { detailEl.hidden = true; }
  function showFeedback(msg) {
    feedbackEl.hidden = false;
    feedbackEl.textContent = msg;
    clearTimeout(showFeedback._t);
    showFeedback._t = setTimeout(function () { feedbackEl.hidden = true; }, 2000);
  }

  /* ===================== 입력 파싱 ===================== */
  // 반환: { kind, value }  kind: "empty" | "invalid" | "toolarge" | "ok"
  function parseInput(raw) {
    var s = (raw == null ? "" : String(raw)).trim();
    if (s === "") return { kind: "empty" };
    // 천단위 콤마·공백 제거
    var cleaned = s.replace(/[,\s ]/g, "");
    // 부호 + 숫자만 허용 (소수점·문자·지수표기 배제)
    if (!/^[+-]?\d+$/.test(cleaned)) return { kind: "invalid" };
    var neg = cleaned[0] === "-";
    var digits = cleaned.replace(/^[+-]/, "");
    // 선행 0 정리 후 자릿수 검사
    var trimmed = digits.replace(/^0+(?=\d)/, "");
    if (trimmed.length > MAX_DIGITS) return { kind: "toolarge" };
    var value = BigInt(cleaned);
    return { kind: "ok", value: value, neg: neg };
  }

  /* ===================== 메인 계산 ===================== */
  function compute(raw, persist) {
    var parsed = parseInput(raw);

    if (parsed.kind === "empty") {
      setBadge("neutral", "—");
      subjectEl.textContent = "";
      showHint(t("tool.hint"), false);
      hideDetail();
      lastResult = null;
      return;
    }
    if (parsed.kind === "invalid") {
      setBadge("neutral", "—");
      subjectEl.textContent = "";
      showHint(t("tool.err.whole"), true);
      hideDetail();
      lastResult = null;
      return;
    }
    if (parsed.kind === "toolarge") {
      setBadge("neutral", "—");
      subjectEl.textContent = "";
      showHint(t("tool.err.toolarge"), true);
      hideDetail();
      lastResult = null;
      return;
    }

    if (persist) { try { localStorage.setItem(LAST_KEY, raw); } catch (e) { /* private mode */ } }

    var signed = parsed.value;          // 부호 포함 원래 값
    var n = absBig(signed);             // 판별·분해 대상
    subjectEl.textContent = groupDigits(signed.toString());

    // ---- 0 / 1 특수 ----
    if (n === 0n) {
      setBadge("notprime", t("tool.badge.notprime"));
      showHint(t("tool.zero"), false);
      hideDetail();
      lastResult = null;
      return;
    }
    if (n === 1n) {
      setBadge("notprime", t("tool.badge.notprime"));
      showHint(t("tool.one"), false);
      hideDetail();
      lastResult = null;
      return;
    }

    // 음수: 소수는 n≥2 에서만 정의 → 판별은 항상 "Not prime", 분해는 |n| 로.
    var isNeg = signed < 0n;

    // ---- 판별 ----
    var prime = !isNeg && isProbablePrime(n);
    var probable = prime && n >= DET_LIMIT;   // 결정적 상한 초과 → probable prime

    if (prime) {
      setBadge("prime", probable ? t("tool.badge.probable") : t("tool.badge.prime"));
    } else {
      setBadge("notprime", t("tool.badge.notprime"));
    }

    // ---- 소인수분해 (항상 |n| 기준) ----
    var res = factorize(n, Date.now() + RHO_TIME);
    var factors = res.factors;
    var factorText = factorString(factors);
    var display = groupDigits(n.toString()) + " = " + (factorText || n.toString());

    factorEl.textContent = display;
    copyPayload = n.toString() + " = " + factorText;

    // 판별 문구(부호·probable·smallest factor)
    var hintParts = [];
    if (isNeg) hintParts.push(t("tool.negNote"));
    if (probable) hintParts.push(t("tool.probableNote"));
    if (prime) {
      hintParts.push(t("tool.primeNote"));
    } else if (!isNeg) {
      var arr = sortedFactors(factors);
      if (arr.length) {
        hintParts.push(t("tool.smallestFactor").replace("{p}", groupDigits(arr[0][0].toString())));
      }
    }
    showHint(hintParts.join(" "), false);

    // partial(시간 가드) 처리 — 조용한 실패 금지
    if (res.partial) {
      factorNote.hidden = false;
      factorNote.textContent = t("tool.partial");
    } else {
      factorNote.hidden = true;
    }

    // 부가 정보 — 완전 분해된 경우에만 정확
    if (!res.partial) {
      divCountEl.textContent = groupDigits(divisorCount(factors).toString());
      divSumEl.textContent   = groupDigits(divisorSum(factors).toString());
    } else {
      divCountEl.textContent = "—";
      divSumEl.textContent   = "—";
    }

    detailEl.hidden = false;
    lastResult = raw;
  }

  /* ===================== 복사 ===================== */
  function doCopy() {
    var val = copyPayload;
    if (!val) { showFeedback(t("tool.msg.nothingToCopy")); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(val).then(
        function () { showFeedback(t("tool.msg.copied")); },
        function () { fallbackCopy(val); }
      );
    } else { fallbackCopy(val); }
  }
  function fallbackCopy(val) {
    try {
      var ta = document.createElement("textarea");
      ta.value = val; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      showFeedback(ok ? t("tool.msg.copied") : t("tool.msg.copyError"));
    } catch (e) { showFeedback(t("tool.msg.copyError")); }
  }

  /* ===================== 이벤트 배선 ===================== */
  var debTimer = null;
  if (inputEl) {
    inputEl.addEventListener("input", function () {
      if (debTimer) clearTimeout(debTimer);
      var raw = inputEl.value;
      debTimer = setTimeout(function () { compute(raw, true); }, DEBOUNCE);
    });
  }
  if (copyBtn) copyBtn.addEventListener("click", doCopy);

  // 언어 전환 시 마지막 입력 재계산(문구 갱신)
  document.addEventListener("i18n:change", function () {
    compute(inputEl ? inputEl.value : "", false);
  });

  /* ===================== 초기화 ===================== */
  (function init() {
    var start = "";
    try {
      // URL ?n= 우선, 없으면 저장된 마지막 입력
      var q = new URLSearchParams(location.search).get("n");
      if (q != null && q !== "") start = q;
      else {
        var saved = localStorage.getItem(LAST_KEY);
        if (saved != null) start = saved;
      }
    } catch (e) { /* private mode / 구형 */ }
    if (inputEl && start) inputEl.value = start;
    compute(start, false);
  })();
  // TOOLJS:END
})();
