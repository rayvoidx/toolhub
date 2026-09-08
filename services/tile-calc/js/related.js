(function(){
  "use strict";
  var CATALOG = {"tire-size-calc":{"cat":"life","emoji":"🛞","names":{"en":"Tire Size Calculator","zh":"轮胎尺寸计算器","hi":"टायर साइज़ कैलकुलेटर","es":"Calculadora de medidas de neumáticos","ar":"حاسبة مقاس الإطارات","fr":"Calculateur de dimension de pneu","bn":"টায়ার সাইজ ক্যালকুলেটর","pt":"Calculadora de medidas de pneus","ru":"Калькулятор размера шин","ur":"ٹائر سائز کیلکولیٹر","id":"Kalkulator Ukuran Ban","de":"Reifengrößen-Rechner","ja":"タイヤサイズ計算ツール","ko":"타이어 사이즈 계산기"}},"topsoil-calc":{"cat":"life","emoji":"🌱","names":{"en":"Topsoil Calculator","zh":"表土用量计算器","hi":"टॉपसॉइल कैलकुलेटर","es":"Calculadora de tierra vegetal","ar":"حاسبة التربة السطحية","fr":"Calculateur de terre végétale","bn":"টপসয়েল ক্যালকুলেটর","pt":"Calculadora de terra vegetal","ru":"Калькулятор плодородного грунта","ur":"ٹاپ سوائل کیلکولیٹر","id":"Kalkulator Tanah Lapisan Atas","de":"Mutterboden-Rechner","ja":"土（表土）計算ツール","ko":"흙(표토) 소요량 계산기"}},"tv-size-calc":{"cat":"life","emoji":"📺","names":{"en":"TV Size Calculator","zh":"电视尺寸计算器","hi":"टीवी साइज़ कैलकुलेटर","es":"Calculadora de tamaño de TV","ar":"حاسبة حجم التلفزيون","fr":"Calculateur de taille de TV","bn":"টিভি সাইজ ক্যালকুলেটর","pt":"Calculadora de tamanho de TV","ru":"Калькулятор размера телевизора и расстояния","ur":"ٹی وی سائز کیلکولیٹر","id":"Kalkulator Ukuran TV","de":"TV-Größen-Rechner","ja":"テレビサイズ計算ツール","ko":"TV 크기 계산기"}},"typing-test":{"cat":"life","emoji":"⌨️","names":{"en":"Typing Speed Test","zh":"打字速度测试","hi":"टाइपिंग स्पीड टेस्ट","es":"Test de Velocidad de Escritura","ar":"اختبار سرعة الكتابة","fr":"Test de Vitesse de Frappe","bn":"টাইপিং স্পিড টেস্ট","pt":"Teste de Velocidade de Digitação","ru":"Тест скорости печати","ur":"ٹائپنگ اسپیڈ ٹیسٹ","id":"Tes Kecepatan Mengetik","de":"Tippgeschwindigkeitstest","ja":"タイピング速度テスト","ko":"타자 속도 테스트"}}};
  var SIBS = ["tire-size-calc","topsoil-calc","tv-size-calc","typing-test"];
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
