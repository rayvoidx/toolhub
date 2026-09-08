(function(){
  "use strict";
  var CATALOG = {"overtime-pay-calc":{"cat":"finance","emoji":"⏰","names":{"en":"Overtime Pay Calculator","zh":"加班费计算器","hi":"ओवरटाइम पे कैलकुलेटर","es":"Calculadora de horas extra","ar":"حاسبة أجر العمل الإضافي","fr":"Calculateur d'heures supplémentaires","bn":"ওভারটাইম বেতন ক্যালকুলেটর","pt":"Calculadora de hora extra","ru":"Калькулятор оплаты сверхурочных","ur":"اوور ٹائم تنخواہ کیلکولیٹر","id":"Kalkulator Upah Lembur","de":"Überstunden-Rechner","ja":"残業代計算ツール","ko":"초과근무 수당 계산기"}},"paycheck-calc":{"cat":"finance","emoji":"💵","names":{"en":"Paycheck Calculator","zh":"美国工资计算器","hi":"US पेचेक कैलकुलेटर","es":"Calculadora de sueldo neto en EE. UU. tras i","ar":"حاسبة الراتب الصافي في أمريكا بعد الضرائب","fr":"Calculateur de salaire net aux États-Unis ap","bn":"US পেচেক ক্যালকুলেটর","pt":"Calculadora de salário líquido nos EUA após","ru":"Калькулятор зарплаты в США","ur":"امریکی تنخواہ کیلکولیٹر","id":"Kalkulator Gaji Bersih AS","de":"US-Nettolohn-Rechner","ja":"米国給与手取り計算ツール","ko":"미국 실수령액 계산기"}},"percent-calc":{"cat":"finance","emoji":"％","names":{"en":"Percentage Calculator","zh":"百分比计算器","hi":"प्रतिशत कैलकुलेटर","es":"Calculadora de porcentajes","ar":"حاسبة النسبة المئوية","fr":"Calculateur de pourcentage","bn":"শতাংশ ক্যালকুলেটর","pt":"Calculadora de porcentagem","ru":"Калькулятор процентов","ur":"فیصد کیلکولیٹر","id":"Kalkulator Persen","de":"Prozentrechner","ja":"パーセント計算","ko":"퍼센트 계산기"}},"position-size-calc":{"cat":"finance","emoji":"🛡️","names":{"en":"Position Size Calculator","zh":"仓位计算器","hi":"पोज़िशन साइज़ कैलकुलेटर","es":"Calculadora de tamaño de posición","ar":"حاسبة حجم المركز","fr":"Calculateur de taille de position","bn":"পজিশন সাইজ ক্যালকুলেটর","pt":"Calculadora de tamanho de posição","ru":"Калькулятор размера позиции","ur":"پوزیشن سائز کیلکولیٹر","id":"Kalkulator Ukuran Posisi","de":"Positionsgrößen-Rechner","ja":"ポジションサイズ計算ツール","ko":"포지션 사이즈 계산기"}}};
  var SIBS = ["overtime-pay-calc","paycheck-calc","percent-calc","position-size-calc"];
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
