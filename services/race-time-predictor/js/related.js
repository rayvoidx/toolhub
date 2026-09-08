(function(){
  "use strict";
  var CATALOG = {"steps-to-miles-calc":{"cat":"health","emoji":"🚶","names":{"en":"Steps to Miles Calculator","zh":"步数换算英里计算器","hi":"कदम से मील कैलकुलेटर","es":"Calculadora de Pasos a Millas","ar":"حاسبة تحويل الخطوات إلى أميال","fr":"Calculateur Pas en Miles","bn":"স্টেপ থেকে মাইল ক্যালকুলেটর","pt":"Calculadora de Passos para Milhas","ru":"Калькулятор шагов в мили","ur":"قدم سے میل کیلکولیٹر","id":"Kalkulator Langkah ke Mil","de":"Schritte-in-Meilen-Rechner","ja":"歩数マイル換算計算機","ko":"걸음수 마일 변환 계산기"}},"tdee-calc":{"cat":"health","emoji":"🏃","names":{"en":"TDEE Calculator","zh":"TDEE计算器","hi":"TDEE कैलकुलेटर","es":"Calculadora de TDEE","ar":"حاسبة TDEE","fr":"Calculateur de TDEE","bn":"TDEE ক্যালকুলেটর","pt":"Calculadora de TDEE","ru":"Калькулятор TDEE","ur":"TDEE کیلکولیٹر","id":"Kalkulator TDEE","de":"TDEE-Rechner","ja":"TDEE計算ツール","ko":"TDEE 계산기"}},"vo2max-calc":{"cat":"health","emoji":"🏃","names":{"en":"VO2 Max Calculator","zh":"最大摄氧量计算器","hi":"VO2 मैक्स कैलकुलेटर","es":"Calculadora de VO2 máx","ar":"حاسبة VO2 max","fr":"Calculateur de VO2 max","bn":"VO2 ম্যাক্স ক্যালকুলেটর","pt":"Calculadora de VO2 máx","ru":"Калькулятор МПК (VO2 max)","ur":"VO2 میکس کیلکولیٹر","id":"Kalkulator VO2 Max","de":"VO2max-Rechner","ja":"VO2max計算ツール","ko":"VO2max 계산기"}},"waist-hip-ratio-calc":{"cat":"health","emoji":"📐","names":{"en":"Waist to Hip Ratio Calculator","zh":"腰臀比计算器","hi":"कमर-कूल्हा अनुपात कैलकुलेटर (WHR)","es":"Calculadora de índice cintura-cadera (ICC /","ar":"حاسبة نسبة الخصر إلى الورك (WHR) ومستوى الخط","fr":"Calculateur du rapport taille-hanches (RTH /","bn":"কোমর-নিতম্ব অনুপাত ক্যালকুলেটর (WHR)","pt":"Calculadora de relação cintura-quadril (RCQ","ru":"Калькулятор соотношения талии и бёдер (WHR)","ur":"کمر کولہا تناسب کیلکولیٹر (WHR)","id":"Kalkulator Rasio Pinggang Pinggul (WHR)","de":"Taille-Hüft-Verhältnis Rechner (WHR)","ja":"ウエストヒップ比計算ツール","ko":"허리 엉덩이 비율 계산기"}}};
  var SIBS = ["steps-to-miles-calc","tdee-calc","vo2max-calc","waist-hip-ratio-calc"];
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
