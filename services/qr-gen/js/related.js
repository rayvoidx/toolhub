(function(){
  "use strict";
  var CATALOG = {"quadratic-solver":{"cat":"utility","emoji":"✖️","names":{"en":"Quadratic Equation Solver","zh":"二次方程求解器","hi":"द्विघात समीकरण हल करने वाला","es":"Resolutor de Ecuaciones Cuadráticas","ar":"حلّال المعادلات التربيعية","fr":"Résolveur d'Équation du Second Degré","bn":"দ্বিঘাত সমীকরণ সমাধানকারী","pt":"Resolvedor de Equação do Segundo Grau","ru":"Решение квадратных уравнений","ur":"کواڈریٹک مساوات حل کار","id":"Kalkulator Persamaan Kuadrat","de":"Quadratische-Gleichung-Löser","ja":"二次方程式ソルバー","ko":"이차방정식 계산기"}},"ratio-calc":{"cat":"utility","emoji":"⚖️","names":{"en":"Ratio Calculator","zh":"比例计算器","hi":"अनुपात कैलकुलेटर","es":"Calculadora de Razones","ar":"حاسبة النسب","fr":"Calculateur de Ratios","bn":"অনুপাত ক্যালকুলেটর","pt":"Calculadora de Razões","ru":"Калькулятор пропорций","ur":"تناسب کیلکولیٹر","id":"Kalkulator Rasio","de":"Verhältnisrechner","ja":"比率計算機","ko":"비율 계산기"}},"safety-stock-batch":{"cat":"utility","emoji":"🧮","names":{"en":"Safety Stock & Reorder Point Batch Calculato","zh":"安全库存与再订货点批量计算器","hi":"सेफ्टी स्टॉक और रीऑर्डर पॉइंट बैच कैलकुलेटर","es":"Calculadora por lotes de stock de seguridad","ar":"حاسبة المخزون الاحتياطي ونقطة إعادة الطلب با","fr":"Calculateur par lots de stock de sécurité et","bn":"নিরাপত্তা স্টক ও পুনঃঅর্ডার পয়েন্ট ব্যাচ ক্","pt":"Calculadora em lote de estoque de segurança","ru":"Пакетный калькулятор страхового запаса и точ","ur":"حفاظتی اسٹاک اور دوبارہ آرڈر پوائنٹ بیچ کیلک","id":"Kalkulator Batch Stok Pengaman & Titik Pemes","de":"Stapelrechner für Sicherheitsbestand & Melde","ja":"安全在庫・発注点 一括計算ツール","ko":"안전재고"}},"slope-calc":{"cat":"utility","emoji":"📈","names":{"en":"Slope Calculator","zh":"斜率计算器","hi":"ढाल कैलकुलेटर","es":"Calculadora de Pendiente","ar":"حاسبة الميل","fr":"Calculateur de Pente","bn":"ঢাল ক্যালকুলেটর","pt":"Calculadora de Inclinação","ru":"Калькулятор уклона","ur":"ڈھلان کیلکولیٹر","id":"Kalkulator Kemiringan","de":"Steigungsrechner","ja":"傾き計算機","ko":"기울기 계산기"}}};
  var SIBS = ["quadratic-solver","ratio-calc","safety-stock-batch","slope-calc"];
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
