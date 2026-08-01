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
  var formula = $("formula"), result = $("result"), errEl = $("err"), body = $("comp-body");
  if (!formula || !result || !body) return;

  var t = function (k) { return (window.I18N && window.I18N.t) ? window.I18N.t(k) : k; };

  // IUPAC 2021 표준 원자량(자연 존재비 가중 평균), 소수 4자리. 방사성 원소는 가장 안정한 동위원소 질량수.
  var W = {
    H:1.0080, He:4.0026, Li:6.9400, Be:9.0122, B:10.8100, C:12.0110, N:14.0070, O:15.9990,
    F:18.9984, Ne:20.1797, Na:22.9898, Mg:24.3050, Al:26.9815, Si:28.0850, P:30.9738, S:32.0600,
    Cl:35.4500, Ar:39.9480, K:39.0983, Ca:40.0780, Sc:44.9559, Ti:47.8670, V:50.9415, Cr:51.9961,
    Mn:54.9380, Fe:55.8450, Co:58.9332, Ni:58.6934, Cu:63.5460, Zn:65.3800, Ga:69.7230, Ge:72.6300,
    As:74.9216, Se:78.9710, Br:79.9040, Kr:83.7980, Rb:85.4678, Sr:87.6200, Y:88.9058, Zr:91.2240,
    Nb:92.9064, Mo:95.9500, Tc:98.0000, Ru:101.0700, Rh:102.9055, Pd:106.4200, Ag:107.8682,
    Cd:112.4140, In:114.8180, Sn:118.7100, Sb:121.7600, Te:127.6000, I:126.9045, Xe:131.2930,
    Cs:132.9055, Ba:137.3270, La:138.9055, Ce:140.1160, Pr:140.9077, Nd:144.2420, Pm:145.0000,
    Sm:150.3600, Eu:151.9640, Gd:157.2500, Tb:158.9254, Dy:162.5000, Ho:164.9303, Er:167.2590,
    Tm:168.9342, Yb:173.0450, Lu:174.9668, Hf:178.4860, Ta:180.9479, W:183.8400, Re:186.2070,
    Os:190.2300, Ir:192.2170, Pt:195.0840, Au:196.9666, Hg:200.5920, Tl:204.3800, Pb:207.2000,
    Bi:208.9804, Po:209.0000, At:210.0000, Rn:222.0000, Fr:223.0000, Ra:226.0000, Ac:227.0000,
    Th:232.0377, Pa:231.0359, U:238.0289, Np:237.0000, Pu:244.0000, Am:243.0000, Cm:247.0000,
    Bk:247.0000, Cf:251.0000, Es:252.0000, Fm:257.0000, Md:258.0000, No:259.0000, Lr:266.0000,
    Rf:267.0000, Db:268.0000, Sg:269.0000, Bh:270.0000, Hs:269.0000, Mt:278.0000, Ds:281.0000,
    Rg:282.0000, Cn:285.0000, Nh:286.0000, Fl:289.0000, Mc:290.0000, Lv:293.0000, Ts:294.0000,
    Og:294.0000
  };

  function bad(key, arg) { var e = new Error(key); e.key = key; e.arg = arg; return e; }

  function add(map, sym, n) { map[sym] = (map[sym] || 0) + n; }
  function merge(dst, src, mult) {
    for (var s in src) { if (Object.prototype.hasOwnProperty.call(src, s)) add(dst, s, src[s] * mult); }
  }

  // 한 조각(수화물 점으로 나뉜 단위)을 괄호 스택으로 파싱한다. 객체 키 순서 = 등장 순서.
  function parseSegment(seg) {
    var stack = [{}], i = 0;
    function num() {
      var d = "";
      while (i < seg.length && seg.charAt(i) >= "0" && seg.charAt(i) <= "9") { d += seg.charAt(i); i++; }
      return d === "" ? 1 : parseInt(d, 10);
    }
    while (i < seg.length) {
      var c = seg.charAt(i);
      if (c === " " || c === "\t") { i++; continue; }
      if (c === "(" || c === "[" || c === "{") { stack.push({}); i++; continue; }
      if (c === ")" || c === "]" || c === "}") {
        if (stack.length < 2) throw bad("tool.err.paren");
        var top = stack.pop(); i++;
        merge(stack[stack.length - 1], top, num());
        continue;
      }
      if (c >= "A" && c <= "Z") {
        var sym = c; i++;
        while (i < seg.length && seg.charAt(i) >= "a" && seg.charAt(i) <= "z") { sym += seg.charAt(i); i++; }
        if (!Object.prototype.hasOwnProperty.call(W, sym)) throw bad("tool.err.symbol", sym);
        add(stack[stack.length - 1], sym, num());
        continue;
      }
      throw bad("tool.err.char", c);
    }
    if (stack.length > 1) throw bad("tool.err.paren");
    return stack[0];
  }

  // 수화물 표기: 점 뒤의 계수는 그 조각 전체에 곱해진다 (CuSO4.5H2O).
  function parseFormula(src) {
    var segs = src.split(/[.\u00b7\u22c5*]/), out = {}, k, m, seg, coef;
    for (k = 0; k < segs.length; k++) {
      seg = segs[k].replace(/^\s+|\s+$/g, "");
      m = seg.match(/^[0-9]+/);
      coef = m ? parseInt(m[0], 10) : 1;
      if (m) seg = seg.slice(m[0].length);
      if (!seg) continue;
      merge(out, parseSegment(seg), coef);
    }
    return out;
  }

  function fail(key, arg) {
    var msg = t(key);
    if (arg) msg = msg.replace("{s}", arg).replace("{c}", arg);
    result.hidden = true;
    errEl.hidden = false;
    errEl.textContent = msg;
  }

  function cell(row, text) {
    var td = document.createElement("td");
    td.textContent = text;
    row.appendChild(td);
  }

  function calc() {
    var src = String(formula.value).replace(/^\s+|\s+$/g, "");
    if (!src) return fail("tool.err.empty");

    var counts;
    try { counts = parseFormula(src); }
    catch (e) { return fail(e.key || "tool.err.empty", e.arg); }

    var syms = Object.keys(counts).filter(function (s) { return counts[s] > 0; });
    var total = 0, atoms = 0, i;
    for (i = 0; i < syms.length; i++) { total += counts[syms[i]] * W[syms[i]]; atoms += counts[syms[i]]; }
    if (!syms.length || total <= 0) return fail("tool.err.noelem");

    $("r-mass").textContent = total.toFixed(3) + " " + t("tool.unit.gmol");
    $("r-elements").textContent = String(syms.length);
    $("r-atoms").textContent = String(atoms);

    while (body.firstChild) body.removeChild(body.firstChild);
    for (i = 0; i < syms.length; i++) {
      var s = syms[i], mass = counts[s] * W[s];
      var row = document.createElement("tr");
      cell(row, s);
      cell(row, String(counts[s]));
      cell(row, mass.toFixed(3));
      cell(row, (mass / total * 100).toFixed(2) + "%");
      body.appendChild(row);
    }

    errEl.hidden = true;
    result.hidden = false;
  }

  $("calc-btn").addEventListener("click", calc);
  formula.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); calc(); } });
  formula.addEventListener("input", function () { if (!result.hidden || !errEl.hidden) calc(); });
  document.addEventListener("i18n:change", function () { if (!result.hidden || !errEl.hidden) calc(); });
  // TOOLJS:END
})();
