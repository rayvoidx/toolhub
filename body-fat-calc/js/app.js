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
  var LS_KEY = (cfg.slug || "body-fat-calc") + ":last";
  var LIM = { hMin: 50, hMax: 250, wMin: 10, wMax: 300, nMin: 10, nMax: 80, gMin: 30, gMax: 200 };
  var CAT_COLOR = {
    essential: "#3b82f6",
    athletes:  "#16a34a",
    fitness:   "#16a34a",
    average:   "#f97316",
    obese:     "#dc2626"
  };

  function $(id) { return document.getElementById(id); }
  var heightEl = $("height-input");
  var weightEl = $("weight-input");
  var neckEl = $("neck-input");
  var waistEl = $("waist-input");
  var hipEl = $("hip-input");
  var hipGroup = $("hip-group");
  var calcBtn = $("calc-btn");
  var box = $("result-box");
  var errEl = $("result-error");
  var bodyEl = $("result-body");
  var warnEl = $("result-warning");
  var bfEl = $("r-bf");
  var badgeEl = $("r-badge");
  var fatEl = $("r-fatmass");
  var leanEl = $("r-leanmass");
  if (!heightEl || !weightEl || !neckEl || !waistEl || !calcBtn || !box) return;

  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? fallback : v;
  }
  function kg(n) {
    return t("tool.kg", "{n} kg").replace("{n}", (Math.round(n * 10) / 10).toFixed(1));
  }

  // calc-core:start — 순수 계산 코어 (node 단위검증 대상)
  function log10(x) { return Math.log(x) / Math.LN10; }
  function computeBodyFat(sex, height, weight, neck, waist, hip) {
    // 미 해군 둘레측정법 (metric). log 인자가 0 이하이면 계산 불가.
    var bf;
    if (sex === "female") {
      var argF = waist + hip - neck;
      if (argF <= 0) return { error: "girth" };
      bf = 495 / (1.29579 - 0.35004 * log10(argF) + 0.22100 * log10(height)) - 450;
    } else {
      var argM = waist - neck;
      if (argM <= 0) return { error: "girth" };
      bf = 495 / (1.0324 - 0.19077 * log10(argM) + 0.15456 * log10(height)) - 450;
    }
    if (!isFinite(bf)) return { error: "girth" };
    var fatMass = weight * bf / 100;
    var leanMass = weight - fatMass;
    return { bf: bf, fatMass: fatMass, leanMass: leanMass };
  }
  function classify(sex, bf) {
    if (sex === "female") {
      if (bf < 14) return "essential";
      if (bf < 21) return "athletes";
      if (bf < 25) return "fitness";
      if (bf < 32) return "average";
      return "obese";
    }
    if (bf < 6)  return "essential";
    if (bf < 14) return "athletes";
    if (bf < 18) return "fitness";
    if (bf < 25) return "average";
    return "obese";
  }
  function isExtreme(bf) { return bf < 2 || bf > 60; }
  // calc-core:end

  var last = null; // 마지막 렌더 상태 (언어 전환 시 재렌더용 — 영속 상태는 localStorage 에만)

  function currentSex() {
    var el = document.querySelector('input[name="sex"]:checked');
    return el && el.value === "female" ? "female" : "male";
  }
  function setSex(value) {
    var el = document.querySelector('input[name="sex"][value="' + value + '"]');
    if (el) el.checked = true;
  }
  function syncHip() {
    if (hipGroup) hipGroup.hidden = currentSex() !== "female";
  }

  function showError(key, fallback) {
    last = { kind: "error", key: key, fallback: fallback };
    box.hidden = false;
    bodyEl.hidden = true;
    errEl.hidden = false;
    errEl.textContent = t(key, fallback);
  }
  function render(data) {
    last = { kind: "result", data: data };
    errEl.hidden = true;
    bodyEl.hidden = false;
    box.hidden = false;
    warnEl.hidden = !data.extreme;
    bfEl.textContent = data.bf.toFixed(1) + "%";
    badgeEl.textContent = t("tool.cat." + data.cat, data.cat);
    badgeEl.style.background = CAT_COLOR[data.cat] || "#6b7280";
    fatEl.textContent = kg(data.fatMass);
    leanEl.textContent = kg(data.leanMass);
  }

  function num(el) {
    var raw = el.value.trim();
    return raw === "" ? { empty: true, val: NaN } : { empty: false, val: Number(raw) };
  }

  function calculate() {
    var sex = currentSex();
    var h = num(heightEl), w = num(weightEl), n = num(neckEl), wa = num(waistEl), hp = num(hipEl);

    // 빈 입력 → 명시적 안내 (조용한 실패 금지). 여성은 엉덩이 둘레도 필수.
    var missing = h.empty || w.empty || n.empty || wa.empty || (sex === "female" && hp.empty);
    if (missing || isNaN(h.val) || isNaN(w.val) || isNaN(n.val) || isNaN(wa.val) ||
        (sex === "female" && isNaN(hp.val))) {
      showError("tool.err.empty", "Enter your sex and body measurements.");
      return;
    }

    // 범위 밖(0·음수 포함) — input min/max 와 별개로 JS 에서도 명시적 차단
    if (h.val < LIM.hMin || h.val > LIM.hMax) {
      showError("tool.err.height", "Enter a height between 50 and 250 cm."); return;
    }
    if (w.val < LIM.wMin || w.val > LIM.wMax) {
      showError("tool.err.weight", "Enter a weight between 10 and 300 kg."); return;
    }
    if (n.val < LIM.nMin || n.val > LIM.nMax) {
      showError("tool.err.neck", "Enter a neck girth between 10 and 80 cm."); return;
    }
    if (wa.val < LIM.gMin || wa.val > LIM.gMax) {
      showError("tool.err.waist", "Enter a waist girth between 30 and 200 cm."); return;
    }
    if (sex === "female" && (hp.val < LIM.gMin || hp.val > LIM.gMax)) {
      showError("tool.err.hip", "Enter a hip girth between 30 and 200 cm."); return;
    }

    var hip = sex === "female" ? hp.val : 0;
    var res = computeBodyFat(sex, h.val, w.val, n.val, wa.val, hip);
    if (res.error === "girth") {
      showError(
        sex === "female" ? "tool.err.girth.female" : "tool.err.girth.male",
        sex === "female"
          ? "Waist plus hip must be larger than neck. Please re-check your measurements."
          : "Waist must be larger than neck. Please re-check your measurements."
      );
      return;
    }

    render({
      sex: sex,
      bf: res.bf,
      fatMass: res.fatMass,
      leanMass: res.leanMass,
      cat: classify(sex, res.bf),
      extreme: isExtreme(res.bf)
    });

    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        sex: sex, height: h.val, weight: w.val, neck: n.val, waist: wa.val,
        hip: sex === "female" ? hp.val : (hp.empty ? "" : hp.val)
      }));
    } catch (e) { /* private mode — 저장 실패는 무시 */ }
  }

  // 저장된 마지막 입력값 복원 (localStorage — 서버 미전송)
  (function restoreLast() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (!saved) return;
      var p = JSON.parse(saved);
      if (p.sex === "male" || p.sex === "female") setSex(p.sex);
      if (p.height != null && p.height !== "") heightEl.value = p.height;
      if (p.weight != null && p.weight !== "") weightEl.value = p.weight;
      if (p.neck != null && p.neck !== "") neckEl.value = p.neck;
      if (p.waist != null && p.waist !== "") waistEl.value = p.waist;
      if (hipEl && p.hip != null && p.hip !== "") hipEl.value = p.hip;
    } catch (e) { /* 접근 불가·파싱 실패 — 빈 폼으로 시작 */ }
  })();
  syncHip();

  var sexRadios = document.querySelectorAll('input[name="sex"]');
  for (var i = 0; i < sexRadios.length; i++) {
    sexRadios[i].addEventListener("change", syncHip);
  }
  calcBtn.addEventListener("click", calculate);
  function onEnter(e) { if (e.key === "Enter") calculate(); }
  heightEl.addEventListener("keydown", onEnter);
  weightEl.addEventListener("keydown", onEnter);
  neckEl.addEventListener("keydown", onEnter);
  waistEl.addEventListener("keydown", onEnter);
  if (hipEl) hipEl.addEventListener("keydown", onEnter);

  // 언어 전환 시 동적 문구(단위·오류·분류 라벨) 재렌더
  document.addEventListener("i18n:change", function () {
    if (!last) return;
    if (last.kind === "error") showError(last.key, last.fallback);
    else render(last.data);
  });
  // TOOLJS:END
})();
