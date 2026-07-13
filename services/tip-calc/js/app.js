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
  /* Tip Calculator — 청구액 x 팁% 를 가산하고 인원으로 분할.
     상태 저장 없음(1회성 계산), 외부 API 없음, 모든 계산은 로컬. */

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  // 금액 파싱: 콤마 제거, 숫자 아니면 0, 붙여넣은 음수는 절대값(입력 min=0 은 UI 차단)
  function parseAmount(raw) {
    if (raw == null) return 0;
    var n = parseFloat(String(raw).replace(/,/g, "").trim());
    if (!isFinite(n)) return 0;
    return Math.abs(n);
  }
  // 인원 파싱: 정수만, 빈값·0·음수·소수는 1 이상 정수로 정규화 (min=1, step=1)
  function parsePeople(raw) {
    var n = parseFloat(String(raw == null ? "" : raw).replace(/,/g, "").trim());
    if (!isFinite(n)) return 1;
    n = Math.floor(n);
    return n < 1 ? 1 : n;
  }
  // 부동소수 오차 제거 후 소수 둘째 자리 반올림
  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }
  // 팁·합계·1인당 계산. roundUp=true 면 1인당 올림(현금 분할용), false 면 소수 2자리.
  function computeTip(bill, pct, people, roundUp) {
    bill = Math.abs(bill);
    pct = Math.abs(pct);
    people = people < 1 ? 1 : Math.floor(people);
    var tip = bill * pct / 100;
    var total = bill + tip;
    var perPersonExact = total / people;
    var perPerson = roundUp ? Math.ceil(perPersonExact) : round2(perPersonExact);
    var perPersonTip = tip / people;
    var actualTotal = roundUp ? perPerson * people : total;
    var roundExtra = roundUp ? actualTotal - total : 0;
    return {
      tip: round2(tip),
      total: round2(total),
      perPerson: round2(perPerson),
      perPersonTip: round2(perPersonTip),
      actualTotal: round2(actualTotal),
      roundExtra: round2(roundExtra)
    };
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseAmount: parseAmount, parsePeople: parsePeople,
      round2: round2, computeTip: computeTip
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function fmt(n) {
    var lang = (window.I18N && window.I18N.lang && window.I18N.lang()) || undefined;
    try {
      return Number(n).toLocaleString(lang, { maximumFractionDigits: 2 });
    } catch (e) {
      return String(n);
    }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var billEl = $("bill"), tipEl = $("tip"), peopleEl = $("people");
  var minusBtn = $("people-minus"), plusBtn = $("people-plus");
  var roundEl = $("roundup"), badgeEl = $("tip-badge");
  var emptyEl = $("result-empty"), gridEl = $("result-grid");
  var helperEl = $("round-helper"), copyHintEl = $("copy-hint");
  var presetsWrap = $("tip-presets");
  if (!billEl || !tipEl || !peopleEl || !gridEl) return;
  var presetBtns = presetsWrap ? presetsWrap.querySelectorAll(".tip-preset") : [];
  var cards = gridEl.querySelectorAll(".res-card");

  /* ---- 프리셋 활성 표시 ---- */
  function syncPresetActive() {
    var cur = tipEl.value.trim();
    for (var i = 0; i < presetBtns.length; i++) {
      var b = presetBtns[i];
      var on = cur !== "" && parseFloat(cur) === parseFloat(b.getAttribute("data-tip"));
      b.style.background = on ? "var(--accent)" : "var(--muted)";
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  /* ---- 카드 값 세팅 ---- */
  function setCard(key, value) {
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute("data-copy") === key) {
        var valEl = cards[i].querySelector(".rc-value");
        if (valEl) valEl.textContent = fmt(value);
        cards[i].setAttribute("data-value", String(value));
      }
    }
  }

  /* ---- 렌더 ---- */
  function render() {
    var bill = parseAmount(billEl.value);
    var tipEmpty = tipEl.value.trim() === "";
    var pct = tipEmpty ? 0 : parseAmount(tipEl.value);
    var people = parsePeople(peopleEl.value);
    var roundUp = !!roundEl.checked;

    // 팁% 빈값 → 0% 배지 (청구액이 있을 때만)
    badgeEl.hidden = !(tipEmpty && bill > 0);

    // 빈/0 청구액 → 결과 비활성 (오류 아님, 안내 문구)
    if (!(bill > 0)) {
      gridEl.hidden = true;
      copyHintEl.hidden = true;
      helperEl.hidden = true;
      emptyEl.hidden = false;
      syncPresetActive();
      return;
    }

    var r = computeTip(bill, pct, people, roundUp);
    setCard("tip", r.tip);
    setCard("total", r.total);
    setCard("perPerson", r.perPerson);
    setCard("perPersonTip", r.perPersonTip);

    emptyEl.hidden = true;
    gridEl.hidden = false;
    copyHintEl.hidden = false;

    if (roundUp && r.roundExtra > 0) {
      helperEl.textContent = tr("tool.roundHelper", "Rounding adds +{x} to the actual total paid")
        .replace("{x}", fmt(r.roundExtra));
      helperEl.hidden = false;
    } else {
      helperEl.hidden = true;
    }
    syncPresetActive();
  }

  /* ---- 클릭 복사 ---- */
  var copiedTimers = {};
  function flashCopied(card) {
    var labelEl = card.querySelector(".rc-label");
    if (!labelEl) return;
    var key = card.getAttribute("data-copy");
    labelEl.textContent = tr("tool.copied", "Copied");
    if (copiedTimers[key]) clearTimeout(copiedTimers[key]);
    copiedTimers[key] = setTimeout(function () {
      // data-i18n 라벨을 현재 언어로 복원
      labelEl.textContent = tr("tool.res." + key, labelEl.textContent);
    }, 1100);
  }
  function legacyCopy(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { /* 복사 미지원 — 표시값은 그대로 남는다 (조용한 실패 아님) */ }
  }
  function copyCard(card) {
    var raw = card.getAttribute("data-value");
    if (raw == null) return;
    var done = function () { flashCopied(card); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(raw).then(done, function () { legacyCopy(raw, done); });
      } else {
        legacyCopy(raw, done);
      }
    } catch (e) {
      legacyCopy(raw, done);
    }
  }

  /* ---- 인원 스테퍼 ---- */
  function bumpPeople(delta) {
    var next = parsePeople(peopleEl.value) + delta;
    if (next < 1) next = 1;
    peopleEl.value = String(next);
    render();
  }

  /* ---- 이벤트 ---- */
  billEl.addEventListener("input", render);
  tipEl.addEventListener("input", render);
  peopleEl.addEventListener("input", render);
  roundEl.addEventListener("change", render);
  if (minusBtn) minusBtn.addEventListener("click", function () { bumpPeople(-1); });
  if (plusBtn) plusBtn.addEventListener("click", function () { bumpPeople(1); });
  for (var p = 0; p < presetBtns.length; p++) {
    presetBtns[p].addEventListener("click", function () {
      tipEl.value = this.getAttribute("data-tip");
      render();
    });
  }
  for (var c = 0; c < cards.length; c++) {
    cards[c].addEventListener("click", function () { copyCard(this); });
  }
  // 언어 전환 시 숫자 포맷·동적 문구 재적용
  document.addEventListener("i18n:change", render);

  render();
  // TOOLJS:END
})();
