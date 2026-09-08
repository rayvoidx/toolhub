(function(){
  "use strict";
  var CATALOG = {"vehicle-log-agg":{"cat":"utility","emoji":"🚗","names":{"en":"Company Vehicle Log Aggregator (Korea)","zh":"韩国公务用车行驶记录汇总器","hi":"कंपनी वाहन लॉग एग्रीगेटर (कोरिया)","es":"Agregador de libros de registro de vehículos","ar":"مُجمِّع سجلات مركبات الشركة (كوريا)","fr":"Agrégateur de carnets de bord de véhicules d","bn":"কোম্পানি গাড়ির লগ সমষ্টিকারক (কোরিয়া)","pt":"Agregador de livros de registro de veículos","ru":"Агрегатор путевых журналов служебных автомоб","ur":"کمپنی وہیکل لاگ ایگریگیٹر (کوریا)","id":"Agregator Buku Catatan Perjalanan Kendaraan","de":"Fahrtenbuch-Auswertung für Firmenwagen (Kore","ja":"社用車 運行記録簿 集計ツール（韓国）","ko":"업무용승용차 운행기록부 집계기"}},"wbs-progress-rollup":{"cat":"utility","emoji":"📋","names":{"en":"WBS Weighted Progress & EVM Rollup","zh":"WBS 加权进度与挣值(EVM)汇总","hi":"WBS भारित प्रगति और EVM रोलअप","es":"Avance ponderado de la EDT y resumen EVM","ar":"التقدم الموزون لهيكل تجزئة العمل (WBS) وتجمي","fr":"Avancement pondéré du WBS et consolidation E","bn":"WBS ভারযুক্ত অগ্রগতি ও EVM রোলআপ","pt":"Progresso ponderado da EAP e consolidação EV","ru":"Взвешенный прогресс по СДР и сводка EVM","ur":"WBS وزنی پیش رفت اور EVM رول اپ","id":"Progres Berbobot WBS & Rekap EVM","de":"PSP-Fortschritt gewichtet & EVM-Rollup","ja":"WBS 加重進捗率・EVM 集計ツール","ko":"WBS 가중 진척률"}},"workback-schedule":{"cat":"utility","emoji":"🗓️","names":{"en":"Workback Schedule Builder","zh":"倒排计划生成器","hi":"वर्कबैक शेड्यूल बिल्डर","es":"Generador de cronograma inverso","ar":"أداة إنشاء الجدول العكسي","fr":"Générateur de rétroplanning","bn":"ওয়ার্কব্যাক শিডিউল বিল্ডার","pt":"Gerador de cronograma reverso","ru":"Конструктор обратного графика","ur":"ورک بیک شیڈول بلڈر","id":"Pembuat Jadwal Mundur","de":"Rückwärtsterminierung erstellen","ja":"逆算スケジュール作成ツール","ko":"역산 스케줄 빌더"}},"average-calc":{"cat":"utility","emoji":"📊","names":{"en":"Average Calculator","zh":"平均值计算器","hi":"औसत कैलकुलेटर","es":"Calculadora de promedio","ar":"حاسبة المتوسط","fr":"Calculateur de moyenne","bn":"গড় ক্যালকুলেটর","pt":"Calculadora de média","ru":"Калькулятор среднего значения","ur":"اوسط کیلکولیٹر","id":"Kalkulator Rata-rata","de":"Durchschnittsrechner","ja":"平均計算機","ko":"평균 계산기"}}};
  var SIBS = ["vehicle-log-agg","wbs-progress-rollup","workback-schedule","average-calc"];
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
