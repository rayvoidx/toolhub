(function(){
  "use strict";
  var CATALOG = {"average-calc":{"cat":"utility","emoji":"📊","names":{"en":"Average Calculator","zh":"平均值计算器","hi":"औसत कैलकुलेटर","es":"Calculadora de promedio","ar":"حاسبة المتوسط","fr":"Calculateur de moyenne","bn":"গড় ক্যালকুলেটর","pt":"Calculadora de média","ru":"Калькулятор среднего значения","ur":"اوسط کیلکولیٹر","id":"Kalkulator Rata-rata","de":"Durchschnittsrechner","ja":"平均計算機","ko":"평균 계산기"}},"calculator":{"cat":"utility","emoji":"🧮","names":{"en":"Scientific Calculator","zh":"科学计算器","hi":"वैज्ञानिक कैलकुलेटर","es":"Calculadora Científica","ar":"الآلة الحاسبة العلمية","fr":"Calculatrice Scientifique","bn":"বৈজ্ঞানিক ক্যালকুলেটর","pt":"Calculadora Científica","ru":"Научный калькулятор","ur":"سائنسی کیلکولیٹر","id":"Kalkulator Ilmiah","de":"Wissenschaftlicher Rechner","ja":"関数電卓","ko":"공학용 계산기"}},"fraction-calc":{"cat":"utility","emoji":"½","names":{"en":"Fraction Calculator","zh":"分数计算器","hi":"भिन्न कैलकुलेटर","es":"Calculadora de Fracciones","ar":"آلة حاسبة للكسور","fr":"Calculatrice de Fractions","bn":"ভগ্নাংশ ক্যালকুলেটর","pt":"Calculadora de Frações","ru":"Калькулятор дробей","ur":"کسر کیلکولیٹر","id":"Kalkulator Pecahan","de":"Bruchrechner","ja":"分数電卓","ko":"분수 계산기"}},"image-compressor":{"cat":"utility","emoji":"🗜️","names":{"en":"Image Compressor","zh":"图片压缩工具","hi":"इमेज कंप्रेसर","es":"Compresor de Imágenes","ar":"ضاغط الصور","fr":"Compresseur d'Images","bn":"ইমেজ কম্প্রেসর","pt":"Compressor de Imagens","ru":"Компрессор изображений","ur":"امیج کمپریسر","id":"Kompresor Gambar","de":"Bildkompressor","ja":"画像圧縮ツール","ko":"이미지 압축"}},"image-resizer":{"cat":"utility","emoji":"🖼️","names":{"en":"Image Resizer","zh":"图片尺寸调整器","hi":"इमेज रीसाइज़र","es":"Redimensionador de imágenes","ar":"أداة تغيير حجم الصور","fr":"Redimensionneur d'images","bn":"ইমেজ রিসাইজার","pt":"Redimensionador de imagens","ru":"Изменение размера изображений","ur":"امیج ری سائزر","id":"Pengubah Ukuran Gambar","de":"Bildgrößenänderung","ja":"画像リサイズツール","ko":"이미지 크기 조정"}},"password-gen":{"cat":"utility","emoji":"🔐","names":{"en":"Password Generator","zh":"密码生成器","hi":"पासवर्ड जेनरेटर","es":"Generador de contraseñas","ar":"مولّد كلمات المرور","fr":"Générateur de mots de passe","bn":"পাসওয়ার্ড জেনারেটর","pt":"Gerador de senhas","ru":"Генератор паролей","ur":"پاس ورڈ جنریٹر","id":"Pembuat Kata Sandi","de":"Passwort-Generator","ja":"パスワード生成","ko":"비밀번호 생성기"}},"prime-checker":{"cat":"utility","emoji":"🔢","names":{"en":"Prime Number Checker","zh":"质数检查器","hi":"अभाज्य संख्या जांचक","es":"Verificador de Números Primos","ar":"فاحص الأعداد الأولية","fr":"Vérificateur de Nombres Premiers","bn":"মৌলিক সংখ্যা যাচাইকারী","pt":"Verificador de Números Primos","ru":"Проверка простых чисел","ur":"مفرد عدد چیکر","id":"Pemeriksa Bilangan Prima","de":"Primzahl-Prüfer","ja":"素数判定","ko":"소수 판별기"}},"qr-gen":{"cat":"utility","emoji":"▦","names":{"en":"QR Code Generator","zh":"二维码生成器","hi":"QR कोड जनरेटर","es":"Generador de códigos QR","ar":"مولّد رموز QR","fr":"Générateur de QR code","bn":"QR কোড জেনারেটর","pt":"Gerador de QR Code","ru":"Генератор QR-кодов","ur":"QR کوڈ جنریٹر","id":"Generator Kode QR","de":"QR-Code-Generator","ja":"QRコード作成","ko":"QR 코드 생성기"}}};
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