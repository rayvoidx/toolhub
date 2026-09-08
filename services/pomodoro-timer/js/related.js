(function(){
  "use strict";
  var CATALOG = {"stopwatch":{"cat":"date","emoji":"⏱️","names":{"en":"Online Stopwatch","zh":"在线秒表","hi":"ऑनलाइन स्टॉपवॉच","es":"Cronómetro online","ar":"ساعة إيقاف أونلاين","fr":"Chronomètre en ligne","bn":"অনলাইন স্টপওয়াচ","pt":"Cronômetro online","ru":"Секундомер онлайн","ur":"آن لائن اسٹاپ واچ","id":"Stopwatch Online","de":"Online-Stoppuhr","ja":"オンラインストップウォッチ","ko":"온라인 스톱워치"}},"sunrise-sunset-calc":{"cat":"date","emoji":"🌅","names":{"en":"Sunrise Sunset Calculator","zh":"日出日落计算器","hi":"सूर्योदय सूर्यास्त कैलकुलेटर","es":"Calculadora de amanecer y atardecer","ar":"حاسبة شروق وغروب الشمس","fr":"Calculateur de lever et coucher du soleil","bn":"সূর্যোদয় সূর্যাস্ত ক্যালকুলেটর","pt":"Calculadora de nascer e pôr do sol","ru":"Калькулятор восхода и заката","ur":"طلوع و غروب آفتاب کیلکولیٹر","id":"Kalkulator Matahari Terbit Terbenam","de":"Sonnenaufgang-Sonnenuntergang-Rechner","ja":"日の出・日の入り計算ツール","ko":"일출 일몰 계산기"}},"time-zone-conv":{"cat":"date","emoji":"🕐","names":{"en":"Time Zone Converter","zh":"时区转换器","hi":"टाइम ज़ोन कन्वर्टर","es":"Conversor de zonas horarias","ar":"محوّل المناطق الزمنية","fr":"Convertisseur de fuseaux horaires","bn":"টাইম জোন কনভার্টার","pt":"Conversor de fuso horário","ru":"Конвертер часовых поясов","ur":"ٹائم زون کنورٹر","id":"Konverter zona waktu","de":"Zeitzonen-Umrechner","ja":"タイムゾーン変換","ko":"시간대 변환기"}},"timesheet-calc":{"cat":"date","emoji":"🗂️","names":{"en":"Time Card Calculator","zh":"工时卡计算器","hi":"टाइम कार्ड कैलकुलेटर","es":"Calculadora de Tarjeta de Horario","ar":"حاسبة بطاقة الدوام","fr":"Calculateur de Fiche de Temps","bn":"টাইম কার্ড ক্যালকুলেটর","pt":"Calculadora de Cartão de Ponto","ru":"Калькулятор Табеля Учёта Времени","ur":"ٹائم کارڈ کیلکولیٹر","id":"Kalkulator Kartu Jam Kerja","de":"Stundenzettel-Rechner","ja":"タイムカード計算機","ko":"타임카드 계산기"}}};
  var SIBS = ["stopwatch","sunrise-sunset-calc","time-zone-conv","timesheet-calc"];
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
