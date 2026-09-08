(function(){
  "use strict";
  var CATALOG = {"color-picker":{"cat":"dev","emoji":"🎨","names":{"en":"Color Picker & Converter","zh":"拾色器与颜色转换器","hi":"कलर पिकर और कन्वर्टर","es":"Selector y conversor de color","ar":"منتقي الألوان والمحوّل","fr":"Sélecteur et convertisseur de couleur","bn":"কালার পিকার ও কনভার্টার","pt":"Seletor e conversor de cor","ru":"Палитра и конвертер цвета","ur":"کلر پکر اور کنورٹر","id":"Pemilih & Konverter Warna","de":"Farbwähler & -konverter","ja":"カラーピッカー＆変換","ko":"컬러 피커 & 변환기"}},"cron-parser":{"cat":"dev","emoji":"⏲️","names":{"en":"Cron Expression Parser","zh":"Cron 表达式解析器","hi":"क्रॉन एक्सप्रेशन पार्सर","es":"Analizador de Expresiones Cron","ar":"محلل تعبير Cron","fr":"Analyseur d'Expressions Cron","bn":"ক্রন এক্সপ্রেশন পার্সার","pt":"Analisador de Expressões Cron","ru":"Парсер Cron-выражений","ur":"کرون ایکسپریشن پارسر","id":"Parser Ekspresi Cron","de":"Cron-Ausdruck-Parser","ja":"Cron式パーサー","ko":"크론 표현식 파서"}},"css-minifier":{"cat":"dev","emoji":"🧰","names":{"en":"CSS Minifier","zh":"CSS 压缩工具","hi":"CSS मिनिफायर","es":"Minificador de CSS","ar":"أداة ضغط CSS","fr":"Minifieur CSS","bn":"CSS মিনিফায়ার","pt":"Minificador de CSS","ru":"Минификатор CSS","ur":"CSS منیفائر","id":"CSS Minifier","de":"CSS Minifier","ja":"CSS ミニファイア","ko":"CSS 압축기"}},"csv-to-json":{"cat":"dev","emoji":"📋","names":{"en":"CSV to JSON Converter","zh":"CSV 转 JSON 工具","hi":"CSV से JSON कनवर्टर","es":"Conversor de CSV a JSON","ar":"محوّل CSV إلى JSON","fr":"Convertisseur CSV vers JSON","bn":"CSV থেকে JSON কনভার্টার","pt":"Conversor de CSV para JSON","ru":"Конвертер CSV в JSON","ur":"CSV سے JSON کنورٹر","id":"Konverter CSV ke JSON","de":"CSV-zu-JSON-Konverter","ja":"CSVをJSONに変換","ko":"CSV to JSON 변환기"}}};
  var SIBS = ["color-picker","cron-parser","css-minifier","csv-to-json"];
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
