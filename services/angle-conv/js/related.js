(function(){
  "use strict";
  var CATALOG = {"area-conv":{"cat":"units","emoji":"📐","names":{"en":"Area Converter","zh":"面积单位换算器","hi":"क्षेत्रफल कन्वर्टर","es":"Conversor de área","ar":"محوّل المساحة","fr":"Convertisseur de surface","bn":"ক্ষেত্রফল কনভার্টার","pt":"Conversor de área","ru":"Конвертер площади","ur":"رقبہ کنورٹر","id":"Konverter Luas","de":"Flächenumrechner","ja":"面積単位変換","ko":"넓이 단위 변환기"}},"data-size-conv":{"cat":"units","emoji":"💾","names":{"en":"Data Size Converter","zh":"数据大小换算器","hi":"डेटा साइज़ कन्वर्टर","es":"Conversor de tamaño de datos","ar":"محوّل حجم البيانات","fr":"Convertisseur de taille de données","bn":"ডেটা সাইজ কনভার্টার","pt":"Conversor de tamanho de dados","ru":"Конвертер размера данных","ur":"ڈیٹا سائز کنورٹر","id":"Konverter Ukuran Data","de":"Datengrößen-Umrechner","ja":"データ容量変換","ko":"데이터 용량 변환기"}},"energy-conv":{"cat":"units","emoji":"⚡","names":{"en":"Energy Converter","zh":"能量单位换算器","hi":"एनर्जी कन्वर्टर","es":"Conversor de Energía","ar":"محوّل الطاقة","fr":"Convertisseur d'Énergie","bn":"এনার্জি কনভার্টার","pt":"Conversor de Energia","ru":"Конвертер энергии","ur":"انرجی کنورٹر","id":"Konverter Energi","de":"Energie-Umrechner","ja":"エネルギー変換ツール","ko":"에너지 단위 변환기"}},"fuel-economy-conv":{"cat":"units","emoji":"⛽","names":{"en":"Fuel Economy Converter","zh":"燃油经济性换算器","hi":"फ्यूल इकॉनमी कन्वर्टर","es":"Conversor de Consumo de Combustible","ar":"محوّل كفاءة الوقود","fr":"Convertisseur de Consommation","bn":"ফুয়েল ইকোনমি কনভার্টার","pt":"Conversor de Consumo de Combustível","ru":"Конвертер расхода топлива","ur":"فیول اکانومی کنورٹر","id":"Konverter Konsumsi BBM","de":"Kraftstoffverbrauch-Umrechner","ja":"燃費換算ツール","ko":"연비 변환기"}}};
  var SIBS = ["area-conv","data-size-conv","energy-conv","fuel-economy-conv"];
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
