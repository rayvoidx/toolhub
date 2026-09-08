(function(){
  "use strict";
  var CATALOG = {"break-even-calc":{"cat":"finance","emoji":"⚖️","names":{"en":"Break-Even Calculator","zh":"盈亏平衡计算器","hi":"ब्रेक-ईवन कैलकुलेटर","es":"Calculadora de Punto de Equilibrio","ar":"حاسبة نقطة التعادل","fr":"Calculateur de Seuil de Rentabilité","bn":"ব্রেক-ইভেন ক্যালকুলেটর","pt":"Calculadora de Ponto de Equilíbrio","ru":"Калькулятор точки безубыточности","ur":"بریک ایون کیلکولیٹر","id":"Kalkulator Titik Impas","de":"Break-Even-Rechner","ja":"損益分岐点計算機","ko":"손익분기점 계산기"}},"budget-calc":{"cat":"finance","emoji":"📊","names":{"en":"50/30/20 Budget Calculator","zh":"50/30/20 预算计算器","hi":"50/30/20 बजट कैलकुलेटर","es":"Calculadora de presupuesto 50/30/20 mensual","ar":"حاسبة ميزانية 50/30/20 الشهرية","fr":"Calculateur de budget 50/30/20 mensuel","bn":"50/30/20 বাজেট ক্যালকুলেটর","pt":"Calculadora de orçamento 50/30/20 mensal","ru":"Калькулятор бюджета 50/30/20 на месяц","ur":"50/30/20 بجٹ کیلکولیٹر","id":"Kalkulator Anggaran 50/30/20 Bulanan","de":"50/30/20 Budgetrechner","ja":"50/30/20 予算計算ツール","ko":"50/30/20 예산 계산기"}},"cagr-calc":{"cat":"finance","emoji":"📈","names":{"en":"CAGR Calculator","zh":"复合年增长率（CAGR）计算器","hi":"CAGR कैलकुलेटर","es":"Calculadora de CAGR","ar":"حاسبة CAGR","fr":"Calculateur de CAGR","bn":"CAGR ক্যালকুলেটর","pt":"Calculadora de CAGR","ru":"Калькулятор CAGR","ur":"CAGR کیلکولیٹر","id":"Kalkulator CAGR","de":"CAGR-Rechner","ja":"CAGR計算機","ko":"CAGR 계산기"}},"cap-rate-calc":{"cat":"finance","emoji":"🏢","names":{"en":"Cap Rate Calculator","zh":"资本化率计算器","hi":"कैप रेट कैलकुलेटर","es":"Calculadora de cap rate","ar":"حاسبة معدل الرسملة","fr":"Calculateur de taux de capitalisation (cap r","bn":"ক্যাপ রেট ক্যালকুলেটর","pt":"Calculadora de cap rate","ru":"Калькулятор ставки капитализации (cap rate)","ur":"کیپ ریٹ کیلکولیٹر","id":"Kalkulator Cap Rate","de":"Cap-Rate-Rechner","ja":"キャップレート計算ツール","ko":"Cap Rate 계산기"}}};
  var SIBS = ["break-even-calc","budget-calc","cagr-calc","cap-rate-calc"];
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
