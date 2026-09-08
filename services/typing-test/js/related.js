(function(){
  "use strict";
  var CATALOG = {"wallpaper-calc":{"cat":"life","emoji":"🖼️","names":{"en":"Wallpaper Calculator","zh":"墙纸计算器","hi":"वॉलपेपर कैलकुलेटर","es":"Calculadora de papel pintado","ar":"حاسبة ورق الجدران","fr":"Calculateur de papier peint","bn":"ওয়ালপেপার ক্যালকুলেটর","pt":"Calculadora de papel de parede","ru":"Калькулятор обоев","ur":"وال پیپر کیلکولیٹر","id":"Kalkulator Wallpaper","de":"Tapetenrechner","ja":"壁紙計算ツール","ko":"벽지 계산기"}},"water-heater-size-calc":{"cat":"life","emoji":"🚿","names":{"en":"Water Heater Size Calculator","zh":"热水器容量计算器","hi":"वॉटर हीटर साइज़ कैलकुलेटर","es":"Calculadora de tamaño de calentador de agua","ar":"حاسبة حجم سخان المياه","fr":"Calculateur de taille de chauffe-eau","bn":"ওয়াটার হিটার সাইজ ক্যালকুলেটর","pt":"Calculadora de tamanho de aquecedor de água","ru":"Калькулятор объёма водонагревателя","ur":"واٹر ہیٹر سائز کیلکولیٹر","id":"Kalkulator Ukuran Water Heater","de":"Warmwasserspeicher-Rechner","ja":"給湯器サイズ計算ツール","ko":"온수기 용량 계산기"}},"wedding-budget-calc":{"cat":"life","emoji":"💒","names":{"en":"Wedding Budget Calculator","zh":"婚礼预算计算器","hi":"वेडिंग बजट कैलकुलेटर","es":"Calculadora de presupuesto de boda por categ","ar":"حاسبة ميزانية الزفاف","fr":"Calculateur de budget mariage","bn":"বিয়ের বাজেট ক্যালকুলেটর","pt":"Calculadora de orçamento de casamento por ca","ru":"Калькулятор бюджета свадьбы","ur":"ویڈنگ بجٹ کیلکولیٹر","id":"Kalkulator Anggaran Pernikahan per Kategori","de":"Hochzeitsbudget-Rechner","ja":"結婚式費用シミュレーター","ko":"결혼식 예산 계산기"}},"wind-chill-calc":{"cat":"life","emoji":"🥶","names":{"en":"Wind Chill Calculator","zh":"体感温度计算器","hi":"विंड चिल कैलकुलेटर","es":"Calculadora de sensación térmica por viento","ar":"حاسبة برودة الرياح","fr":"Calculateur de refroidissement éolien (resse","bn":"উইন্ড চিল ক্যালকুলেটর","pt":"Calculadora de sensação térmica com vento","ru":"Калькулятор ветрового охлаждения","ur":"ونڈ چل کیلکولیٹر","id":"Kalkulator Wind Chill","de":"Windchill-Rechner","ja":"体感温度計算ツール","ko":"체감온도 계산기"}}};
  var SIBS = ["wallpaper-calc","water-heater-size-calc","wedding-budget-calc","wind-chill-calc"];
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
