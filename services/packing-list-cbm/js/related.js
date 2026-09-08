(function(){
  "use strict";
  var CATALOG = {"password-gen":{"cat":"utility","emoji":"🔐","names":{"en":"Password Generator","zh":"密码生成器","hi":"पासवर्ड जेनरेटर","es":"Generador de contraseñas","ar":"مولّد كلمات المرور","fr":"Générateur de mots de passe","bn":"পাসওয়ার্ড জেনারেটর","pt":"Gerador de senhas","ru":"Генератор паролей","ur":"پاس ورڈ جنریٹر","id":"Pembuat Kata Sandi","de":"Passwort-Generator","ja":"パスワード生成","ko":"비밀번호 생성기"}},"paygap-report":{"cat":"utility","emoji":"🧾","names":{"en":"Gender Pay Gap Report Builder","zh":"性别薪酬差距报告生成器","hi":"जेंडर पे गैप रिपोर्ट बिल्डर","es":"Generador de informe de brecha salarial","ar":"منشئ تقرير فجوة الأجور بين الجنسين","fr":"Générateur de rapport d'écart salarial","bn":"লিঙ্গভিত্তিক বেতন-বৈষম্য রিপোর্ট বিল্ডার","pt":"Gerador de relatório de desigualdade salaria","ru":"Отчёт о гендерном разрыве в оплате","ur":"صنفی اجرت فرق رپورٹ بلڈر","id":"Pembuat Laporan Kesenjangan Upah Gender","de":"Gender-Pay-Gap-Report-Builder","ja":"男女賃金格差レポート作成","ko":"성별 임금격차 리포트 빌더"}},"perf-rating-calibrator":{"cat":"utility","emoji":"📋","names":{"en":"Performance Rating Calibrator","zh":"绩效评分校准器","hi":"परफ़ॉर्मेंस रेटिंग कैलिब्रेटर","es":"Calibrador de Evaluaciones de Desempeño","ar":"أداة معايرة تقييم الأداء","fr":"Calibrateur d'évaluations de performance","bn":"পারফরম্যান্স রেটিং ক্যালিব্রেটর","pt":"Calibrador de Avaliação de Desempenho","ru":"Калибратор оценок эффективности","ur":"پرفارمنس ریٹنگ کیلیبریٹر","id":"Kalibrator Nilai Kinerja","de":"Kalibrator für Leistungsbewertungen","ja":"人事評価キャリブレーター","ko":"인사평가 캘리브레이터"}},"prime-checker":{"cat":"utility","emoji":"🔢","names":{"en":"Prime Number Checker","zh":"质数检查器","hi":"अभाज्य संख्या जांचक","es":"Verificador de Números Primos","ar":"فاحص الأعداد الأولية","fr":"Vérificateur de Nombres Premiers","bn":"মৌলিক সংখ্যা যাচাইকারী","pt":"Verificador de Números Primos","ru":"Проверка простых чисел","ur":"مفرد عدد چیکر","id":"Pemeriksa Bilangan Prima","de":"Primzahl-Prüfer","ja":"素数判定","ko":"소수 판별기"}}};
  var SIBS = ["password-gen","paygap-report","perf-rating-calibrator","prime-checker"];
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
