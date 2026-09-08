(function(){
  "use strict";
  var CATALOG = {"interest-calc":{"cat":"finance","emoji":"💵","names":{"en":"Interest Calculator","zh":"利息计算器","hi":"ब्याज कैलकुलेटर","es":"Calculadora de intereses","ar":"حاسبة الفائدة","fr":"Calculateur d'intérêts","bn":"সুদ ক্যালকুলেটর","pt":"Calculadora de juros","ru":"Калькулятор процентов","ur":"سود کیلکولیٹر","id":"Kalkulator Bunga","de":"Zinsrechner","ja":"利息計算機","ko":"이자 계산기"}},"investment-goal-calc":{"cat":"finance","emoji":"🎯","names":{"en":"Investment Goal Calculator","zh":"投资目标计算器","hi":"निवेश लक्ष्य कैलकुलेटर","es":"Calculadora de objetivo de inversión","ar":"حاسبة هدف الاستثمار","fr":"Calculateur d'objectif d'investissement","bn":"বিনিয়োগ লক্ষ্য ক্যালকুলেটর","pt":"Calculadora de meta de investimento","ru":"Калькулятор инвестиционной цели","ur":"سرمایہ کاری ہدف کیلکولیٹر","id":"Kalkulator Tujuan Investasi","de":"Anlageziel-Rechner","ja":"投資目標計算機","ko":"투자 목표 계산기"}},"landed-cost-batch":{"cat":"finance","emoji":"🚢","names":{"en":"Landed Cost Batch Calculator","zh":"到岸成本批量计算器","hi":"लैंडेड कॉस्ट बैच कैलकुलेटर","es":"Calculadora de landed cost por lotes","ar":"حاسبة التكلفة النهائية للواردات دفعةً واحدة","fr":"Calculateur de coût de revient débarqué par","bn":"ল্যান্ডেড কস্ট ব্যাচ ক্যালকুলেটর","pt":"Calculadora de landed cost em lote","ru":"Пакетный калькулятор полной себестоимости им","ur":"لینڈڈ کاسٹ بیچ کیلکولیٹر","id":"Kalkulator landed cost massal","de":"Einstandspreis-Rechner für ganze Rechnungen","ja":"輸入原価一括計算ツール","ko":"수입원가 일괄 계산기"}},"loan-calc":{"cat":"finance","emoji":"🏦","names":{"en":"Loan Calculator","zh":"贷款计算器","hi":"लोन कैलकुलेटर","es":"Calculadora de préstamos","ar":"حاسبة القروض","fr":"Calculatrice de prêt","bn":"ঋণ ক্যালকুলেটর","pt":"Calculadora de empréstimo","ru":"Кредитный калькулятор","ur":"لون کیلکولیٹر","id":"Kalkulator Pinjaman","de":"Kreditrechner","ja":"ローン計算機","ko":"대출 계산기"}}};
  var SIBS = ["interest-calc","investment-goal-calc","landed-cost-batch","loan-calc"];
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
