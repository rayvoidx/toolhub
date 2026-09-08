(function(){
  "use strict";
  var CATALOG = {"shoe-size-conv":{"cat":"units","emoji":"👟","names":{"en":"Shoe Size Converter","zh":"鞋码转换器","hi":"शू साइज़ कन्वर्टर","es":"Conversor de Tallas de Zapatos","ar":"محول مقاسات الأحذية","fr":"Convertisseur de Pointures","bn":"জুতার সাইজ কনভার্টার","pt":"Conversor de Numeração de Calçados","ru":"Конвертер размеров обуви","ur":"جوتوں کے سائز کا کنورٹر","id":"Konverter Ukuran Sepatu","de":"Schuhgrößen-Umrechner","ja":"靴サイズ変換","ko":"신발 사이즈 변환기"}},"speed-conv":{"cat":"units","emoji":"💨","names":{"en":"Speed Converter","zh":"速度单位换算器","hi":"स्पीड कन्वर्टर","es":"Conversor de velocidad","ar":"محول السرعة","fr":"Convertisseur de vitesse","bn":"স্পিড কনভার্টার","pt":"Conversor de velocidade","ru":"Конвертер скорости","ur":"اسپیڈ کنورٹر","id":"Konverter kecepatan","de":"Geschwindigkeits-Umrechner","ja":"速度換算","ko":"속도 단위 변환기"}},"square-footage-calc":{"cat":"units","emoji":"▧","names":{"en":"Square Footage Calculator","zh":"面积计算器","hi":"क्षेत्रफल कैलकुलेटर","es":"Calculadora de metros y pies cuadrados","ar":"حاسبة المساحة","fr":"Calculateur de surface","bn":"আয়তন ক্যালকুলেটর","pt":"Calculadora de metros e pés quadrados","ru":"Калькулятор площади","ur":"رقبہ کیلکولیٹر","id":"Kalkulator Luas","de":"Quadratmeter-Rechner","ja":"面積計算ツール","ko":"면적 계산기"}},"temp-conv":{"cat":"units","emoji":"🌡️","names":{"en":"Temperature Converter","zh":"温度换算器","hi":"तापमान कन्वर्टर","es":"Conversor de temperatura","ar":"محوّل درجات الحرارة","fr":"Convertisseur de température","bn":"তাপমাত্রা রূপান্তরকারী","pt":"Conversor de temperatura","ru":"Конвертер температуры","ur":"درجہ حرارت کنورٹر","id":"Konverter suhu","de":"Temperatur-Umrechner","ja":"温度換算","ko":"온도 변환기"}}};
  var SIBS = ["shoe-size-conv","speed-conv","square-footage-calc","temp-conv"];
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
