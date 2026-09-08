(function(){
  "use strict";
  var CATALOG = {"dilution-calc":{"cat":"science","emoji":"🧪","names":{"en":"Dilution Calculator","zh":"稀释计算器","hi":"डाइल्यूशन कैलकुलेटर","es":"Calculadora de diluciones","ar":"حاسبة التخفيف","fr":"Calculateur de dilution","bn":"ডাইলিউশন ক্যালকুলেটর","pt":"Calculadora de diluição","ru":"Калькулятор разведения","ur":"ڈائلیوشن کیلکولیٹر","id":"Kalkulator Pengenceran","de":"Verdünnungsrechner","ja":"希釈計算ツール","ko":"희석 계산기"}},"half-life-calc":{"cat":"science","emoji":"☢️","names":{"en":"Half-Life Calculator","zh":"半衰期计算器","hi":"हाफ लाइफ कैलकुलेटर","es":"Calculadora de vida media","ar":"حاسبة عمر النصف","fr":"Calculateur de demi-vie","bn":"হাফ লাইফ ক্যালকুলেটর","pt":"Calculadora de meia-vida","ru":"Калькулятор периода полураспада и полувыведе","ur":"ہاف لائف کیلکولیٹر","id":"Kalkulator Waktu Paruh","de":"Halbwertszeit-Rechner","ja":"半減期計算ツール","ko":"반감기 계산기"}},"kinetic-energy-calc":{"cat":"science","emoji":"⚡","names":{"en":"Kinetic Energy Calculator","zh":"动能计算器","hi":"गतिज ऊर्जा कैलकुलेटर","es":"Calculadora de energía cinética","ar":"حاسبة الطاقة الحركية","fr":"Calculateur d'énergie cinétique","bn":"গতিশক্তি ক্যালকুলেটর","pt":"Calculadora de energia cinética","ru":"Калькулятор кинетической энергии","ur":"حرکی توانائی کیلکولیٹر","id":"Kalkulator Energi Kinetik","de":"Kinetische-Energie-Rechner","ja":"運動エネルギー計算ツール","ko":"운동에너지 계산기"}},"marks-percentage-calc":{"cat":"science","emoji":"📝","names":{"en":"Marks Percentage Calculator","zh":"分数百分比计算器","hi":"मार्क्स परसेंटेज कैलकुलेटर","es":"Calculadora de porcentaje de notas","ar":"حاسبة النسبة المئوية للدرجات","fr":"Calculateur de pourcentage de notes","bn":"নম্বরের শতকরা ক্যালকুলেটর","pt":"Calculadora de porcentagem de notas","ru":"Калькулятор процента баллов","ur":"مارکس پرسنٹیج کیلکولیٹر","id":"Kalkulator Persentase Nilai","de":"Notenprozent-Rechner","ja":"得点パーセント計算ツール","ko":"성적 백분율 계산기"}}};
  var SIBS = ["dilution-calc","half-life-calc","kinetic-energy-calc","marks-percentage-calc"];
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
