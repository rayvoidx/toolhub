(function(){
  "use strict";
  var CATALOG = {"gcf-lcm-calc":{"cat":"utility","emoji":"➗","names":{"en":"GCF and LCM Calculator","zh":"最大公约数与最小公倍数计算器","hi":"महत्तम समापवर्तक और लघुत्तम समापवर्त्य कैलकुलेटर","es":"Calculadora de MCD y mcm","ar":"حاسبة القاسم المشترك الأكبر والمضاعف المشترك الأصغر","fr":"Calculateur de PGCD et PPCM","bn":"গসাগু ও লসাগু ক্যালকুলেটর","pt":"Calculadora de MDC e MMC","ru":"Калькулятор НОД и НОК","ur":"GCF اور LCM کیلکولیٹر","id":"Kalkulator FPB dan KPK","de":"ggT- und kgV-Rechner","ja":"最大公約数・最小公倍数計算機","ko":"최대공약수·최소공배수 계산기"}},"image-compressor":{"cat":"utility","emoji":"🗜️","names":{"en":"Image Compressor","zh":"图片压缩工具","hi":"इमेज कंप्रेसर","es":"Compresor de Imágenes","ar":"ضاغط الصور","fr":"Compresseur d'Images","bn":"ইমেজ কম্প্রেসর","pt":"Compressor de Imagens","ru":"Компрессор изображений","ur":"امیج کمپریسر","id":"Kompresor Gambar","de":"Bildkompressor","ja":"画像圧縮ツール","ko":"이미지 압축"}},"image-resizer":{"cat":"utility","emoji":"🖼️","names":{"en":"Image Resizer","zh":"图片尺寸调整器","hi":"इमेज रीसाइज़र","es":"Redimensionador de imágenes","ar":"أداة تغيير حجم الصور","fr":"Redimensionneur d'images","bn":"ইমেজ রিসাইজার","pt":"Redimensionador de imagens","ru":"Изменение размера изображений","ur":"امیج ری سائزر","id":"Pengubah Ukuran Gambar","de":"Bildgrößenänderung","ja":"画像リサイズツール","ko":"이미지 크기 조정"}},"inventory-turnover":{"cat":"utility","emoji":"📦","names":{"en":"Inventory Turnover & Dead Stock Finder","zh":"库存周转率与呆滞库存分析器","hi":"इन्वेंट्री टर्नओवर और डेड स्टॉक फ़ाइंडर","es":"Rotación de inventario y buscador de stock m","ar":"معدل دوران المخزون ومكتشف المخزون الراكد","fr":"Rotation des stocks et détecteur de stock do","bn":"ইনভেন্টরি টার্নওভার ও ডেড স্টক ফাইন্ডার","pt":"Giro de estoque e localizador de estoque par","ru":"Оборачиваемость запасов и поиск неликвидов","ur":"انوینٹری ٹرن اوور اور ڈیڈ اسٹاک فائنڈر","id":"Perputaran Persediaan & Pencari Stok Mati","de":"Lagerumschlag & Ladenhüter-Finder","ja":"在庫回転率・不動在庫ファインダー","ko":"재고회전율"}}};
  var SIBS = ["gcf-lcm-calc","image-compressor","image-resizer","inventory-turnover"];
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
