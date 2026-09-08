(function(){
  "use strict";
  var CATALOG = {"grass-seed-calc":{"cat":"life","emoji":"🌾","names":{"en":"Grass Seed Calculator","zh":"草籽用量计算器","hi":"घास बीज कैलकुलेटर","es":"Calculadora de semilla de césped","ar":"حاسبة بذور العشب","fr":"Calculateur de semences de gazon","bn":"ঘাসের বীজ ক্যালকুলেটর","pt":"Calculadora de sementes de grama","ru":"Калькулятор семян газона","ur":"گھاس کے بیج کا کیلکولیٹر","id":"Kalkulator Benih Rumput","de":"Rasensamen-Rechner","ja":"芝生の種 計算ツール","ko":"잔디 씨앗 계산기"}},"gravel-calc":{"cat":"life","emoji":"🪨","names":{"en":"Gravel Calculator","zh":"碎石计算器","hi":"ग्रेवल कैलकुलेटर","es":"Calculadora de grava","ar":"حاسبة الحصى","fr":"Calculateur de gravier","bn":"গ্র্যাভেল ক্যালকুলেটর","pt":"Calculadora de brita","ru":"Калькулятор щебня","ur":"بجری کیلکولیٹر","id":"Kalkulator Kerikil","de":"Schotterrechner","ja":"砂利計算ツール","ko":"자갈 계산기"}},"grout-calc":{"cat":"life","emoji":"🪣","names":{"en":"Grout Calculator","zh":"填缝剂计算器","hi":"ग्राउट कैलकुलेटर","es":"Calculadora de lechada","ar":"حاسبة الجاروت","fr":"Calculateur de joint carrelage","bn":"গ্রাউট ক্যালকুলেটর","pt":"Calculadora de rejunte","ru":"Калькулятор затирки","ur":"گراؤٹ کیلکولیٹر","id":"Kalkulator Nat Keramik","de":"Fugenmörtel-Rechner","ja":"目地材計算ツール","ko":"줄눈 계산기"}},"heat-index-calc":{"cat":"life","emoji":"🥵","names":{"en":"Heat Index Calculator","zh":"体感温度（酷热指数）计算器","hi":"हीट इंडेक्स कैलकुलेटर","es":"Calculadora de índice de calor","ar":"حاسبة مؤشر الحرارة","fr":"Calculateur d'indice de chaleur","bn":"হিট ইনডেক্স ক্যালকুলেটর","pt":"Calculadora de índice de calor","ru":"Калькулятор индекса жары","ur":"ہیٹ انڈیکس کیلکولیٹر","id":"Kalkulator Heat Index","de":"Hitzeindex-Rechner","ja":"暑さ指数（ヒートインデックス）計算ツール","ko":"열지수 계산기"}}};
  var SIBS = ["grass-seed-calc","gravel-calc","grout-calc","heat-index-calc"];
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
