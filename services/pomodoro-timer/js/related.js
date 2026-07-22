(function(){
  "use strict";
  var CATALOG = {"age-calc":{"cat":"date","emoji":"🎂","names":{"en":"Age Calculator","zh":"年龄计算器","hi":"आयु कैलकुलेटर","es":"Calculadora de edad","ar":"حاسبة العمر","fr":"Calculateur d'âge","bn":"বয়স ক্যালকুলেটর","pt":"Calculadora de idade","ru":"Калькулятор возраста","ur":"عمر کیلکولیٹر","id":"Kalkulator Usia","de":"Altersrechner","ja":"年齢計算","ko":"나이 계산기"}},"countdown-timer":{"cat":"date","emoji":"⏲️","names":{"en":"Countdown Timer","zh":"倒计时器","hi":"काउंटडाउन टाइमर","es":"Temporizador online","ar":"مؤقت تنازلي","fr":"Minuteur en ligne","bn":"কাউন্টডাউন টাইমার","pt":"Timer online","ru":"Таймер обратного отсчёта","ur":"کاؤنٹ ڈاؤن ٹائمر","id":"Timer Hitung Mundur","de":"Countdown-Timer","ja":"カウントダウンタイマー","ko":"카운트다운 타이머"}},"date-diff-calc":{"cat":"date","emoji":"🗓️","names":{"en":"Date Difference Calculator","zh":"日期差计算器","hi":"तारीख अंतर कैलकुलेटर","es":"Calculadora de diferencia de fechas","ar":"حاسبة الفرق بين تاريخين","fr":"Calculateur d'écart entre deux dates","bn":"তারিখ পার্থক্য ক্যালকুলেটর","pt":"Calculadora de diferença entre datas","ru":"Калькулятор разницы дат","ur":"تاریخ کا فرق کیلکولیٹر","id":"Kalkulator Selisih Tanggal","de":"Datumsdifferenz-Rechner","ja":"日付差計算機","ko":"날짜 차이 계산기"}},"dday-calc":{"cat":"date","emoji":"📅","names":{"en":"D-Day Counter","zh":"倒数日计算器","hi":"डी-डे काउंटर","es":"Contador de días (D-Day)","ar":"عدّاد الأيام","fr":"Compteur de jours (D-Day)","bn":"ডি-ডে কাউন্টার","pt":"Contador de dias (D-Day)","ru":"Счётчик дней (D-Day)","ur":"ڈی-ڈے کاؤنٹر","id":"Penghitung D-Day","de":"D-Day-Zähler","ja":"D-day計算","ko":"디데이 계산기"}},"hours-calc":{"cat":"date","emoji":"🕗","names":{"en":"Hours Calculator","zh":"工时计算器","hi":"ऑवर्स कैलकुलेटर","es":"Calculadora de horas","ar":"حاسبة الساعات","fr":"Calculateur d'heures","bn":"আওয়ার্স ক্যালকুলেটর","pt":"Calculadora de horas","ru":"Калькулятор часов","ur":"آورز کیلکولیٹر","id":"Kalkulator Jam","de":"Stundenrechner","ja":"時間計算機","ko":"근무시간 계산기"}},"pomodoro-timer":{"cat":"date","emoji":"🍅","names":{"en":"Pomodoro Timer","zh":"番茄钟计时器","hi":"पोमोडोरो टाइमर","es":"Temporizador Pomodoro","ar":"مؤقت بومودورو","fr":"Minuteur Pomodoro","bn":"পোমোডোরো টাইমার","pt":"Timer Pomodoro","ru":"Помодоро-таймер","ur":"پومودورو ٹائمر","id":"Timer Pomodoro","de":"Pomodoro-Timer","ja":"ポモドーロタイマー","ko":"뽀모도로 타이머"}},"stopwatch":{"cat":"date","emoji":"⏱️","names":{"en":"Online Stopwatch","zh":"在线秒表","hi":"ऑनलाइन स्टॉपवॉच","es":"Cronómetro online","ar":"ساعة إيقاف أونلاين","fr":"Chronomètre en ligne","bn":"অনলাইন স্টপওয়াচ","pt":"Cronômetro online","ru":"Секундомер онлайн","ur":"آن لائن اسٹاپ واچ","id":"Stopwatch Online","de":"Online-Stoppuhr","ja":"オンラインストップウォッチ","ko":"온라인 스톱워치"}},"time-zone-conv":{"cat":"date","emoji":"🕐","names":{"en":"Time Zone Converter","zh":"时区转换器","hi":"टाइम ज़ोन कन्वर्टर","es":"Conversor de zonas horarias","ar":"محوّل المناطق الزمنية","fr":"Convertisseur de fuseaux horaires","bn":"টাইম জোন কনভার্টার","pt":"Conversor de fuso horário","ru":"Конвертер часовых поясов","ur":"ٹائم زون کنورٹر","id":"Konverter zona waktu","de":"Zeitzonen-Umrechner","ja":"タイムゾーン変換","ko":"시간대 변환기"}},"workday-calc":{"cat":"date","emoji":"💼","names":{"en":"Business Days Calculator","zh":"工作日计算器","hi":"कार्यदिवस कैलकुलेटर","es":"Calculadora de días hábiles","ar":"حاسبة أيام العمل","fr":"Calculateur de jours ouvrés","bn":"কর্মদিবস ক্যালকুলেটর","pt":"Calculadora de dias úteis","ru":"Калькулятор рабочих дней","ur":"کاروباری ایام کیلکولیٹر","id":"Kalkulator Hari Kerja","de":"Arbeitstage-Rechner","ja":"営業日計算機","ko":"근무일 계산기"}},"world-clock":{"cat":"date","emoji":"🌍","names":{"en":"World Clock","zh":"世界时钟","hi":"वर्ल्ड क्लॉक","es":"Reloj mundial","ar":"الساعة العالمية","fr":"Horloge mondiale","bn":"ওয়ার্ল্ড ক্লক","pt":"Relógio mundial","ru":"Мировые часы","ur":"ورلڈ کلاک","id":"Jam dunia","de":"Weltuhr","ja":"世界時計","ko":"세계 시계"}}};
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