(function(){
  "use strict";
  var CATALOG = {"dog-age-calc":{"cat":"life","emoji":"🐕","names":{"en":"Dog Age Calculator","zh":"狗狗年龄计算器","hi":"डॉग एज कैलकुलेटर","es":"Calculadora de edad canina","ar":"حاسبة عمر الكلب","fr":"Calculateur d'âge du chien","bn":"কুকুরের বয়স ক্যালকুলেটর","pt":"Calculadora de idade do cachorro","ru":"Калькулятор возраста собаки","ur":"کتے کی عمر کیلکولیٹر","id":"Kalkulator Usia Anjing","de":"Hundealter-Rechner","ja":"犬の年齢計算ツール","ko":"강아지 나이 계산기"}},"drywall-calc":{"cat":"life","emoji":"🛠️","names":{"en":"Drywall Calculator","zh":"石膏板计算器","hi":"ड्राईवॉल कैलकुलेटर","es":"Calculadora de pladur","ar":"حاسبة الجبس بورد","fr":"Calculateur placo","bn":"ড্রাইওয়াল ক্যালকুলেটর","pt":"Calculadora de drywall","ru":"Калькулятор гипсокартона","ur":"ڈرائی وال کیلکولیٹر","id":"Kalkulator Drywall","de":"Trockenbau-Rechner","ja":"石膏ボード計算ツール","ko":"석고보드 계산기"}},"ev-charging-calc":{"cat":"life","emoji":"🔋","names":{"en":"EV Charging Time Calculator","zh":"电动车充电时间计算器","hi":"ईवी चार्जिंग टाइम कैलकुलेटर","es":"Calculadora de tiempo de carga de coche eléc","ar":"حاسبة زمن شحن السيارة الكهربائية","fr":"Calculateur de temps de charge voiture élect","bn":"ইভি চার্জিং টাইম ক্যালকুলেটর","pt":"Calculadora de tempo de carga de carro elétr","ru":"Калькулятор времени зарядки электромобиля","ur":"ای وی چارجنگ ٹائم کیلکولیٹر","id":"Kalkulator Waktu Pengisian Mobil Listrik & B","de":"Ladezeit-Rechner E-Auto","ja":"EV充電時間計算ツール","ko":"전기차 충전 시간 계산기"}},"fence-calc":{"cat":"life","emoji":"🚧","names":{"en":"Fence Calculator","zh":"围栏计算器","hi":"फ़ेंस कैलकुलेटर","es":"Calculadora de vallas","ar":"حاسبة السياج","fr":"Calculateur de clôture","bn":"বেড়া ক্যালকুলেটর","pt":"Calculadora de cerca","ru":"Калькулятор забора","ur":"باڑ کیلکولیٹر","id":"Kalkulator Pagar","de":"Zaunrechner","ja":"フェンス計算ツール","ko":"울타리 계산기"}}};
  var SIBS = ["dog-age-calc","drywall-calc","ev-charging-calc","fence-calc"];
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
