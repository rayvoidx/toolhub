(function(){
  "use strict";
  var CATALOG = {"prorated-rent-calc":{"cat":"finance","emoji":"🗓️","names":{"en":"Prorated Rent Calculator","zh":"按天计租计算器","hi":"प्रोरेटेड रेंट कैलकुलेटर","es":"Calculadora de alquiler prorrateado por días","ar":"حاسبة الإيجار بالتناسب","fr":"Calculateur de loyer au prorata (mois partie","bn":"প্রোরেটেড ভাড়া ক্যালকুলেটর","pt":"Calculadora de aluguel proporcional por dias","ru":"Калькулятор аренды за неполный месяц","ur":"پرو ریٹڈ کرایہ کیلکولیٹر","id":"Kalkulator Sewa Prorata","de":"Mietrechner anteilig","ja":"日割り家賃計算ツール","ko":"일할 월세 계산기"}},"rd-calc":{"cat":"finance","emoji":"🏦","names":{"en":"RD Calculator","zh":"定期定额存款计算器","hi":"RD कैलकुलेटर","es":"Calculadora RD","ar":"حاسبة الوديعة الشهرية RD","fr":"Calculateur RD","bn":"RD ক্যালকুলেটর","pt":"Calculadora RD","ru":"Калькулятор RD","ur":"RD کیلکولیٹر","id":"Kalkulator RD","de":"RD-Rechner","ja":"積立定期(RD)計算ツール","ko":"정기적금 만기 계산기"}},"refinance-calc":{"cat":"finance","emoji":"🔄","names":{"en":"Refinance Calculator","zh":"再融资计算器","hi":"रीफाइनेंस कैलकुलेटर","es":"Calculadora de refinanciación","ar":"حاسبة إعادة التمويل","fr":"Calculateur de rachat de crédit","bn":"রিফাইন্যান্স ক্যালকুলেটর","pt":"Calculadora de refinanciamento","ru":"Калькулятор рефинансирования","ur":"ری فنانس کیلکولیٹر","id":"Kalkulator Refinancing","de":"Umschuldungsrechner","ja":"借り換え計算ツール","ko":"재융자 계산기"}},"rent-affordability-calc":{"cat":"finance","emoji":"🏠","names":{"en":"Rent Affordability Calculator","zh":"房租承受能力计算器","hi":"रेंट अफोर्डेबिलिटी कैलकुलेटर","es":"Calculadora de alquiler asequible","ar":"حاسبة القدرة على دفع الإيجار","fr":"Calculateur de loyer abordable","bn":"ভাড়া সাধ্য ক্যালকুলেটর","pt":"Calculadora de aluguel","ru":"Калькулятор доступной аренды","ur":"کرایہ استطاعت کیلکولیٹر","id":"Kalkulator Kemampuan Sewa","de":"Mietrechner","ja":"家賃いくらまで払える？","ko":"월세 감당액 계산기"}}};
  var SIBS = ["prorated-rent-calc","rd-calc","refinance-calc","rent-affordability-calc"];
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
