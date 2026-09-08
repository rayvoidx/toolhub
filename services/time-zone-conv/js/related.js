(function(){
  "use strict";
  var CATALOG = {"timesheet-calc":{"cat":"date","emoji":"🗂️","names":{"en":"Time Card Calculator","zh":"工时卡计算器","hi":"टाइम कार्ड कैलकुलेटर","es":"Calculadora de Tarjeta de Horario","ar":"حاسبة بطاقة الدوام","fr":"Calculateur de Fiche de Temps","bn":"টাইম কার্ড ক্যালকুলেটর","pt":"Calculadora de Cartão de Ponto","ru":"Калькулятор Табеля Учёта Времени","ur":"ٹائم کارڈ کیلکولیٹر","id":"Kalkulator Kartu Jam Kerja","de":"Stundenzettel-Rechner","ja":"タイムカード計算機","ko":"타임카드 계산기"}},"week-number-check":{"cat":"date","emoji":"📆","names":{"en":"Week Number Today","zh":"今日周数","hi":"आज का सप्ताह नंबर","es":"Número de Semana Hoy","ar":"رقم الأسبوع اليوم","fr":"Numéro de Semaine","bn":"আজকের সপ্তাহ নম্বর","pt":"Número da Semana Hoje","ru":"Номер недели сегодня","ur":"آج ہفتہ نمبر","id":"Nomor Minggu Hari Ini","de":"Kalenderwoche Heute","ja":"今週の週番号","ko":"오늘의 주차"}},"workday-calc":{"cat":"date","emoji":"💼","names":{"en":"Business Days Calculator","zh":"工作日计算器","hi":"कार्यदिवस कैलकुलेटर","es":"Calculadora de días hábiles","ar":"حاسبة أيام العمل","fr":"Calculateur de jours ouvrés","bn":"কর্মদিবস ক্যালকুলেটর","pt":"Calculadora de dias úteis","ru":"Калькулятор рабочих дней","ur":"کاروباری ایام کیلکولیٹر","id":"Kalkulator Hari Kerja","de":"Arbeitstage-Rechner","ja":"営業日計算機","ko":"근무일 계산기"}},"world-clock":{"cat":"date","emoji":"🌍","names":{"en":"World Clock","zh":"世界时钟","hi":"वर्ल्ड क्लॉक","es":"Reloj mundial","ar":"الساعة العالمية","fr":"Horloge mondiale","bn":"ওয়ার্ল্ড ক্লক","pt":"Relógio mundial","ru":"Мировые часы","ur":"ورلڈ کلاک","id":"Jam dunia","de":"Weltuhr","ja":"世界時計","ko":"세계 시계"}}};
  var SIBS = ["timesheet-calc","week-number-check","workday-calc","world-clock"];
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
