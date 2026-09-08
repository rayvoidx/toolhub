(function(){
  "use strict";
  var CATALOG = {"compound-interest-calc":{"cat":"finance","emoji":"📈","names":{"en":"Compound Interest Calculator","zh":"复利计算器","hi":"कंपाउंड इंटरेस्ट कैलकुलेटर","es":"Calculadora de interés compuesto","ar":"حاسبة الفائدة المركبة","fr":"Calculateur d'intérêts composés","bn":"চক্রবৃদ্ধি সুদ ক্যালকুলেটর","pt":"Calculadora de juros compostos","ru":"Калькулятор сложных процентов","ur":"کمپاؤنڈ انٹرسٹ کیلکولیٹر","id":"Kalkulator Bunga Majemuk","de":"Zinseszinsrechner","ja":"複利計算機","ko":"복리 계산기"}},"credit-card-interest-calc":{"cat":"finance","emoji":"💳","names":{"en":"Credit Card Interest Calculator","zh":"信用卡利息计算器","hi":"क्रेडिट कार्ड ब्याज कैलकुलेटर","es":"Calculadora de Interés de Tarjeta de Crédito","ar":"حاسبة فائدة بطاقة الائتمان","fr":"Calculateur d'Intérêts de Carte de Crédit","bn":"ক্রেডিট কার্ড সুদ ক্যালকুলেটর","pt":"Calculadora de Juros de Cartão de Crédito","ru":"Калькулятор процентов по кредитной карте","ur":"کریڈٹ کارڈ سود کیلکولیٹر","id":"Kalkulator Bunga Kartu Kredit","de":"Kreditkarten-Zinsrechner","ja":"クレジットカード利息計算機","ko":"신용카드 이자 계산기"}},"crypto-average-calc":{"cat":"finance","emoji":"🪙","names":{"en":"Crypto Average Calculator","zh":"加密货币平均价计算器","hi":"क्रिप्टो औसत कैलकुलेटर","es":"Calculadora de precio medio cripto","ar":"حاسبة متوسط سعر العملة المشفّرة","fr":"Calculateur de prix moyen crypto","bn":"ক্রিপ্টো গড় ক্যালকুলেটর","pt":"Calculadora de preço médio de cripto","ru":"Калькулятор средней цены криптовалюты","ur":"کرپٹو اوسط کیلکولیٹر","id":"Kalkulator Harga Rata-rata Kripto","de":"Krypto-Durchschnittsrechner","ja":"仮想通貨 平均取得単価計算機","ko":"코인 평단가 계산기"}},"dca-calc":{"cat":"finance","emoji":"📈","names":{"en":"DCA Investment Calculator","zh":"定投计算器","hi":"SIP/DCA निवेश कैलकुलेटर","es":"Calculadora de inversión DCA/SIP","ar":"حاسبة الاستثمار الدوري DCA/SIP","fr":"Calculateur d'investissement DCA/SIP","bn":"SIP/DCA বিনিয়োগ ক্যালকুলেটর","pt":"Calculadora de investimento DCA/SIP","ru":"Калькулятор инвестиций DCA/SIP","ur":"SIP/DCA سرمایہ کاری کیلکولیٹر","id":"Kalkulator Investasi DCA/SIP","de":"DCA/SIP-Investmentrechner","ja":"積立投資計算機","ko":"적립식 투자 계산기"}}};
  var SIBS = ["compound-interest-calc","credit-card-interest-calc","crypto-average-calc","dca-calc"];
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
