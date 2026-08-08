/* oven-temp-conv guide translations. Keys = UI language codes. Values = innerHTML of .guide-content. */
window.GUIDES = window.GUIDES || {};

var S = "<style>.guide-content{max-width:none;margin:32px 0 8px;line-height:1.7}.guide-content h2{font-size:22px;font-weight:700;margin:28px 0 10px;letter-spacing:-.01em}.guide-content h3{font-size:17px;font-weight:650;margin:20px 0 6px}.guide-content p{margin:0 0 12px;color:var(--ink)}.guide-content ul,.guide-content ol{margin:0 0 12px;padding-left:22px}.guide-content li{margin:4px 0}.guide-content .example{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:14px 0;background:color-mix(in srgb,var(--accent) 5%,var(--surface))}.guide-content table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14px}.guide-content th,.guide-content td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}.guide-content th{color:var(--muted);font-weight:650}</style>";

/* Table rows: only the Description cell differs per language. */
function R(d) {
  var v = [["1/4",110,225,90],["1/2",120,250,100],["1",140,275,120],["2",150,300,130],["3",160,325,140],["4",180,350,160],["5",190,375,170],["6",200,400,180],["7",220,425,200],["8",230,450,210],["9",240,475,220],["10",260,500,240]];
  var out = "";
  for (var i = 0; i < v.length; i++) {
    out += "<tr><td>" + v[i][0] + "</td><td>" + v[i][1] + "</td><td>" + v[i][2] + "</td><td>" + v[i][3] + "</td><td>" + d[i] + "</td></tr>";
  }
  return out;
}

function T(head, desc) {
  return "<table><thead><tr>" + head + "</tr></thead><tbody>" + R(desc) + "</tbody></table>";
}

window.GUIDES["ko"] = S +
  "<h2>오븐 온도에 서로 다른 세 가지 눈금이 필요한 이유</h2>" +
  "<p>미국에서 쓰인 레시피는 화씨를 알려줍니다. 세계 대부분의 다른 지역에서 쓰인 레시피는 섭씨를 알려줍니다. 영국 요리책에서 나온 레시피 — 또는 디지털 표시창 대신 다이얼이 달린 오래된 오븐 — 는 둘 중 어느 것도 아닌 가스마크(Gas Mark)를 알려줍니다. 어느 쪽도 틀린 것이 아니라, 주방 기기의 시대와 지역이 다를 뿐입니다. 이 변환기는 세 가지 중 어느 하나를 나머지 두 가지로 즉시 바꿔주고, 레시피가 좀처럼 분명히 설명해 주지 않는 조정 한 가지를 덧붙입니다. 바로 오븐에 팬이 달려 있을 때 어떻게 해야 하는가입니다.</p>" +
  "<h3>화씨-섭씨 변환 공식</h3>" +
  "<ul><li>섭씨에서 화씨로: F = C &times; 9/5 + 32</li><li>화씨에서 섭씨로: C = (F &minus; 32) &times; 5/9</li></ul>" +
  "<p>여기까지는 정확한 계산입니다. 가스마크는 다릅니다. 정의된 지점이 열두 개뿐인 단계형 역사적 눈금이기 때문에, 이 도구는 공식으로 가스마크를 계산하지 않고 입력한 숫자에 가장 가까운 값을 찾아줍니다.</p>" +
  "<div class=\"example\"><strong>예시 1 — 고전적인 \"350도\".</strong> (350&minus;32)&times;5/9 = 176.7°C이며, 레시피에서는 180°C로 반올림합니다 — 가스마크 4, 중간 온도의 오븐이자 가장 흔하게 쓰이는 베이킹 온도입니다.</div>" +
  "<div class=\"example\"><strong>예시 2 — 뜨거운 로스팅.</strong> 220°C는 220&times;9/5+32 = 428°F로 변환되며 가스마크 7에 해당합니다. \"뜨거움\"으로 분류되며 채소를 굽거나 빵 껍질을 바삭하게 마무리할 때 쓰는 온도입니다.</div>" +
  "<div class=\"example\"><strong>예시 3 — 낮은 온도의 느린 베이킹.</strong> 가스마크 1/4은 110°C 또는 225°F입니다 — 머랭, 뭉근하게 끓이는 스튜, 과일 건조에 쓰이는 \"매우 낮은\" 오븐 온도로, 빠른 조리가 아니라 오랜 시간 은근한 열을 주는 것이 목적입니다.</div>" +
  "<h3>팬(컨벡션) 오븐: -20°C 규칙</h3>" +
  "<p>팬(컨벡션) 오븐은 내장 팬으로 뜨거운 공기를 순환시키기 때문에, 같은 다이얼 설정에서 일반(정적) 오븐보다 음식을 더 빠르고 고르게 익힙니다. 그래서 대부분의 요리책과 오븐 제조사는 팬 오븐을 쓸 때 온도를 약 20°C(대략 25~30°F) 낮추거나, 온도를 유지한다면 시간을 줄이라고 권합니다. 이 도구는 토글을 팬/컨벡션으로 바꾸면 -20°C 관례를 적용하고, 결과 옆에 항상 다른 오븐 방식의 대응 수치를 함께 보여주어 레시피를 어느 방향으로든 변환할 수 있게 합니다.</p>" +
  "<p>20°C라는 수치는 널리 쓰이는 경험칙이지 물리 법칙이 아닙니다. 어떤 오븐은 다이얼이 가리키는 것보다 뜨겁거나 차갑게 작동하고, 제조사에 따라 조금 다른 보정값을 제안하기도 합니다. 특정 베이킹이 온도에 민감하다면(섬세한 페이스트리, 수플레) 오븐 설명서를 확인하거나 오븐용 온도계로 첫 시험 굽기를 해 보는 것이 좋습니다.</p>" +
  "<h2>가스마크·섭씨·화씨 전체 대조표</h2>" +
  T("<th>가스마크</th><th>°C (일반)</th><th>°F</th><th>팬/컨벡션 °C</th><th>설명</th>",
    ["매우 낮음","매우 낮음","낮음","낮음","약함","중간","약간 뜨거움","꽤 뜨거움","뜨거움","뜨거움","매우 뜨거움","매우 뜨거움"]) +
  "<h3>흔한 실수</h3>" +
  "<ul><li><strong>가스마크를 정확한 계산으로 여기는 것:</strong> 가스마크는 선형 변환이 아니라 표준화된 열두 개 지점의 대조표입니다 — 두 마크 사이에 있는 섭씨 값에는 고유한 \"진짜\" 가스마크가 없고 가장 가까운 값만 있습니다.</li><li><strong>팬 보정을 잊는 것:</strong> 일반 오븐 기준 레시피를 팬 오븐에서 온도 그대로 따르면 속이 익기 전에 겉이 지나치게 타는 일이 흔합니다.</li><li><strong>모든 오븐이 정확히 보정되어 있다고 가정하는 것:</strong> 가정용 오븐은 다이얼 표시보다 10~20°C 벗어날 수 있으며, 온도에 민감한 베이킹이라면 오븐 온도계가 답을 줍니다.</li></ul>" +
  "<p>이 페이지의 모든 변환은 브라우저 안에서 처리됩니다. 입력한 내용은 어디로도 전송되지 않습니다.</p>";

