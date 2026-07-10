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
  var LS_KEY = (cfg.slug || "bmr-calc") + ":last";
  var LIM = { ageMin: 10, ageMax: 120, hMin: 50, hMax: 250, wMin: 10, wMax: 300 };
  var ACT = {
    "1.2":   { key: "tool.activity.sedentary",  fallback: "좌식 생활 (운동 거의 안 함) — ×1.2" },
    "1.375": { key: "tool.activity.light",      fallback: "가벼운 활동 (주 1~3회 운동) — ×1.375" },
    "1.55":  { key: "tool.activity.moderate",   fallback: "보통 활동 (주 3~5회 운동) — ×1.55" },
    "1.725": { key: "tool.activity.active",     fallback: "적극적 활동 (주 6~7회 운동) — ×1.725" },
    "1.9":   { key: "tool.activity.veryactive", fallback: "매우 적극적 (고강도 운동·육체노동) — ×1.9" }
  };

  function $(id) { return document.getElementById(id); }
  var ageEl = $("age-input");
  var heightEl = $("height-input");
  var weightEl = $("weight-input");
  var activityEl = $("activity-select");
  var calcBtn = $("calc-btn");
  var box = $("result-box");
  var errEl = $("result-error");
  var bodyEl = $("result-body");
  var warnEl = $("result-warning");
  var outBmr = $("r-bmr");
  var outHarris = $("r-harris");
  var outActivity = $("r-activity");
  var outTdee = $("r-tdee");
  var outCut = $("r-cut");
  var outMaintain = $("r-maintain");
  var outBulk = $("r-bulk");
  var belowEl = $("r-belowbmr");
  if (!ageEl || !heightEl || !weightEl || !activityEl || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function kcal(n) { return t("tool.kcalday", "{n} kcal/일").replace("{n}", group(n)); }

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상)
  function computeBMR(gender, age, height, weight) {
    // 미플린-세인트 지어(1990): 남 = 10w + 6.25h − 5a + 5 / 여 = 10w + 6.25h − 5a − 161
    var mifflin = 10 * weight + 6.25 * height - 5 * age + (gender === "male" ? 5 : -161);
    // 해리스-베네딕트(1984 개정)
    var harris = gender === "male"
      ? 88.362 + 13.397 * weight + 4.799 * height - 5.677 * age
      : 447.593 + 9.247 * weight + 3.098 * height - 4.330 * age;
    return { mifflin: mifflin, harris: harris };
  }
  function computePlan(gender, age, height, weight, factor) {
    var raw = computeBMR(gender, age, height, weight);
    if (raw.mifflin <= 0 || raw.harris <= 0) return null; // 공식 결과 ≤ 0 → 입력 오류
    var tdee = Math.round(raw.mifflin * factor); // TDEE 는 미플린 기준
    var cut = tdee - 500;
    var bmi = weight / Math.pow(height / 100, 2);
    var plan = {
      mifflin: Math.round(raw.mifflin),
      harris: Math.round(raw.harris),
      tdee: tdee,
      cut: cut < 0 ? 0 : cut,
      maintain: tdee,
      bulk: tdee + 500,
      extreme: bmi < 10 || bmi > 60           // 극단 조합 경고 (bmi-calc 패턴)
    };
    plan.belowBmr = plan.cut < plan.mifflin;  // 감량 목표 < BMR → 주의 문구
    return plan;
  }
  // calc-core:end

  var last = null; // 마지막 렌더 상태 (언어 전환 시 재렌더용 — 영속 상태는 localStorage 에만)

  function radioVal(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function setRadio(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }
  function showError(key, fallback) {
    last = { kind: "error", key: key, fallback: fallback };
    box.hidden = false;
    bodyEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }
  function render(plan, factorStr) {
    last = { kind: "plan", plan: plan, factorStr: factorStr };
    errEl.hidden = true;
    bodyEl.hidden = false;
    box.hidden = false;
    warnEl.hidden = !plan.extreme;
    belowEl.hidden = !plan.belowBmr;
    outBmr.textContent = kcal(plan.mifflin);
    outHarris.textContent = kcal(plan.harris);
    var act = ACT[factorStr] || ACT["1.55"];
    outActivity.textContent = t(act.key, act.fallback);
    outTdee.textContent = kcal(plan.tdee);
    outCut.textContent = kcal(plan.cut);
    outMaintain.textContent = kcal(plan.maintain);
    outBulk.textContent = kcal(plan.bulk);
  }

  function calculate() {
    var gender = radioVal("gender") === "female" ? "female" : "male";
    var ageRaw = ageEl.value.trim();
    var hRaw = heightEl.value.trim();
    var wRaw = weightEl.value.trim();
    var age = ageRaw === "" ? NaN : Number(ageRaw);
    var height = hRaw === "" ? NaN : Number(hRaw);
    var weight = wRaw === "" ? NaN : Number(wRaw);

    // 빈 입력 → 명시적 안내 (조용한 실패 금지)
    if (ageRaw === "" || hRaw === "" || wRaw === "" || isNaN(age) || isNaN(height) || isNaN(weight)) {
      showError("tool.err.empty", "성별·나이·키·몸무게를 입력해 주세요.");
      return;
    }
    // 범위 밖(0·음수 포함) — input min/max 와 별개로 JS 에서도 명시적 차단
    age = Math.floor(age);
    if (age < LIM.ageMin || age > LIM.ageMax) {
      showError("tool.err.age", "나이를 10~120세 범위로 입력해 주세요.");
      return;
    }
    if (height < LIM.hMin || height > LIM.hMax) {
      showError("tool.err.height", "키를 50~250 cm 범위로 입력해 주세요.");
      return;
    }
    if (weight < LIM.wMin || weight > LIM.wMax) {
      showError("tool.err.weight", "몸무게를 10~300 kg 범위로 입력해 주세요.");
      return;
    }

    var factorStr = ACT[activityEl.value] ? activityEl.value : "1.55";
    var plan = computePlan(gender, age, height, weight, Number(factorStr));
    if (!plan) {
      // 공식 결과 ≤ 0 (고령 + 저체중 등 극단 조합)
      showError("tool.err.invalid", "입력값을 확인해 주세요. 공식 결과가 유효하지 않습니다.");
      return;
    }
    render(plan, factorStr);

    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        gender: gender, age: age, height: height, weight: weight, activity: factorStr
      }));
    } catch (e) { /* private mode — 저장 실패는 무시 */ }
  }

  // 저장된 마지막 입력값 복원 (localStorage — 서버 미전송)
  (function restoreLast() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (!saved) return;
      var p = JSON.parse(saved);
      if (p.gender === "male" || p.gender === "female") setRadio("gender", p.gender);
      if (p.age != null && p.age !== "") ageEl.value = p.age;
      if (p.height != null && p.height !== "") heightEl.value = p.height;
      if (p.weight != null && p.weight !== "") weightEl.value = p.weight;
      if (ACT[p.activity]) activityEl.value = p.activity;
    } catch (e) { /* 접근 불가·파싱 실패 — 빈 폼으로 시작 */ }
  })();

  calcBtn.addEventListener("click", calculate);
  function onEnter(e) { if (e.key === "Enter") calculate(); }
  ageEl.addEventListener("keydown", onEnter);
  heightEl.addEventListener("keydown", onEnter);
  weightEl.addEventListener("keydown", onEnter);

  // 언어 전환 시 동적 문구(숫자 단위·오류·활동 라벨) 재렌더
  document.addEventListener("i18n:change", function () {
    if (!last) return;
    if (last.kind === "error") showError(last.key, last.fallback);
    else render(last.plan, last.factorStr);
  });
  // TOOLJS:END
})();
