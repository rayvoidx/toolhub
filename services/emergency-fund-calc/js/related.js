(function(){
  "use strict";
  var CATALOG = {"exchange-rate-conv":{"cat":"finance","emoji":"💱","names":{"en":"Currency Converter","zh":"汇率换算器","hi":"मुद्रा परिवर्तक","es":"Conversor de Divisas","ar":"محول العملات","fr":"Convertisseur de Devises","bn":"মুদ্রা কনভার্টার","pt":"Conversor de Moedas","ru":"Конвертер валют","ur":"کرنسی کنورٹر","id":"Konverter Mata Uang","de":"Währungsrechner","ja":"為替レート計算機","ko":"환율 계산기"}},"fire-calc":{"cat":"finance","emoji":"🔥","names":{"en":"FIRE Calculator","zh":"FIRE 计算器","hi":"FIRE कैलकुलेटर","es":"Calculadora FIRE","ar":"حاسبة FIRE","fr":"Calculateur FIRE","bn":"FIRE ক্যালকুলেটর","pt":"Calculadora FIRE","ru":"Калькулятор FIRE","ur":"FIRE کیلکولیٹر","id":"Kalkulator FIRE","de":"FIRE-Rechner","ja":"FIRE計算機","ko":"FIRE 계산기"}},"freelance-rate-calc":{"cat":"finance","emoji":"💼","names":{"en":"Freelance Rate Calculator","zh":"自由职业报价计算器","hi":"फ्रीलांस रेट कैलकुलेटर","es":"Calculadora de tarifa freelance","ar":"حاسبة سعر العمل الحر","fr":"Calculateur de tarif freelance","bn":"ফ্রিল্যান্স রেট ক্যালকুলেটর","pt":"Calculadora de valor freelancer","ru":"Калькулятор ставки фрилансера","ur":"فری لانس ریٹ کیلکولیٹر","id":"Kalkulator Tarif Freelance","de":"Freelancer-Stundensatz-Rechner","ja":"フリーランス単価計算ツール","ko":"프리랜서 단가 계산기"}},"gold-purity-calc":{"cat":"finance","emoji":"🥇","names":{"en":"Gold Purity Calculator","zh":"黄金纯度计算器","hi":"सोने की शुद्धता कैलकुलेटर","es":"Calculadora de pureza del oro","ar":"حاسبة نقاء الذهب","fr":"Calculateur de pureté de l'or","bn":"সোনার বিশুদ্ধতা ক্যালকুলেটর","pt":"Calculadora de pureza do ouro","ru":"Калькулятор пробы золота","ur":"سونے کی پیوریٹی کیلکولیٹر","id":"Kalkulator Kadar Emas","de":"Gold-Reinheitsrechner","ja":"金の純度計算ツール","ko":"금 순도 계산기"}}};
  var SIBS = ["exchange-rate-conv","fire-calc","freelance-rate-calc","gold-purity-calc"];
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
