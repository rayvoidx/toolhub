(function(){
  "use strict";
  var CATALOG = {"click-speed-test":{"cat":"life","emoji":"🖱️","names":{"en":"Click Speed Test (CPS)","zh":"点击速度测试（CPS）","hi":"क्लिक स्पीड टेस्ट (CPS)","es":"Test de velocidad de clic (CPS)","ar":"اختبار سرعة النقر (CPS)","fr":"Test de vitesse de clic (CPS)","bn":"ক্লিক স্পিড টেস্ট (CPS)","pt":"Teste de velocidade de clique (CPS)","ru":"Тест скорости кликов (CPS)","ur":"کلک اسپیڈ ٹیسٹ (CPS)","id":"Tes Kecepatan Klik (CPS)","de":"Klickgeschwindigkeitstest (CPS)","ja":"クリックスピードテスト（CPS）","ko":"클릭 속도 테스트 (CPS)"}},"final-grade-calc":{"cat":"life","emoji":"📝","names":{"en":"Final Grade Calculator","zh":"期末成绩计算器","hi":"फाइनल ग्रेड कैलकुलेटर","es":"Calculadora de nota final","ar":"حاسبة الدرجة النهائية","fr":"Calculateur de note finale","bn":"ফাইনাল গ্রেড ক্যালকুলেটর","pt":"Calculadora de nota final","ru":"Калькулятор итоговой оценки","ur":"فائنل گریڈ کیلکولیٹر","id":"Kalkulator Nilai Akhir","de":"Abschlussnoten-Rechner","ja":"期末成績計算機","ko":"기말고사 성적 계산기"}},"fuel-cost-calc":{"cat":"life","emoji":"⛽","names":{"en":"Fuel Cost Calculator","zh":"燃油费用计算器","hi":"ईंधन लागत कैलकुलेटर","es":"Calculadora de costo de combustible","ar":"حاسبة تكلفة الوقود","fr":"Calculateur de coût de carburant","bn":"জ্বালানি খরচ ক্যালকুলেটর","pt":"Calculadora de custo de combustível","ru":"Калькулятор расходов на топливо","ur":"ایندھن لاگت کیلکولیٹر","id":"Kalkulator Biaya Bahan Bakar","de":"Spritkosten-Rechner","ja":"ガソリン代計算機","ko":"유류비 계산기"}},"gpa-calc":{"cat":"life","emoji":"🎓","names":{"en":"GPA Calculator","zh":"GPA 计算器","hi":"GPA कैलकुलेटर","es":"Calculadora de GPA","ar":"حاسبة المعدل التراكمي GPA","fr":"Calculateur de GPA","bn":"GPA ক্যালকুলেটর","pt":"Calculadora de GPA","ru":"Калькулятор GPA","ur":"GPA کیلکولیٹر","id":"Kalkulator GPA","de":"GPA-Rechner","ja":"GPA計算機","ko":"GPA 계산기 (학점 계산기)"}},"grade-calc":{"cat":"life","emoji":"🎓","names":{"en":"Grade Calculator","zh":"成绩计算器","hi":"ग्रेड कैलकुलेटर","es":"Calculadora de Notas","ar":"حاسبة الدرجات","fr":"Calculatrice de Notes","bn":"গ্রেড ক্যালকুলেটর","pt":"Calculadora de Notas","ru":"Калькулятор Оценок","ur":"گریڈ کیلکولیٹر","id":"Kalkulator Nilai","de":"Notenrechner","ja":"成績計算機","ko":"성적 계산기"}},"online-notepad":{"cat":"life","emoji":"🗒️","names":{"en":"Online Notepad","zh":"在线记事本","hi":"ऑनलाइन नोटपैड","es":"Bloc de Notas Online","ar":"مفكرة أونلاين","fr":"Bloc-Notes en Ligne","bn":"অনলাইন নোটপ্যাড","pt":"Bloco de Notas Online","ru":"Онлайн-блокнот","ur":"آن لائن نوٹ پیڈ","id":"Notepad Online","de":"Online-Notizblock","ja":"オンラインメモ帳","ko":"온라인 메모장"}},"sleep-cycle-calc":{"cat":"life","emoji":"😴","names":{"en":"Sleep Cycle Calculator","zh":"睡眠周期计算器","hi":"स्लीप साइकिल कैलकुलेटर","es":"Calculadora de ciclos de sueño","ar":"حاسبة دورات النوم","fr":"Calculateur de cycles de sommeil","bn":"স্লিপ সাইকেল ক্যালকুলেটর","pt":"Calculadora de ciclos de sono","ru":"Калькулятор циклов сна","ur":"سلیپ سائیکل کیلکولیٹر","id":"Kalkulator Siklus Tidur","de":"Schlafzyklus-Rechner","ja":"睡眠サイクル計算機","ko":"수면 사이클 계산기"}},"typing-test":{"cat":"life","emoji":"⌨️","names":{"en":"Typing Speed Test","zh":"打字速度测试","hi":"टाइपिंग स्पीड टेस्ट","es":"Test de Velocidad de Escritura","ar":"اختبار سرعة الكتابة","fr":"Test de Vitesse de Frappe","bn":"টাইপিং স্পিড টেস্ট","pt":"Teste de Velocidade de Digitação","ru":"Тест скорости печати","ur":"ٹائپنگ اسپیڈ ٹیسٹ","id":"Tes Kecepatan Mengetik","de":"Tippgeschwindigkeitstest","ja":"タイピング速度テスト","ko":"타자 속도 테스트"}}};
  var HEADING = {"en":"Related tools","ko":"관련 도구","ja":"関連ツール","zh":"相关工具","es":"Herramientas relacionadas","fr":"Outils similaires","de":"Ähnliche Tools","pt":"Ferramentas relacionadas","ru":"Похожие инструменты","ar":"أدوات ذات صلة","hi":"संबंधित टूल","bn":"সম্পর্কিত টুল","id":"Alat terkait","ur":"متعلقہ ٹولز"};
  var cfg = window.APP_CONFIG || {};
  var slug = cfg.slug, host = document.getElementById("related-tools");
  if (!host || !slug || !CATALOG[slug]) { if(host) host.hidden = true; return; }
  var cat = CATALOG[slug].cat;
  var ring = Object.keys(CATALOG).filter(function(s){ return CATALOG[s].cat === cat; }).sort();
  var at = ring.indexOf(slug);
  var sibs = [];
  for (var i = 1; i <= ring.length - 1 && sibs.length < 4; i++) sibs.push(ring[(at + i) % ring.length]);
  if (!sibs.length) { host.hidden = true; return; }
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