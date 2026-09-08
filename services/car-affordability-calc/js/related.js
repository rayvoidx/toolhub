(function(){
  "use strict";
  var CATALOG = {"car-lease-calc":{"cat":"finance","emoji":"🚙","names":{"en":"Car Lease Calculator","zh":"汽车租赁计算器","hi":"कार लीज़ कैलकुलेटर","es":"Calculadora de leasing de coches","ar":"حاسبة تأجير السيارات","fr":"Calculateur de leasing auto","bn":"কার লিজ ক্যালকুলেটর","pt":"Calculadora de leasing de carro","ru":"Калькулятор автолизинга","ur":"کار لیز کیلکولیٹر","id":"Kalkulator Leasing Mobil","de":"Auto-Leasing-Rechner","ja":"カーリース計算ツール","ko":"자동차 리스 계산기"}},"car-payment-calc":{"cat":"finance","emoji":"🚗","names":{"en":"Car Payment Calculator","zh":"汽车贷款计算器","hi":"कार लोन कैलकुलेटर","es":"Calculadora de pago de coche","ar":"حاسبة قسط السيارة","fr":"Calculateur de mensualité auto","bn":"গাড়ি ঋণ ক্যালকুলেটর","pt":"Calculadora de financiamento de carro","ru":"Калькулятор автокредита","ur":"کار قرض کیلکولیٹر","id":"Kalkulator Cicilan Mobil","de":"Autokredit-Rechner","ja":"自動車ローン計算ツール","ko":"자동차 할부 계산기"}},"cd-calc":{"cat":"finance","emoji":"📜","names":{"en":"CD Calculator","zh":"CD 计算器","hi":"CD कैलकुलेटर","es":"Calculadora de CD","ar":"حاسبة شهادة الإيداع CD","fr":"Calculateur de CD","bn":"CD ক্যালকুলেটর","pt":"Calculadora de CD","ru":"Калькулятор вклада CD","ur":"CD کیلکولیٹر","id":"Kalkulator CD","de":"CD-Rechner","ja":"CD計算ツール","ko":"CD 계산기"}},"coast-fire-calc":{"cat":"finance","emoji":"🏖️","names":{"en":"Coast FIRE Calculator","zh":"Coast FIRE 计算器","hi":"Coast FIRE कैलकुलेटर","es":"Calculadora Coast FIRE","ar":"حاسبة Coast FIRE","fr":"Calculateur Coast FIRE","bn":"Coast FIRE ক্যালকুলেটর","pt":"Calculadora Coast FIRE","ru":"Калькулятор Coast FIRE","ur":"Coast FIRE کیلکولیٹر","id":"Kalkulator Coast FIRE","de":"Coast-FIRE-Rechner","ja":"Coast FIRE 計算機","ko":"코스트 파이어 계산기"}}};
  var SIBS = ["car-lease-calc","car-payment-calc","cd-calc","coast-fire-calc"];
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
