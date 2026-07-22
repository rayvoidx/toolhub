(function(){
  "use strict";
  var CATALOG = {"ad-copy-limit-check":{"cat":"text","emoji":"📣","names":{"en":"Ad Copy Length Checker","zh":"广告文案字数检查器","hi":"विज्ञापन कॉपी लंबाई चेकर","es":"Comprobador de longitud de anuncios","ar":"أداة فحص طول النص الإعلاني","fr":"Vérificateur de longueur d'annonces","bn":"বিজ্ঞাপন কপির দৈর্ঘ্য পরীক্ষক","pt":"Verificador de limite de caracteres de anúncios","ru":"Проверка длины рекламных текстов","ur":"اشتہاری متن کی لمبائی چیک کرنے والا","id":"Pemeriksa Panjang Teks Iklan","de":"Anzeigentext-Längenprüfer","ja":"広告文字数チェッカー","ko":"광고 문구 글자수 검사기"}},"case-converter":{"cat":"text","emoji":"🔠","names":{"en":"Case Converter","zh":"大小写转换器","hi":"केस कन्वर्टर","es":"Conversor de mayúsculas y minúsculas","ar":"محوّل حالة الأحرف","fr":"Convertisseur de casse","bn":"কেস কনভার্টার","pt":"Conversor de maiúsculas e minúsculas","ru":"Конвертер регистра","ur":"کیس کنورٹر","id":"Konverter Huruf Besar-Kecil","de":"Groß-/Kleinschreibung-Konverter","ja":"大文字・小文字変換ツール","ko":"대소문자 변환기"}},"char-count":{"cat":"text","emoji":"字","names":{"en":"Character Counter","zh":"字数统计","hi":"कैरेक्टर काउंटर","es":"Contador de caracteres","ar":"عدّاد الأحرف","fr":"Compteur de caractères","bn":"অক্ষর গণনাকারী","pt":"Contador de caracteres","ru":"Счётчик символов","ur":"حروف شمار","id":"Penghitung Karakter","de":"Zeichenzähler","ja":"文字数カウント","ko":"글자수 세기"}},"lorem-ipsum-gen":{"cat":"text","emoji":"📄","names":{"en":"Lorem Ipsum Generator","zh":"Lorem Ipsum 生成器","hi":"Lorem Ipsum जनरेटर","es":"Generador de Lorem Ipsum","ar":"مولّد Lorem Ipsum","fr":"Générateur de Lorem Ipsum","bn":"Lorem Ipsum জেনারেটর","pt":"Gerador de Lorem Ipsum","ru":"Генератор Lorem Ipsum","ur":"Lorem Ipsum جنریٹر","id":"Generator Lorem Ipsum","de":"Lorem-Ipsum-Generator","ja":"Lorem Ipsum ジェネレーター","ko":"로렘 입숨 생성기"}},"morse-code-translator":{"cat":"text","emoji":"📡","names":{"en":"Morse Code Translator","zh":"摩尔斯电码翻译器","hi":"मोर्स कोड ट्रांसलेटर","es":"Traductor de Código Morse","ar":"مترجم شفرة مورس","fr":"Traducteur de Code Morse","bn":"মোর্স কোড ট্রান্সলেটর","pt":"Tradutor de Código Morse","ru":"Переводчик азбуки Морзе","ur":"مورس کوڈ ٹرانسلیٹر","id":"Penerjemah Kode Morse","de":"Morsecode-Übersetzer","ja":"モールス信号翻訳ツール","ko":"모스부호 변환기"}},"text-diff":{"cat":"text","emoji":"🔍","names":{"en":"Text Diff Checker","zh":"文本对比工具","hi":"टेक्स्ट डिफ चेकर","es":"Comparador de Textos","ar":"أداة مقارنة النصوص","fr":"Comparateur de Textes","bn":"টেক্সট ডিফ চেকার","pt":"Comparador de Textos","ru":"Сравнение текстов","ur":"ٹیکسٹ ڈف چیکر","id":"Pemeriksa Perbedaan Teks","de":"Text-Diff-Prüfer","ja":"テキスト差分チェッカー","ko":"텍스트 비교기"}},"word-counter":{"cat":"text","emoji":"📝","names":{"en":"Word Counter","zh":"字数统计","hi":"वर्ड काउंटर","es":"Contador de palabras","ar":"عدّاد الكلمات","fr":"Compteur de mots","bn":"শব্দ গণনা","pt":"Contador de palavras","ru":"Счётчик слов","ur":"ورڈ کاؤنٹر","id":"Penghitung Kata","de":"Wortzähler","ja":"単語カウンター","ko":"단어수 세기"}}};
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