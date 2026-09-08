(function(){
  "use strict";
  var CATALOG = {"case-converter":{"cat":"text","emoji":"🔠","names":{"en":"Case Converter","zh":"大小写转换器","hi":"केस कन्वर्टर","es":"Conversor de mayúsculas y minúsculas","ar":"محوّل حالة الأحرف","fr":"Convertisseur de casse","bn":"কেস কনভার্টার","pt":"Conversor de maiúsculas e minúsculas","ru":"Конвертер регистра","ur":"کیس کنورٹر","id":"Konverter Huruf Besar-Kecil","de":"Groß-/Kleinschreibung-Konverter","ja":"大文字・小文字変換ツール","ko":"대소문자 변환기"}},"char-count":{"cat":"text","emoji":"字","names":{"en":"Character Counter","zh":"字数统计","hi":"कैरेक्टर काउंटर","es":"Contador de caracteres","ar":"عدّاد الأحرف","fr":"Compteur de caractères","bn":"অক্ষর গণনাকারী","pt":"Contador de caracteres","ru":"Счётчик символов","ur":"حروف شمار","id":"Penghitung Karakter","de":"Zeichenzähler","ja":"文字数カウント","ko":"글자수 세기"}},"csv-dedupe":{"cat":"text","emoji":"🧹","names":{"en":"CSV Duplicate Remover","zh":"CSV 去重工具","hi":"CSV डुप्लिकेट रिमूवर","es":"Eliminar duplicados de CSV","ar":"إزالة التكرارات من CSV","fr":"Suppression de doublons CSV","bn":"CSV ডুপ্লিকেট রিমুভার","pt":"Removedor de duplicados de CSV","ru":"Удаление дубликатов CSV","ur":"CSV ڈپلیکیٹ ریموور","id":"Penghapus Duplikat CSV","de":"CSV-Duplikate entfernen","ja":"CSV重複削除","ko":"CSV 중복 제거"}},"csv-diff":{"cat":"text","emoji":"📑","names":{"en":"Csv Diff","zh":"Csv Diff","hi":"Csv Diff","es":"Csv Diff","ar":"Csv Diff","fr":"Csv Diff","bn":"Csv Diff","pt":"Csv Diff","ru":"Csv Diff","ur":"Csv Diff","id":"Csv Diff","de":"Csv Diff","ja":"Csv Diff","ko":"Csv Diff"}}};
  var SIBS = ["case-converter","char-count","csv-dedupe","csv-diff"];
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
