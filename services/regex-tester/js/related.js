(function(){
  "use strict";
  var CATALOG = {"base64-conv":{"cat":"dev","emoji":"🔡","names":{"en":"Base64 Encoder / Decoder","zh":"Base64 编码/解码器","hi":"Base64 एन्कोडर / डिकोडर","es":"Codificador / Decodificador Base64","ar":"مُرمِّز / فاكّ ترميز Base64","fr":"Encodeur / Décodeur Base64","bn":"Base64 এনকোডার / ডিকোডার","pt":"Codificador / Decodificador Base64","ru":"Base64 кодировщик / декодировщик","ur":"Base64 اینکوڈر / ڈیکوڈر","id":"Encoder / Decoder Base64","de":"Base64-Encoder / -Decoder","ja":"Base64 エンコーダー / デコーダー","ko":"Base64 인코더 / 디코더"}},"color-picker":{"cat":"dev","emoji":"🎨","names":{"en":"Color Picker & Converter","zh":"拾色器与颜色转换器","hi":"कलर पिकर और कन्वर्टर","es":"Selector y conversor de color","ar":"منتقي الألوان والمحوّل","fr":"Sélecteur et convertisseur de couleur","bn":"কালার পিকার ও কনভার্টার","pt":"Seletor e conversor de cor","ru":"Палитра и конвертер цвета","ur":"کلر پکر اور کنورٹر","id":"Pemilih & Konverter Warna","de":"Farbwähler & -konverter","ja":"カラーピッカー＆変換","ko":"컬러 피커 & 변환기"}},"hash-gen":{"cat":"dev","emoji":"#️⃣","names":{"en":"Hash Generator","zh":"哈希生成器","hi":"हैश जनरेटर","es":"Generador de hash","ar":"مولّد التجزئة","fr":"Générateur de hachage","bn":"হ্যাশ জেনারেটর","pt":"Gerador de hash","ru":"Генератор хешей","ur":"ہیش جنریٹر","id":"Generator Hash","de":"Hash-Generator","ja":"ハッシュ生成ツール","ko":"해시 생성기"}},"json-formatter":{"cat":"dev","emoji":"⚙️","names":{"en":"JSON Formatter","zh":"JSON 格式化工具","hi":"JSON फ़ॉर्मैटर","es":"Formateador JSON","ar":"منسّق JSON","fr":"Formateur JSON","bn":"JSON ফরম্যাটার","pt":"Formatador JSON","ru":"Форматтер JSON","ur":"JSON فارمیٹر","id":"Pemformat JSON","de":"JSON-Formatter","ja":"JSONフォーマッター","ko":"JSON 포매터"}},"regex-tester":{"cat":"dev","emoji":"🧪","names":{"en":"Regex Tester","zh":"正则表达式测试工具","hi":"रेगेक्स टेस्टर","es":"Probador de Regex","ar":"أداة اختبار Regex","fr":"Testeur de Regex","bn":"রেজেক্স টেস্টার","pt":"Testador de Regex","ru":"Тестер регулярных выражений","ur":"ریجیکس ٹیسٹر","id":"Penguji Regex","de":"Regex-Tester","ja":"正規表現テスター","ko":"정규식 테스터"}},"unix-timestamp-conv":{"cat":"dev","emoji":"🕐","names":{"en":"Unix Timestamp Converter","zh":"Unix时间戳转换器","hi":"यूनिक्स टाइमस्टैम्प कनवर्टर","es":"Conversor de Timestamp Unix","ar":"محول الطابع الزمني يونكس","fr":"Convertisseur de timestamp Unix","bn":"ইউনিক্স টাইমস্ট্যাম্প কনভার্টার","pt":"Conversor de Timestamp Unix","ru":"Конвертер Unix-времени","ur":"یونکس ٹائم اسٹیمپ کنورٹر","id":"Konverter Timestamp Unix","de":"Unix-Timestamp-Konverter","ja":"Unixタイムスタンプ変換","ko":"유닉스 타임스탬프 변환기"}},"url-encoder":{"cat":"dev","emoji":"🔗","names":{"en":"URL Encoder / Decoder","zh":"URL 编码/解码器","hi":"URL एन्कोडर / डिकोडर","es":"Codificador / Decodificador de URL","ar":"مُرمِّز / مُفكِّك ترميز URL","fr":"Encodeur / Décodeur d'URL","bn":"URL এনকোডার / ডিকোডার","pt":"Codificador / Decodificador de URL","ru":"URL-кодировщик / декодировщик","ur":"URL اینکوڈر / ڈی کوڈر","id":"Encoder / Decoder URL","de":"URL-Encoder / -Decoder","ja":"URL エンコーダー / デコーダー","ko":"URL 인코더 / 디코더"}},"uuid-gen":{"cat":"dev","emoji":"🆔","names":{"en":"UUID Generator","zh":"UUID 生成器","hi":"UUID जनरेटर","es":"Generador de UUID","ar":"مولّد UUID","fr":"Générateur d'UUID","bn":"UUID জেনারেটর","pt":"Gerador de UUID","ru":"Генератор UUID","ur":"UUID جنریٹر","id":"Generator UUID","de":"UUID-Generator","ja":"UUIDジェネレーター","ko":"UUID 생성기"}}};
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