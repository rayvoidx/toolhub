(function(){
  "use strict";
  var CATALOG = {"z-score-calc":{"cat":"science","emoji":"📈","names":{"en":"Z-Score Calculator","zh":"Z分数计算器","hi":"Z-स्कोर कैलकुलेटर","es":"Calculadora de puntuación Z","ar":"حاسبة الدرجة المعيارية Z","fr":"Calculateur de score Z","bn":"Z-স্কোর ক্যালকুলেটর","pt":"Calculadora de escore Z","ru":"Калькулятор Z-оценки","ur":"Z اسکور کیلکولیٹر","id":"Kalkulator Z-Score","de":"Z-Wert-Rechner","ja":"Z値計算ツール","ko":"Z점수 계산기"}},"attendance-calc":{"cat":"science","emoji":"🎓","names":{"en":"Attendance Percentage Calculator","zh":"出勤率计算器","hi":"अटेंडेंस कैलकुलेटर","es":"Calculadora de asistencia","ar":"حاسبة نسبة الحضور","fr":"Calculateur de présence","bn":"উপস্থিতি ক্যালকুলেটর","pt":"Calculadora de frequência","ru":"Калькулятор посещаемости","ur":"حاضری کیلکولیٹر","id":"Kalkulator Kehadiran","de":"Anwesenheitsrechner","ja":"出席率計算ツール","ko":"출석률 계산기"}},"cgpa-to-percentage":{"cat":"science","emoji":"🎯","names":{"en":"CGPA to Percentage Calculator","zh":"CGPA 转百分比计算器","hi":"CGPA को प्रतिशत में बदलें","es":"Calculadora de CGPA a porcentaje","ar":"تحويل CGPA إلى نسبة مئوية","fr":"Convertisseur CGPA en pourcentage","bn":"CGPA থেকে শতাংশ ক্যালকুলেটর","pt":"Conversor de CGPA para porcentagem","ru":"Перевод CGPA в проценты","ur":"CGPA کو فیصد میں بدلیں","id":"Kalkulator CGPA ke Persen","de":"CGPA in Prozent umrechnen","ja":"CGPAをパーセントに変換","ko":"CGPA 백분율 변환기"}},"density-calc":{"cat":"science","emoji":"🧊","names":{"en":"Density Calculator","zh":"密度计算器","hi":"डेंसिटी कैलकुलेटर","es":"Calculadora de densidad","ar":"حاسبة الكثافة","fr":"Calculateur de masse volumique","bn":"ঘনত্ব ক্যালকুলেটর","pt":"Calculadora de densidade","ru":"Калькулятор плотности","ur":"کثافت کیلکولیٹر","id":"Kalkulator Densitas","de":"Dichte-Rechner","ja":"密度計算ツール","ko":"밀도 계산기"}}};
  var SIBS = ["z-score-calc","attendance-calc","cgpa-to-percentage","density-calc"];
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
