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
  var IDS = ["w1", "a1", "d1", "w2", "a2", "d2"];
  var els = {}, i;
  for (i = 0; i < IDS.length; i++) { els[IDS[i]] = $(IDS[i]); if (!els[IDS[i]]) return; }
  els.spd = $("spd");
  var result = $("result"), errEl = $("err"), warnEl = $("r-warn");

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var MM_PER_IN = 25.4, MM_PER_MILE = 1609344, MM_PER_KM = 1000000;

  // 규격 표기가 곧 기하학이다 — 사이드월은 폭의 편평비, 외경은 휠 지름에 사이드월 두 장.
  function spec(w, a, d) {
    var side = w * a / 100;
    var dia = d * MM_PER_IN + 2 * side;
    var circ = Math.PI * dia;
    return { side: side, dia: dia, circ: circ, revs: MM_PER_MILE / circ };
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }
  function set(id, txt) { $(id).textContent = txt; }

  function fillCard(p, s, w, a, d) {
    set("r-" + p + "-size", w + "/" + a + "R" + d);
    set("r-" + p + "-side", s.side.toFixed(1) + " mm");
    set("r-" + p + "-dia", (s.dia / MM_PER_IN).toFixed(2) + " in (" + s.dia.toFixed(1) + " mm)");
    set("r-" + p + "-circ", s.circ.toFixed(1) + " mm");
    set("r-" + p + "-revs", String(Math.round(s.revs)));
    set("r-" + p + "-revskm", String(Math.round(MM_PER_KM / s.circ)));
  }

  function calc() {
    var v = {}, k, x;
    for (k = 0; k < IDS.length; k++) {
      x = parseFloat(String(els[IDS[k]].value).replace(/,/g, ""));
      if (!isFinite(x)) return fail("tool.err.empty");
      v[IDS[k]] = x;
    }
    if (v.w1 < 100 || v.w1 > 500 || v.w2 < 100 || v.w2 > 500 ||
        v.a1 < 10 || v.a1 > 95 || v.a2 < 10 || v.a2 > 95 ||
        v.d1 < 8 || v.d1 > 30 || v.d2 < 8 || v.d2 > 30) return fail("tool.err.range");

    // 속도계 기준 속도는 선택 입력 — 비우면 기존 기본값 60mph 그대로.
    var raw = String(els.spd ? els.spd.value : "").trim(), spd = 60;
    if (raw !== "") {
      spd = parseFloat(raw.replace(/,/g, ""));
      if (!isFinite(spd) || spd < 5 || spd > 250) return fail("tool.err.speed");
    }

    var A = spec(v.w1, v.a1, v.d1), B = spec(v.w2, v.a2, v.d2);
    fillCard("cur", A, v.w1, v.a1, v.d1);
    fillCard("new", B, v.w2, v.a2, v.d2);

    var delta = (B.dia - A.dia) / A.dia * 100;
    set("r-delta", (delta >= 0 ? "+" : "") + delta.toFixed(2) + "%");

    var ok = Math.abs(delta) <= 3;
    var badge = $("r-badge");
    badge.className = "badge " + (ok ? "ok" : "bad");
    badge.textContent = t(ok ? "tool.badge.ok" : "tool.badge.warn");

    // 속도계는 순정 외경 기준으로 보정돼 있다 — 실제 60mph 에서 표시값은 옛 외경/새 외경 비율.
    var shown = spd * A.dia / B.dia;
    set("r-speedo", t("tool.speedo.line").replace("{s}", String(spd)).replace("{v}", shown.toFixed(1)));
    // 미터법 사용자를 위한 쌍둥이 값 — 같은 계산, 단위만 km/h.
    set("r-speedo-kmh", t("tool.speedo.line.kmh").replace("{s}", (spd * 1.609344).toFixed(1)).replace("{v}", (shown * 1.609344).toFixed(1)));

    var lift = (B.dia - A.dia) / 2;
    set("r-height", (lift >= 0 ? "+" : "") + lift.toFixed(1) + " mm");

    warnEl.textContent = t("tool.warn.big");
    warnEl.hidden = Math.abs(delta) <= 10;

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  if (els.spd) {
    els.spd.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    els.spd.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  }
  for (i = 0; i < IDS.length; i++) {
    els[IDS[i]].addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    els[IDS[i]].addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  }
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
