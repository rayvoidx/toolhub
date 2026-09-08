(function(){
  "use strict";
  var CATALOG = {"volume-conv":{"cat":"units","emoji":"🧊","names":{"en":"Volume Converter","zh":"体积单位换算器","hi":"आयतन कन्वर्टर","es":"Conversor de volumen","ar":"محوّل الحجم","fr":"Convertisseur de volume","bn":"আয়তন কনভার্টার","pt":"Conversor de volume","ru":"Конвертер объёма","ur":"حجم کنورٹر","id":"Konverter Volume","de":"Volumenumrechner","ja":"体積単位変換","ko":"부피 단위 변환기"}},"weight-conv":{"cat":"units","emoji":"🏋️","names":{"en":"Weight Converter","zh":"重量单位换算器","hi":"वज़न कन्वर्टर","es":"Conversor de peso","ar":"محوّل الوزن","fr":"Convertisseur de poids","bn":"ওজন কনভার্টার","pt":"Conversor de peso","ru":"Конвертер веса","ur":"وزن کنورٹر","id":"Konverter Berat","de":"Gewichtsumrechner","ja":"重さ単位変換","ko":"무게 단위 변환기"}},"angle-conv":{"cat":"units","emoji":"📐","names":{"en":"Angle Converter","zh":"角度换算器","hi":"कोण कनवर्टर","es":"Conversor de ángulos","ar":"محول الزوايا","fr":"Convertisseur d'angles","bn":"কোণ কনভার্টার","pt":"Conversor de ângulos","ru":"Конвертер углов","ur":"زاویہ کنورٹر","id":"Konverter Sudut","de":"Winkelumrechner","ja":"角度変換ツール","ko":"각도 변환기"}},"area-conv":{"cat":"units","emoji":"📐","names":{"en":"Area Converter","zh":"面积单位换算器","hi":"क्षेत्रफल कन्वर्टर","es":"Conversor de área","ar":"محوّل المساحة","fr":"Convertisseur de surface","bn":"ক্ষেত্রফল কনভার্টার","pt":"Conversor de área","ru":"Конвертер площади","ur":"رقبہ کنورٹر","id":"Konverter Luas","de":"Flächenumrechner","ja":"面積単位変換","ko":"넓이 단위 변환기"}}};
  var SIBS = ["volume-conv","weight-conv","angle-conv","area-conv"];
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
