(function(){
  "use strict";
  var CATALOG = {"aspect-ratio-calc":{"cat":"dev","emoji":"▭","names":{"en":"Aspect Ratio Calculator","zh":"宽高比计算器","hi":"आस्पेक्ट रेशियो कैलकुलेटर","es":"Calculadora de relación de aspecto","ar":"حاسبة نسبة العرض إلى الارتفاع","fr":"Calculateur de format d'image","bn":"অ্যাসপেক্ট রেশিও ক্যালকুলেটর","pt":"Calculadora de proporção de tela","ru":"Калькулятор соотношения сторон","ur":"ایسپیکٹ ریشو کیلکولیٹر","id":"Kalkulator Rasio Aspek","de":"Seitenverhältnis-Rechner","ja":"アスペクト比計算ツール","ko":"화면 비율 계산기"}},"base64-conv":{"cat":"dev","emoji":"🔡","names":{"en":"Base64 Encoder / Decoder","zh":"Base64 编码/解码器","hi":"Base64 एन्कोडर / डिकोडर","es":"Codificador / Decodificador Base64","ar":"مُرمِّز / فاكّ ترميز Base64","fr":"Encodeur / Décodeur Base64","bn":"Base64 এনকোডার / ডিকোডার","pt":"Codificador / Decodificador Base64","ru":"Base64 кодировщик / декодировщик","ur":"Base64 اینکوڈر / ڈیکوڈر","id":"Encoder / Decoder Base64","de":"Base64-Encoder / -Decoder","ja":"Base64 エンコーダー / デコーダー","ko":"Base64 인코더 / 디코더"}},"box-shadow-generator":{"cat":"dev","emoji":"🔲","names":{"en":"Box Shadow Generator","zh":"盒阴影生成器","hi":"बॉक्स शैडो जेनरेटर","es":"Generador de Box Shadow","ar":"مولّد ظل الصندوق","fr":"Générateur de Box Shadow","bn":"বক্স শ্যাডো জেনারেটর","pt":"Gerador de Box Shadow","ru":"Генератор Box Shadow","ur":"باکس شیڈو جنریٹر","id":"Box Shadow Generator","de":"Box-Shadow-Generator","ja":"ボックスシャドウジェネレーター","ko":"박스 섀도우 생성기"}},"chmod-calc":{"cat":"dev","emoji":"🔐","names":{"en":"Chmod Calculator","zh":"Chmod 权限计算器","hi":"Chmod कैलकुलेटर","es":"Calculadora Chmod","ar":"حاسبة Chmod","fr":"Calculateur Chmod","bn":"Chmod ক্যালকুলেটর","pt":"Calculadora Chmod","ru":"Калькулятор Chmod","ur":"Chmod کیلکولیٹر","id":"Kalkulator Chmod","de":"Chmod-Rechner","ja":"Chmod計算機","ko":"Chmod 계산기"}}};
  var SIBS = ["aspect-ratio-calc","base64-conv","box-shadow-generator","chmod-calc"];
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
