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
  var account = $("account"), risk = $("risk"), entry = $("entry"), stop = $("stop");
  var riskCustom = $("risk-custom"), riskWrap = $("risk-custom-wrap"), frac = $("frac");
  var result = $("result"), errEl = $("err"), warnEl = $("warn-margin");
  if (!account || !risk || !entry || !stop) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (el) { return parseFloat(String(el.value).replace(/[\s,]/g, "")); };
  var money = function (n) { return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var whole = function (n) { return n.toLocaleString(undefined, { maximumFractionDigits: 0 }); };

  function fail(key) {
    result.hidden = true;
    warnEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function calc() {
    var acct = num(account);
    if (!isFinite(acct) || acct <= 0) return fail("tool.err.account");
    var e = num(entry);
    if (!isFinite(e) || e <= 0) return fail("tool.err.entry");
    var s = num(stop);
    if (!isFinite(s) || s <= 0) return fail("tool.err.stop");
    // 진입가 = 손절가면 주당 리스크가 0 — 나눗셈이 Infinity 가 되므로 계산 전에 막는다.
    if (e === s) return fail("tool.err.same");

    var pct;
    if (risk.value === "custom") {
      pct = num(riskCustom);
      // 0.01~100% 밖이면 리스크 예산이 무의미해진다 — 조용히 기본값으로 되돌리지 않고 안내한다.
      if (!isFinite(pct) || pct < 0.01 || pct > 100) return fail("tool.err.risk");
    } else {
      pct = parseFloat(risk.value) || 1;
    }
    var budget = acct * pct / 100;
    var perShare = Math.abs(e - s);
    // 리스크 한도를 넘지 않도록 항상 내림한다. 소수점 주식 허용 시 0.0001주 단위.
    var step = (frac && frac.checked) ? 10000 : 1;
    var shares = Math.floor(budget / perShare * step) / step;
    if (shares <= 0) return fail("tool.err.budget");

    var value = shares * e;
    $("r-shares").textContent = (step === 1) ? whole(shares) : shares.toLocaleString(undefined, { maximumFractionDigits: 4 });
    // 손절가가 진입가 위면 숏 — 수식은 절대값이라 같고, 방향만 라벨로 알린다.
    $("r-dir").textContent = t(s < e ? "tool.dir.long" : "tool.dir.short");
    $("r-risk").textContent = money(shares * perShare);
    $("r-value").textContent = money(value);
    $("r-pct").textContent = (value / acct * 100).toFixed(1) + "% " + t("tool.r.ofaccount");
    $("r-pershare").textContent = money(perShare);
    warnEl.hidden = value <= acct;

    errEl.hidden = true;
    result.hidden = false;
  }

  risk.addEventListener("change", function () {
    riskWrap.hidden = risk.value !== "custom";
    if (!riskWrap.hidden) riskCustom.focus();
  });

  $("calc-btn").addEventListener("click", calc);
  [account, entry, stop, riskCustom].forEach(function (el) {
    el.addEventListener("keydown", function (ev) { if (ev.key === "Enter") calc(); });
  });
  [account, risk, entry, stop, riskCustom, frac].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
