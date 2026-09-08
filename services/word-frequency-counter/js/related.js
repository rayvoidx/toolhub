(function(){
  "use strict";
  var CATALOG = {"words-to-pages":{"cat":"text","emoji":"📄","names":{"en":"Words to Pages Converter","zh":"字数转页数计算器","hi":"वर्ड्स टू पेजेस","es":"Convertidor de palabras a páginas","ar":"تحويل عدد الكلمات إلى صفحات","fr":"Convertisseur mots en pages","bn":"শব্দ থেকে পৃষ্ঠা কনভার্টার","pt":"Conversor de palavras em páginas","ru":"Слова в страницы","ur":"الفاظ سے صفحات کیلکولیٹر","id":"Konverter Kata ke Halaman","de":"Wörter in Seiten umrechnen","ja":"文字数・単語数からページ数を計算","ko":"단어 수 페이지 변환기"}},"ad-copy-limit-check":{"cat":"text","emoji":"📣","names":{"en":"Ad Copy Length Checker","zh":"广告文案字数检查器","hi":"विज्ञापन कॉपी लंबाई चेकर","es":"Comprobador de longitud de anuncios","ar":"أداة فحص طول النص الإعلاني","fr":"Vérificateur de longueur d'annonces","bn":"বিজ্ঞাপন কপির দৈর্ঘ্য পরীক্ষক","pt":"Verificador de limite de caracteres de anúncios","ru":"Проверка длины рекламных текстов","ur":"اشتہاری متن کی لمبائی چیک کرنے والا","id":"Pemeriksa Panjang Teks Iklan","de":"Anzeigentext-Längenprüfer","ja":"広告文字数チェッカー","ko":"광고 문구 글자수 검사기"}},"binary-text-conv":{"cat":"text","emoji":"💻","names":{"en":"Binary Translator","zh":"二进制转换器","hi":"बाइनरी ट्रांसलेटर","es":"Traductor Binario","ar":"مترجم الثنائي","fr":"Traducteur binaire","bn":"বাইনারি ট্রান্সলেটর","pt":"Tradutor Binário","ru":"Бинарный переводчик","ur":"بائنری ٹرانسلیٹر","id":"Penerjemah Biner","de":"Binär-Übersetzer","ja":"バイナリ変換ツール","ko":"바이너리 변환기"}},"case-converter":{"cat":"text","emoji":"🔠","names":{"en":"Case Converter","zh":"大小写转换器","hi":"केस कन्वर्टर","es":"Conversor de mayúsculas y minúsculas","ar":"محوّل حالة الأحرف","fr":"Convertisseur de casse","bn":"কেস কনভার্টার","pt":"Conversor de maiúsculas e minúsculas","ru":"Конвертер регистра","ur":"کیس کنورٹر","id":"Konverter Huruf Besar-Kecil","de":"Groß-/Kleinschreibung-Konverter","ja":"大文字・小文字変換ツール","ko":"대소문자 변환기"}}};
  var SIBS = ["words-to-pages","ad-copy-limit-check","binary-text-conv","case-converter"];
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
