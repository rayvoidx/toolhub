(function(){
  "use strict";
  var CATALOG = {"nap-calc":{"cat":"health","emoji":"😴","names":{"en":"Nap Calculator","zh":"小睡计算器","hi":"नैप कैलकुलेटर","es":"Calculadora de siestas","ar":"حاسبة القيلولة","fr":"Calculateur de sieste","bn":"ন্যাপ ক্যালকুলেটর","pt":"Calculadora de soneca","ru":"Калькулятор дневного сна","ur":"نیپ کیلکولیٹر","id":"Kalkulator Tidur Siang","de":"Powernap-Rechner","ja":"昼寝タイマー計算","ko":"낮잠 계산기"}},"one-rep-max-calc":{"cat":"health","emoji":"🏋","names":{"en":"One Rep Max Calculator","zh":"1RM 计算器","hi":"1RM कैलकुलेटर","es":"Calculadora de 1RM","ar":"حاسبة الحد الأقصى لتكرار واحد (1RM)","fr":"Calculateur de 1RM","bn":"1RM ক্যালকুলেটর","pt":"Calculadora de 1RM","ru":"Калькулятор 1ПМ","ur":"1RM کیلکولیٹر","id":"Kalkulator 1RM","de":"1RM-Rechner","ja":"1RM計算ツール","ko":"1RM 계산기"}},"ovulation-calc":{"cat":"health","emoji":"♀","names":{"en":"Ovulation Calculator","zh":"排卵计算器","hi":"ओव्यूलेशन कैलकुलेटर","es":"Calculadora de Ovulación","ar":"حاسبة التبويض","fr":"Calculatrice d'Ovulation","bn":"ডিম্বস্ফোটন ক্যালকুলেটর","pt":"Calculadora de Ovulação","ru":"Калькулятор овуляции","ur":"بیضہ دانی کیلکولیٹر","id":"Kalkulator Ovulasi","de":"Eisprungrechner","ja":"排卵日計算","ko":"배란일 계산기"}},"pace-calc":{"cat":"health","emoji":"👟","names":{"en":"Running Pace Calculator","zh":"跑步配速计算器","hi":"रनिंग पेस कैलकुलेटर","es":"Calculadora de Ritmo de Carrera","ar":"حاسبة إيقاع الجري","fr":"Calculateur d'Allure de Course","bn":"রানিং পেস ক্যালকুলেটর","pt":"Calculadora de Ritmo de Corrida","ru":"Калькулятор темпа бега","ur":"رننگ پیس کیلکولیٹر","id":"Kalkulator Pace Lari","de":"Lauftempo-Rechner","ja":"ランニングペース計算機","ko":"러닝 페이스 계산기"}}};
  var SIBS = ["nap-calc","one-rep-max-calc","ovulation-calc","pace-calc"];
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
