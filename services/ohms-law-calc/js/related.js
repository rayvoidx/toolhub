(function(){
  "use strict";
  var CATALOG = {"percent-error-calc":{"cat":"science","emoji":"🎯","names":{"en":"Percent Error Calculator","zh":"百分误差计算器","hi":"प्रतिशत त्रुटि कैलकुलेटर","es":"Calculadora de error porcentual","ar":"حاسبة نسبة الخطأ المئوية","fr":"Calculateur d'erreur en pourcentage","bn":"শতকরা ত্রুটি ক্যালকুলেটর","pt":"Calculadora de erro percentual","ru":"Калькулятор относительной погрешности","ur":"فیصد خطا کیلکولیٹر","id":"Kalkulator Persen Galat","de":"Prozentualer Fehler","ja":"誤差率（パーセント誤差）計算ツール","ko":"퍼센트 오차 계산기"}},"permutation-combination-calc":{"cat":"science","emoji":"🎲","names":{"en":"Combination Calculator","zh":"组合计算器","hi":"कॉम्बिनेशन कैलकुलेटर","es":"Calculadora de combinaciones","ar":"حاسبة التوافيق","fr":"Calculateur de combinaisons","bn":"কম্বিনেশন ক্যালকুলেটর","pt":"Calculadora de combinações","ru":"Калькулятор сочетаний","ur":"کومبینیشن کیلکولیٹر","id":"Kalkulator Kombinasi","de":"Kombinationsrechner","ja":"組み合わせ計算ツール","ko":"조합·순열 계산기"}},"sig-fig-calc":{"cat":"science","emoji":"🔬","names":{"en":"Sig Fig Calculator","zh":"有效数字计算器","hi":"सिग फिग कैलकुलेटर","es":"Calculadora de cifras significativas y redon","ar":"حاسبة الأرقام المعنوية","fr":"Calculateur de chiffres significatifs et arr","bn":"সিগ ফিগ ক্যালকুলেটর","pt":"Calculadora de algarismos significativos","ru":"Калькулятор значащих цифр","ur":"سگ فگ کیلکولیٹر","id":"Kalkulator Angka Penting","de":"Signifikante Stellen Rechner","ja":"有効数字計算ツール","ko":"유효숫자 계산기"}},"wavelength-calc":{"cat":"science","emoji":"🌈","names":{"en":"Wavelength Calculator","zh":"波长计算器","hi":"वेवलेंथ कैलकुलेटर","es":"Calculadora de longitud de onda y frecuencia","ar":"حاسبة الطول الموجي","fr":"Calculateur de longueur d'onde et de fréquen","bn":"তরঙ্গদৈর্ঘ্য ক্যালকুলেটর","pt":"Calculadora de comprimento de onda e frequên","ru":"Калькулятор длины волны и частоты","ur":"ویو لینتھ کیلکولیٹر","id":"Kalkulator Panjang Gelombang dan Frekuensi","de":"Wellenlängen-Rechner","ja":"波長計算ツール","ko":"파장 계산기"}}};
  var SIBS = ["percent-error-calc","permutation-combination-calc","sig-fig-calc","wavelength-calc"];
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
