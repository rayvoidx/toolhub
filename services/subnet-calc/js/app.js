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
  /* IP Subnet Calculator — IPv4 주소 + CIDR 프리픽스(또는 점 표기 넷마스크)를 입력받아
     네트워크 주소·브로드캐스트·사용 가능 호스트 범위·와일드카드 마스크·2진수 분해·
     /8~/32 CIDR 속견표를 계산한다. /31(RFC 3021 point-to-point)·/32(단일 호스트 라우트)
     특수 케이스를 정확히 처리한다. 외부 라이브러리·API 없음, 모든 계산은 로컬 정수 연산.
     상태: localStorage "<slug>:state" (마지막 IP·프리픽스 입력)만. */

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */

  // "192.168.1.10" → [192,168,1,10] 또는 형식이 어긋나면 null (옥텟 0-255, 정확히 4개)
  function parseIPv4(s) {
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
    if (!m) return null;
    var out = [];
    for (var i = 1; i <= 4; i++) {
      var n = parseInt(m[i], 10);
      if (n < 0 || n > 255) return null;
      out.push(n);
    }
    return out;
  }

  // 옥텟 배열 → 부호 없는 32비트 정수. o[0]<<24 는 o[0]>127 일 때 int32 부호 비트가 서므로
  // 매 단계 사이에 두지 않고 마지막에 한 번만 >>>0 으로 unsigned 로 되돌린다.
  function octetsToInt(o) {
    return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  }

  // 32비트 정수 → "a.b.c.d" 문자열
  function intToIp(n) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }

  // 프리픽스 길이(0-32) → 넷마스크 정수. prefix=0 은 "32비트 왼쪽 시프트"가 JS에서
  // 시프트량 mod 32 로 감겨 0시프트(=변화 없음)가 되어버리는 함정이 있어 별도 처리한다.
  function maskFromPrefix(prefix) {
    if (prefix <= 0) return 0;
    return (0xFFFFFFFF << (32 - prefix)) >>> 0;
  }

  function wildcardFromMask(mask) {
    return (~mask) >>> 0;
  }

  // 넷마스크 정수 → 프리픽스 길이, 단 "왼쪽부터 연속된 1 다음 연속된 0" 형태가 아니면 null
  // (255.255.255.64 같은 불연속 마스크는 유효한 넷마스크가 아니다 — 라우팅에서 정의되지 않음).
  function maskToPrefix(mask) {
    if (mask === 0) return 0;
    var ones = 0;
    for (var i = 31; i >= 0; i--) {
      if (((mask >>> i) & 1) === 1) ones++; else break;
    }
    return maskFromPrefix(ones) === mask ? ones : null;
  }

  // "24" / "/24" / "255.255.255.0" 중 어느 형식이든 받아 프리픽스 정수를 돌려주거나,
  // 실패 시 {error:"range"|"noncontig"|"invalid"} 를 돌려준다 (호출부가 정확한 오류 문구 결정).
  function parsePrefixOrMask(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (s.charAt(0) === "/") s = s.slice(1);
    if (/^\d{1,2}$/.test(s)) {
      var n = parseInt(s, 10);
      if (n >= 0 && n <= 32) return n;
      return { error: "range" };
    }
    var octs = parseIPv4(s);
    if (octs) {
      var maskInt = octetsToInt(octs);
      var prefix = maskToPrefix(maskInt);
      if (prefix == null) return { error: "noncontig" };
      return prefix;
    }
    return { error: "invalid" };
  }

  // 서브넷 전체 계산. /31(RFC 3021 point-to-point)과 /32(단일 호스트)는 네트워크/브로드캐스트
  // 예약이 없는 예외이므로 usable·first·last 를 별도 분기로 계산한다.
  function computeSubnet(ipInt, prefix) {
    var mask = maskFromPrefix(prefix);
    var wildcard = wildcardFromMask(mask);
    var network = (ipInt & mask) >>> 0;
    var broadcast = (network | wildcard) >>> 0;
    var total = Math.pow(2, 32 - prefix); // /0 은 2^32 로 int32 범위를 넘어가 Number 연산 사용
    var usable, first, last;
    if (prefix === 32) {
      usable = 1; first = network; last = network;
    } else if (prefix === 31) {
      usable = 2; first = network; last = broadcast;
    } else {
      usable = total - 2;
      first = (network + 1) >>> 0;
      last = (broadcast - 1) >>> 0;
    }
    return {
      mask: mask, wildcard: wildcard, network: network, broadcast: broadcast,
      total: total, usable: usable, first: first, last: last, prefix: prefix
    };
  }

  // 입력한 IP 가 어떤 주소 대역에 속하는지 분류 (RFC 1918 사설 / 루프백 / 링크로컬 /
  // 멀티캐스트 / 예약·문서용 / 그 외 공인). 문구 키만 돌려주고 번역은 호출부가 한다.
  function classifyAddress(ipInt) {
    function inNet(a, b, c, d, prefix) {
      var m = maskFromPrefix(prefix);
      return ((ipInt & m) >>> 0) === ((octetsToInt([a, b, c, d]) & m) >>> 0);
    }
    if (inNet(127, 0, 0, 0, 8)) return "loopback";
    if (inNet(10, 0, 0, 0, 8) || inNet(172, 16, 0, 0, 12) || inNet(192, 168, 0, 0, 16)) return "private";
    if (inNet(169, 254, 0, 0, 16)) return "linklocal";
    if (inNet(224, 0, 0, 0, 4)) return "multicast";
    if (inNet(0, 0, 0, 0, 8) || inNet(100, 64, 0, 0, 10) || inNet(192, 0, 0, 0, 24) ||
        inNet(192, 0, 2, 0, 24) || inNet(198, 18, 0, 0, 15) || inNet(198, 51, 100, 0, 24) ||
        inNet(203, 0, 113, 0, 24) || inNet(240, 0, 0, 0, 4)) return "reserved";
    return "public";
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseIPv4: parseIPv4, octetsToInt: octetsToInt, intToIp: intToIp,
      maskFromPrefix: maskFromPrefix, wildcardFromMask: wildcardFromMask,
      maskToPrefix: maskToPrefix, parsePrefixOrMask: parsePrefixOrMask,
      computeSubnet: computeSubnet, classifyAddress: classifyAddress
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "subnet-calc") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmt(n) {
    try { return new Intl.NumberFormat(uiLang()).format(n); }
    catch (e) { return String(n); }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var ipEl = $("sc-ip"), prefixEl = $("sc-prefix");
  var errEl = $("sc-err"), emptyEl = $("sc-empty"), resultEl = $("sc-result"), noteEl = $("sc-note");
  var gridEl = $("sc-grid"), copyHintEl = $("sc-copy-hint");
  var binIpEl = $("sc-bin-ip"), binMaskEl = $("sc-bin-mask");
  var tableBody = $("sc-table-body");
  if (!ipEl || !prefixEl || !gridEl) return;
  var cards = gridEl.querySelectorAll(".res-card");

  /* ---- 상태 저장/복원 ---- */
  function saveState() {
    try { localStorage.setItem(SKEY, JSON.stringify({ ip: ipEl.value, prefix: prefixEl.value })); }
    catch (e) { /* private mode — 저장만 실패, 계산은 정상 */ }
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(SKEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : null;
    } catch (e) { return null; }
  }

  /* ---- 카드 값 세팅 ---- */
  function setCard(key, text) {
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute("data-copy") === key) {
        var valEl = cards[i].querySelector(".rc-value");
        if (valEl) valEl.textContent = text;
        cards[i].setAttribute("data-value", text);
      }
    }
  }

  /* ---- 2진수 시각화 ---- */
  // 32비트를 8비트씩 4개 옥텟으로 묶어 렌더링. bitIndex < prefix 인 비트는 네트워크 부분으로
  // 강조(accent) 색을, 나머지는 호스트 부분으로 muted 색을 준다 — IP 행·마스크 행 모두 동일
  // 경계선 기준이라 두 행을 나란히 보면 프리픽스 경계가 시각적으로 정렬되어 보인다.
  function renderBits(container, value, prefix) {
    if (!container) return;
    container.textContent = "";
    for (var oct = 0; oct < 4; oct++) {
      if (oct > 0) {
        var dot = document.createElement("span");
        dot.className = "sc-bin-dot";
        dot.textContent = ".";
        container.appendChild(dot);
      }
      var octSpan = document.createElement("span");
      octSpan.className = "sc-bin-oct";
      for (var b = 0; b < 8; b++) {
        var bitIndex = oct * 8 + b;
        var bitVal = (value >>> (31 - bitIndex)) & 1;
        var bitEl = document.createElement("span");
        bitEl.className = "sc-bit " + (bitIndex < prefix ? "sc-bit-net" : "sc-bit-host");
        bitEl.textContent = String(bitVal);
        octSpan.appendChild(bitEl);
      }
      container.appendChild(octSpan);
    }
  }

  /* ---- CIDR 속견표 (/8-/32, 입력과 무관한 정적 데이터) ---- */
  function appendTd(row, text) {
    var td = document.createElement("td");
    td.textContent = text;
    row.appendChild(td);
  }
  function buildTable() {
    if (!tableBody) return;
    tableBody.textContent = "";
    for (var p = 0; p <= 32; p++) {
      var mask = maskFromPrefix(p);
      var wildcard = wildcardFromMask(mask);
      var total = Math.pow(2, 32 - p);
      var usable = p === 32 ? 1 : (p === 31 ? 2 : total - 2);
      var row = document.createElement("tr");
      appendTd(row, "/" + p);
      appendTd(row, intToIp(mask));
      appendTd(row, intToIp(wildcard));
      appendTd(row, fmt(total));
      appendTd(row, fmt(usable));
      tableBody.appendChild(row);
    }
  }

  /* ---- 상태 표시 헬퍼 ---- */
  function showEmpty() {
    errEl.hidden = true; errEl.textContent = "";
    resultEl.hidden = true;
    emptyEl.hidden = false;
  }
  function showError(msg) {
    resultEl.hidden = true;
    emptyEl.hidden = true;
    errEl.textContent = msg;
    errEl.hidden = false;
  }

  /* ---- 메인 계산 + 렌더 ---- */
  function computeAndRender() {
    // "192.168.1.10/24" 처럼 CIDR 통째로 붙여넣은 경우 두 필드로 갈라 넣는다 (붙여넣기 실패 방지)
    var pasted = ipEl.value.indexOf("/");
    if (pasted > -1) {
      var suffix = ipEl.value.slice(pasted + 1).trim();
      ipEl.value = ipEl.value.slice(0, pasted).trim();
      if (suffix !== "") prefixEl.value = suffix;
    }
    var ipTrim = ipEl.value.trim();
    var prefixTrim = prefixEl.value.trim();

    if (ipTrim === "") { showEmpty(); saveState(); return; }

    var octs = parseIPv4(ipTrim);
    if (!octs) { showError(tr("tool.err.ip", "Enter a valid IPv4 address, like 192.168.1.10")); saveState(); return; }

    if (prefixTrim === "") { showError(tr("tool.err.prefix", "Enter a prefix between /0 and /32, or a valid netmask like 255.255.255.0")); saveState(); return; }

    var parsed = parsePrefixOrMask(prefixTrim);
    if (parsed && typeof parsed === "object") {
      var msg = parsed.error === "noncontig"
        ? tr("tool.err.prefixNoncontig", "\"{x}\" isn't a valid netmask — the 1 bits must be contiguous from the left").replace("{x}", prefixTrim)
        : tr("tool.err.prefix", "Enter a prefix between /0 and /32, or a valid netmask like 255.255.255.0");
      showError(msg);
      saveState();
      return;
    }

    var ipInt = octetsToInt(octs);
    var r = computeSubnet(ipInt, parsed);

    setCard("cidr", intToIp(r.network) + "/" + r.prefix);
    setCard("netmask", intToIp(r.mask));
    setCard("network", intToIp(r.network));
    setCard("broadcast", intToIp(r.broadcast));
    setCard("first", intToIp(r.first));
    setCard("last", intToIp(r.last));
    setCard("usable", fmt(r.usable));
    setCard("wildcard", intToIp(r.wildcard));
    setCard("total", fmt(r.total));
    var kind = classifyAddress(ipInt);
    setCard("type", tr("tool.type." + kind, kind));

    renderBits(binIpEl, ipInt, r.prefix);
    renderBits(binMaskEl, r.mask, r.prefix);

    if (r.prefix === 31) {
      noteEl.textContent = tr("tool.note.slash31", "/31 is a point-to-point link (RFC 3021) — both addresses are usable and there's no network or broadcast address.");
      noteEl.hidden = false;
    } else if (r.prefix === 32) {
      noteEl.textContent = tr("tool.note.slash32", "/32 is a single host route — the address is its own network, broadcast, and only usable host.");
      noteEl.hidden = false;
    } else {
      noteEl.hidden = true;
    }

    errEl.hidden = true;
    emptyEl.hidden = true;
    resultEl.hidden = false;
    if (copyHintEl) copyHintEl.hidden = false;

    saveState();
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

  /* ---- 이벤트 ---- */
  ipEl.addEventListener("input", computeAndRender);
  prefixEl.addEventListener("input", computeAndRender);
  for (var i = 0; i < cards.length; i++) {
    cards[i].addEventListener("click", function () { copyCard(this); });
  }
  // 언어 전환 시 오류/안내 문구·숫자 포맷(천단위 구분자는 로케일마다 다름)·속견표 재적용
  document.addEventListener("i18n:change", function () {
    buildTable();
    computeAndRender();
  });

  /* ---- 초기화: 저장된 마지막 입력 복원 ---- */
  var savedState = loadState();
  if (savedState) {
    if (typeof savedState.ip === "string") ipEl.value = savedState.ip;
    if (typeof savedState.prefix === "string") prefixEl.value = savedState.prefix;
  }
  buildTable();
  computeAndRender();
  // TOOLJS:END
})();
