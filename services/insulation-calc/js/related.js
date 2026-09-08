(function(){
  "use strict";
  var CATALOG = {"laminate-flooring-calc":{"cat":"life","emoji":"🪵","names":{"en":"Laminate Flooring Calculator","zh":"强化地板计算器","hi":"लैमिनेट फ़्लोरिंग कैलकुलेटर","es":"Calculadora de suelo laminado","ar":"حاسبة أرضيات اللامينيت","fr":"Calculateur de sol stratifié","bn":"ল্যামিনেট ফ্লোরিং ক্যালকুলেটর","pt":"Calculadora de piso laminado","ru":"Калькулятор ламината","ur":"لیمینیٹ فلورنگ کیلکولیٹر","id":"Kalkulator Lantai Laminate","de":"Laminat-Rechner","ja":"フローリング計算ツール","ko":"라미네이트 바닥재 계산기"}},"metronome":{"cat":"life","emoji":"🎵","names":{"en":"Online Metronome","zh":"在线节拍器","hi":"ऑनलाइन मेट्रोनोम","es":"Metrónomo Online","ar":"مترونوم أونلاين","fr":"Métronome en ligne","bn":"অনলাইন মেট্রোনোম","pt":"Metrônomo Online","ru":"Онлайн-метроном","ur":"آن لائن میٹرونوم","id":"Metronom Online","de":"Online-Metronom","ja":"オンラインメトロノーム","ko":"온라인 메트로놈"}},"mpg-calc":{"cat":"life","emoji":"⛽","names":{"en":"MPG Calculator","zh":"油耗计算器","hi":"MPG कैलकुलेटर","es":"Calculadora de MPG","ar":"حاسبة استهلاك الوقود","fr":"Calculateur MPG","bn":"MPG ক্যালকুলেটর","pt":"Calculadora de MPG","ru":"Калькулятор расхода топлива","ur":"MPG کیلکولیٹر","id":"Kalkulator MPG","de":"MPG-Rechner","ja":"燃費計算ツール","ko":"연비 계산기"}},"mulch-calc":{"cat":"life","emoji":"🌳","names":{"en":"Mulch Calculator","zh":"覆盖物计算器","hi":"मल्च कैलकुलेटर","es":"Calculadora de mantillo","ar":"حاسبة المهاد","fr":"Calculateur de paillis","bn":"মালচ ক্যালকুলেটর","pt":"Calculadora de cobertura morta","ru":"Калькулятор мульчи","ur":"ملچ کیلکولیٹر","id":"Kalkulator Mulsa","de":"Mulch-Rechner","ja":"マルチング計算","ko":"멀칭 계산기"}}};
  var SIBS = ["laminate-flooring-calc","metronome","mpg-calc","mulch-calc"];
  var HEADING = {"en":"Related tools","ko":"관련 도구","ja":"関連ツール","zh":"相关工具","es":"Herramientas relacionadas","fr":"Outils similaires","de":"Ähnliche Tools","pt":"Ferramentas relacionadas","ru":"Похожие инструменты","ar":"أدوات ذات صلة","hi":"संबंधित टूल","bn":"সম্পর্কিত টুল","id":"Alat terkait","ur":"متعلقہ ٹولز"};
  var host = document.getElementById("related-tools");
  // 형제는 빌드 시 확정(회전 선택 — 알파벳 앞 도구에만 인바운드가 몰리지 않게 균등 배분).
  var sibs = SIBS;
  if (!host || !sibs.length) { if(host) host.hidden = true; return; }
  if (!document.getElementById("related-tools-style")) {
    var st = document.createElement("style"); st.id = "related-tools-style";
    st.textContent = ".related{margin:36px 0 8px}.related h2{font-size:15px;font-weight:700;letter-spacing:-.01em;margin:0 0 14px;color:var(--ink)}.related-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}.related-item{display:flex;align-items:center;gap:11px;padding:12px 13px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--ink);text-decoration:none;transition:border-color .15s,transform .15s}.related-item:hover{border-color:var(--accent);transform:translateY(-2px)}.related-ico{flex-shrink:0;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:18px;border-radius:8px;background:color-mix(in srgb,var(--accent) 12%,var(--surface))}.related-name{font-size:14px;font-weight:600;line-height:1.3}";
    document.head.appendChild(st);
  }
  function curLang(){ var l = document.documentElement.getAttribute("lang") || cfg.lang || "en"; return HEADING[l] ? l : "en"; }
  function render(){
    var lg = curLang();
    host.className = "related"; host.textContent = "";
    var h2 = document.createElement("h2"); h2.textContent = HEADING[lg]; host.appendChild(h2);
    var grid = document.createElement("div"); grid.className = "related-grid";
    sibs.forEach(function(s){
      var t = CATALOG[s];
      var a = document.createElement("a"); a.className = "related-item"; a.href = "https://tool-hub.me/" + s + "/";
      var ico = document.createElement("span"); ico.className = "related-ico"; ico.setAttribute("aria-hidden","true"); ico.textContent = t.emoji;
      var nm = document.createElement("span"); nm.className = "related-name"; nm.textContent = t.names[lg] || t.names.en || s;
      a.appendChild(ico); a.appendChild(nm); grid.appendChild(a);
    });
    host.appendChild(grid); host.hidden = false;
  }
  render();
  document.addEventListener("i18n:change", render);
})();
