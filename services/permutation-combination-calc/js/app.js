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
  var nEl = $("n"), rEl = $("r"), repEl = $("rep");
  var combRadio = $("mode-comb"), permRadio = $("mode-perm");
  var result = $("result"), errEl = $("err");
  if (!nEl || !rEl || !repEl || !combRadio || !permRadio) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var MAX = 1000;

  // 팩토리얼을 통째로 만들지 않는다. C(n,r) 는 곱하면서 바로 나눠도 매 단계가 정수 이항계수라
  // 나머지가 생기지 않는다 — n=1000 까지 BigInt 로 정확하다.
  function nCr(n, r) {
    if (r < 0 || r > n) return BigInt(0);
    if (r > n - r) r = n - r;
    var res = BigInt(1);
    for (var i = 1; i <= r; i++) res = res * BigInt(n - r + i) / BigInt(i);
    return res;
  }
  function nPr(n, r) {
    if (r < 0 || r > n) return BigInt(0);
    var res = BigInt(1);
    for (var i = 0; i < r; i++) res = res * BigInt(n - i);
    return res;
  }
  function pow(n, r) {
    var res = BigInt(1), b = BigInt(n);
    for (var i = 0; i < r; i++) res = res * b;
    return res;
  }

  function group(s) { return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function sci(s) {
    var head = s.charAt(0) + (s.length > 1 ? "." + s.slice(1, 5) : "");
    return head + " x 10^" + (s.length - 1);
  }
  // 30자리를 넘으면 자릿수 구분 표기가 오히려 안 읽힌다 — 지수 표기로 바꾸고 정확 자릿수는 아래 줄에 밝힌다.
  function disp(v) {
    var s = v.toString();
    return s.length <= 30 ? group(s) : "~ " + sci(s);
  }

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function calc() {
    var nRaw = String(nEl.value).trim().replace(/,/g, "");
    var rRaw = String(rEl.value).trim().replace(/,/g, "");
    if (!nRaw || !rRaw) return fail("tool.err.empty");
    if (!/^\d+$/.test(nRaw) || !/^\d+$/.test(rRaw)) return fail("tool.err.range");
    var n = parseInt(nRaw, 10), r = parseInt(rRaw, 10);
    if (!isFinite(n) || !isFinite(r) || n < 1 || n > MAX || r > MAX) return fail("tool.err.range");

    var rep = repEl.checked;
    if (!rep && r > n) return fail("tool.err.rgtn");

    var comb = rep ? nCr(n + r - 1, r) : nCr(n, r);
    var perm = rep ? pow(n, r) : nPr(n, r);

    var combTxt = disp(comb), permTxt = disp(perm);
    var combF = rep
      ? "C(n+r-1, r) = C(" + (n + r - 1) + ", " + r + ") = " + (n + r - 1) + "! / (" + r + "! x " + (n - 1) + "!) = " + combTxt
      : "C(" + n + ", " + r + ") = " + n + "! / (" + r + "! x " + (n - r) + "!) = " + combTxt;
    var permF = rep
      ? "P with repetition = n^r = " + n + "^" + r + " = " + permTxt
      : "P(" + n + ", " + r + ") = " + n + "! / " + (n - r) + "! = " + permTxt;

    var wantComb = combRadio.checked;
    var main = wantComb ? comb : perm;
    $("r-main").textContent = wantComb ? combTxt : permTxt;
    $("r-comb").textContent = combTxt;
    $("r-perm").textContent = permTxt;
    $("r-formula").textContent = wantComb ? combF : permF;
    $("r-formula2").textContent = wantComb ? permF : combF;

    var mainStr = main.toString(), sciEl = $("r-sci");
    if (mainStr.length > 30) {
      sciEl.textContent = t("tool.res.digits").replace("{d}", group(String(mainStr.length)));
      sciEl.hidden = false;
    } else if (mainStr.length > 15) {
      sciEl.textContent = "~ " + sci(mainStr);
      sciEl.hidden = false;
    } else {
      sciEl.textContent = "";
      sciEl.hidden = true;
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  function live() { if (!result.hidden || !errEl.hidden) calc(); }

  $("calc-btn").addEventListener("click", calc);
  [nEl, rEl].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("input", live);
  });
  [combRadio, permRadio, repEl].forEach(function (el) { el.addEventListener("change", live); });
  document.addEventListener("i18n:change", live);
  // TOOLJS:END
})();
