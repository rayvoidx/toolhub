(function(){
  "use strict";
  var CATALOG = {"cat-age-calc":{"cat":"health","emoji":"🐈","names":{"en":"Cat Age Calculator","zh":"猫咪年龄计算器","hi":"बिल्ली उम्र कैलकुलेटर","es":"Calculadora de Edad Felina","ar":"حاسبة عمر القطة","fr":"Calculateur d'Âge du Chat","bn":"বিড়ালের বয়স ক্যালকুলেটর","pt":"Calculadora de Idade do Gato","ru":"Калькулятор возраста кошки","ur":"بلی کی عمر کیلکولیٹر","id":"Kalkulator Usia Kucing","de":"Katzenalter-Rechner","ja":"猫年齢計算機","ko":"고양이 나이 계산기"}},"child-height-predictor":{"cat":"health","emoji":"🧒","names":{"en":"Child Height Predictor","zh":"儿童身高预测器","hi":"बच्चे की लंबाई प्रेडिक्टर","es":"Predictor de Estatura Infantil","ar":"أداة توقّع طول الطفل","fr":"Prédicteur de Taille de l'Enfant","bn":"শিশুর উচ্চতা প্রেডিক্টর","pt":"Preditor de Altura Infantil","ru":"Калькулятор роста ребёнка","ur":"بچے کے قد کا اندازہ لگانے والا","id":"Prediktor Tinggi Anak","de":"Größenrechner für Kinder","ja":"子どもの身長予測ツール","ko":"아이 키 예측 계산기"}},"cholesterol-ratio-calc":{"cat":"health","emoji":"🫀","names":{"en":"Cholesterol Ratio Calculator","zh":"胆固醇比值计算器","hi":"कोलेस्ट्रॉल अनुपात कैलकुलेटर","es":"Calculadora de índice de colesterol","ar":"حاسبة نسبة الكوليسترول","fr":"Calculateur de rapport de cholestérol","bn":"কোলেস্টেরল অনুপাত ক্যালকুলেটর","pt":"Calculadora de razão de colesterol","ru":"Калькулятор коэффициента холестерина","ur":"کولیسٹرول ریشو کیلکولیٹر","id":"Kalkulator Rasio Kolesterol","de":"Cholesterin-Quotient-Rechner","ja":"コレステロール比率計算ツール","ko":"콜레스테롤 비율 계산기"}},"heart-rate-zone-calc":{"cat":"health","emoji":"❤","names":{"en":"Heart Rate Zone Calculator","zh":"心率区间计算器","hi":"हार्ट रेट ज़ोन कैलकुलेटर","es":"Calculadora de zonas de frecuencia cardíaca","ar":"حاسبة مناطق معدل ضربات القلب","fr":"Calculateur de zones cardiaques","bn":"হার্ট রেট জোন ক্যালকুলেটর","pt":"Calculadora de zonas de frequência cardíaca","ru":"Калькулятор пульсовых зон","ur":"ہارٹ ریٹ زون کیلکولیٹر","id":"Kalkulator Zona Detak Jantung","de":"Herzfrequenz-Zonen-Rechner","ja":"心拍ゾーン計算ツール","ko":"심박존 계산기"}}};
  var SIBS = ["cat-age-calc","child-height-predictor","cholesterol-ratio-calc","heart-rate-zone-calc"];
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
