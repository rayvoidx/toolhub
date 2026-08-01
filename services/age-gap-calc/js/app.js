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
  var dA = $("date-a"), dB = $("date-b");
  var result = $("result"), errEl = $("err");
  if (!dA || !dB) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };
  function fmt(key, vals) {
    var s = t(key);
    for (var p in vals) {
      if (Object.prototype.hasOwnProperty.call(vals, p)) s = s.split("{" + p + "}").join(String(vals[p]));
    }
    return s;
  }

  // 로컬 타임존/DST 를 타지 않도록 날짜는 UTC 자정으로만 다룬다.
  function parseYMD(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || "").trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return { y: y, m: mo, d: d, ms: dt.getTime() };
  }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m: 1-12

  // 달력식 차용: 일이 모자라면 "나중 날짜의 직전 달" 실제 길이를 빌린다 (365.25 근사 아님).
  function diffYMD(a, b) {
    var y = b.y - a.y, m = b.m - a.m, d = b.d - a.d;
    if (d < 0) {
      m--;
      var pm = b.m - 1, py = b.y;
      if (pm === 0) { pm = 12; py--; }
      d += daysInMonth(py, pm);
    }
    if (m < 0) { y--; m += 12; }
    return { y: y, m: m, d: d };
  }
  function todayYMD() {
    var n = new Date();
    return parseYMD(n.getFullYear() + "-" + ("0" + (n.getMonth() + 1)).slice(-2) + "-" + ("0" + n.getDate()).slice(-2));
  }
  function num(n) { try { return n.toLocaleString(); } catch (e) { return String(n); } }

  function fail(key) {
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key);
  }

  function calc() {
    var a = parseYMD(dA.value), b = parseYMD(dB.value);
    if (!a || !b) return fail("tool.err.empty");
    if (a.y < 1900 || a.y > 2100 || b.y < 1900 || b.y > 2100) return fail("tool.err.range");

    var older = a.ms <= b.ms ? a : b, younger = a.ms <= b.ms ? b : a;
    var g = diffYMD(older, younger);
    $("r-gap").textContent = g.y + " " + t("tool.u.years") + " " + g.m + " " + t("tool.u.months") + " " + g.d + " " + t("tool.u.days");
    $("r-days").textContent = num(Math.round((younger.ms - older.ms) / 86400000));
    $("r-months").textContent = num(g.y * 12 + g.m);

    // 민속 규칙(half your age plus seven)은 "오늘 기준 나이"로만 성립한다 — 미래 생일이면 적용 불가.
    var today = todayYMD();
    var ruleEl = $("r-rule");
    if (older.ms > today.ms || younger.ms > today.ms) {
      ruleEl.textContent = t("tool.rule.na");
    } else {
      var ageOld = diffYMD(older, today).y;
      var ageYoung = diffYMD(younger, today).y;
      var min = Math.round((ageOld / 2 + 7) * 10) / 10;
      ruleEl.textContent = fmt(ageYoung >= min ? "tool.rule.ok" : "tool.rule.under", { a: ageOld, b: ageYoung, min: min });
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  [dA, dB].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