window.GUIDES["ja"] = S +
  "<h2>オーブン温度に3つの異なる目盛りが必要な理由</h2>" +
  "<p>アメリカで書かれたレシピは華氏で示されます。世界の他の多くの地域で書かれたレシピは摂氏です。イギリスの料理書のレシピ — あるいはデジタル表示ではなくダイヤル式の古いオーブン — は、そのどちらでもなくガスマーク(Gas Mark)で示されます。どれも間違いではなく、調理機器の時代と地域が違うだけです。このコンバーターは3つのうちどれか1つを残り2つへ即座に変換し、レシピがはっきり説明してくれないことが多い調整をひとつ加えます。オーブンにファンが付いている場合どうするか、という点です。</p>" +
  "<h3>華氏-摂氏の換算式</h3>" +
  "<ul><li>摂氏から華氏へ: F = C &times; 9/5 + 32</li><li>華氏から摂氏へ: C = (F &minus; 32) &times; 5/9</li></ul>" +
  "<p>ここまでは正確な計算です。ガスマークは違います。定義された点が12個しかない段階的で歴史的な目盛りなので、このツールは式で計算するのではなく、入力した数値に最も近い点を対応させます。</p>" +
  "<div class=\"example\"><strong>例1 — 定番の「350度」。</strong> (350&minus;32)&times;5/9 = 176.7°C で、レシピでは180°Cに丸められます — ガスマーク4、中温のオーブンで、最もよく使われる焼成温度です。</div>" +
  "<div class=\"example\"><strong>例2 — 高温のロースト。</strong> 220°C は 220&times;9/5+32 = 428°F に換算され、ガスマーク7に一致します。「熱い」と表現され、野菜を焼いたりパンの表面をパリッと仕上げたりするのに使われます。</div>" +
  "<div class=\"example\"><strong>例3 — 低温でじっくり焼く。</strong> ガスマーク1/4は110°Cまたは225°F — メレンゲ、煮込み、果物の乾燥に使われる「非常に低い」オーブン温度で、素早く火を通すのではなく長時間おだやかな熱を与えるのが目的です。</div>" +
  "<h3>ファン(コンベクション)オーブン: -20°Cのルール</h3>" +
  "<p>ファン(コンベクション)オーブンは内蔵ファンで熱風を循環させるため、同じダイヤル設定でも従来型(静止空気)のオーブンより速く均一に加熱します。そのため多くの料理書やオーブンメーカーは、ファンオーブンを使う際に温度を約20°C(およそ25〜30°F)下げるか、温度を同じにするなら時間を短くすることを勧めています。このツールはトグルをファン/コンベクションに切り替えると-20°Cの慣習を適用し、結果の横にもう一方のオーブン方式の対応する数値を常に表示するので、レシピをどちらの方向にも変換できます。</p>" +
  "<p>20°Cという数字は広く使われる目安であって物理法則ではありません。ダイヤルの表示より高温または低温で動くオーブンもあり、メーカーによって少し異なる補正を示す場合もあります。温度に敏感な焼き物(繊細なペストリー、スフレ)なら、オーブンの説明書を確認するか、オーブン用温度計で一度試し焼きをする価値があります。</p>" +
  "<h2>ガスマーク・摂氏・華氏の完全対照表</h2>" +
  T("<th>ガスマーク</th><th>°C (従来型)</th><th>°F</th><th>ファン/コンベクション °C</th><th>説明</th>",
    ["非常に低い","非常に低い","低い","低い","ぬるめ","中温","やや高温","かなり高温","高温","高温","非常に高温","非常に高温"]) +
  "<h3>よくある間違い</h3>" +
  "<ul><li><strong>ガスマークを正確な計算だと考える:</strong> ガスマークは線形換算ではなく、標準化された12点の対応表です — 2つのマークの間にある摂氏の値に固有の「正しい」ガスマークは存在せず、最も近いものがあるだけです。</li><li><strong>ファンの補正を忘れる:</strong> 従来型オーブン向けのレシピをファンオーブンで温度そのままに従うと、中が焼き上がる前に外側が焦げすぎることがよくあります。</li><li><strong>すべてのオーブンが正しく校正されていると思い込む:</strong> 家庭用オーブンはダイヤル表示から10〜20°Cずれることがあります。温度に敏感な焼き物では、オーブン用温度計が答えを出してくれます。</li></ul>" +
  "<p>このページのすべての変換はブラウザー内で実行されます。入力した内容がどこかに送信されることはありません。</p>";

