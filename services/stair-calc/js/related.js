(function(){
  "use strict";
  var CATALOG = {"stud-calc":{"cat":"life","emoji":"🪚","names":{"en":"Stud Calculator","zh":"墙骨柱计算器","hi":"स्टड कैलकुलेटर","es":"Calculadora de montantes","ar":"حاسبة القوائم","fr":"Calculateur de montants","bn":"স্টাড ক্যালকুলেটর","pt":"Calculadora de montantes","ru":"Калькулятор стоек","ur":"اسٹڈ کیلکولیٹر","id":"Kalkulator Stud","de":"Ständer-Rechner","ja":"スタッド計算ツール","ko":"스터드 계산기"}},"tank-volume-calc":{"cat":"life","emoji":"🛢️","names":{"en":"Tank Volume Calculator","zh":"储罐容积计算器","hi":"टैंक वॉल्यूम कैलकुलेटर","es":"Calculadora de volumen de tanques","ar":"حاسبة حجم الخزان","fr":"Calculateur de volume de cuve","bn":"ট্যাংক ভলিউম ক্যালকুলেটর","pt":"Calculadora de volume de tanque","ru":"Калькулятор объёма ёмкости","ur":"ٹینک والیوم کیلکولیٹر","id":"Kalkulator Volume Tangki","de":"Tankvolumen-Rechner","ja":"タンク容量計算ツール","ko":"탱크 용량 계산기"}},"tile-calc":{"cat":"life","emoji":"🔲","names":{"en":"Tile Calculator","zh":"瓷砖计算器","hi":"टाइल कैलकुलेटर","es":"Calculadora de azulejos","ar":"حاسبة البلاط","fr":"Calculateur de carrelage","bn":"টাইলস ক্যালকুলেটর","pt":"Calculadora de azulejos","ru":"Калькулятор плитки","ur":"ٹائل کیلکولیٹر","id":"Kalkulator Keramik","de":"Fliesenrechner","ja":"タイル計算ツール","ko":"타일 계산기"}},"tire-size-calc":{"cat":"life","emoji":"🛞","names":{"en":"Tire Size Calculator","zh":"轮胎尺寸计算器","hi":"टायर साइज़ कैलकुलेटर","es":"Calculadora de medidas de neumáticos","ar":"حاسبة مقاس الإطارات","fr":"Calculateur de dimension de pneu","bn":"টায়ার সাইজ ক্যালকুলেটর","pt":"Calculadora de medidas de pneus","ru":"Калькулятор размера шин","ur":"ٹائر سائز کیلکولیٹر","id":"Kalkulator Ukuran Ban","de":"Reifengrößen-Rechner","ja":"タイヤサイズ計算ツール","ko":"타이어 사이즈 계산기"}}};
  var SIBS = ["stud-calc","tank-volume-calc","tile-calc","tire-size-calc"];
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
