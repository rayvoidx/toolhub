(function(){
  "use strict";
  var CATALOG = {"retaining-wall-calc":{"cat":"life","emoji":"🧱","names":{"en":"Retaining Wall Calculator","zh":"挡土墙计算器","hi":"रिटेनिंग वॉल कैलकुलेटर","es":"Calculadora de muro de contención","ar":"حاسبة الجدار الاستنادي","fr":"Calculateur de mur de soutènement","bn":"রিটেইনিং ওয়াল ক্যালকুলেটর","pt":"Calculadora de muro de arrimo","ru":"Калькулятор подпорной стены","ur":"ریٹیننگ وال کیلکولیٹر","id":"Kalkulator Dinding Penahan","de":"Stützmauer-Rechner","ja":"擁壁ブロック計算ツール","ko":"옹벽 블록 계산기"}},"roof-pitch-calc":{"cat":"life","emoji":"🏚️","names":{"en":"Roof Pitch Calculator","zh":"屋顶坡度计算器","hi":"रूफ पिच कैलकुलेटर","es":"Calculadora de pendiente de tejado","ar":"حاسبة ميل السقف","fr":"Calculateur de pente de toit","bn":"রুফ পিচ ক্যালকুলেটর","pt":"Calculadora de inclinação de telhado","ru":"Калькулятор уклона крыши","ur":"چھت کی ڈھلوان کیلکولیٹر","id":"Kalkulator Kemiringan Atap","de":"Dachneigung berechnen","ja":"屋根勾配計算ツール","ko":"지붕 물매 계산기"}},"sand-calc":{"cat":"life","emoji":"🏝️","names":{"en":"Sand Calculator","zh":"沙子计算器","hi":"सैंड कैलकुलेटर","es":"Calculadora de arena","ar":"حاسبة الرمل","fr":"Calculateur de sable","bn":"বালু ক্যালকুলেটর","pt":"Calculadora de areia","ru":"Калькулятор песка","ur":"ریت کیلکولیٹر","id":"Kalkulator Pasir","de":"Sand-Rechner","ja":"砂の計算ツール","ko":"모래 계산기"}},"shingle-calc":{"cat":"life","emoji":"🏠","names":{"en":"Shingle Calculator","zh":"屋顶瓦片计算器","hi":"शिंगल कैलकुलेटर","es":"Calculadora de tejas","ar":"حاسبة ألواح السقف","fr":"Calculateur de bardeaux","bn":"শিঙ্গল ক্যালকুলেটর","pt":"Calculadora de telhas","ru":"Калькулятор гибкой черепицы","ur":"شنگل کیلکولیٹر","id":"Kalkulator Sirap Atap","de":"Dachschindel-Rechner","ja":"屋根シングル計算ツール","ko":"지붕 슁글 계산기"}}};
  var SIBS = ["retaining-wall-calc","roof-pitch-calc","sand-calc","shingle-calc"];
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
