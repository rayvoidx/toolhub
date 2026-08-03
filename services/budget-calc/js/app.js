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
  var income = $("income"), rule = $("rule"), customRow = $("custom-row"), freq = $("freq");
  var pNeeds = $("p-needs"), pWants = $("p-wants"), pSave = $("p-save");
  var result = $("result"), errEl = $("err");
  if (!income || !rule || !customRow) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 프리셋은 [필수, 여유, 저축] 순서 — 세 카드 역할이 고정이라 순서 자체가 계약이다.
  var RULES = { classic: [50, 30, 20], hcol: [60, 30, 10], saver: [50, 20, 30] };
  var MAX_INCOME = 10000000;
  // 급여 주기 -> 월 환산 계수. 주급 52회·격주 26회를 12로 나눈다(4주/2주 근사 금지).
  var FREQ = { month: 1, week: 52 / 12, biweek: 26 / 12, semi: 2, year: 1 / 12 };

  function num(el) { return parseFloat(String(el.value).replace(/,/g, "")); }
  function money(n) {
    var neg = n < 0, s = Math.round(Math.abs(n)).toString();
    return (neg ? "-" : "") + s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function pct(p) { return (Math.round(p * 10) / 10) + "%"; }
  function fail(key, sub) {
    result.hidden = true; errEl.hidden = false;
    errEl.textContent = sub === undefined ? t(key) : t(key).replace(/\{s\}/, sub);
  }

  function splitFor(mode) {
    if (mode !== "custom") return RULES[mode] || RULES.classic;
    var a = num(pNeeds), b = num(pWants), c = num(pSave);
    if (!isFinite(a) || !isFinite(b) || !isFinite(c)) return { err: "tool.err.pct" };
    if (a < 0 || b < 0 || c < 0 || a > 100 || b > 100 || c > 100) return { err: "tool.err.pct" };
    var sum = a + b + c;
    // 부동소수 오차만 흡수하고, 99.9 같은 실제 오입력은 합계를 그대로 알려준다.
    if (Math.abs(sum - 100) > 0.01) return { err: "tool.err.sum", sum: Math.round(sum * 100) / 100 };
    return [a, b, c];
  }

  function calc() {
    var raw = num(income);
    if (!isFinite(raw) || raw <= 0) return fail("tool.err.income");
    var inc = raw * (FREQ[freq && freq.value] || 1);
    if (inc > MAX_INCOME) return fail("tool.err.range");

    var s = splitFor(rule.value);
    if (s.err) return fail(s.err, s.sum);

    var needs = inc * s[0] / 100, wants = inc * s[1] / 100, save = inc * s[2] / 100;
    $("r-needs").textContent = money(needs);
    $("r-wants").textContent = money(wants);
    $("r-save").textContent = money(save);
    $("r-needs-pct").textContent = pct(s[0]);
    $("r-wants-pct").textContent = pct(s[1]);
    $("r-save-pct").textContent = pct(s[2]);
    $("r-annual").textContent = t("tool.r.annual").replace(/\{a\}/, money(save * 12));

    errEl.hidden = true;
    result.hidden = false;
  }

  function syncCustom() { customRow.hidden = rule.value !== "custom"; }
  function live() { if (!result.hidden || !errEl.hidden) calc(); }

  syncCustom();
  $("calc-btn").addEventListener("click", calc);
  [income, pNeeds, pWants, pSave].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("input", live);
  });
  rule.addEventListener("change", function () { syncCustom(); live(); });
  if (freq) freq.addEventListener("change", live);
  document.addEventListener("i18n:change", live);
  // TOOLJS:END
})();
