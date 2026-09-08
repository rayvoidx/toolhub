(function(){
  "use strict";
  var CATALOG = {"cooking-conv":{"cat":"life","emoji":"🥄","names":{"en":"Cups to Grams Converter","zh":"杯换算克","hi":"कप से ग्राम कन्वर्टर","es":"Convertidor de tazas a gramos","ar":"محوّل الأكواب إلى الغرامات","fr":"Convertisseur tasses en grammes","bn":"কাপ থেকে গ্রাম কনভার্টার","pt":"Conversor de xícaras para gramas","ru":"Перевод чашек в граммы","ur":"کپ سے گرام کنورٹر","id":"Konverter Cangkir ke Gram","de":"Cups-in-Gramm-Rechner","ja":"カップ→グラム変換","ko":"컵→그램 변환기"}},"decking-calc":{"cat":"life","emoji":"🏗️","names":{"en":"Decking Calculator","zh":"露台木板计算器","hi":"डेकिंग कैलकुलेटर","es":"Calculadora de tarima","ar":"حاسبة ألواح التراس","fr":"Calculateur de terrasse","bn":"ডেকিং ক্যালকুলেটর","pt":"Calculadora de deck","ru":"Калькулятор террасной доски","ur":"ڈیکنگ کیلکولیٹر","id":"Kalkulator Decking","de":"Terrassen-Rechner","ja":"ウッドデッキ計算","ko":"데크 계산기"}},"dog-age-calc":{"cat":"life","emoji":"🐕","names":{"en":"Dog Age Calculator","zh":"狗狗年龄计算器","hi":"डॉग एज कैलकुलेटर","es":"Calculadora de edad canina","ar":"حاسبة عمر الكلب","fr":"Calculateur d'âge du chien","bn":"কুকুরের বয়স ক্যালকুলেটর","pt":"Calculadora de idade do cachorro","ru":"Калькулятор возраста собаки","ur":"کتے کی عمر کیلکولیٹر","id":"Kalkulator Usia Anjing","de":"Hundealter-Rechner","ja":"犬の年齢計算ツール","ko":"강아지 나이 계산기"}},"drywall-calc":{"cat":"life","emoji":"🛠️","names":{"en":"Drywall Calculator","zh":"石膏板计算器","hi":"ड्राईवॉल कैलकुलेटर","es":"Calculadora de pladur","ar":"حاسبة الجبس بورد","fr":"Calculateur placo","bn":"ড্রাইওয়াল ক্যালকুলেটর","pt":"Calculadora de drywall","ru":"Калькулятор гипсокартона","ur":"ڈرائی وال کیلکولیٹر","id":"Kalkulator Drywall","de":"Trockenbau-Rechner","ja":"石膏ボード計算ツール","ko":"석고보드 계산기"}}};
  var SIBS = ["cooking-conv","decking-calc","dog-age-calc","drywall-calc"];
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
