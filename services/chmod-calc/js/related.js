(function(){
  "use strict";
  var CATALOG = {"color-contrast-checker":{"cat":"dev","emoji":"♿","names":{"en":"Color Contrast Checker","zh":"颜色对比度检测工具","hi":"कलर कंट्रास्ट चेकर","es":"Comprobador de Contraste de Color","ar":"أداة فحص تباين الألوان","fr":"Vérificateur de Contraste des Couleurs","bn":"কালার কনট্রাস্ট চেকার","pt":"Verificador de Contraste de Cores","ru":"Проверка контрастности цветов","ur":"کلر کنٹراسٹ چیکر","id":"Pemeriksa Kontras Warna","de":"Farbkontrast-Prüfer","ja":"カラーコントラストチェッカー","ko":"색상 대비 검사기"}},"color-conv":{"cat":"dev","emoji":"◐","names":{"en":"HEX to RGB Converter","zh":"HEX 转 RGB","hi":"HEX से RGB कन्वर्टर","es":"Conversor HEX a RGB","ar":"محوّل HEX إلى RGB","fr":"Convertisseur HEX en RGB","bn":"HEX থেকে RGB কনভার্টার","pt":"Conversor HEX para RGB","ru":"Конвертер HEX в RGB","ur":"HEX سے RGB کنورٹر","id":"Konverter HEX ke RGB","de":"HEX-zu-RGB-Konverter","ja":"HEX→RGB変換ツール","ko":"HEX ↔ RGB 변환기"}},"color-picker":{"cat":"dev","emoji":"🎨","names":{"en":"Color Picker & Converter","zh":"拾色器与颜色转换器","hi":"कलर पिकर और कन्वर्टर","es":"Selector y conversor de color","ar":"منتقي الألوان والمحوّل","fr":"Sélecteur et convertisseur de couleur","bn":"কালার পিকার ও কনভার্টার","pt":"Seletor e conversor de cor","ru":"Палитра и конвертер цвета","ur":"کلر پکر اور کنورٹر","id":"Pemilih & Konverter Warna","de":"Farbwähler & -konverter","ja":"カラーピッカー＆変換","ko":"컬러 피커 & 변환기"}},"cron-parser":{"cat":"dev","emoji":"⏲️","names":{"en":"Cron Expression Parser","zh":"Cron 表达式解析器","hi":"क्रॉन एक्सप्रेशन पार्सर","es":"Analizador de Expresiones Cron","ar":"محلل تعبير Cron","fr":"Analyseur d'Expressions Cron","bn":"ক্রন এক্সপ্রেশন পার্সার","pt":"Analisador de Expressões Cron","ru":"Парсер Cron-выражений","ur":"کرون ایکسپریشن پارسر","id":"Parser Ekspresi Cron","de":"Cron-Ausdruck-Parser","ja":"Cron式パーサー","ko":"크론 표현식 파서"}}};
  var SIBS = ["color-contrast-checker","color-conv","color-picker","cron-parser"];
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
