(function(){
  "use strict";
  var CATALOG = {"fence-calc":{"cat":"life","emoji":"🚧","names":{"en":"Fence Calculator","zh":"围栏计算器","hi":"फ़ेंस कैलकुलेटर","es":"Calculadora de vallas","ar":"حاسبة السياج","fr":"Calculateur de clôture","bn":"বেড়া ক্যালকুলেটর","pt":"Calculadora de cerca","ru":"Калькулятор забора","ur":"باڑ کیلکولیٹر","id":"Kalkulator Pagar","de":"Zaunrechner","ja":"フェンス計算ツール","ko":"울타리 계산기"}},"final-grade-calc":{"cat":"life","emoji":"📝","names":{"en":"Final Grade Calculator","zh":"期末成绩计算器","hi":"फाइनल ग्रेड कैलकुलेटर","es":"Calculadora de nota final","ar":"حاسبة الدرجة النهائية","fr":"Calculateur de note finale","bn":"ফাইনাল গ্রেড ক্যালকুলেটর","pt":"Calculadora de nota final","ru":"Калькулятор итоговой оценки","ur":"فائنل گریڈ کیلکولیٹر","id":"Kalkulator Nilai Akhir","de":"Abschlussnoten-Rechner","ja":"期末成績計算機","ko":"기말고사 성적 계산기"}},"fuel-cost-calc":{"cat":"life","emoji":"⛽","names":{"en":"Fuel Cost Calculator","zh":"燃油费用计算器","hi":"ईंधन लागत कैलकुलेटर","es":"Calculadora de costo de combustible","ar":"حاسبة تكلفة الوقود","fr":"Calculateur de coût de carburant","bn":"জ্বালানি খরচ ক্যালকুলেটর","pt":"Calculadora de custo de combustível","ru":"Калькулятор расходов на топливо","ur":"ایندھن لاگت کیلکولیٹر","id":"Kalkulator Biaya Bahan Bakar","de":"Spritkosten-Rechner","ja":"ガソリン代計算機","ko":"유류비 계산기"}},"furnace-size-calc":{"cat":"life","emoji":"🔥","names":{"en":"Furnace Size Calculator","zh":"暖炉功率计算器","hi":"फर्नेस साइज़ कैलकुलेटर","es":"Calculadora de potencia de calefacción en BT","ar":"حاسبة قدرة التدفئة بالـ BTU","fr":"Calculateur de puissance de chauffage en BTU","bn":"ফার্নেস সাইজ ক্যালকুলেটর","pt":"Calculadora de potência de aquecimento em BT","ru":"Расчёт мощности отопления в BTU","ur":"فرنس سائز کیلکولیٹر","id":"Kalkulator Ukuran Furnace","de":"Heizleistungsrechner","ja":"暖房能力（BTU）計算ツール","ko":"퍼니스 용량 계산기"}}};
  var SIBS = ["fence-calc","final-grade-calc","fuel-cost-calc","furnace-size-calc"];
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
