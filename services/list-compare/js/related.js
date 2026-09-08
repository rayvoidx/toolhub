(function(){
  "use strict";
  var CATALOG = {"lorem-ipsum-gen":{"cat":"text","emoji":"📄","names":{"en":"Lorem Ipsum Generator","zh":"Lorem Ipsum 生成器","hi":"Lorem Ipsum जनरेटर","es":"Generador de Lorem Ipsum","ar":"مولّد Lorem Ipsum","fr":"Générateur de Lorem Ipsum","bn":"Lorem Ipsum জেনারেটর","pt":"Gerador de Lorem Ipsum","ru":"Генератор Lorem Ipsum","ur":"Lorem Ipsum جنریٹر","id":"Generator Lorem Ipsum","de":"Lorem-Ipsum-Generator","ja":"Lorem Ipsum ジェネレーター","ko":"로렘 입숨 생성기"}},"morse-code-translator":{"cat":"text","emoji":"📡","names":{"en":"Morse Code Translator","zh":"摩尔斯电码翻译器","hi":"मोर्स कोड ट्रांसलेटर","es":"Traductor de Código Morse","ar":"مترجم شفرة مورس","fr":"Traducteur de Code Morse","bn":"মোর্স কোড ট্রান্সলেটর","pt":"Tradutor de Código Morse","ru":"Переводчик азбуки Морзе","ur":"مورس کوڈ ٹرانسلیٹر","id":"Penerjemah Kode Morse","de":"Morsecode-Übersetzer","ja":"モールス信号翻訳ツール","ko":"모스부호 변환기"}},"number-to-words":{"cat":"text","emoji":"✍️","names":{"en":"Number to Words Converter","zh":"数字转英文单词","hi":"नंबर टू वर्ड्स","es":"Convertir números a palabras en inglés","ar":"تحويل الأرقام إلى كلمات إنجليزية","fr":"Nombre en lettres anglaises","bn":"সংখ্যা থেকে ইংরেজি শব্দ","pt":"Número por extenso em inglês","ru":"Число прописью по-английски","ur":"نمبر ٹو ورڈز","id":"Angka ke Kata Bahasa Inggris","de":"Zahlen in englische Wörter","ja":"数字を英語に変換","ko":"숫자 영어 변환기"}},"random-word-gen":{"cat":"text","emoji":"🎲","names":{"en":"Random Word Generator","zh":"随机单词生成器","hi":"रैंडम वर्ड जनरेटर","es":"Generador de Palabras Aleatorias","ar":"مولّد الكلمات العشوائية","fr":"Générateur de Mots Aléatoires","bn":"র‍্যান্ডম ওয়ার্ড জেনারেটর","pt":"Gerador de Palavras Aleatórias","ru":"Генератор случайных слов","ur":"رینڈم ورڈ جنریٹر","id":"Generator Kata Acak","de":"Zufallswortgenerator","ja":"ランダム単語ジェネレーター","ko":"랜덤 단어 생성기"}}};
  var SIBS = ["lorem-ipsum-gen","morse-code-translator","number-to-words","random-word-gen"];
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
