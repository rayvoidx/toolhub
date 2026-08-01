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
  var text = $("text"), sep = $("sep"), lower = $("lower"), stop = $("stop");
  var slugEl = $("slug"), result = $("result"), errEl = $("err"), hint = $("len-hint");
  if (!text || !sep || !slugEl) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  var STOP = { "a":1, "an":1, "the":1, "and":1, "or":1, "but":1, "for":1, "at":1, "by":1,
    "of":1, "on":1, "to":1, "in":1, "with":1 };

  // NFD 로 분해되지 않는 글자들 — 결합문자 제거만으로는 못 벗기므로 직접 대응시킨다.
  var FOLD = { "ß":"ss", "ø":"o", "Ø":"O", "æ":"ae", "Æ":"AE", "œ":"oe", "Œ":"OE",
    "ł":"l", "Ł":"L", "đ":"d", "Đ":"D", "þ":"th", "Þ":"Th", "ð":"d", "Ð":"D" };

  // 라틴 밖 문자(한글·키릴·아랍 등)는 그대로 남긴다. \p{M} 을 포함해야 데바나가리 모음기호가 잘리지 않는다.
  // 유니코드 속성 이스케이프를 못 쓰는 구형 엔진에서는 ASCII 폴백 — 리터럴로 쓰면 파싱 단계에서 셸까지 죽는다.
  var NONWORD;
  try { NONWORD = new RegExp("[^\\p{L}\\p{N}\\p{M}]+", "gu"); }
  catch (e) { NONWORD = /[^A-Za-z0-9]+/g; }

  function fold(s) {
    var out = "", i;
    for (i = 0; i < s.length; i++) { var c = s.charAt(i); out += (FOLD[c] || c); }
    // NFD 로 악센트를 떼어내고 결합문자만 지운 뒤 NFC 로 되돌린다 — 한글이 자모로 풀린 채 남지 않게.
    return out.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC");
  }

  function slugify(raw, sepCh, doLower, dropStop) {
    var s = fold(String(raw).trim());
    if (doLower) s = s.toLowerCase();
    // 아포스트로피는 구분자로 바꾸지 않고 지운다 — owner's 가 owner-s 로 쪼개지면 읽기 나빠진다.
    s = s.replace(/['\u2018\u2019\u02bc]/g, "");
    // 구분자 아닌 문자를 통째로 끊어내므로 중복 구분자·앞뒤 구분자가 애초에 생기지 않는다.
    var words = s.split(NONWORD).filter(function (w) { return w.length > 0; });
    if (!words.length) return { err: "tool.err.nothing" };
    if (dropStop) {
      var kept = words.filter(function (w) { return !STOP[w.toLowerCase()]; });
      if (!kept.length) return { err: "tool.err.allstop" };
      words = kept;
    }
    return { slug: words.join(sepCh) };
  }

  function fail(key) { result.hidden = true; errEl.hidden = false; errEl.textContent = t(key); }

  function calc() {
    var raw = String(text.value);
    if (!raw.trim()) return fail("tool.err.empty");
    var r = slugify(raw, sep.value, lower.checked, stop.checked);
    if (r.err) return fail(r.err);

    slugEl.value = r.slug;
    var n = r.slug.length;
    $("r-chars").textContent = String(n);
    var over = n > 60;
    hint.textContent = t(over ? "tool.len.long" : "tool.len.good").replace("{n}", String(n));
    hint.style.color = over ? "#d97706" : "#16a34a";
    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  text.addEventListener("input", function () { calc(); });
  text.addEventListener("keydown", function (e) { if (e.key === "Enter") calc(); });
  [sep, lower, stop].forEach(function (el) {
    el.addEventListener("change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });

  $("copy-btn").addEventListener("click", function () {
    var btn = $("copy-btn");
    if (!slugEl.value) return;
    var done = function () {
      var prev = btn.textContent;
      btn.textContent = t("tool.copied");
      setTimeout(function () { btn.textContent = prev; }, 1200);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(slugEl.value).then(done, function () { /* 권한 거부 */ });
    else { slugEl.removeAttribute("readonly"); slugEl.select(); document.execCommand("copy"); slugEl.setAttribute("readonly", ""); done(); }
  });
  // TOOLJS:END
})();
