(function(){
  "use strict";
  var CATALOG = {"army-body-fat-calc":{"cat":"health","emoji":"🎖️","names":{"en":"Army Body Fat Calculator","zh":"美国陆军体脂率计算器","hi":"आर्मी बॉडी फैट कैलकुलेटर","es":"Calculadora de grasa corporal del Army","ar":"حاسبة دهون الجسم للجيش الأمريكي","fr":"Calculateur de masse grasse Army","bn":"আর্মি বডি ফ্যাট ক্যালকুলেটর","pt":"Calculadora de gordura corporal do Army","ru":"Калькулятор жира армии США","ur":"آرمی باڈی فیٹ کیلکولیٹر","id":"Kalkulator Lemak Tubuh Army","de":"Army-Körperfettrechner","ja":"米陸軍 体脂肪率計算ツール","ko":"미 육군 체지방 계산기"}},"blood-alcohol-calc":{"cat":"health","emoji":"🍺","names":{"en":"Blood Alcohol Calculator (BAC)","zh":"血液酒精浓度计算器（BAC）— 魏德马克公式估算","hi":"ब्लड अल्कोहल कैलकुलेटर (BAC)","es":"Calculadora de Alcohol en Sangre (BAC)","ar":"حاسبة الكحول في الدم (BAC)","fr":"Calculateur d'Alcoolémie (BAC)","bn":"ব্লাড অ্যালকোহল ক্যালকুলেটর (BAC)","pt":"Calculadora de Álcool no Sangue (BAC)","ru":"Калькулятор алкоголя в крови (BAC)","ur":"بلڈ الکحل کیلکولیٹر (BAC)","id":"Kalkulator Alkohol dalam Darah (BAC)","de":"Blutalkohol-Rechner (BAC)","ja":"血中アルコール濃度計算機（BAC）— ウィドマーク式の推定","ko":"혈중 알코올농도 계산기 (BAC)"}},"blood-pressure-checker":{"cat":"health","emoji":"🫀","names":{"en":"Blood Pressure Checker","zh":"血压检测器","hi":"ब्लड प्रेशर चेकर","es":"Comprobador de Presión Arterial","ar":"فاحص ضغط الدم","fr":"Vérificateur de Tension Artérielle","bn":"ব্লাড প্রেসার চেকার","pt":"Verificador de Pressão Arterial","ru":"Проверка артериального давления","ur":"بلڈ پریشر چیکر","id":"Pengecek Tekanan Darah","de":"Blutdruck-Checker","ja":"血圧チェッカー","ko":"혈압 체커"}},"blood-sugar-conv":{"cat":"health","emoji":"🩸","names":{"en":"Blood Sugar Converter","zh":"血糖单位换算器","hi":"ब्लड शुगर कनवर्टर","es":"Conversor de Glucosa en Sangre","ar":"محوّل سكر الدم","fr":"Convertisseur de Glycémie","bn":"রক্তে শর্করা রূপান্তরকারী","pt":"Conversor de Glicemia","ru":"Конвертер сахара в крови","ur":"بلڈ شوگر کنورٹر","id":"Konverter Gula Darah","de":"Blutzucker-Umrechner","ja":"血糖値コンバーター","ko":"혈당 단위 변환기"}}};
  var SIBS = ["army-body-fat-calc","blood-alcohol-calc","blood-pressure-checker","blood-sugar-conv"];
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
