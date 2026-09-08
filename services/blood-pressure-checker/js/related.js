(function(){
  "use strict";
  var CATALOG = {"blood-sugar-conv":{"cat":"health","emoji":"🩸","names":{"en":"Blood Sugar Converter","zh":"血糖单位换算器","hi":"ब्लड शुगर कनवर्टर","es":"Conversor de Glucosa en Sangre","ar":"محوّل سكر الدم","fr":"Convertisseur de Glycémie","bn":"রক্তে শর্করা রূপান্তরকারী","pt":"Conversor de Glicemia","ru":"Конвертер сахара в крови","ur":"بلڈ شوگر کنورٹر","id":"Konverter Gula Darah","de":"Blutzucker-Umrechner","ja":"血糖値コンバーター","ko":"혈당 단위 변환기"}},"bmi-calc":{"cat":"health","emoji":"⚖️","names":{"en":"BMI Calculator","zh":"BMI 计算器","hi":"BMI कैलकुलेटर","es":"Calculadora de IMC","ar":"حاسبة مؤشر كتلة الجسم","fr":"Calculateur d'IMC","bn":"BMI ক্যালকুলেটর","pt":"Calculadora de IMC","ru":"Калькулятор ИМТ","ur":"BMI کیلکولیٹر","id":"Kalkulator BMI","de":"BMI-Rechner","ja":"BMI計算","ko":"BMI 계산기"}},"bmr-calc":{"cat":"health","emoji":"🔥","names":{"en":"BMR Calculator","zh":"基础代谢率计算器","hi":"BMR कैलकुलेटर","es":"Calculadora de metabolismo basal","ar":"حاسبة معدل الأيض الأساسي","fr":"Calculateur de métabolisme de base","bn":"BMR ক্যালকুলেটর","pt":"Calculadora de Taxa Metabólica Basal","ru":"Калькулятор базального метаболизма","ur":"BMR کیلکولیٹر","id":"Kalkulator BMR","de":"Grundumsatz-Rechner","ja":"基礎代謝量計算ツール","ko":"기초대사량 계산기"}},"body-fat-calc":{"cat":"health","emoji":"📊","names":{"en":"Body Fat Calculator","zh":"体脂率计算器","hi":"बॉडी फैट कैलकुलेटर","es":"Calculadora de grasa corporal","ar":"حاسبة نسبة الدهون في الجسم","fr":"Calculateur de masse grasse","bn":"বডি ফ্যাট ক্যালকুলেটর","pt":"Calculadora de gordura corporal","ru":"Калькулятор процента жира","ur":"باڈی فیٹ کیلکولیٹر","id":"Kalkulator Lemak Tubuh","de":"Körperfett-Rechner","ja":"体脂肪率計算機","ko":"체지방률 계산기"}}};
  var SIBS = ["blood-sugar-conv","bmi-calc","bmr-calc","body-fat-calc"];
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
