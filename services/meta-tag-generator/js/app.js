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
  /* Meta Tag Generator — 폼(제목/설명/canonical URL/OG 이미지/트위터 카드 타입/robots)을
     즉시 <title>/meta/OG/Twitter 태그 블록으로 변환하고, Google 검색결과와 소셜 카드
     미리보기를 라이브로 그린다. 외부 API 없음 — 이미지 미리보기만 사용자가 입력한
     URL 을 브라우저가 직접 요청한다(우리 서버 경유 아님). 상태는 localStorage 만. */

  /* ---- 순수 함수 (node 단위 검증 대상) ---- */

  // 속성/텍스트에 안전하게 넣기 위한 HTML 이스케이프 (& 먼저 처리해야 이중 치환이 안 생긴다)
  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // 문자 길이: surrogate pair(대부분의 이모지)를 1개로 세어 눈에 보이는 길이에 더 가깝게 한다
  function charLen(str) {
    if (!str) return 0;
    try { return Array.from(String(str)).length; }
    catch (e) { return String(str).length; }
  }

  // 미터 상태: empty(미입력) / ok / near(권장치 85%↑) / over(권장치 초과)
  function meterState(count, limit) {
    if (count <= 0) return "empty";
    if (count > limit) return "over";
    if (count >= limit * 0.85) return "near";
    return "ok";
  }

  function isHttpUrl(str) {
    return /^https?:\/\/\S+/i.test(String(str == null ? "" : str).trim());
  }

  // URL → hostname (실패 시 null). 미리보기의 초록 URL 줄과 도메인 배지에 쓰인다.
  function hostFromUrl(str) {
    var s = String(str == null ? "" : str).trim();
    if (!isHttpUrl(s)) return null;
    try { return new URL(s).hostname.replace(/^www\./, ""); }
    catch (e) { return null; }
  }

  // Google SERP 스타일 브레드크럼("example.com › blog › post"). 실패 시 null.
  function breadcrumbFromUrl(str) {
    var s = String(str == null ? "" : str).trim();
    if (!isHttpUrl(s)) return null;
    try {
      var u = new URL(s);
      var segs = u.pathname.split("/").filter(function (p) { return p.length > 0; });
      var host = u.hostname.replace(/^www\./, "");
      return segs.length ? host + " › " + segs.join(" › ") : host;
    } catch (e) { return null; }
  }

  // 폼 데이터 → <head> 삽입용 태그 블록 문자열. title 이 없으면 null(안내 문구로 대체).
  function buildMetaBlock(d) {
    var title = String(d.title || "").trim();
    if (!title) return null;
    var desc = String(d.desc || "").trim();
    var url = String(d.url || "").trim();
    var siteName = String(d.siteName || "").trim();
    var image = String(d.image || "").trim();
    var twcard = d.twcard === "summary" ? "summary" : "summary_large_image";
    var robots = d.robots || "index, follow";
    var hasUrl = isHttpUrl(url);
    var lines = [];

    lines.push("<title>" + escapeHtml(title) + "</title>");
    if (desc) lines.push('<meta name="description" content="' + escapeHtml(desc) + '">');
    if (hasUrl) lines.push('<link rel="canonical" href="' + escapeHtml(url) + '">');
    lines.push('<meta name="robots" content="' + escapeHtml(robots) + '">');

    lines.push('<meta property="og:type" content="website">');
    if (hasUrl) lines.push('<meta property="og:url" content="' + escapeHtml(url) + '">');
    lines.push('<meta property="og:title" content="' + escapeHtml(title) + '">');
    if (desc) lines.push('<meta property="og:description" content="' + escapeHtml(desc) + '">');
    if (siteName) lines.push('<meta property="og:site_name" content="' + escapeHtml(siteName) + '">');
    if (image) lines.push('<meta property="og:image" content="' + escapeHtml(image) + '">');

    lines.push('<meta name="twitter:card" content="' + escapeHtml(twcard) + '">');
    lines.push('<meta name="twitter:title" content="' + escapeHtml(title) + '">');
    if (desc) lines.push('<meta name="twitter:description" content="' + escapeHtml(desc) + '">');
    if (image) lines.push('<meta name="twitter:image" content="' + escapeHtml(image) + '">');

    return lines.join("\n");
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      escapeHtml: escapeHtml, charLen: charLen, meterState: meterState,
      isHttpUrl: isHttpUrl, hostFromUrl: hostFromUrl,
      breadcrumbFromUrl: breadcrumbFromUrl, buildMetaBlock: buildMetaBlock
    };
    return;
  }

  var TITLE_LIMIT = 60;
  var DESC_LIMIT = 160;

  function t(key, fallback) {
    var v = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t(key) : null;
    return v == null || v === key ? (fallback == null ? key : fallback) : v;
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var titleEl = $("mtg-title"), titleCountEl = $("mtg-title-count"),
      titleBarEl = $("mtg-title-bar"), titleHintEl = $("mtg-title-hint");
  var descEl = $("mtg-desc"), descCountEl = $("mtg-desc-count"),
      descBarEl = $("mtg-desc-bar"), descHintEl = $("mtg-desc-hint");
  var urlEl = $("mtg-url"), urlWarnEl = $("mtg-url-warn");
  var siteNameEl = $("mtg-sitename"), imageEl = $("mtg-image");
  var twcardEl = $("mtg-twcard"), twcardHintEl = $("mtg-twcard-hint");
  var robotsEl = $("mtg-robots");
  var outputEl = $("mtg-output"), copyBtn = $("mtg-copy"), toastEl = $("mtg-toast");
  var serpUrlEl = $("mtg-serp-url"), serpTitleEl = $("mtg-serp-title"), serpDescEl = $("mtg-serp-desc");
  var socialImgEl = $("mtg-social-img"), socialPhEl = $("mtg-social-ph"),
      socialDomainEl = $("mtg-social-domain"), socialTitleEl = $("mtg-social-title"), socialDescEl = $("mtg-social-desc");
  if (!titleEl || !descEl || !outputEl) return;

  var cfg = window.APP_CONFIG || {};
  var SKEY = (cfg.slug || "meta-tag-generator") + ":state";
  var imgDebounce = null;

  /* ---- 저장/복원 ---- */
  function save() {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        title: titleEl.value, desc: descEl.value, url: urlEl.value,
        siteName: siteNameEl.value, image: imageEl.value,
        twcard: twcardEl.value, robots: robotsEl.value
      }));
    } catch (e) { /* private mode — 저장만 실패, 편집은 계속 가능 */ }
  }
  function restore() {
    var raw = null;
    try { raw = localStorage.getItem(SKEY); } catch (e) { return; }
    if (!raw) return;
    try {
      var s = JSON.parse(raw);
      if (typeof s.title === "string") titleEl.value = s.title;
      if (typeof s.desc === "string") descEl.value = s.desc;
      if (typeof s.url === "string") urlEl.value = s.url;
      if (typeof s.siteName === "string") siteNameEl.value = s.siteName;
      if (typeof s.image === "string") imageEl.value = s.image;
      if (s.twcard === "summary" || s.twcard === "summary_large_image") twcardEl.value = s.twcard;
      if (typeof s.robots === "string") robotsEl.value = s.robots;
    } catch (e) { /* 손상된 저장값 — 기본값 유지 */ }
  }

  /* ---- 미터 ---- */
  function applyMeter(count, limit, barEl, countEl, hintEl) {
    var state = meterState(count, limit);
    if (countEl) {
      countEl.textContent = t("tool.count", "{n} / {max} characters")
        .replace("{n}", String(count)).replace("{max}", String(limit));
      countEl.className = "mtg-count is-" + state;
    }
    if (barEl) {
      barEl.style.width = Math.min(100, (count / limit) * 100) + "%";
      barEl.className = "mtg-bar is-" + state;
    }
    if (hintEl) hintEl.hidden = state !== "over";
  }

  /* ---- 소셜 이미지 미리보기 (디바운스 — 매 키 입력마다 요청하지 않는다) ---- */
  function updateSocialImage(url) {
    if (!socialImgEl || !socialPhEl) return;
    if (imgDebounce) clearTimeout(imgDebounce);
    if (!url) {
      socialImgEl.hidden = true;
      socialPhEl.hidden = false;
      socialPhEl.textContent = t("tool.preview.noImage", "1200 × 630 image preview");
      return;
    }
    imgDebounce = setTimeout(function () {
      socialImgEl.onerror = function () {
        socialImgEl.hidden = true;
        socialPhEl.hidden = false;
        socialPhEl.textContent = t("tool.preview.imageError", "Image failed to load");
      };
      socialImgEl.onload = function () {
        socialImgEl.hidden = false;
        socialPhEl.hidden = true;
      };
      socialImgEl.src = url;
    }, 350);
  }

  /* ---- 렌더 ---- */
  function render() {
    var data = {
      title: titleEl.value, desc: descEl.value, url: urlEl.value,
      siteName: siteNameEl.value, image: imageEl.value,
      twcard: twcardEl.value, robots: robotsEl.value
    };
    var titleLen = charLen(data.title), descLen = charLen(data.desc);

    applyMeter(titleLen, TITLE_LIMIT, titleBarEl, titleCountEl, titleHintEl);
    applyMeter(descLen, DESC_LIMIT, descBarEl, descCountEl, descHintEl);

    // URL 형식 경고 (값이 있는데 http(s):// 로 시작하지 않을 때만)
    if (urlWarnEl) urlWarnEl.hidden = data.url.trim() === "" || isHttpUrl(data.url);

    // 대형 이미지 카드인데 이미지가 없으면 안내
    if (twcardHintEl) twcardHintEl.hidden = !(data.twcard === "summary_large_image" && !data.image.trim());

    // 출력 블록
    var block = buildMetaBlock(data);
    outputEl.value = block || t("tool.output.empty", "Enter a page title above, and your <title>, meta description, Open Graph and Twitter Card tags will appear here — ready to copy into your <head>.");
    if (copyBtn) copyBtn.disabled = !block;

    // Google 검색결과 미리보기
    var crumb = breadcrumbFromUrl(data.url);
    if (serpUrlEl) serpUrlEl.textContent = crumb || t("tool.preview.urlPh", "example.com › your-page");
    if (serpTitleEl) serpTitleEl.textContent = data.title.trim() || t("tool.preview.titlePh", "Your page title will appear here");
    if (serpDescEl) serpDescEl.textContent = data.desc.trim() || t("tool.preview.descPh", "Your meta description will appear here, summarizing the page for search results.");

    // 소셜 카드 미리보기
    var host = hostFromUrl(data.url);
    if (socialDomainEl) socialDomainEl.textContent = (host || t("tool.preview.urlPh", "example.com")).toUpperCase();
    if (socialTitleEl) socialTitleEl.textContent = data.title.trim() || t("tool.preview.titlePh", "Your page title will appear here");
    if (socialDescEl) socialDescEl.textContent = data.desc.trim() || t("tool.preview.descPh", "Your meta description will appear here, summarizing the page for search results.");
    updateSocialImage(data.image.trim());

    save();
  }

  /* ---- 복사 ---- */
  var toastTimer = null;
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.textContent = ""; }, 2000);
  }
  function legacyCopy(text, onOk) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      onOk();
    } catch (e) { showToast(t("tool.copyFail", "Copy failed — select the text manually")); }
  }
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      if (!outputEl.value || copyBtn.disabled) return;
      var onOk = function () { showToast(t("tool.copied", "Copied to clipboard")); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(outputEl.value).then(onOk, function () { legacyCopy(outputEl.value, onOk); });
      } else {
        legacyCopy(outputEl.value, onOk);
      }
    });
  }

  /* ---- 이벤트 ---- */
  [titleEl, descEl, urlEl, siteNameEl, imageEl].forEach(function (el) {
    el.addEventListener("input", render);
  });
  [twcardEl, robotsEl].forEach(function (el) {
    el.addEventListener("change", render);
  });
  document.addEventListener("i18n:change", render);

  restore();
  render();
  // TOOLJS:END
})();
