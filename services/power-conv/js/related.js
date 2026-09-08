(function(){
  "use strict";
  var CATALOG = {"pressure-conv":{"cat":"units","emoji":"🔩","names":{"en":"Pressure Converter","zh":"压力单位换算器","hi":"दबाव कनवर्टर","es":"Conversor de Presión","ar":"محول الضغط","fr":"Convertisseur de Pression","bn":"চাপ কনভার্টার","pt":"Conversor de Pressão","ru":"Конвертер давления","ur":"پریشر کنورٹر","id":"Konverter Tekanan","de":"Druckumrechner","ja":"圧力変換ツール","ko":"압력 변환기"}},"ring-size-conv":{"cat":"units","emoji":"💍","names":{"en":"Ring Size Converter","zh":"戒指尺码转换器","hi":"रिंग साइज़ कन्वर्टर","es":"Conversor de Tallas de Anillos","ar":"محول مقاسات الخواتم","fr":"Convertisseur de Tailles de Bagues","bn":"রিং সাইজ কনভার্টার","pt":"Conversor de Numeração de Anéis","ru":"Конвертер размеров колец","ur":"انگوٹھی سائز کنورٹر","id":"Konverter Ukuran Cincin","de":"Ringgrößen-Umrechner","ja":"リングサイズ変換ツール","ko":"반지 사이즈 변환기"}},"roman-numeral-conv":{"cat":"units","emoji":"Ⅹ","names":{"en":"Roman Numeral Converter","zh":"罗马数字转换器","hi":"रोमन अंक कनवर्टर","es":"Conversor de Números Romanos","ar":"محول الأرقام الرومانية","fr":"Convertisseur de Chiffres Romains","bn":"রোমান সংখ্যা কনভার্টার","pt":"Conversor de Números Romanos","ru":"Конвертер римских цифр","ur":"رومن ہندسہ کنورٹر","id":"Konverter Angka Romawi","de":"Römische-Zahlen-Umrechner","ja":"ローマ数字変換","ko":"로마 숫자 변환기"}},"shoe-size-conv":{"cat":"units","emoji":"👟","names":{"en":"Shoe Size Converter","zh":"鞋码转换器","hi":"शू साइज़ कन्वर्टर","es":"Conversor de Tallas de Zapatos","ar":"محول مقاسات الأحذية","fr":"Convertisseur de Pointures","bn":"জুতার সাইজ কনভার্টার","pt":"Conversor de Numeração de Calçados","ru":"Конвертер размеров обуви","ur":"جوتوں کے سائز کا کنورٹر","id":"Konverter Ukuran Sepatu","de":"Schuhgrößen-Umrechner","ja":"靴サイズ変換","ko":"신발 사이즈 변환기"}}};
  var SIBS = ["pressure-conv","ring-size-conv","roman-numeral-conv","shoe-size-conv"];
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
