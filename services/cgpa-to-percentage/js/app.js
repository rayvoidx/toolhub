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
  var dirEl = $("dir"), valEl = $("value"), facEl = $("factor");
  var result = $("result"), errEl = $("err"), tbody = $("r-tbody");
  var valLabel = $("value-label"), mainLabel = $("r-main-label");
  if (!dirEl || !valEl || !facEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 소수 둘째 자리까지 두되 의미 없는 0 은 지운다 — 8.2 × 9.5 는 77.90 이 아니라 77.9.
  function fmt(n) {
    var s = (Math.round(n * 100) / 100).toFixed(2);
    return s.replace(/\.?0+$/, "");
  }

  // 방향이 바뀌면 입력 라벨·결과 라벨·상한이 함께 바뀐다 (CGPA 0–10 / 퍼센트 0–100).
  function syncLabels() {
    var rev = dirEl.value === "p2c";
    var vk = rev ? "tool.value.pct" : "tool.value.cgpa";
    valLabel.setAttribute("data-i18n", vk);
    valLabel.textContent = t(vk);
    var mk = rev ? "tool.r.cgpa" : "tool.r.pct";
    mainLabel.setAttribute("data-i18n", mk);
    mainLabel.textContent = t(mk);
    valEl.setAttribute("max", rev ? "100" : "10");
  }

  function fail(key, max) {
    result.hidden = true;
    errEl.hidden = false;
    var msg = t(key);
    if (max != null) msg = msg.replace("{max}", max);
    errEl.textContent = msg;
  }

  function fillTable(factor) {
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    for (var c = 6; c <= 10.0001; c += 0.5) {
      var tr = document.createElement("tr");
      var td1 = document.createElement("td");
      td1.textContent = c.toFixed(1);
      var td2 = document.createElement("td");
      td2.textContent = fmt(c * factor) + "%";
      tr.appendChild(td1);
      tr.appendChild(td2);
      tbody.appendChild(tr);
    }
  }

  function calc() {
    syncLabels();
    var factor = parseFloat(facEl.value);
    var raw = parseFloat(String(valEl.value).replace(/,/g, ""));
    if (!isFinite(raw)) return fail("tool.err.empty");

    var out, line;
    if (dirEl.value === "p2c") {
      if (raw < 0 || raw > 100) return fail("tool.err.pct");
      out = raw / factor;
      // 9.5 계수에서 95% 를 넘으면 10점 척도 안에 대응하는 CGPA 가 없다 — 조용히 11점을 내지 않는다.
      if (out > 10) return fail("tool.err.overmax", fmt(10 * factor));
      line = fmt(raw) + "% ÷ " + fmt(factor) + " = " + fmt(out);
    } else {
      if (raw < 0) return fail("tool.err.cgpa");
      if (raw > 10) return fail("tool.err.maybepct");
      out = raw * factor;
      line = fmt(raw) + " × " + fmt(factor) + " = " + fmt(out) + "%";
    }

    $("r-main").textContent = dirEl.value === "p2c" ? fmt(out) : fmt(out) + "%";
    $("r-formula").textContent = line;
    fillTable(factor);
    errEl.hidden = true;
    result.hidden = false;
  }

  syncLabels();
  $("calc-btn").addEventListener("click", calc);
  valEl.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  [dirEl, facEl].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); else syncLabels(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); else syncLabels(); });
  // TOOLJS:END
})();
