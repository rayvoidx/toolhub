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
  var unit = $("unit"), tcEl = $("tc"), hdlEl = $("hdl"), ldlEl = $("ldl"), trigEl = $("trig");
  var result = $("result"), errEl = $("err"), noteEmerging = $("note-emerging");
  if (!unit || !tcEl || !hdlEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 모든 판정은 mg/dL 기준으로 통일한다 — TG/HDL 컷오프가 단위 의존적이라 mmol/L 로는 밴드가 어긋난다.
  var CHOL = 38.67, TRIG = 88.57;

  function num(el) {
    var v = String(el.value).replace(/,/g, "").trim();
    if (v === "") return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }
  function fmt(n, d) { return n.toFixed(d); }
  // 밴드는 반올림된 표시값으로 판정한다 — 3.4545 를 "3.5"로 보여주면서 배지는 3.5 미만 구간이면 모순이다.
  function round(n, d) { var p = Math.pow(10, d); return Math.round(n * p) / p; }
  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }
  function setCard(id, text) { $(id).textContent = text; }
  function badge(el, labelKey, cls) {
    el.textContent = t(labelKey);
    el.className = "badge " + cls;
  }

  function calc() {
    var tc = num(tcEl), hdl = num(hdlEl), ldl = num(ldlEl), trig = num(trigEl);
    if (tc === null || hdl === null) return fail("tool.err.empty");

    var mmol = unit.value === "mmol";
    if (mmol) {
      tc = tc * CHOL; hdl = hdl * CHOL;
      if (ldl !== null) ldl = ldl * CHOL;
      if (trig !== null) trig = trig * TRIG;
    }

    if (hdl <= 0) return fail("tool.err.hdl");
    if (tc <= hdl) return fail("tool.err.tc");
    if (tc < 50 || tc > 1000 || hdl < 5 || hdl > 200) return fail("tool.err.range");
    if (ldl !== null && (ldl < 5 || ldl > 800)) return fail("tool.err.range");
    if (trig !== null && (trig < 10 || trig > 5000)) return fail("tool.err.range");

    var tchdl = round(tc / hdl, 1);
    setCard("r-tchdl", fmt(tchdl, 1));
    if (tchdl < 3.5) badge($("r-band"), "tool.b.ideal", "b-good");
    else if (tchdl <= 5) badge($("r-band"), "tool.b.avg", "b-mid");
    else badge($("r-band"), "tool.b.high", "b-bad");

    var nonhdl = round(tc - hdl, 0);
    var shown = mmol ? fmt(nonhdl / CHOL, 2) : fmt(nonhdl, 0);
    var unitLabel = t(mmol ? "tool.unit.mmol" : "tool.unit.mg");
    setCard("r-nonhdl", shown + " " + unitLabel + " · " + t(nonhdl < 130 ? "tool.b.attarget" : "tool.b.abovetarget"));

    if (ldl !== null) {
      var lh = round(ldl / hdl, 1);
      setCard("r-ldlhdl", fmt(lh, 1) + " · " + t(lh < 2.5 ? "tool.b.good" : (lh <= 3.5 ? "tool.b.borderline" : "tool.b.high")));
    } else setCard("r-ldlhdl", "—");

    if (trig !== null) {
      var th = round(trig / hdl, 1);
      setCard("r-trighdl", fmt(th, 1) + " · " + t(th < 2 ? "tool.b.fav" : (th <= 3 ? "tool.b.borderline" : "tool.b.high")));
    } else setCard("r-trighdl", "—");
    noteEmerging.hidden = trig === null;

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [tcEl, hdlEl, ldlEl, trigEl].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  unit.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
