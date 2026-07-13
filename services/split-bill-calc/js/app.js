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
  // split-bill-calc — even bill split (spec: factory/state/split-bill-calc.yaml)
  // 순수 숫자·통화 중립. 정산은 일회성이라 localStorage 미사용(스펙). 외부 API 없음.
  var cfg = window.APP_CONFIG || {};
  var MAX = Number.MAX_SAFE_INTEGER;

  /* ---- i18n 헬퍼 ---- */
  function t(key) {
    var s = window.I18N && window.I18N.t(key);
    return s != null ? s : key;
  }
  function fmt(s, params) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] != null ? String(params[k]) : m;
    });
  }
  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---- 순수 계산 로직 (통화 중립, 지수표기 없음) ---- */

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  /** 표시 문자열 → 숫자. 콤마(자릿구분) 제거, 첫 소수점만 인정. 실패 시 NaN */
  function parseNum(str) {
    if (str == null) return NaN;
    var s = String(str).replace(/,/g, "").trim();
    if (s === "" || s === "-" || s === "." || s === "-.") return NaN;
    if (!/^-?\d*\.?\d*$/.test(s)) return NaN;
    return parseFloat(s);
  }

  /** 입력 표시용 정규화: 선행 '-', 정수부 콤마 그룹핑, 소수부 최대 2자리 */
  function cleanTotalInput(raw) {
    var neg = /^\s*-/.test(raw);
    var digitsDot = String(raw).replace(/[^\d.]/g, "");
    var firstDot = digitsDot.indexOf(".");
    var intPart, decPart = null;
    if (firstDot === -1) {
      intPart = digitsDot;
    } else {
      intPart = digitsDot.slice(0, firstDot);
      decPart = digitsDot.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
    }
    intPart = intPart.replace(/^0+(?=\d)/, "");
    var grouped = intPart === "" ? "" : intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var out = grouped;
    if (decPart !== null) out += "." + decPart;
    if (out === "" && decPart === null) return neg ? "-" : "";
    return (neg ? "-" : "") + out;
  }

  /**
   * 핵심 분할 계산.
   * total>=0, people>=1 정수, tipPct>=0, unit ∈ {0,1,10,100,1000} (0=Exact→소수 2자리 반올림)
   */
  function compute(total, people, tipPct, unit) {
    var tip = total * tipPct / 100;
    var grand = total + tip;
    var exact = grand / people;
    var perPerson = (unit === 0) ? round2(exact) : Math.ceil(round2(exact) / unit) * unit;
    var collected = round2(perPerson * people);
    var surplus = round2(collected - grand);
    return {
      tip: round2(tip),
      grand: round2(grand),
      perPerson: round2(perPerson),
      collected: collected,
      surplus: surplus
    };
  }

  // node 단위 검증 훅 (UI 상태 저장 아님)
  window.__SBC_TEST = { round2: round2, parseNum: parseNum, cleanTotalInput: cleanTotalInput, compute: compute };

  /* ---- 숫자 표시 (Intl, 현재 언어) ---- */
  function nf(n) {
    try {
      var lang = window.I18N && window.I18N.lang();
      return Number(n).toLocaleString(lang || undefined, { maximumFractionDigits: 2 });
    } catch (e) { return String(n); }
  }

  /* ---- DOM 참조 (node 검증 시 전부 null — 모든 사용처 가드) ---- */
  var totalEl = document.getElementById("sbc-total");
  var peopleEl = document.getElementById("sbc-people");
  var minusBtn = document.getElementById("sbc-minus");
  var plusBtn = document.getElementById("sbc-plus");
  var tipsEl = document.getElementById("sbc-tips");
  var customEl = document.getElementById("sbc-tip-custom");
  var roundsEl = document.getElementById("sbc-rounds");
  var resultEl = document.getElementById("sbc-result");

  /* ---- 현재 선택값 읽기 ---- */
  function currentTip() {
    if (customEl && customEl.value.trim() !== "") {
      var c = parseNum(customEl.value);
      return (isNaN(c) || c < 0) ? 0 : c;
    }
    var on = tipsEl ? tipsEl.querySelector(".sbc-chip.is-on") : null;
    return on ? Number(on.getAttribute("data-tip")) : 0;
  }
  function currentRound() {
    var on = roundsEl ? roundsEl.querySelector(".sbc-chip.is-on") : null;
    return on ? Number(on.getAttribute("data-round")) : 0;
  }

  /* ---- 렌더 ---- */
  function showMsg(msg) {
    if (resultEl) resultEl.innerHTML = '<p class="sbc-msg">' + escHtml(msg) + "</p>";
  }
  function showErr(msg) {
    if (resultEl) resultEl.innerHTML = '<p class="sbc-err">ⓘ ' + escHtml(msg) + "</p>";
  }

  function render() {
    if (!resultEl) return;
    var totalRaw = totalEl ? totalEl.value : "";
    var peopleRaw = peopleEl ? peopleEl.value : "";

    var totalNum = parseNum(totalRaw);
    var hasTotal = totalRaw.trim() !== "" && !isNaN(totalNum);
    var hasPeople = peopleRaw.trim() !== "";

    // 엣지: 한쪽이라도 미입력 → 안내만, 계산 안 함
    if (!hasTotal || !hasPeople) { showMsg(t("tool.n.empty")); return; }

    var notices = [];

    // 음수 총액 → 절댓값 + 안내
    if (totalNum < 0) { totalNum = Math.abs(totalNum); notices.push(t("tool.n.negTotal")); }

    // 인원: 0·음수·비수 → 오류 배너
    var peopleF = parseNum(peopleRaw);
    if (isNaN(peopleF) || peopleF < 1) { showErr(t("tool.n.people")); return; }
    var people = Math.floor(peopleF);
    if (people !== peopleF) notices.push(t("tool.n.decPeople"));
    if (people < 1) { showErr(t("tool.n.people")); return; }

    var tipPct = currentTip();
    var unit = currentRound();

    // 극단값 가드 (지수표기 방지 — 계산 자체를 거부)
    var grandPre = totalNum + totalNum * tipPct / 100;
    if (!isFinite(grandPre) || grandPre > MAX || totalNum > MAX) { showErr(t("tool.n.extreme")); return; }

    var r = compute(totalNum, people, tipPct, unit);
    if (!isFinite(r.collected) || r.collected > MAX) { showErr(t("tool.n.extreme")); return; }

    if (people === 1) notices.push(t("tool.n.solo"));

    // 채팅용 복사 문구
    var message = (people === 1)
      ? fmt(t("tool.msg.solo"), { grand: nf(r.grand) })
      : fmt(t("tool.msg"), { n: nf(people), per: nf(r.perPerson), grand: nf(r.grand) });

    var html = "";

    if (notices.length) {
      html += '<div class="sbc-notices">';
      for (var i = 0; i < notices.length; i++) html += "<p>ⓘ " + escHtml(notices[i]) + "</p>";
      html += "</div>";
    }

    // 히어로: 1인당 금액 (탭하면 그 숫자만 복사)
    html += '<div class="sbc-heroLabel">' + escHtml(t("tool.hero.label")) + "</div>";
    html += '<div class="sbc-big" data-copy="' + escHtml(nf(r.perPerson)) + '" role="button" tabindex="0" title="' +
      escHtml(t("tool.copyOne")) + '">' + escHtml(nf(r.perPerson)) + "</div>";

    // 요약 카드: 팁 포함 총액 · 걷힌 금액 · 라운딩 잉여
    var surplusText = (Math.abs(r.surplus) < 0.005) ? t("tool.v.evenly") : nf(r.surplus);
    html += '<dl class="sbc-cards">';
    html += '<div class="sbc-cell" data-copy="' + escHtml(nf(r.grand)) + '"><dt>' +
      escHtml(t("tool.k.grand")) + "</dt><dd>" + escHtml(nf(r.grand)) + "</dd></div>";
    html += '<div class="sbc-cell" data-copy="' + escHtml(nf(r.collected)) + '"><dt>' +
      escHtml(t("tool.k.collected")) + "</dt><dd>" + escHtml(nf(r.collected)) + "</dd></div>";
    html += '<div class="sbc-cell" data-copy="' + escHtml(surplusText) + '"><dt>' +
      escHtml(t("tool.k.surplus")) + "</dt><dd>" + escHtml(surplusText) + "</dd></div>";
    html += "</dl>";

    // 복사 행 + 미리보기 + 상태
    html += '<div class="sbc-copyrow">' +
      '<button type="button" class="btn" id="sbc-copy" data-copy="' + escHtml(message) + '">' + escHtml(t("tool.copy")) + "</button>" +
      '<span class="sbc-copytext" data-copy="' + escHtml(message) + '">' + escHtml(message) + "</span></div>";
    html += '<p class="sbc-hint">' + escHtml(t("tool.copyHint")) + "</p>";
    html += '<p class="sbc-status" hidden></p>';

    resultEl.innerHTML = html;
  }

  /* ---- 복사 (Clipboard API → execCommand 폴백 → 실패 안내) ---- */
  function showStatus(text) {
    var st = resultEl ? resultEl.querySelector(".sbc-status") : null;
    if (!st) return;
    st.textContent = text;
    st.hidden = false;
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(function () {
      var s = resultEl ? resultEl.querySelector(".sbc-status") : null;
      if (s) { s.hidden = true; s.textContent = ""; }
    }, 1600);
  }
  function copyFallback(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      showStatus(ok ? t("tool.copied") : t("tool.copyFail"));
    } catch (e) { showStatus(t("tool.copyFail")); }
  }
  function copyText(text) {
    if (text == null || text === "") return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { showStatus(t("tool.copied")); },
        function () { copyFallback(text); }
      );
    } else {
      copyFallback(text);
    }
  }

  /* ---- 이벤트 ---- */
  if (totalEl) {
    totalEl.addEventListener("input", function () {
      var before = totalEl.value.slice(0, totalEl.selectionStart == null ? totalEl.value.length : totalEl.selectionStart);
      var digitsBefore = (before.replace(/[^\d]/g, "")).length;
      var cleaned = cleanTotalInput(totalEl.value);
      if (cleaned !== totalEl.value) {
        totalEl.value = cleaned;
        // 캐럿 복원: 앞쪽 자릿수 개수 기준
        var pos = 0, seen = 0;
        while (pos < cleaned.length && seen < digitsBefore) {
          if (/\d/.test(cleaned[pos])) seen++;
          pos++;
        }
        try { totalEl.setSelectionRange(pos, pos); } catch (e) { /* number/일부 브라우저 */ }
      }
      render();
    });
  }
  if (peopleEl) peopleEl.addEventListener("input", render);
  if (customEl) {
    customEl.addEventListener("input", function () {
      // 커스텀 팁 입력 시 프리셋 칩 해제
      if (customEl.value.trim() !== "" && tipsEl) {
        var chips = tipsEl.querySelectorAll(".sbc-chip");
        for (var i = 0; i < chips.length; i++) { chips[i].classList.remove("is-on"); chips[i].setAttribute("aria-pressed", "false"); }
      }
      render();
    });
  }

  function setChip(container, chip, clearCustom) {
    if (!container) return;
    var chips = container.querySelectorAll(".sbc-chip");
    for (var i = 0; i < chips.length; i++) {
      var on = chips[i] === chip;
      chips[i].classList.toggle("is-on", on);
      chips[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (clearCustom && customEl) customEl.value = "";
    render();
  }
  if (tipsEl) {
    tipsEl.addEventListener("click", function (ev) {
      var chip = ev.target.closest ? ev.target.closest(".sbc-chip") : null;
      if (chip) setChip(tipsEl, chip, true);
    });
  }
  if (roundsEl) {
    roundsEl.addEventListener("click", function (ev) {
      var chip = ev.target.closest ? ev.target.closest(".sbc-chip") : null;
      if (chip) setChip(roundsEl, chip, false);
    });
  }

  function stepPeople(delta) {
    if (!peopleEl) return;
    var cur = parseNum(peopleEl.value);
    if (isNaN(cur)) cur = delta > 0 ? 0 : 2;
    var next = Math.max(1, Math.floor(cur) + delta);
    peopleEl.value = String(next);
    render();
  }
  if (minusBtn) minusBtn.addEventListener("click", function () { stepPeople(-1); });
  if (plusBtn) plusBtn.addEventListener("click", function () { stepPeople(1); });

  // 결과 영역은 렌더마다 갈아끼우므로 복사 대상은 위임 처리
  if (resultEl) {
    resultEl.addEventListener("click", function (ev) {
      var el = ev.target;
      while (el && el !== resultEl) {
        if (el.getAttribute && el.getAttribute("data-copy") != null) { copyText(el.getAttribute("data-copy")); return; }
        el = el.parentNode;
      }
    });
    resultEl.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      var el = ev.target;
      if (el && el.getAttribute && el.getAttribute("data-copy") != null) {
        ev.preventDefault();
        copyText(el.getAttribute("data-copy"));
      }
    });
  }

  // 언어 전환 시 결과·안내 문구 재렌더
  document.addEventListener("i18n:change", render);

  // 초기 렌더 (기본: 인원 2, 팁 0%, Exact)
  render();
  // TOOLJS:END
})();
