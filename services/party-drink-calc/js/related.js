(function(){
  "use strict";
  var CATALOG = {"paver-calc":{"cat":"life","emoji":"🧱","names":{"en":"Paver Calculator","zh":"地砖计算器","hi":"पेवर कैलकुलेटर","es":"Calculadora de adoquines","ar":"حاسبة البلاط المتشابك","fr":"Calculateur de pavés","bn":"পেভার ক্যালকুলেটর","pt":"Calculadora de pavês","ru":"Калькулятор тротуарной плитки","ur":"پیور کیلکولیٹر","id":"Kalkulator Paving","de":"Pflasterstein-Rechner","ja":"ペイバー計算ツール","ko":"보도블록 계산기"}},"plant-spacing-calc":{"cat":"life","emoji":"🌷","names":{"en":"Plant Spacing Calculator","zh":"种植间距计算器","hi":"प्लांट स्पेसिंग कैलकुलेटर","es":"Calculadora de marco de plantación","ar":"حاسبة تباعد النباتات","fr":"Calculateur d'espacement des plants","bn":"গাছের দূরত্ব ক্যালকুলেটর","pt":"Calculadora de espaçamento de plantas","ru":"Калькулятор расстояния между растениями","ur":"پودوں کے فاصلے کا کیلکولیٹر","id":"Kalkulator Jarak Tanam","de":"Pflanzabstand-Rechner","ja":"植え付け間隔計算ツール","ko":"식재 간격 계산기"}},"pool-volume-calc":{"cat":"life","emoji":"🏊","names":{"en":"Pool Volume Calculator","zh":"泳池容量计算器","hi":"पूल वॉल्यूम कैलकुलेटर","es":"Calculadora de volumen de piscina","ar":"حاسبة حجم حوض السباحة","fr":"Calculateur de volume de piscine","bn":"পুল ভলিউম ক্যালকুলেটর","pt":"Calculadora de volume de piscina","ru":"Калькулятор объёма бассейна","ur":"پول والیوم کیلکولیٹر","id":"Kalkulator Volume Kolam Renang","de":"Poolvolumen-Rechner","ja":"プール容量計算ツール","ko":"수영장 물량 계산기"}},"propane-calc":{"cat":"life","emoji":"🔥","names":{"en":"Propane Tank Calculator","zh":"丙烷气瓶计算器","hi":"प्रोपेन टैंक कैलकुलेटर","es":"Calculadora de bombona de propano","ar":"حاسبة أسطوانة البروبان","fr":"Calculateur bouteille de propane","bn":"প্রোপেন ট্যাংক ক্যালকুলেটর","pt":"Calculadora de botijão de gás","ru":"Калькулятор газового баллона","ur":"پروپین سلنڈر کیلکولیٹر","id":"Kalkulator Tabung Propana","de":"Propangas-Rechner","ja":"プロパンガス残量計算","ko":"프로판 가스통 계산기"}}};
  var SIBS = ["paver-calc","plant-spacing-calc","pool-volume-calc","propane-calc"];
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
