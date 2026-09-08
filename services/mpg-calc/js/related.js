(function(){
  "use strict";
  var CATALOG = {"mulch-calc":{"cat":"life","emoji":"🌳","names":{"en":"Mulch Calculator","zh":"覆盖物计算器","hi":"मल्च कैलकुलेटर","es":"Calculadora de mantillo","ar":"حاسبة المهاد","fr":"Calculateur de paillis","bn":"মালচ ক্যালকুলেটর","pt":"Calculadora de cobertura morta","ru":"Калькулятор мульчи","ur":"ملچ کیلکولیٹر","id":"Kalkulator Mulsa","de":"Mulch-Rechner","ja":"マルチング計算","ko":"멀칭 계산기"}},"online-notepad":{"cat":"life","emoji":"🗒️","names":{"en":"Online Notepad","zh":"在线记事本","hi":"ऑनलाइन नोटपैड","es":"Bloc de Notas Online","ar":"مفكرة أونلاين","fr":"Bloc-Notes en Ligne","bn":"অনলাইন নোটপ্যাড","pt":"Bloco de Notas Online","ru":"Онлайн-блокнот","ur":"آن لائن نوٹ پیڈ","id":"Notepad Online","de":"Online-Notizblock","ja":"オンラインメモ帳","ko":"온라인 메모장"}},"paint-calc":{"cat":"life","emoji":"🎨","names":{"en":"Paint Calculator","zh":"油漆用量计算器","hi":"पेंट कैलकुलेटर","es":"Calculadora de pintura","ar":"حاسبة الطلاء","fr":"Calculateur de peinture","bn":"পেইন্ট ক্যালকুলেটর","pt":"Calculadora de tinta","ru":"Калькулятор краски","ur":"پینٹ کیلکولیٹر","id":"Kalkulator Cat","de":"Farbrechner","ja":"ペンキ計算ツール","ko":"페인트 계산기"}},"party-drink-calc":{"cat":"life","emoji":"🥂","names":{"en":"Party Drink Calculator","zh":"派对酒水计算器","hi":"पार्टी ड्रिंक कैलकुलेटर","es":"Calculadora de bebidas para fiestas","ar":"حاسبة مشروبات الحفلات","fr":"Calculateur de boissons pour fête","bn":"পার্টি ড্রিংক ক্যালকুলেটর","pt":"Calculadora de bebidas para festa","ru":"Калькулятор напитков для вечеринки","ur":"پارٹی ڈرنک کیلکولیٹر","id":"Kalkulator Minuman Pesta","de":"Party-Getränkerechner","ja":"パーティーのお酒量計算ツール","ko":"파티 주류 계산기"}}};
  var SIBS = ["mulch-calc","online-notepad","paint-calc","party-drink-calc"];
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
