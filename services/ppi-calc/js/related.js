(function(){
  "use strict";
  var CATALOG = {"px-to-rem":{"cat":"dev","emoji":"📐","names":{"en":"PX to REM Converter","zh":"px 转 rem 换算器","hi":"PX से REM कन्वर्टर","es":"Conversor de px a rem","ar":"محوّل px إلى rem","fr":"Convertisseur px en rem","bn":"PX থেকে REM কনভার্টার","pt":"Conversor de px para rem","ru":"Конвертер px в rem","ur":"PX سے REM کنورٹر","id":"Konverter PX ke REM","de":"PX-zu-REM-Rechner","ja":"px rem 変換ツール","ko":"px rem 변환기"}},"regex-tester":{"cat":"dev","emoji":"🧪","names":{"en":"Regex Tester","zh":"正则表达式测试工具","hi":"रेगेक्स टेस्टर","es":"Probador de Regex","ar":"أداة اختبار Regex","fr":"Testeur de Regex","bn":"রেজেক্স টেস্টার","pt":"Testador de Regex","ru":"Тестер регулярных выражений","ur":"ریجیکس ٹیسٹر","id":"Penguji Regex","de":"Regex-Tester","ja":"正規表現テスター","ko":"정규식 테스터"}},"resistor-color-code":{"cat":"dev","emoji":"🎛️","names":{"en":"Resistor Color Code Calculator","zh":"电阻色环计算器","hi":"रेज़िस्टर कलर कोड कैलकुलेटर","es":"Calculadora de código de colores de resisten","ar":"حاسبة شفرة ألوان المقاومات","fr":"Calculateur de code couleur des résistances","bn":"রেজিস্টর কালার কোড ক্যালকুলেটর","pt":"Calculadora de código de cores de resistores","ru":"Калькулятор цветовой маркировки резисторов","ur":"ریزسٹر کلر کوڈ کیلکولیٹر","id":"Kalkulator Kode Warna Resistor","de":"Widerstand-Farbcode-Rechner","ja":"抵抗カラーコード計算ツール","ko":"저항 컬러코드 계산기"}},"robots-txt-generator":{"cat":"dev","emoji":"🤖","names":{"en":"Robots.txt Generator","zh":"robots.txt 生成器","hi":"Robots.txt जनरेटर","es":"Generador de robots.txt","ar":"مولّد robots.txt","fr":"Générateur de robots.txt","bn":"Robots.txt জেনারেটর","pt":"Gerador de robots.txt","ru":"Генератор robots.txt","ur":"Robots.txt جنریٹر","id":"Generator Robots.txt","de":"Robots.txt-Generator","ja":"robots.txt 生成ツール","ko":"robots.txt 생성기"}}};
  var SIBS = ["px-to-rem","regex-tester","resistor-color-code","robots-txt-generator"];
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