window.GUIDES["zh"] = S +
  "<h2>为什么烤箱温度需要三种不同的标度</h2>" +
  "<p>美国写的食谱给出华氏度。世界上大多数其他地区写的食谱给出摄氏度。来自英国烹饪书的食谱——或者带旋钮而非数字显示屏的旧烤箱——给出的既不是华氏也不是摄氏，而是气位（Gas Mark）。这些都没有错，只是不同年代、不同地区的厨房设备而已。本转换器可以把三者中的任意一个立刻换算成另外两个，并补上食谱很少讲清楚的那一项调整：如果你的烤箱带风扇该怎么办。</p>" +
  "<h3>华氏-摄氏换算公式</h3>" +
  "<ul><li>摄氏转华氏: F = C &times; 9/5 + 32</li><li>华氏转摄氏: C = (F &minus; 32) &times; 5/9</li></ul>" +
  "<p>这部分是精确的数学。气位则不同：它是一种分级的历史标度，只有十二个定义点，因此本工具会把你的数值匹配到最接近的一档，而不是用公式算出气位。</p>" +
  "<div class=\"example\"><strong>示例 1 —— 经典的“350 度”。</strong> (350&minus;32)&times;5/9 = 176.7°C，食谱通常取整为 180°C —— 即气位 4，中火烤箱，也是最常见的烘焙温度。</div>" +
  "<div class=\"example\"><strong>示例 2 —— 高温烤制。</strong> 220°C 换算为 220&times;9/5+32 = 428°F，对应气位 7，被描述为“热”，常用于烤蔬菜或给面包收尾烤出脆皮。</div>" +
  "<div class=\"example\"><strong>示例 3 —— 低温慢烤。</strong> 气位 1/4 是 110°C 或 225°F —— 属于“极低温”烤箱，用于蛋白霜、慢炖菜和水果烘干，目标是长时间的温和加热而非快速烹调。</div>" +
  "<h3>风扇/对流烤箱：-20°C 规则</h3>" +
  "<p>风扇（对流）烤箱通过内置风扇让热空气循环，在相同旋钮设定下比传统（静态）烤箱加热更快、更均匀。因此，大多数食谱书和烤箱厂商建议使用风扇烤箱时把温度降低约 20°C（大致 25-30°F），或者保持温度不变而缩短时间。只要你把开关切换到风扇/对流，本工具就会套用 -20°C 的惯例，并始终在结果旁显示另一种烤箱类型的对应数值，方便你双向换算食谱。</p>" +
  "<p>20°C 只是被广泛使用的经验法则，并非物理定律——有些烤箱实际温度比旋钮显示更高或更低，厂商偶尔也会建议略有不同的偏移量。如果某次烘焙对温度很敏感（精致酥皮、舒芙蕾），值得查阅烤箱说明书或先用烤箱温度计试烤一次。</p>" +
  "<h2>气位、摄氏与华氏完整对照表</h2>" +
  T("<th>气位</th><th>°C (传统)</th><th>°F</th><th>风扇/对流 °C</th><th>说明</th>",
    ["极低","极低","低","低","温","中","中高","相当高","高","高","极高","极高"]) +
  "<h3>常见错误</h3>" +
  "<ul><li><strong>把气位当作精确计算：</strong> 它是十二个标准化点的查照表，而不是线性换算——介于两档之间的摄氏值并没有属于自己的“真实”气位，只有最接近的一档。</li><li><strong>忘记风扇调整：</strong> 在风扇烤箱里按传统烤箱食谱的满温烘烤，常常会外表过焦而里面还没熟。</li><li><strong>以为每台烤箱都校准准确：</strong> 家用烤箱的实际温度可能与旋钮读数相差 10-20°C；对温度敏感的烘焙，用一支烤箱温度计就能一锤定音。</li></ul>" +
  "<p>本页的所有换算都在你的浏览器本地运行；你输入的内容不会被发送到任何地方。</p>";

