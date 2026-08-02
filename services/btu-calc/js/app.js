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
  var unit = $("unit"), sun = $("sun"), climate = $("climate"), occ = $("occ"), kitchen = $("kitchen");
  var result = $("result"), errEl = $("err");
  if (!unit || !sun || !climate || !occ || !kitchen) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  var num = function (id) { var v = parseFloat(String($(id).value).replace(/,/g, "")); return isFinite(v) ? v : NaN; };
  var TO_FT = { ft: 1, m: 3.280839895 };
  // 단위를 바꾸면 예시값도 같이 바꾼다 — 미터 모드에서 "8"은 천장 높이로 말이 안 된다.
  var PH = { ft: { len: "15", wid: "12", height: "8" }, m: { len: "4.5", wid: "3.7", height: "2.4" } };

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var f = TO_FT[unit.value] || 1;
    var len = num("len"), wid = num("wid"), h = num("height");
    if (isNaN(len) || isNaN(wid) || isNaN(h)) return fail("tool.err.empty");
    if (len <= 0 || wid <= 0 || h <= 0) return fail("tool.err.positive");

    var lenFt = len * f, widFt = wid * f, hFt = h * f;
    if (lenFt > 200 || widFt > 200) return fail("tool.err.range");
    if (hFt < 6 || hFt > 20) return fail("tool.err.height");

    var people = num("occ");
    if (isNaN(people) || people < 1 || people > 20 || people !== Math.floor(people)) return fail("tool.err.occ");

    // 20 BTU/sq ft 경험식. 천장고는 8ft 기준 비례 보정, 일사량은 배수, 인원·주방은 가산.
    var areaFt = lenFt * widFt;
    var btu = areaFt * 20 * (hFt / 8) * (parseFloat(sun.value) || 1);
    btu += Math.max(0, people - 2) * 600;
    if (kitchen.checked) btu += 4000;
    // 기후 보정은 모든 가산이 끝난 뒤 전체에 곱한다 — 500 BTU 반올림 직전.
    var cf = parseFloat(climate.value);
    if (!isFinite(cf) || cf <= 0) cf = 1;
    btu *= cf;
    var rec = Math.round(btu / 500) * 500;

    var sysKey = rec < 10000 ? "tool.sys.window" : (rec <= 24000 ? "tool.sys.mini" : "tool.sys.central");
    var noteKey = rec > 50000 ? "tool.g.huge"
      : (rec < 10000 ? "tool.g.window" : (rec <= 24000 ? "tool.g.mini" : "tool.g.central"));

    $("r-btu").textContent = rec.toLocaleString(undefined, { maximumFractionDigits: 0 }) + " BTU/h";
    $("r-tons").textContent = (rec / 12000).toFixed(2);
    $("r-area").textContent = Math.round(areaFt) + " sq ft / " + (Math.round(areaFt * 0.09290304 * 10) / 10) + " m²";
    $("r-system").textContent = t(sysKey);
    var note = t(noteKey);
    if (cf !== 1) note += " " + t("tool.climate.note").replace("{pct}", "+" + Math.round((cf - 1) * 100) + "%");
    $("r-note").textContent = note;

    errEl.hidden = true;
    result.hidden = false;
  }

  function syncUnit() {
    var p = PH[unit.value] || PH.ft;
    $("len").setAttribute("placeholder", p.len);
    $("wid").setAttribute("placeholder", p.wid);
    $("height").setAttribute("placeholder", p.height);
    if (!result.hidden || !errEl.hidden) calc();
  }

  $("calc-btn").addEventListener("click", calc);
  unit.addEventListener("change", syncUnit);
  [sun, climate, kitchen].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  ["len", "wid", "height", "occ"].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
