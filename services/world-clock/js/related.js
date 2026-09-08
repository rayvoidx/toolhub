(function(){
  "use strict";
  var CATALOG = {"zodiac-sign-calc":{"cat":"date","emoji":"♈","names":{"en":"Zodiac Sign Calculator","zh":"星座计算器","hi":"राशि कैलकुलेटर","es":"Calculadora de Signo Zodiacal","ar":"حاسبة الأبراج","fr":"Calculateur de Signe Astrologique","bn":"রাশি ক্যালকুলেটর","pt":"Calculadora de Signo do Zodíaco","ru":"Калькулятор знака зодиака","ur":"زائچہ کیلکولیٹر","id":"Kalkulator Zodiak","de":"Sternzeichen-Rechner","ja":"星座占い計算機","ko":"별자리 계산기"}},"age-calc":{"cat":"date","emoji":"🎂","names":{"en":"Age Calculator","zh":"年龄计算器","hi":"आयु कैलकुलेटर","es":"Calculadora de edad","ar":"حاسبة العمر","fr":"Calculateur d'âge","bn":"বয়স ক্যালকুলেটর","pt":"Calculadora de idade","ru":"Калькулятор возраста","ur":"عمر کیلکولیٹر","id":"Kalkulator Usia","de":"Altersrechner","ja":"年齢計算","ko":"나이 계산기"}},"age-gap-calc":{"cat":"date","emoji":"💞","names":{"en":"Age Gap Calculator","zh":"年龄差计算器","hi":"एज गैप कैलकुलेटर","es":"Calculadora de diferencia de edad entre dos","ar":"حاسبة فارق العمر بين تاريخي ميلاد","fr":"Calculateur d'écart d'âge entre deux dates","bn":"বয়সের পার্থক্য ক্যালকুলেটর","pt":"Calculadora de diferença de idade entre duas","ru":"Калькулятор разницы в возрасте между двумя д","ur":"عمر کے فرق کا کیلکولیٹر","id":"Kalkulator Selisih Usia antara Dua Tanggal L","de":"Altersunterschied-Rechner","ja":"年の差計算ツール","ko":"나이 차이 계산기"}},"alarm-clock":{"cat":"date","emoji":"⏰","names":{"en":"Online Alarm Clock","zh":"在线闹钟","hi":"ऑनलाइन अलार्म घड़ी","es":"Reloj Despertador en Línea","ar":"منبه عبر الإنترنت","fr":"Réveil en Ligne","bn":"অনলাইন অ্যালার্ম ঘড়ি","pt":"Despertador Online","ru":"Онлайн-будильник","ur":"آن لائن الارم گھڑی","id":"Alarm Online","de":"Online-Wecker","ja":"オンライン目覚まし時計","ko":"온라인 알람 시계"}}};
  var SIBS = ["zodiac-sign-calc","age-calc","age-gap-calc","alarm-clock"];
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