window.GUIDES["es"] = S +
  "<h2>Por qué las temperaturas del horno necesitan tres escalas distintas</h2>" +
  "<p>Una receta escrita en Estados Unidos da grados Fahrenheit. Una escrita en la mayor parte del resto del mundo da grados Celsius. Una receta de un libro de cocina británico —o un horno antiguo con mando en lugar de pantalla digital— da un Gas Mark en vez de cualquiera de los dos. Ninguna está equivocada: son simplemente épocas y regiones distintas del equipamiento de cocina. Este conversor transforma cualquiera de las tres en las otras dos al instante y añade el ajuste que las recetas rara vez explican con claridad: qué hacer si tu horno tiene ventilador.</p>" +
  "<h3>La fórmula Fahrenheit-Celsius</h3>" +
  "<ul><li>De Celsius a Fahrenheit: F = C &times; 9/5 + 32</li><li>De Fahrenheit a Celsius: C = (F &minus; 32) &times; 5/9</li></ul>" +
  "<p>Esa parte es matemática exacta. El Gas Mark es distinto: es una escala histórica escalonada con solo doce puntos definidos, así que esta herramienta asocia tu número al punto más cercano en lugar de calcular un Gas Mark con una fórmula.</p>" +
  "<div class=\"example\"><strong>Ejemplo 1 — los clásicos «350 grados».</strong> (350&minus;32)&times;5/9 = 176,7 °C, que las recetas redondean a 180 °C — Gas Mark 4, un horno moderado y la temperatura de horneado más común que existe.</div>" +
  "<div class=\"example\"><strong>Ejemplo 2 — un asado fuerte.</strong> 220 °C equivalen a 220&times;9/5+32 = 428 °F, lo que coincide con el Gas Mark 7, descrito como «caliente» y típico para asar verduras o terminar una hogaza de pan con corteza crujiente.</div>" +
  "<div class=\"example\"><strong>Ejemplo 3 — un horneado lento y suave.</strong> El Gas Mark 1/4 son 110 °C o 225 °F — un horno «muy bajo» usado para merengues, guisos de cocción lenta y secado de fruta, donde se busca calor suave durante mucho tiempo en lugar de una cocción rápida.</div>" +
  "<h3>Hornos con ventilador / convección: la regla de los -20 °C</h3>" +
  "<p>Un horno con ventilador (convección) hace circular el aire caliente mediante un ventilador integrado, lo que cocina los alimentos más rápido y de forma más uniforme que un horno convencional (estático) con el mismo ajuste del mando. Por eso, la mayoría de los libros de recetas y de los fabricantes recomiendan bajar la temperatura unos 20 °C (aproximadamente 25-30 °F) al usar un horno con ventilador, o reducir el tiempo si mantienes la misma temperatura. Esta herramienta aplica la convención de -20 °C en cuanto activas el interruptor de ventilador/convección, y siempre muestra junto al resultado el valor equivalente del otro tipo de horno para que puedas convertir una receta en ambos sentidos.</p>" +
  "<p>La cifra de 20 °C es una regla práctica muy extendida, no una ley física: algunos hornos calientan más o menos de lo que indica el mando y los fabricantes sugieren a veces desviaciones algo distintas. Si un horneado concreto es delicado (masas finas, suflés), conviene consultar el manual del horno o hacer una primera prueba con un termómetro de horno.</p>" +
  "<h2>Tabla completa de referencia: Gas Mark, Celsius y Fahrenheit</h2>" +
  T("<th>Gas Mark</th><th>°C (convencional)</th><th>°F</th><th>°C con ventilador/convección</th><th>Descripción</th>",
    ["Muy bajo","Muy bajo","Bajo","Bajo","Templado","Moderado","Moderadamente caliente","Bastante caliente","Caliente","Caliente","Muy caliente","Muy caliente"]) +
  "<h3>Errores frecuentes</h3>" +
  "<ul><li><strong>Tratar el Gas Mark como matemática exacta:</strong> es una tabla de consulta de doce puntos estandarizados, no una conversión lineal — un valor en Celsius situado entre dos marcas no tiene un Gas Mark «verdadero» propio, solo uno más cercano.</li><li><strong>Olvidar el ajuste por ventilador:</strong> seguir una receta de horno convencional a temperatura completa en un horno con ventilador suele dorar demasiado el exterior antes de que el interior esté hecho.</li><li><strong>Dar por hecho que todos los hornos están bien calibrados:</strong> los hornos domésticos pueden desviarse 10-20 °C respecto a la lectura del mando; un termómetro de horno resuelve la duda en horneados sensibles a la temperatura.</li></ul>" +
  "<p>Todas las conversiones de esta página se ejecutan localmente en tu navegador; nada de lo que escribes se envía a ningún sitio.</p>";

