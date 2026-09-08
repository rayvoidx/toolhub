(function(){
  "use strict";
  var CATALOG = {"whitespace-remover":{"cat":"text","emoji":"✂️","names":{"en":"Extra Space Remover","zh":"多余空格删除工具","hi":"एक्स्ट्रा स्पेस रिमूवर","es":"Eliminador de Espacios Extra","ar":"أداة إزالة المسافات الزائدة","fr":"Suppresseur d'Espaces Superflus","bn":"এক্সট্রা স্পেস রিমুভার","pt":"Removedor de Espaços Extras","ru":"Удаление Лишних Пробелов","ur":"اضافی اسپیس ریمووَر","id":"Penghapus Spasi Berlebih","de":"Leerzeichen-Entferner","ja":"余分なスペース削除ツール","ko":"여백 제거 도구"}},"word-counter":{"cat":"text","emoji":"📝","names":{"en":"Word Counter","zh":"字数统计","hi":"वर्ड काउंटर","es":"Contador de palabras","ar":"عدّاد الكلمات","fr":"Compteur de mots","bn":"শব্দ গণনা","pt":"Contador de palavras","ru":"Счётчик слов","ur":"ورڈ کاؤنٹر","id":"Penghitung Kata","de":"Wortzähler","ja":"単語カウンター","ko":"단어수 세기"}},"word-frequency-counter":{"cat":"text","emoji":"📊","names":{"en":"Word Frequency Counter","zh":"词频统计工具","hi":"वर्ड फ़्रीक्वेंसी काउंटर","es":"Contador de frecuencia de palabras y densida","ar":"عدّاد تكرار الكلمات","fr":"Compteur de fréquence des mots et densité","bn":"শব্দ ফ্রিকোয়েন্সি কাউন্টার","pt":"Contador de frequência de palavras e densida","ru":"Частотный анализ слов","ur":"ورڈ فریکوئنسی کاؤنٹر","id":"Penghitung Frekuensi Kata","de":"Worthäufigkeit zählen","ja":"単語出現回数カウンター","ko":"단어 빈도 계산기"}},"words-to-pages":{"cat":"text","emoji":"📄","names":{"en":"Words to Pages Converter","zh":"字数转页数计算器","hi":"वर्ड्स टू पेजेस","es":"Convertidor de palabras a páginas","ar":"تحويل عدد الكلمات إلى صفحات","fr":"Convertisseur mots en pages","bn":"শব্দ থেকে পৃষ্ঠা কনভার্টার","pt":"Conversor de palavras em páginas","ru":"Слова в страницы","ur":"الفاظ سے صفحات کیلکولیٹر","id":"Konverter Kata ke Halaman","de":"Wörter in Seiten umrechnen","ja":"文字数・単語数からページ数を計算","ko":"단어 수 페이지 변환기"}}};
  var SIBS = ["whitespace-remover","word-counter","word-frequency-counter","words-to-pages"];
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
