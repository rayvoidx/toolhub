(function(){
  "use strict";
  var CATALOG = {"roi-calc":{"cat":"finance","emoji":"📊","names":{"en":"ROI Calculator","zh":"ROI 计算器","hi":"ROI कैलकुलेटर","es":"Calculadora de ROI","ar":"حاسبة ROI","fr":"Calculateur de ROI","bn":"ROI ক্যালকুলেটর","pt":"Calculadora de ROI","ru":"Калькулятор ROI","ur":"ROI کیلکولیٹر","id":"Kalkulator ROI","de":"ROI-Rechner","ja":"ROI計算機","ko":"ROI 계산기"}},"rule-of-72-calc":{"cat":"finance","emoji":"✌️","names":{"en":"Rule of 72 Calculator","zh":"72法则计算器","hi":"रूल ऑफ 72 कैलकुलेटर","es":"Calculadora de la regla del 72","ar":"حاسبة قاعدة 72","fr":"Calculateur règle de 72","bn":"রুল অব ৭২ ক্যালকুলেটর","pt":"Calculadora da regra de 72","ru":"Правило 72","ur":"رول آف 72 کیلکولیٹر","id":"Kalkulator Rule of 72","de":"72er-Regel Rechner","ja":"72の法則 計算ツール","ko":"72 법칙 계산기"}},"salary-calc":{"cat":"finance","emoji":"💰","names":{"en":"Korean Salary Calculator","zh":"韩国年薪实得计算器","hi":"कोरियाई वेतन कैलकुलेटर","es":"Calculadora de salario (Corea)","ar":"حاسبة الراتب (كوريا)","fr":"Calculateur de salaire (Corée)","bn":"কোরীয় বেতন ক্যালকুলেটর","pt":"Calculadora salarial (Coreia)","ru":"Зарплатный калькулятор (Корея)","ur":"کوریائی تنخواہ کیلکولیٹر","id":"Kalkulator Gaji (Korea)","de":"Gehaltsrechner (Korea)","ja":"韓国の手取り計算","ko":"연봉 실수령액 계산기"}},"salary-hike-calc":{"cat":"finance","emoji":"📊","names":{"en":"Salary Hike Calculator","zh":"涨薪计算器","hi":"सैलरी हाइक कैलकुलेटर","es":"Calculadora de aumento salarial","ar":"حاسبة زيادة الراتب","fr":"Calculateur d'augmentation de salaire","bn":"স্যালারি হাইক ক্যালকুলেটর","pt":"Calculadora de aumento salarial","ru":"Калькулятор повышения зарплаты","ur":"تنخواہ اضافہ کیلکولیٹر","id":"Kalkulator Kenaikan Gaji","de":"Gehaltserhöhung-Rechner","ja":"昇給率計算ツール","ko":"연봉 인상률 계산기"}}};
  var SIBS = ["roi-calc","rule-of-72-calc","salary-calc","salary-hike-calc"];
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