window.GUIDES["fr"] = S +
  "<h2>Pourquoi les températures de four utilisent trois échelles différentes</h2>" +
  "<p>Une recette écrite aux États-Unis donne des degrés Fahrenheit. Une recette écrite dans la plupart des autres pays donne des degrés Celsius. Une recette issue d'un livre de cuisine britannique — ou d'un vieux four à cadran plutôt qu'à affichage numérique — indique un Gas Mark, ni l'un ni l'autre. Aucune de ces échelles n'est fausse : elles correspondent simplement à des époques et à des régions différentes en matière d'équipement de cuisine. Ce convertisseur transforme instantanément l'une des trois valeurs en les deux autres, et ajoute l'ajustement que les recettes précisent rarement clairement : que faire si votre four est à chaleur tournante.</p>" +
  "<h3>La formule Fahrenheit-Celsius</h3>" +
  "<ul><li>Celsius vers Fahrenheit : F = C &times; 9/5 + 32</li><li>Fahrenheit vers Celsius : C = (F &minus; 32) &times; 5/9</li></ul>" +
  "<p>Cette partie relève d'un calcul exact. Le Gas Mark, lui, est différent : c'est une échelle historique par paliers ne comportant que douze points définis. L'outil rapproche donc votre valeur du point le plus proche au lieu de calculer un Gas Mark avec une formule.</p>" +
  "<div class=\"example\"><strong>Exemple 1 — les fameux \"350 degrés\".</strong> (350&minus;32)&times;5/9 = 176,7 °C, que les recettes arrondissent à 180 °C — Gas Mark 4, un four moyen, la température de cuisson la plus courante qui soit.</div>" +
  "<div class=\"example\"><strong>Exemple 2 — un rôtissage à haute température.</strong> 220 °C donne 220&times;9/5+32 = 428 °F, ce qui correspond au Gas Mark 7, qualifié de \"chaud\" et typique pour rôtir des légumes ou terminer un pain avec une croûte croustillante.</div>" +
  "<div class=\"example\"><strong>Exemple 3 — une cuisson lente à basse température.</strong> Le Gas Mark 1/4 correspond à 110 °C ou 225 °F — un four \"très doux\" utilisé pour les meringues, les ragoûts mijotés et le séchage des fruits, où l'objectif est une chaleur douce sur une longue durée plutôt qu'une cuisson rapide.</div>" +
  "<h3>Fours à chaleur tournante : la règle des -20 °C</h3>" +
  "<p>Un four à chaleur tournante (convection) fait circuler l'air chaud grâce à un ventilateur intégré, ce qui cuit les aliments plus vite et plus uniformément qu'un four statique réglé sur la même position. C'est pourquoi la plupart des livres de recettes et des fabricants de fours recommandent de baisser la température d'environ 20 °C (soit à peu près 25 à 30 °F) en chaleur tournante, ou de réduire le temps de cuisson si vous conservez la même température. Cet outil applique la convention des -20 °C dès que vous basculez sur chaleur tournante, et affiche toujours à côté du résultat la valeur équivalente pour l'autre type de four, afin de convertir une recette dans les deux sens.</p>" +
  "<p>Les 20 °C sont une règle empirique largement utilisée, pas une loi physique : certains fours chauffent plus ou moins que ne l'indique leur cadran, et les fabricants proposent parfois des écarts légèrement différents. Si une cuisson est particulièrement sensible (pâtisserie délicate, soufflés), mieux vaut consulter la notice de votre four ou faire un premier essai avec un thermomètre de four.</p>" +
  "<h2>Tableau de correspondance complet Gas Mark, Celsius et Fahrenheit</h2>" +
  T("<th>Gas Mark</th><th>°C (statique)</th><th>°F</th><th>°C chaleur tournante</th><th>Description</th>",
    ["Très doux","Très doux","Doux","Doux","Tiède","Moyen","Moyennement chaud","Assez chaud","Chaud","Chaud","Très chaud","Très chaud"]) +
  "<h3>Erreurs fréquentes</h3>" +
  "<ul><li><strong>Traiter le Gas Mark comme un calcul exact :</strong> il s'agit d'une table de douze points normalisés, pas d'une conversion linéaire — une valeur en Celsius située entre deux repères n'a pas de \"vrai\" Gas Mark propre, seulement un plus proche voisin.</li><li><strong>Oublier l'ajustement chaleur tournante :</strong> suivre une recette prévue pour un four statique à pleine température dans un four ventilé fait souvent trop dorer l'extérieur avant que l'intérieur soit cuit.</li><li><strong>Supposer que tout four est bien calibré :</strong> un four domestique peut s'écarter de 10 à 20 °C de l'indication du cadran ; un thermomètre de four tranche la question pour les cuissons sensibles à la température.</li></ul>" +
  "<p>Toutes les conversions de cette page s'exécutent localement dans votre navigateur ; rien de ce que vous saisissez n'est envoyé ailleurs.</p>";

