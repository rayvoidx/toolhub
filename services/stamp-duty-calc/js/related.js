(function(){
  "use strict";
  var CATALOG = {"stock-average-calc":{"cat":"finance","emoji":"📉","names":{"en":"Stock Average Calculator","zh":"股票平均价计算器","hi":"स्टॉक औसत कैलकुलेटर","es":"Calculadora de precio medio de acciones","ar":"حاسبة متوسط سعر السهم","fr":"Calculateur de prix moyen d'actions","bn":"স্টক গড় ক্যালকুলেটর","pt":"Calculadora de preço médio de ações","ru":"Калькулятор средней цены акции","ur":"اسٹاک اوسط کیلکولیٹر","id":"Kalkulator Harga Rata-rata Saham","de":"Aktien-Durchschnittsrechner","ja":"株式平均取得単価計算機","ko":"주식 평단가 계산기"}},"stock-profit-calc":{"cat":"finance","emoji":"💹","names":{"en":"Stock Profit Calculator","zh":"股票收益计算器","hi":"स्टॉक प्रॉफ़िट कैलकुलेटर","es":"Calculadora de beneficio de acciones","ar":"حاسبة أرباح الأسهم","fr":"Calculateur de profit d'actions","bn":"স্টক প্রফিট ক্যালকুলেটর","pt":"Calculadora de lucro de ações","ru":"Калькулятор прибыли по акциям","ur":"اسٹاک پرافٹ کیلکولیٹر","id":"Kalkulator Laba Saham","de":"Aktien-Gewinnrechner","ja":"株式利益計算機","ko":"주식 수익 계산기"}},"tax-calc":{"cat":"finance","emoji":"🧾","names":{"en":"VAT Calculator (Korea 10%)","zh":"增值税计算器（韩国 10%）","hi":"VAT कैलकुलेटर (कोरिया 10%)","es":"Calculadora de IVA (Corea 10 %)","ar":"حاسبة ضريبة القيمة المضافة (كوريا 10٪)","fr":"Calculateur de TVA (Corée 10 %)","bn":"VAT ক্যালকুলেটর (কোরিয়া ১০%)","pt":"Calculadora de IVA (Coreia 10%)","ru":"Калькулятор НДС (Корея 10%)","ur":"VAT کیلکولیٹر (کوریا 10%)","id":"Kalkulator PPN (Korea 10%)","de":"MwSt.-Rechner (Korea 10 %)","ja":"付加価値税計算（韓国10%）","ko":"부가세 계산기"}},"tip-calc":{"cat":"finance","emoji":"🪙","names":{"en":"Tip Calculator","zh":"小费计算器","hi":"टिप कैलकुलेटर","es":"Calculadora de propinas","ar":"حاسبة البقشيش","fr":"Calculateur de pourboire","bn":"টিপ ক্যালকুলেটর","pt":"Calculadora de gorjeta","ru":"Калькулятор чаевых","ur":"ٹِپ کیلکولیٹر","id":"Kalkulator Tip","de":"Trinkgeld-Rechner","ja":"チップ計算機","ko":"팁 계산기"}}};
  var SIBS = ["stock-average-calc","stock-profit-calc","tax-calc","tip-calc"];
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
