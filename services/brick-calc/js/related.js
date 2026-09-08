(function(){
  "use strict";
  var CATALOG = {"btu-calc":{"cat":"life","emoji":"❄️","names":{"en":"BTU Calculator","zh":"BTU 计算器","hi":"BTU कैलकुलेटर","es":"Calculadora BTU","ar":"حاسبة BTU","fr":"Calculateur BTU","bn":"BTU ক্যালকুলেটর","pt":"Calculadora de BTU","ru":"Калькулятор BTU","ur":"BTU کیلکولیٹر","id":"Kalkulator BTU","de":"BTU-Rechner","ja":"BTU計算ツール","ko":"BTU 계산기"}},"carpet-calc":{"cat":"life","emoji":"🟫","names":{"en":"Carpet Calculator","zh":"地毯计算器","hi":"कार्पेट कैलकुलेटर","es":"Calculadora de moqueta","ar":"حاسبة السجاد","fr":"Calculateur de moquette","bn":"কার্পেট ক্যালকুলেটর","pt":"Calculadora de carpete","ru":"Калькулятор ковролина","ur":"کارپٹ کیلکولیٹر","id":"Kalkulator Karpet","de":"Teppichboden-Rechner","ja":"カーペット計算ツール","ko":"카펫 계산기"}},"click-speed-test":{"cat":"life","emoji":"🖱️","names":{"en":"Click Speed Test (CPS)","zh":"点击速度测试（CPS）","hi":"क्लिक स्पीड टेस्ट (CPS)","es":"Test de velocidad de clic (CPS)","ar":"اختبار سرعة النقر (CPS)","fr":"Test de vitesse de clic (CPS)","bn":"ক্লিক স্পিড টেস্ট (CPS)","pt":"Teste de velocidade de clique (CPS)","ru":"Тест скорости кликов (CPS)","ur":"کلک اسپیڈ ٹیسٹ (CPS)","id":"Tes Kecepatan Klik (CPS)","de":"Klickgeschwindigkeitstest (CPS)","ja":"クリックスピードテスト（CPS）","ko":"클릭 속도 테스트 (CPS)"}},"coffee-ratio-calc":{"cat":"life","emoji":"☕","names":{"en":"Coffee to Water Ratio Calculator","zh":"咖啡粉水比例计算器","hi":"कॉफ़ी और पानी का अनुपात कैलकुलेटर","es":"Calculadora de ratio café-agua","ar":"حاسبة نسبة القهوة إلى الماء","fr":"Calculateur ratio café-eau","bn":"কফি ও পানির অনুপাত ক্যালকুলেটর","pt":"Calculadora de proporção café e água","ru":"Калькулятор пропорции кофе и воды","ur":"کافی اور پانی کے تناسب کا کیلکولیٹر","id":"Kalkulator Rasio Kopi dan Air","de":"Kaffee-Wasser-Verhältnis Rechner","ja":"コーヒーの粉と湯の比率計算","ko":"커피 물 비율 계산기"}}};
  var SIBS = ["btu-calc","carpet-calc","click-speed-test","coffee-ratio-calc"];
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
