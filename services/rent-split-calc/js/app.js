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
  var ROWS = 6;
  var rent = $("rent"), method = $("method"), mode = $("mode");
  var result = $("result"), errEl = $("err"), list = $("r-list"), headV = $("h-value");
  if (!rent || !method || !mode || !result || !list || !headV) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // 빈칸은 null(미입력), 쓰레기 값은 NaN — 둘을 섞으면 "안 쓴 행"과 "잘못 쓴 행"을 구분 못 한다.
  function num(el) {
    var v = String(el.value).replace(/,/g, "").trim();
    if (!v) return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : NaN;
  }
  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }
  function money(cents) {
    var p = (cents / 100).toFixed(2).split(".");
    return p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + p[1];
  }

  function headKey() {
    if (method.value === "income") return "tool.h.income";
    if (method.value === "equal") return "tool.h.equal";
    return "tool.h.sqft";
  }
  function syncHead() { headV.textContent = t(headKey()); }

  function collect() {
    var rows = [], i, nm, v;
    for (i = 1; i <= ROWS; i++) {
      nm = String($("n" + i).value).trim();
      v = num($("v" + i));
      if (!nm && v === null) continue; // 아예 손대지 않은 행은 인원에서 뺀다
      if (method.value !== "equal" && (v === null || isNaN(v) || v <= 0)) return { err: "tool.err.value" };
      rows.push({ name: nm, v: (v === null || isNaN(v)) ? 0 : v, i: i });
    }
    if (!rows.length) return { err: "tool.err.rows" };
    return { rows: rows };
  }

  // 비례 비중: 기본 100%, 하이브리드 70/80/50%. 모르는 값은 기본(100%)으로 떨어뜨린다.
  var SHARES = { hybrid: 0.7, hybrid80: 0.8, hybrid50: 0.5 };
  function propShare() { return SHARES[mode.value] || 1; }

  // 가중치 합은 항상 1. 하이브리드는 비례 70% + 균등 30% — 공용 공간은 똑같이 쓰기 때문.
  function weights(rows) {
    var n = rows.length, i, sum = 0, w = [], p;
    if (method.value === "equal") { for (i = 0; i < n; i++) w.push(1 / n); return w; }
    for (i = 0; i < n; i++) sum += rows[i].v;
    if (!(sum > 0)) return null;
    p = propShare();
    for (i = 0; i < n; i++) w.push(p * rows[i].v / sum + (1 - p) / n);
    return w;
  }

  // 센트 단위 최대잔여법. 각자 반올림하면 합이 월세와 1~2센트 어긋나고, 그게 곧 분쟁이 된다.
  function allocate(totalCents, w) {
    var raw = [], out = [], idx = [], sum = 0, i, rem;
    for (i = 0; i < w.length; i++) {
      raw.push(totalCents * w[i]);
      out.push(Math.floor(raw[i]));
      sum += out[i];
      idx.push(i);
    }
    idx.sort(function (a, b) { return (raw[b] - out[b]) - (raw[a] - out[a]) || a - b; });
    rem = totalCents - sum;
    for (i = 0; i < rem && idx.length; i++) out[idx[i % idx.length]] += 1;
    return out;
  }

  function noteText(n) {
    if (n === 1) return t("tool.note.single");
    if (method.value === "equal") return t("tool.note.equal");
    var p = propShare(), size = method.value === "size";
    if (p === 1) return t(size ? "tool.note.sizeBasic" : "tool.note.incomeBasic");
    if (p === 0.7) return t(size ? "tool.note.sizeHybrid" : "tool.note.incomeHybrid");
    return t(size ? "tool.note.sizeHybridP" : "tool.note.incomeHybridP")
      .replace("{p}", String(Math.round(p * 100)))
      .replace("{q}", String(Math.round((1 - p) * 100)));
  }

  function calc() {
    var r = num(rent);
    if (r === null || isNaN(r)) return fail("tool.err.rent");
    if (r <= 0) return fail("tool.err.rentpos");
    if (r >= 1000000) return fail("tool.err.rentmax");

    var got = collect();
    if (got.err) return fail(got.err);
    var rows = got.rows, n = rows.length;
    var w = weights(rows);
    if (!w) return fail("tool.err.value");

    var totalCents = Math.round(r * 100);
    var cents = allocate(totalCents, w);
    var min = cents[0], max = cents[0], i;
    for (i = 1; i < n; i++) {
      if (cents[i] < min) min = cents[i];
      if (cents[i] > max) max = cents[i];
    }

    $("r-hero-label").textContent = t(min === max ? "tool.r.each" : "tool.r.range");
    $("r-hero").textContent = min === max ? money(min) : money(min) + " – " + money(max);
    $("r-people").textContent = String(n);
    $("r-total").textContent = money(totalCents);

    while (list.firstChild) list.removeChild(list.firstChild);
    rows.forEach(function (row, k) {
      var div = document.createElement("div");
      div.className = "prow";
      var nm = document.createElement("span");
      nm.textContent = row.name || (t("tool.r.person") + " " + row.i);
      var amt = document.createElement("span");
      amt.className = "p-amt";
      amt.textContent = money(cents[k]);
      var pct = document.createElement("span");
      pct.className = "p-pct";
      pct.textContent = (cents[k] / totalCents * 100).toFixed(1) + "%";
      div.appendChild(nm); div.appendChild(amt); div.appendChild(pct);
      list.appendChild(div);
    });
    $("r-note").textContent = noteText(n);

    errEl.hidden = true;
    result.hidden = false;
  }

  var live = function () { if (!result.hidden || !errEl.hidden) calc(); };
  var els = [rent, method, mode], j;
  for (j = 1; j <= ROWS; j++) { els.push($("n" + j)); els.push($("v" + j)); }
  els.forEach(function (el) {
    if (!el) return;
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
    el.addEventListener("change", live);
  });
  $("calc-btn").addEventListener("click", calc);
  method.addEventListener("change", syncHead);
  document.addEventListener("i18n:change", function () { syncHead(); live(); });
  syncHead();
  // TOOLJS:END
})();