window.GUIDES["de"] = S +
  "<h2>Warum es für Backofentemperaturen drei verschiedene Skalen gibt</h2>" +
  "<p>Ein in den USA geschriebenes Rezept gibt Fahrenheit an. Ein Rezept aus den meisten übrigen Ländern gibt Celsius an. Ein Rezept aus einem britischen Kochbuch — oder ein älterer Ofen mit Drehregler statt Digitalanzeige — nennt stattdessen einen Gas Mark. Keine dieser Angaben ist falsch; sie stammen nur aus unterschiedlichen Epochen und Regionen der Küchentechnik. Dieser Umrechner wandelt jede der drei Angaben sofort in die beiden anderen um und ergänzt die eine Anpassung, die Rezepte selten klar benennen: was zu tun ist, wenn Ihr Ofen mit Umluft arbeitet.</p>" +
  "<h3>Die Formel für Fahrenheit und Celsius</h3>" +
  "<ul><li>Celsius in Fahrenheit: F = C &times; 9/5 + 32</li><li>Fahrenheit in Celsius: C = (F &minus; 32) &times; 5/9</li></ul>" +
  "<p>Das ist exakte Mathematik. Gas Mark funktioniert anders: Es ist eine historische Stufenskala mit nur zwölf festgelegten Punkten. Deshalb ordnet dieses Werkzeug Ihren Wert dem nächstgelegenen Punkt zu, statt einen Gas Mark per Formel zu berechnen.</p>" +
  "<div class=\"example\"><strong>Beispiel 1 — die klassischen \"350 Grad\".</strong> (350&minus;32)&times;5/9 = 176,7 °C, was Rezepte auf 180 °C runden — Gas Mark 4, ein mittelheißer Ofen und die mit Abstand häufigste Backtemperatur.</div>" +
  "<div class=\"example\"><strong>Beispiel 2 — scharfes Braten.</strong> 220 °C ergeben 220&times;9/5+32 = 428 °F und entsprechen Gas Mark 7, beschrieben als \"heiß\" und typisch für Ofengemüse oder das Ausbacken eines Brotlaibs mit knuspriger Kruste.</div>" +
  "<div class=\"example\"><strong>Beispiel 3 — langsames Garen bei niedriger Hitze.</strong> Gas Mark 1/4 entspricht 110 °C oder 225 °F — ein \"sehr niedriger\" Ofen für Baiser, lange geschmorte Eintöpfe und das Trocknen von Obst, wo es um sanfte Hitze über lange Zeit statt um schnelles Garen geht.</div>" +
  "<h3>Umluftöfen: die -20-°C-Regel</h3>" +
  "<p>Ein Umluftofen (Konvektionsofen) verteilt die heiße Luft mit einem eingebauten Ventilator und gart Speisen dadurch schneller und gleichmäßiger als ein Ober-/Unterhitze-Ofen bei gleicher Einstellung. Deshalb empfehlen die meisten Kochbücher und Ofenhersteller, die Temperatur bei Umluft um etwa 20 °C (rund 25 bis 30 °F) zu senken oder stattdessen die Garzeit zu verkürzen, wenn Sie die Temperatur beibehalten. Dieses Werkzeug wendet die -20-°C-Konvention an, sobald Sie auf Umluft umschalten, und zeigt neben Ihrem Ergebnis stets den entsprechenden Wert der anderen Ofenart an, damit Sie ein Rezept in beide Richtungen umrechnen können.</p>" +
  "<p>Die 20 °C sind eine weit verbreitete Faustregel, kein physikalisches Gesetz — manche Öfen heizen stärker oder schwächer, als der Regler vermuten lässt, und Hersteller nennen gelegentlich leicht abweichende Werte. Wenn ein Gebäck besonders empfindlich ist (feines Blätterteiggebäck, Soufflés), lohnt sich ein Blick in die Bedienungsanleitung oder ein erster Testdurchgang mit einem Backofenthermometer.</p>" +
  "<h2>Vollständige Vergleichstabelle: Gas Mark, Celsius und Fahrenheit</h2>" +
  T("<th>Gas Mark</th><th>°C (Ober-/Unterhitze)</th><th>°F</th><th>Umluft °C</th><th>Beschreibung</th>",
    ["Sehr niedrig","Sehr niedrig","Niedrig","Niedrig","Warm","Mittel","Mittelheiß","Ziemlich heiß","Heiß","Heiß","Sehr heiß","Sehr heiß"]) +
  "<h3>Häufige Fehler</h3>" +
  "<ul><li><strong>Gas Mark als exakte Rechnung verstehen:</strong> Es ist eine Nachschlagetabelle mit zwölf standardisierten Punkten, keine lineare Umrechnung — ein Celsius-Wert zwischen zwei Stufen hat keinen eigenen \"echten\" Gas Mark, sondern nur einen nächstgelegenen.</li><li><strong>Die Umluftanpassung vergessen:</strong> Ein Rezept für Ober-/Unterhitze bei voller Temperatur im Umluftofen zu backen führt häufig dazu, dass die Oberfläche zu stark bräunt, bevor das Innere gar ist.</li><li><strong>Annehmen, jeder Ofen sei korrekt kalibriert:</strong> Haushaltsöfen können 10 bis 20 °C von der Reglerangabe abweichen; ein Backofenthermometer klärt die Frage bei temperaturempfindlichem Gebäck.</li></ul>" +
  "<p>Alle Umrechnungen auf dieser Seite laufen lokal in Ihrem Browser; nichts von dem, was Sie eingeben, wird irgendwohin gesendet.</p>";

