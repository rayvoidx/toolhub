(function(){
  "use strict";
  var CATALOG = {"generator-size-calc":{"cat":"life","emoji":"🔌","names":{"en":"Generator Size Calculator","zh":"发电机功率计算器","hi":"जेनरेटर साइज़ कैलकुलेटर","es":"Calculadora de potencia de generador","ar":"حاسبة حجم المولد","fr":"Calculateur de puissance de groupe électrogè","bn":"জেনারেটর সাইজ ক্যালকুলেটর","pt":"Calculadora de potência de gerador","ru":"Калькулятор мощности генератора","ur":"جنریٹر سائز کیلکولیٹر","id":"Kalkulator Ukuran Genset","de":"Generator-Größenrechner","ja":"発電機サイズ計算","ko":"발전기 용량 계산기"}},"golf-handicap-calc":{"cat":"life","emoji":"⛳","names":{"en":"Golf Handicap Calculator","zh":"高尔夫差点计算器","hi":"गोल्फ हैंडीकैप कैलकुलेटर","es":"Calculadora de hándicap de golf","ar":"حاسبة الهانديكاب في الغولف","fr":"Calculateur d'index de golf","bn":"গল্ফ হ্যান্ডিক্যাপ ক্যালকুলেটর","pt":"Calculadora de handicap de golfe","ru":"Калькулятор гандикапа в гольфе","ur":"گولف ہینڈی کیپ کیلکولیٹر","id":"Kalkulator Handicap Golf","de":"Golf-Handicap-Rechner","ja":"ゴルフハンディキャップ計算","ko":"골프 핸디캡 계산기"}},"gpa-calc":{"cat":"life","emoji":"🎓","names":{"en":"GPA Calculator","zh":"GPA 计算器","hi":"GPA कैलकुलेटर","es":"Calculadora de GPA","ar":"حاسبة المعدل التراكمي GPA","fr":"Calculateur de GPA","bn":"GPA ক্যালকুলেটর","pt":"Calculadora de GPA","ru":"Калькулятор GPA","ur":"GPA کیلکولیٹر","id":"Kalkulator GPA","de":"GPA-Rechner","ja":"GPA計算機","ko":"GPA 계산기 (학점 계산기)"}},"grade-calc":{"cat":"life","emoji":"🎓","names":{"en":"Grade Calculator","zh":"成绩计算器","hi":"ग्रेड कैलकुलेटर","es":"Calculadora de Notas","ar":"حاسبة الدرجات","fr":"Calculatrice de Notes","bn":"গ্রেড ক্যালকুলেটর","pt":"Calculadora de Notas","ru":"Калькулятор Оценок","ur":"گریڈ کیلکولیٹر","id":"Kalkulator Nilai","de":"Notenrechner","ja":"成績計算機","ko":"성적 계산기"}}};
  var SIBS = ["generator-size-calc","golf-handicap-calc","gpa-calc","grade-calc"];
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
