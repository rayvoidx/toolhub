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

  // GA4 — 설정 시에만 로드, 실패해도 본 기능에 영향 없게 격리 (safeTrack 원칙)
  if (cfg.analytics && cfg.analytics.ga4) {
    try {
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + cfg.analytics.ga4;
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", cfg.analytics.ga4);
    } catch (e) { /* 분석 실패는 조용히 무시 */ }
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
  var cfg = window.APP_CONFIG || {};
  var LS_KEY = (cfg.slug || "calorie-calc") + ":last";
  var LB_TO_KG = 0.453592;
  var LIM = { minMin: 1, minMax: 1440, kgMin: 10, kgMax: 300 };

  // MET 값: 2011 Compendium of Physical Activities (하드코딩, 외부 API 0)
  var GROUPS = [
    { key: "tool.grp.walking",  fb: "Walking" },
    { key: "tool.grp.running",  fb: "Running" },
    { key: "tool.grp.cycling",  fb: "Cycling" },
    { key: "tool.grp.swimming", fb: "Swimming" },
    { key: "tool.grp.strength", fb: "Strength & home" },
    { key: "tool.grp.ball",     fb: "Ball & racket" },
    { key: "tool.grp.daily",    fb: "Daily activities" }
  ];
  var ACTS = [
    { id: "walk_slow",   g: 0, met: 2.8,  key: "tool.act.walk_slow",   fb: "Walking · slow (3 km/h)" },
    { id: "walk_brisk",  g: 0, met: 4.3,  key: "tool.act.walk_brisk",  fb: "Walking · brisk (5.5 km/h)" },
    { id: "hiking",      g: 0, met: 6.5,  key: "tool.act.hiking",      fb: "Hiking" },
    { id: "stairs",      g: 0, met: 4.0,  key: "tool.act.stairs",      fb: "Stair climbing" },
    { id: "run_8",       g: 1, met: 8.3,  key: "tool.act.run_8",       fb: "Running · 8 km/h" },
    { id: "run_10",      g: 1, met: 9.8,  key: "tool.act.run_10",      fb: "Running · 10 km/h" },
    { id: "run_12",      g: 1, met: 11.8, key: "tool.act.run_12",      fb: "Running · 12 km/h" },
    { id: "cycle_light", g: 2, met: 4.0,  key: "tool.act.cycle_light", fb: "Cycling · light (<16 km/h)" },
    { id: "cycle_mod",   g: 2, met: 6.8,  key: "tool.act.cycle_mod",   fb: "Cycling · moderate (19-22 km/h)" },
    { id: "cycle_vig",   g: 2, met: 10.0, key: "tool.act.cycle_vig",   fb: "Cycling · vigorous (22-26 km/h)" },
    { id: "swim_mod",    g: 3, met: 5.8,  key: "tool.act.swim_mod",    fb: "Swimming · freestyle, moderate" },
    { id: "swim_vig",    g: 3, met: 9.8,  key: "tool.act.swim_vig",    fb: "Swimming · freestyle, fast" },
    { id: "weights_mod", g: 4, met: 3.5,  key: "tool.act.weights_mod", fb: "Weight training · moderate" },
    { id: "weights_vig", g: 4, met: 6.0,  key: "tool.act.weights_vig", fb: "Weight training · vigorous" },
    { id: "jump_rope",   g: 4, met: 11.0, key: "tool.act.jump_rope",   fb: "Jump rope" },
    { id: "yoga",        g: 4, met: 2.5,  key: "tool.act.yoga",        fb: "Yoga" },
    { id: "hiit",        g: 4, met: 8.0,  key: "tool.act.hiit",        fb: "HIIT / circuit training" },
    { id: "rowing",      g: 4, met: 7.0,  key: "tool.act.rowing",      fb: "Rowing machine" },
    { id: "basketball",  g: 5, met: 6.5,  key: "tool.act.basketball",  fb: "Basketball" },
    { id: "soccer",      g: 5, met: 7.0,  key: "tool.act.soccer",      fb: "Soccer" },
    { id: "tennis",      g: 5, met: 7.3,  key: "tool.act.tennis",      fb: "Tennis" },
    { id: "badminton",   g: 5, met: 5.5,  key: "tool.act.badminton",   fb: "Badminton" },
    { id: "tabletennis", g: 5, met: 4.0,  key: "tool.act.tabletennis", fb: "Table tennis" },
    { id: "cleaning",    g: 6, met: 3.3,  key: "tool.act.cleaning",    fb: "House cleaning" },
    { id: "gardening",   g: 6, met: 3.8,  key: "tool.act.gardening",   fb: "Gardening" },
    { id: "dancing",     g: 6, met: 5.0,  key: "tool.act.dancing",     fb: "Dancing" }
  ];
  var FOODS = [
    { key: "tool.food.pizza",  fb: "Slices of pizza", emoji: "🍕", kcal: 285 },
    { key: "tool.food.banana", fb: "Bananas",         emoji: "🍌", kcal: 105 },
    { key: "tool.food.burger", fb: "Cheeseburgers",   emoji: "🍔", kcal: 300 },
    { key: "tool.food.soda",   fb: "Cans of soda",    emoji: "🥤", kcal: 140 }
  ];

  function $(id) { return document.getElementById(id); }
  var activityEl = $("activity-select");
  var durationEl = $("duration-input");
  var weightEl = $("weight-input");
  var calcBtn = $("calc-btn");
  var box = $("result-box");
  var errEl = $("result-error");
  var bodyEl = $("result-body");
  var warnEl = $("result-warning");
  var outKcal = $("r-kcal");
  var outSummary = $("r-summary");
  var foodsEl = $("r-foods");
  var compareEl = $("r-compare");
  if (!activityEl || !durationEl || !weightEl || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function actById(id) {
    for (var i = 0; i < ACTS.length; i++) { if (ACTS[i].id === id) return ACTS[i]; }
    return null;
  }
  function unitVal() {
    var el = document.querySelector('input[name="wunit"]:checked');
    return el && el.value === "lb" ? "lb" : "kg";
  }
  function setUnit(u) {
    var el = document.querySelector('input[name="wunit"][value="' + u + '"]');
    if (el) el.checked = true;
  }

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상, DOM 비의존)
  function toKg(weight, unit) { return unit === "lb" ? weight * LB_TO_KG : weight; }
  // 표준 MET 공식: kcal = MET × 3.5 × weight(kg) / 200 × 분
  function burnedKcal(met, weightKg, minutes) { return met * 3.5 * weightKg / 200 * minutes; }
  function computeAll(id, minutes, weightKg) {
    var act = actById(id);
    if (!act) return null;
    var kcal = Math.round(burnedKcal(act.met, weightKg, minutes));
    var foods = FOODS.map(function (f) {
      return { key: f.key, fb: f.fb, emoji: f.emoji, n: Math.round(kcal / f.kcal * 10) / 10 };
    });
    var others = [];
    for (var i = 0; i < ACTS.length; i++) {
      if (ACTS[i].id === id) continue;
      others.push({
        key: ACTS[i].key, fb: ACTS[i].fb,
        kcal: Math.round(burnedKcal(ACTS[i].met, weightKg, minutes))
      });
    }
    others.sort(function (a, b) { return b.kcal - a.kcal; });
    return { kcal: kcal, foods: foods, comparisons: others.slice(0, 3), act: act };
  }
  // calc-core:end

  var last = null; // 마지막 렌더 상태 (언어 전환 재렌더용 — 영속 상태는 localStorage 에만)

  function showError(key, fallback) {
    last = { kind: "error", key: key, fallback: fallback };
    box.hidden = false;
    bodyEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }

  function render(res, meta) {
    last = { kind: "result", res: res, meta: meta };
    errEl.hidden = true;
    bodyEl.hidden = false;
    box.hidden = false;
    warnEl.hidden = !meta.extreme;
    outKcal.textContent = group(res.kcal);

    var actLabel = t(res.act.key, res.act.fb);
    outSummary.textContent = actLabel + " · " + meta.minutes + " min · "
      + meta.weight + " " + meta.unit;

    // 음식 환산 배지
    foodsEl.innerHTML = "";
    for (var i = 0; i < res.foods.length; i++) {
      var f = res.foods[i];
      var card = document.createElement("div");
      card.style.cssText = "border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--surface);text-align:center;";
      var em = document.createElement("div"); em.style.fontSize = "22px"; em.textContent = f.emoji;
      var num = document.createElement("div"); num.style.cssText = "font-weight:700;font-size:18px;"; num.textContent = String(f.n);
      var cap = document.createElement("div"); cap.style.cssText = "font-size:12.5px;color:var(--muted);"; cap.textContent = t(f.key, f.fb);
      card.appendChild(em); card.appendChild(num); card.appendChild(cap);
      foodsEl.appendChild(card);
    }

    // 같은 조건 다른 운동 비교
    compareEl.innerHTML = "";
    for (var j = 0; j < res.comparisons.length; j++) {
      var c = res.comparisons[j];
      var row = document.createElement("div");
      row.style.cssText = "display:flex;justify-content:space-between;gap:10px;border:1px solid var(--line);border-radius:8px;padding:8px 12px;background:var(--surface);";
      var nm = document.createElement("span"); nm.textContent = t(c.key, c.fb);
      var kc = document.createElement("strong");
      kc.style.cssText = "font-size:15px;color:var(--accent-strong);white-space:nowrap;";
      kc.textContent = group(c.kcal) + " kcal";
      row.appendChild(nm); row.appendChild(kc);
      compareEl.appendChild(row);
    }
  }

  function calculate() {
    var id = activityEl.value;
    var durRaw = durationEl.value.trim();
    var wRaw = weightEl.value.trim();
    var unit = unitVal();

    // 빈 입력/미선택 → 명시적 안내 (조용한 실패 금지)
    if (!id || durRaw === "" || wRaw === "" || isNaN(Number(durRaw)) || isNaN(Number(wRaw))) {
      showError("tool.err.empty", "Enter an activity, duration and weight to see the result.");
      return;
    }
    var minutes = Math.floor(Number(durRaw));
    if (minutes < LIM.minMin || minutes > LIM.minMax) {
      showError("tool.err.duration", "Enter a duration between 1 and 1440 minutes.");
      return;
    }
    var weight = Number(wRaw);
    var kg = toKg(weight, unit);
    if (kg < LIM.kgMin || kg > LIM.kgMax) {
      showError("tool.err.weight", "Enter a body weight between 10 and 300 kg (22-660 lb).");
      return;
    }
    var res = computeAll(id, minutes, kg);
    if (!res) {
      showError("tool.err.empty", "Enter an activity, duration and weight to see the result.");
      return;
    }
    // 극단값: 600분 초과 또는 체중이 허용 경계 근처
    var extreme = minutes > 600 || kg <= 15 || kg >= 250;
    render(res, { minutes: minutes, weight: weight, unit: unit, extreme: extreme });

    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        activity: id, duration: minutes, weight: weight, unit: unit
      }));
    } catch (e) { /* private mode — 저장 실패는 무시 */ }
  }

  // 활동 셀렉트 옵션 구성 (MET 테이블 단일 소스에서 생성 + i18n 라벨)
  function buildOptions() {
    var cur = activityEl.value;
    activityEl.innerHTML = "";
    var ph = document.createElement("option");
    ph.value = "";
    ph.textContent = t("tool.activity.placeholder", "Select an activity");
    activityEl.appendChild(ph);
    for (var gi = 0; gi < GROUPS.length; gi++) {
      var og = document.createElement("optgroup");
      og.label = t(GROUPS[gi].key, GROUPS[gi].fb);
      for (var i = 0; i < ACTS.length; i++) {
        if (ACTS[i].g !== gi) continue;
        var o = document.createElement("option");
        o.value = ACTS[i].id;
        o.textContent = t(ACTS[i].key, ACTS[i].fb);
        og.appendChild(o);
      }
      activityEl.appendChild(og);
    }
    if (cur) activityEl.value = cur;
  }

  // 단위 토글 시 입력값 환산 + 검증 범위 갱신
  function applyBounds(unit) {
    if (unit === "lb") { weightEl.min = "22"; weightEl.max = "660"; }
    else { weightEl.min = "10"; weightEl.max = "300"; }
  }
  function onUnitChange() {
    var unit = unitVal();
    var raw = weightEl.value.trim();
    if (raw !== "" && !isNaN(Number(raw))) {
      var v = Number(raw);
      // 라디오가 방금 새 단위로 바뀌었으므로 직전 단위는 반대쪽
      v = unit === "lb" ? v / LB_TO_KG : v * LB_TO_KG;
      weightEl.value = String(Math.round(v * 10) / 10);
    }
    applyBounds(unit);
  }

  buildOptions();

  // 저장된 마지막 입력 복원 (localStorage — 서버 미전송)
  (function restoreLast() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (!saved) return;
      var p = JSON.parse(saved);
      if (p.unit === "kg" || p.unit === "lb") setUnit(p.unit);
      if (actById(p.activity)) activityEl.value = p.activity;
      if (p.duration != null && p.duration !== "") durationEl.value = p.duration;
      if (p.weight != null && p.weight !== "") weightEl.value = p.weight;
    } catch (e) { /* 접근 불가·파싱 실패 — 빈 폼으로 시작 */ }
  })();
  applyBounds(unitVal());

  calcBtn.addEventListener("click", calculate);
  function onEnter(e) { if (e.key === "Enter") calculate(); }
  durationEl.addEventListener("keydown", onEnter);
  weightEl.addEventListener("keydown", onEnter);
  var unitRadios = document.querySelectorAll('input[name="wunit"]');
  for (var u = 0; u < unitRadios.length; u++) { unitRadios[u].addEventListener("change", onUnitChange); }

  // 언어 전환 시 옵션 라벨·결과 재렌더 (동적 문구 갱신)
  document.addEventListener("i18n:change", function () {
    buildOptions();
    if (!last) return;
    if (last.kind === "error") showError(last.key, last.fallback);
    else render(last.res, last.meta);
  });
  // TOOLJS:END
})();