window.GUIDES["pt"] = S +
  "<h2>Por que as temperaturas de forno usam três escalas diferentes</h2>" +
  "<p>Uma receita escrita nos Estados Unidos indica graus Fahrenheit. Uma receita escrita na maior parte do resto do mundo indica graus Celsius. Uma receita de um livro de culinária britânico — ou de um forno mais antigo com botão giratório em vez de mostrador digital — indica um Gas Mark, e não uma das outras duas. Nenhuma delas está errada; são apenas épocas e regiões diferentes de equipamento de cozinha. Este conversor transforma instantaneamente qualquer uma das três nas outras duas e acrescenta o ajuste que as receitas raramente explicam com clareza: o que fazer se o seu forno tem ventilador.</p>" +
  "<h3>A fórmula Fahrenheit-Celsius</h3>" +
  "<ul><li>Celsius para Fahrenheit: F = C &times; 9/5 + 32</li><li>Fahrenheit para Celsius: C = (F &minus; 32) &times; 5/9</li></ul>" +
  "<p>Essa parte é matemática exata. O Gas Mark é diferente: trata-se de uma escala histórica em degraus, com apenas doze pontos definidos, por isso esta ferramenta associa o seu número ao ponto mais próximo em vez de calcular um Gas Mark por fórmula.</p>" +
  "<div class=\"example\"><strong>Exemplo 1 — os clássicos \"350 graus\".</strong> (350&minus;32)&times;5/9 = 176,7 °C, que as receitas arredondam para 180 °C — Gas Mark 4, um forno moderado, a temperatura de forno mais comum que existe.</div>" +
  "<div class=\"example\"><strong>Exemplo 2 — um assado em forno quente.</strong> 220 °C convertem-se em 220&times;9/5+32 = 428 °F, correspondendo ao Gas Mark 7, descrito como \"quente\" e típico para assar legumes ou finalizar um pão com crosta crocante.</div>" +
  "<div class=\"example\"><strong>Exemplo 3 — um assado lento em temperatura baixa.</strong> O Gas Mark 1/4 equivale a 110 °C ou 225 °F — um forno \"muito baixo\", usado para merengues, ensopados de cozimento lento e desidratação de frutas, em que o objetivo é calor suave por muito tempo em vez de cozimento rápido.</div>" +
  "<h3>Fornos com ventilador (convecção): a regra dos -20 °C</h3>" +
  "<p>Um forno com ventilador (convecção) faz circular o ar quente por meio de uma ventoinha embutida, o que cozinha os alimentos mais rápido e de forma mais uniforme do que um forno convencional (estático) no mesmo ajuste. Por isso, a maioria dos livros de receitas e dos fabricantes de fornos recomenda reduzir a temperatura em cerca de 20 °C (aproximadamente 25 a 30 °F) ao usar forno com ventilador, ou reduzir o tempo caso mantenha a mesma temperatura. Esta ferramenta aplica a convenção dos -20 °C assim que você muda o seletor para ventilador/convecção, e sempre mostra ao lado do resultado o valor equivalente do outro tipo de forno, para converter uma receita em qualquer direção.</p>" +
  "<p>O valor de 20 °C é uma regra prática amplamente usada, não uma lei física — alguns fornos aquecem mais ou menos do que o botão sugere, e os fabricantes às vezes indicam diferenças ligeiramente distintas. Se um preparo for sensível (massas delicadas, suflês), vale consultar o manual do forno ou fazer um primeiro teste com um termômetro de forno.</p>" +
  "<h2>Tabela completa de referência: Gas Mark, Celsius e Fahrenheit</h2>" +
  T("<th>Gas Mark</th><th>°C (convencional)</th><th>°F</th><th>°C ventilador/convecção</th><th>Descrição</th>",
    ["Muito baixo","Muito baixo","Baixo","Baixo","Morno","Moderado","Moderadamente quente","Bastante quente","Quente","Quente","Muito quente","Muito quente"]) +
  "<h3>Erros comuns</h3>" +
  "<ul><li><strong>Tratar o Gas Mark como cálculo exato:</strong> é uma tabela de consulta com doze pontos padronizados, não uma conversão linear — um valor em Celsius entre duas marcas não tem um Gas Mark \"verdadeiro\" próprio, apenas o mais próximo.</li><li><strong>Esquecer o ajuste do ventilador:</strong> seguir em forno com ventilador uma receita feita para forno convencional na temperatura cheia costuma dourar demais a superfície antes de o interior ficar pronto.</li><li><strong>Supor que todo forno está bem calibrado:</strong> fornos domésticos podem variar de 10 a 20 °C em relação à marcação do botão; um termômetro de forno resolve a dúvida em preparos sensíveis à temperatura.</li></ul>" +
  "<p>Todas as conversões desta página são feitas localmente no seu navegador; nada do que você digita é enviado para lugar algum.</p>";

