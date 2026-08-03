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
  var result = $("result"), errEl = $("err"), brkList = $("brk-list");
  var lastTime = $("last-time"), bedtime = $("bedtime"), calcBtn = $("calc-btn");
  if (!result || !errEl || !brkList || !calcBtn) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  function fmt(key, vals) {
    var s = t(key);
    for (var p in vals) { if (vals.hasOwnProperty(p)) s = s.split("{" + p + "}").join(String(vals[p])); }
    return s;
  }

  // 1회 제공량 평균 카페인 (USDA·제조사 표기). 라벨 문구에 적힌 mg 과 같은 값이어야 한다.
  var DRINKS = [
    { id: "d-drip", key: "tool.d.drip", mg: 95 },
    { id: "d-espresso", key: "tool.d.espresso", mg: 63 },
    { id: "d-coldbrew", key: "tool.d.coldbrew", mg: 155 },
    { id: "d-blacktea", key: "tool.d.blacktea", mg: 47 },
    { id: "d-greentea", key: "tool.d.greentea", mg: 28 },
    { id: "d-cola", key: "tool.d.cola", mg: 34 },
    { id: "d-energy", key: "tool.d.energy", mg: 80 },
    { id: "d-shot", key: "tool.d.shot", mg: 200 },
    { id: "d-preworkout", key: "tool.d.preworkout", mg: 200 },
    { id: "d-choc", key: "tool.d.chocolate", mg: 12 }
  ];
  var LIMIT = 400, PREG = 200, HALF_LIFE = 5, HL_MIN = 2, HL_MAX = 12, GAUGE_MAX = 600, MAX_TOTAL = 3000;

  function num(el) {
    if (!el) return 0;
    var raw = String(el.value).replace(/,/g, "").trim();
    if (!raw) return 0;
    var n = parseFloat(raw);
    return isFinite(n) ? n : 0;
  }
  // "HH:MM" -> 분. 비어 있으면 HTML 에 박힌 기본값을 되돌려 넣어 사용자가 무엇이 쓰였는지 보게 한다.
  function minutes(el) {
    if (!el.value) el.value = el.defaultValue;
    var m = String(el.value).match(/^(\d{1,2}):(\d{2})/);
    return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : 0;
  }

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }
  function row(name, qty, mg) {
    var li = document.createElement("li");
    var a = document.createElement("span"); a.className = "b-name"; a.textContent = name;
    var b = document.createElement("span"); b.className = "b-qty"; b.textContent = qty;
    var c = document.createElement("span"); c.className = "b-mg"; c.textContent = mg;
    li.appendChild(a); li.appendChild(b); li.appendChild(c);
    brkList.appendChild(li);
  }

  function calc() {
    var total = 0, negative = false, parts = [];
    for (var i = 0; i < DRINKS.length; i++) {
      var d = DRINKS[i], n = num($(d.id));
      if (n < 0) negative = true;
      if (n > 0) { total += n * d.mg; parts.push({ key: d.key, n: n, mg: n * d.mg }); }
    }
    var custom = num($("d-custom"));
    if (custom < 0) negative = true;
    if (custom > 0) { total += custom; parts.push({ key: "tool.break.custom", n: 0, mg: custom }); }

    // 반감기는 개인차가 커서(흡연 3h ~ 임신 10h) 사용자가 덮어쓸 수 있다. 빈 값이면 기본 5시간.
    var hlEl = $("half-life");
    var hl = (hlEl && String(hlEl.value).trim()) ? num(hlEl) : HALF_LIFE;

    if (negative) return fail("tool.err.neg");
    if (total <= 0) return fail("tool.err.none");
    if (total > MAX_TOTAL) return fail("tool.err.big");
    if (!(hl >= HL_MIN && hl <= HL_MAX)) return fail("tool.err.hl");

    var mg = t("tool.unit.mg");
    $("r-total").textContent = Math.round(total) + " " + mg;
    $("r-pct").textContent = fmt("tool.r.pct", { n: Math.round(total / LIMIT * 100) });

    // 게이지: 0~600mg 스케일이라 200(임신부)·400(FDA) 눈금 위치가 33%/67%로 고정된다.
    var pct = Math.min(100, total / GAUGE_MAX * 100);
    var statusKey = total < PREG ? "tool.s.low" : total < LIMIT ? "tool.s.mid" : total <= 600 ? "tool.s.high" : "tool.s.veryhigh";
    var color = total < PREG ? "#15803d" : total < LIMIT ? "#ca8a04" : total <= 600 ? "#ea580c" : "#dc2626";
    var fill = $("gfill");
    fill.style.width = pct.toFixed(1) + "%";
    fill.style.background = color;
    $("gauge").setAttribute("aria-label", fmt("tool.gauge.aria", { n: Math.round(total) }));
    $("r-status").textContent = t(statusKey);

    // 반감기 감쇠는 하루치 전부를 마지막 섭취 시각에 마신 것으로 본다 — 취침 잔량의 상한선.
    var hours = ((minutes(bedtime) - minutes(lastTime)) + 1440) % 1440 / 60;
    var left = total * Math.pow(0.5, hours / hl);
    $("r-bed").textContent = Math.round(left) + " " + mg;
    $("r-bedsub").textContent = fmt("tool.r.bedsub", { n: Math.round(hours * 10) / 10, h: Math.round(hl * 10) / 10 });

    while (brkList.firstChild) brkList.removeChild(brkList.firstChild);
    for (var j = 0; j < parts.length; j++) {
      var p = parts[j];
      row(t(p.key), p.n ? "× " + p.n : "", Math.round(p.mg) + " " + mg);
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  calcBtn.addEventListener("click", calc);
  var fields = [lastTime, bedtime, $("d-custom"), $("half-life")];
  for (var k = 0; k < DRINKS.length; k++) fields.push($(DRINKS[k].id));
  fields.forEach(function (el) {
    if (!el) return;
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
