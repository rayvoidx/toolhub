(function(){
  "use strict";
  var CATALOG = {"hours-calc":{"cat":"date","emoji":"🕗","names":{"en":"Hours Calculator","zh":"工时计算器","hi":"ऑवर्स कैलकुलेटर","es":"Calculadora de horas","ar":"حاسبة الساعات","fr":"Calculateur d'heures","bn":"আওয়ার্স ক্যালকুলেটর","pt":"Calculadora de horas","ru":"Калькулятор часов","ur":"آورز کیلکولیٹر","id":"Kalkulator Jam","de":"Stundenrechner","ja":"時間計算機","ko":"근무시간 계산기"}},"leap-year-checker":{"cat":"date","emoji":"📅","names":{"en":"Leap Year Checker","zh":"闰年计算器","hi":"लीप वर्ष जांचक","es":"Comprobador de Años Bisiestos","ar":"فاحص السنة الكبيسة","fr":"Vérificateur d'Année Bissextile","bn":"অধিবর্ষ যাচাইকারী","pt":"Verificador de Ano Bissexto","ru":"Калькулятор високосного года","ur":"لیپ ایئر چیکر","id":"Pengecek Tahun Kabisat","de":"Schaltjahr-Rechner","ja":"うるう年チェッカー","ko":"윤년 계산기"}},"military-time-conv":{"cat":"date","emoji":"🎖️","names":{"en":"Military Time Converter","zh":"24小时制转换器","hi":"मिलिट्री टाइम कन्वर्टर","es":"Conversor de Hora Militar","ar":"محول الوقت العسكري","fr":"Convertisseur d'Heure Militaire","bn":"মিলিটারি টাইম কনভার্টার","pt":"Conversor de Hora Militar","ru":"Конвертер военного времени","ur":"ملٹری ٹائم کنورٹر","id":"Konverter Waktu Militer","de":"Militärzeit-Umrechner","ja":"ミリタリータイム変換ツール","ko":"군대시간 변환기"}},"moon-phase-calc":{"cat":"date","emoji":"🌙","names":{"en":"Moon Phase Calculator","zh":"月相计算器","hi":"मून फेज़ कैलकुलेटर","es":"Calculadora de Fases Lunares","ar":"حاسبة أطوار القمر","fr":"Calculateur de Phases Lunaires","bn":"চাঁদের দশা ক্যালকুলেটর","pt":"Calculadora de Fases da Lua","ru":"Калькулятор фаз Луны","ur":"قمری منازل کیلکولیٹر","id":"Kalkulator Fase Bulan","de":"Mondphasen-Rechner","ja":"月齢計算機","ko":"달의 위상 계산기"}}};
  var SIBS = ["hours-calc","leap-year-checker","military-time-conv","moon-phase-calc"];
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