window.GUIDES["ru"] = S +
  "<h2>Почему для температуры духовки существуют три разные шкалы</h2>" +
  "<p>Рецепт, написанный в США, указывает градусы Фаренгейта. Рецепт из большинства других стран мира — градусы Цельсия. Рецепт из британской кулинарной книги (или старая духовка с поворотной ручкой вместо цифрового дисплея) вместо этого указывает Gas Mark. Ни одна из этих шкал не является ошибочной: это просто разные эпохи и регионы кухонной техники. Этот конвертер мгновенно переводит любое из трёх значений в два других и добавляет поправку, которую рецепты редко объясняют внятно: что делать, если в вашей духовке есть конвекция.</p>" +
  "<h3>Формула перевода Фаренгейта и Цельсия</h3>" +
  "<ul><li>Из Цельсия в Фаренгейты: F = C &times; 9/5 + 32</li><li>Из Фаренгейтов в Цельсии: C = (F &minus; 32) &times; 5/9</li></ul>" +
  "<p>Это точная математика. С Gas Mark всё иначе: это историческая ступенчатая шкала всего с двенадцатью определёнными точками, поэтому инструмент подбирает ближайшее значение, а не вычисляет Gas Mark по формуле.</p>" +
  "<div class=\"example\"><strong>Пример 1 — классические \"350 градусов\".</strong> (350&minus;32)&times;5/9 = 176,7 °C, что в рецептах округляют до 180 °C — Gas Mark 4, умеренно нагретая духовка и самая распространённая температура выпечки.</div>" +
  "<div class=\"example\"><strong>Пример 2 — запекание на сильном жару.</strong> 220 °C дают 220&times;9/5+32 = 428 °F, что соответствует Gas Mark 7 — \"горячая\" духовка, обычная для запекания овощей или для получения хрустящей корочки у хлеба.</div>" +
  "<div class=\"example\"><strong>Пример 3 — медленное запекание при низкой температуре.</strong> Gas Mark 1/4 — это 110 °C или 225 °F: \"очень низкая\" духовка для безе, томлёных рагу и сушки фруктов, где нужен мягкий жар в течение долгого времени, а не быстрое приготовление.</div>" +
  "<h3>Духовки с конвекцией: правило -20 °C</h3>" +
  "<p>Духовка с конвекцией с помощью встроенного вентилятора гоняет горячий воздух, поэтому при том же положении регулятора она готовит быстрее и равномернее, чем обычная духовка со статичным нагревом. Именно поэтому большинство кулинарных книг и производителей духовок рекомендуют при конвекции снижать температуру примерно на 20 °C (около 25-30 °F) либо сокращать время, если температура остаётся прежней. Этот инструмент применяет правило -20 °C, как только вы переключаетесь на режим конвекции, и всегда показывает рядом с результатом эквивалентное значение для другого типа духовки, чтобы можно было пересчитать рецепт в любую сторону.</p>" +
  "<p>Значение 20 °C — широко используемое эмпирическое правило, а не физический закон: некоторые духовки греют сильнее или слабее, чем показывает шкала, а производители иногда указывают немного другую поправку. Если выпечка особенно чувствительна (тонкое тесто, суфле), стоит заглянуть в инструкцию к духовке или сделать первую пробную выпечку с термометром для духовки.</p>" +
  "<h2>Полная таблица соответствия Gas Mark, Цельсия и Фаренгейта</h2>" +
  T("<th>Gas Mark</th><th>°C (обычный режим)</th><th>°F</th><th>°C с конвекцией</th><th>Описание</th>",
    ["Очень низкая","Очень низкая","Низкая","Низкая","Тёплая","Умеренная","Умеренно горячая","Довольно горячая","Горячая","Горячая","Очень горячая","Очень горячая"]) +
  "<h3>Частые ошибки</h3>" +
  "<ul><li><strong>Считать Gas Mark точным расчётом:</strong> это таблица из двенадцати стандартных точек, а не линейный перевод — у значения в градусах Цельсия между двумя отметками нет собственного \"настоящего\" Gas Mark, есть только ближайший.</li><li><strong>Забывать про поправку на конвекцию:</strong> если готовить по рецепту для обычной духовки при полной температуре в режиме конвекции, поверхность часто подрумянивается слишком сильно раньше, чем пропечётся середина.</li><li><strong>Считать, что любая духовка откалибрована точно:</strong> домашние духовки могут отклоняться на 10-20 °C от показаний регулятора; термометр для духовки снимает этот вопрос при чувствительной к температуре выпечке.</li></ul>" +
  "<p>Все преобразования на этой странице выполняются локально в вашем браузере; ничего из введённого никуда не отправляется.</p>";
