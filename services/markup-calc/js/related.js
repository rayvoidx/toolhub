(function(){
  "use strict";
  var CATALOG = {"mileage-reimbursement-calc":{"cat":"finance","emoji":"🧭","names":{"en":"Mileage Reimbursement Calculator","zh":"里程报销计算器","hi":"माइलेज रीइम्बर्समेंट कैलकुलेटर","es":"Calculadora de reembolso por millas","ar":"حاسبة بدل الأميال","fr":"Calculateur d'indemnités kilométriques","bn":"মাইলেজ রিইম্বার্সমেন্ট ক্যালকুলেটর","pt":"Calculadora de reembolso por milhas","ru":"Калькулятор компенсации за пробег","ur":"مائلیج ری ایمبرسمنٹ کیلکولیٹر","id":"Kalkulator Reimbursement Mil","de":"Kilometergeld-Rechner (Meilen)","ja":"走行距離精算計算ツール","ko":"마일리지 정산 계산기"}},"mortgage-calc":{"cat":"finance","emoji":"🏠","names":{"en":"Mortgage Calculator","zh":"房贷计算器","hi":"मॉर्गेज कैलकुलेटर","es":"Calculadora de hipoteca","ar":"حاسبة الرهن العقاري","fr":"Calculateur de prêt immobilier","bn":"মর্টগেজ ক্যালকুলেটর","pt":"Calculadora de financiamento imobiliário","ru":"Ипотечный калькулятор","ur":"مارگیج کیلکولیٹر","id":"Kalkulator KPR","de":"Hypothekenrechner","ja":"住宅ローン計算機","ko":"주택담보대출 계산기"}},"net-worth-calc":{"cat":"finance","emoji":"💎","names":{"en":"Net Worth Calculator","zh":"净资产计算器","hi":"नेट वर्थ कैलकुलेटर","es":"Calculadora de patrimonio neto","ar":"حاسبة صافي الثروة","fr":"Calculateur de patrimoine net","bn":"নেট ওয়ার্থ ক্যালকুলেটর","pt":"Calculadora de patrimônio líquido","ru":"Калькулятор чистого капитала","ur":"نیٹ ورتھ کیلکولیٹر","id":"Kalkulator Kekayaan Bersih","de":"Nettovermögen-Rechner","ja":"純資産計算ツール","ko":"순자산 계산기"}},"npv-irr-calc":{"cat":"finance","emoji":"📉","names":{"en":"NPV Calculator","zh":"NPV IRR 计算器","hi":"NPV IRR कैलकुलेटर","es":"Calculadora de VAN y TIR","ar":"حاسبة صافي القيمة الحالية ومعدل العائد الداخ","fr":"Calculateur VAN et TRI","bn":"NPV IRR ক্যালকুলেটর","pt":"Calculadora de VPL e TIR","ru":"Калькулятор NPV и IRR","ur":"NPV اور IRR کیلکولیٹر","id":"Kalkulator NPV dan IRR","de":"Kapitalwertrechner","ja":"NPV・IRR 計算ツール","ko":"NPV IRR 계산기"}}};
  var SIBS = ["mileage-reimbursement-calc","mortgage-calc","net-worth-calc","npv-irr-calc"];
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
