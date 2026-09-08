(function(){
  "use strict";
  var CATALOG = {"text-diff":{"cat":"text","emoji":"🔍","names":{"en":"Text Diff Checker","zh":"文本对比工具","hi":"टेक्स्ट डिफ चेकर","es":"Comparador de Textos","ar":"أداة مقارنة النصوص","fr":"Comparateur de Textes","bn":"টেক্সট ডিফ চেকার","pt":"Comparador de Textos","ru":"Сравнение текстов","ur":"ٹیکسٹ ڈف چیکر","id":"Pemeriksa Perbedaan Teks","de":"Text-Diff-Prüfer","ja":"テキスト差分チェッカー","ko":"텍스트 비교기"}},"text-to-speech":{"cat":"text","emoji":"🔊","names":{"en":"Text to Speech","zh":"文本转语音","hi":"टेक्स्ट टू स्पीच","es":"Texto a Voz","ar":"تحويل النص إلى كلام","fr":"Synthèse vocale","bn":"টেক্সট টু স্পিচ","pt":"Texto para Voz","ru":"Синтез речи","ur":"ٹیکسٹ ٹو اسپیچ","id":"Teks ke Suara","de":"Text zu Sprache","ja":"テキスト読み上げ","ko":"텍스트 음성 변환"}},"upside-down-text":{"cat":"text","emoji":"🙃","names":{"en":"Upside Down Text Generator","zh":"文字倒转生成器","hi":"अपसाइड डाउन टेक्स्ट जनरेटर","es":"Generador de Texto al Revés","ar":"مولّد النص المقلوب","fr":"Générateur de Texte à l'Envers","bn":"উল্টো টেক্সট জেনারেটর","pt":"Gerador de Texto Invertido","ru":"Генератор перевёрнутого текста","ur":"الٹا ٹیکسٹ جنریٹر","id":"Generator Teks Terbalik","de":"Text-auf-den-Kopf-Generator","ja":"さかさま文字ジェネレーター","ko":"거꾸로 텍스트 생성기"}},"whitespace-remover":{"cat":"text","emoji":"✂️","names":{"en":"Extra Space Remover","zh":"多余空格删除工具","hi":"एक्स्ट्रा स्पेस रिमूवर","es":"Eliminador de Espacios Extra","ar":"أداة إزالة المسافات الزائدة","fr":"Suppresseur d'Espaces Superflus","bn":"এক্সট্রা স্পেস রিমুভার","pt":"Removedor de Espaços Extras","ru":"Удаление Лишних Пробелов","ur":"اضافی اسپیس ریمووَر","id":"Penghapus Spasi Berlebih","de":"Leerzeichen-Entferner","ja":"余分なスペース削除ツール","ko":"여백 제거 도구"}}};
  var SIBS = ["text-diff","text-to-speech","upside-down-text","whitespace-remover"];
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
