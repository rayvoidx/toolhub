(function(){
  "use strict";
  var CATALOG = {"area-conv":{"cat":"units","emoji":"📐","names":{"en":"Area Converter","zh":"面积单位换算器","hi":"क्षेत्रफल कन्वर्टर","es":"Conversor de área","ar":"محوّل المساحة","fr":"Convertisseur de surface","bn":"ক্ষেত্রফল কনভার্টার","pt":"Conversor de área","ru":"Конвертер площади","ur":"رقبہ کنورٹر","id":"Konverter Luas","de":"Flächenumrechner","ja":"面積単位変換","ko":"넓이 단위 변환기"}},"data-size-conv":{"cat":"units","emoji":"💾","names":{"en":"Data Size Converter","zh":"数据大小换算器","hi":"डेटा साइज़ कन्वर्टर","es":"Conversor de tamaño de datos","ar":"محوّل حجم البيانات","fr":"Convertisseur de taille de données","bn":"ডেটা সাইজ কনভার্টার","pt":"Conversor de tamanho de dados","ru":"Конвертер размера данных","ur":"ڈیٹا سائز کنورٹر","id":"Konverter Ukuran Data","de":"Datengrößen-Umrechner","ja":"データ容量変換","ko":"데이터 용량 변환기"}},"height-conv":{"cat":"units","emoji":"🧍","names":{"en":"Height Converter","zh":"身高换算器","hi":"हाइट कन्वर्टर","es":"Conversor de estatura","ar":"محوّل الطول","fr":"Convertisseur de taille","bn":"উচ্চতা কনভার্টার","pt":"Conversor de altura","ru":"Конвертер роста","ur":"قد کنورٹر","id":"Konverter Tinggi Badan","de":"Größenumrechner","ja":"身長換算ツール","ko":"키 변환기"}},"length-conv":{"cat":"units","emoji":"📏","names":{"en":"Length Converter","zh":"长度单位换算器","hi":"लंबाई कन्वर्टर","es":"Conversor de longitud","ar":"محوّل الطول","fr":"Convertisseur de longueur","bn":"দৈর্ঘ্য কনভার্টার","pt":"Conversor de comprimento","ru":"Конвертер длины","ur":"لمبائی کنورٹر","id":"Konverter Panjang","de":"Längenumrechner","ja":"長さ単位変換","ko":"길이 단위 변환기"}},"roman-numeral-conv":{"cat":"units","emoji":"Ⅹ","names":{"en":"Roman Numeral Converter","zh":"罗马数字转换器","hi":"रोमन अंक कनवर्टर","es":"Conversor de Números Romanos","ar":"محول الأرقام الرومانية","fr":"Convertisseur de Chiffres Romains","bn":"রোমান সংখ্যা কনভার্টার","pt":"Conversor de Números Romanos","ru":"Конвертер римских цифр","ur":"رومن ہندسہ کنورٹر","id":"Konverter Angka Romawi","de":"Römische-Zahlen-Umrechner","ja":"ローマ数字変換","ko":"로마 숫자 변환기"}},"speed-conv":{"cat":"units","emoji":"💨","names":{"en":"Speed Converter","zh":"速度单位换算器","hi":"स्पीड कन्वर्टर","es":"Conversor de velocidad","ar":"محول السرعة","fr":"Convertisseur de vitesse","bn":"স্পিড কনভার্টার","pt":"Conversor de velocidade","ru":"Конвертер скорости","ur":"اسپیڈ کنورٹر","id":"Konverter kecepatan","de":"Geschwindigkeits-Umrechner","ja":"速度換算","ko":"속도 단위 변환기"}},"temp-conv":{"cat":"units","emoji":"🌡️","names":{"en":"Temperature Converter","zh":"温度换算器","hi":"तापमान कन्वर्टर","es":"Conversor de temperatura","ar":"محوّل درجات الحرارة","fr":"Convertisseur de température","bn":"তাপমাত্রা রূপান্তরকারী","pt":"Conversor de temperatura","ru":"Конвертер температуры","ur":"درجہ حرارت کنورٹر","id":"Konverter suhu","de":"Temperatur-Umrechner","ja":"温度換算","ko":"온도 변환기"}},"volume-conv":{"cat":"units","emoji":"🧊","names":{"en":"Volume Converter","zh":"体积单位换算器","hi":"आयतन कन्वर्टर","es":"Conversor de volumen","ar":"محوّل الحجم","fr":"Convertisseur de volume","bn":"আয়তন কনভার্টার","pt":"Conversor de volume","ru":"Конвертер объёма","ur":"حجم کنورٹر","id":"Konverter Volume","de":"Volumenumrechner","ja":"体積単位変換","ko":"부피 단위 변환기"}},"weight-conv":{"cat":"units","emoji":"🏋️","names":{"en":"Weight Converter","zh":"重量单位换算器","hi":"वज़न कन्वर्टर","es":"Conversor de peso","ar":"محوّل الوزن","fr":"Convertisseur de poids","bn":"ওজন কনভার্টার","pt":"Conversor de peso","ru":"Конвертер веса","ur":"وزن کنورٹر","id":"Konverter Berat","de":"Gewichtsumrechner","ja":"重さ単位変換","ko":"무게 단위 변환기"}}};
  var HEADING = {"en":"Related tools","ko":"관련 도구","ja":"関連ツール","zh":"相关工具","es":"Herramientas relacionadas","fr":"Outils similaires","de":"Ähnliche Tools","pt":"Ferramentas relacionadas","ru":"Похожие инструменты","ar":"أدوات ذات صلة","hi":"संबंधित टूल","bn":"সম্পর্কিত টুল","id":"Alat terkait","ur":"متعلقہ ٹولز"};
  var cfg = window.APP_CONFIG || {};
  var slug = cfg.slug, host = document.getElementById("related-tools");
  if (!host || !slug || !CATALOG[slug]) { if(host) host.hidden = true; return; }
  var cat = CATALOG[slug].cat;
  var ring = Object.keys(CATALOG).filter(function(s){ return CATALOG[s].cat === cat; }).sort();
  var at = ring.indexOf(slug);
  var sibs = [];
  for (var i = 1; i <= ring.length - 1 && sibs.length < 4; i++) sibs.push(ring[(at + i) % ring.length]);
  if (!sibs.length) { host.hidden = true; return; }
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