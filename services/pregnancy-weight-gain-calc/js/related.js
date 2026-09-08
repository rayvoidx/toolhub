(function(){
  "use strict";
  var CATALOG = {"protein-intake-calc":{"cat":"health","emoji":"🥩","names":{"en":"Protein Intake Calculator","zh":"蛋白质摄入计算器","hi":"प्रोटीन इनटेक कैलकुलेटर","es":"Calculadora de ingesta de proteína","ar":"حاسبة تناول البروتين","fr":"Calculateur d'apport en protéines","bn":"প্রোটিন গ্রহণ ক্যালকুলেটর","pt":"Calculadora de ingestão de proteína","ru":"Калькулятор потребления белка","ur":"پروٹین انٹیک کیلکولیٹر","id":"Kalkulator Asupan Protein","de":"Proteinbedarf-Rechner","ja":"プロテイン摂取量計算機","ko":"단백질 섭취량 계산기"}},"race-time-predictor":{"cat":"health","emoji":"🏅","names":{"en":"Race Time Predictor","zh":"跑步成绩预测器","hi":"रेस टाइम प्रेडिक्टर","es":"Predictor de tiempo de carrera","ar":"حاسبة توقع زمن السباق","fr":"Prédicteur de temps de course","bn":"রেস টাইম প্রেডিক্টর","pt":"Previsão de tempo de prova","ru":"Калькулятор прогноза времени забега","ur":"ریس ٹائم پریڈکٹر","id":"Prediksi Waktu Lomba Lari","de":"Wettkampfzeit-Rechner","ja":"レース予想タイム計算","ko":"레이스 기록 예측기"}},"steps-to-miles-calc":{"cat":"health","emoji":"🚶","names":{"en":"Steps to Miles Calculator","zh":"步数换算英里计算器","hi":"कदम से मील कैलकुलेटर","es":"Calculadora de Pasos a Millas","ar":"حاسبة تحويل الخطوات إلى أميال","fr":"Calculateur Pas en Miles","bn":"স্টেপ থেকে মাইল ক্যালকুলেটর","pt":"Calculadora de Passos para Milhas","ru":"Калькулятор шагов в мили","ur":"قدم سے میل کیلکولیٹر","id":"Kalkulator Langkah ke Mil","de":"Schritte-in-Meilen-Rechner","ja":"歩数マイル換算計算機","ko":"걸음수 마일 변환 계산기"}},"tdee-calc":{"cat":"health","emoji":"🏃","names":{"en":"TDEE Calculator","zh":"TDEE计算器","hi":"TDEE कैलकुलेटर","es":"Calculadora de TDEE","ar":"حاسبة TDEE","fr":"Calculateur de TDEE","bn":"TDEE ক্যালকুলেটর","pt":"Calculadora de TDEE","ru":"Калькулятор TDEE","ur":"TDEE کیلکولیٹر","id":"Kalkulator TDEE","de":"TDEE-Rechner","ja":"TDEE計算ツール","ko":"TDEE 계산기"}}};
  var SIBS = ["protein-intake-calc","race-time-predictor","steps-to-miles-calc","tdee-calc"];
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
