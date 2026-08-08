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

window.GUIDES["ar"] = S +
  "<h2>لماذا تحتاج حرارة الفرن إلى ثلاثة مقاييس مختلفة</h2>" +
  "<p>الوصفة المكتوبة في الولايات المتحدة تعطيك الدرجة بالفهرنهايت، والمكتوبة في معظم بقية أنحاء العالم تعطيك الدرجة بالسيلسيوس، أما الوصفة المأخوذة من كتاب طبخ بريطاني — أو من فرن قديم بمؤشر دوّار بدل الشاشة الرقمية — فتعطيك رقم Gas Mark بدلاً من الاثنين. لا شيء من ذلك خاطئ؛ إنها ببساطة عصور ومناطق مختلفة من أدوات المطبخ. هذا المحوّل يبدّل أي واحد من الثلاثة إلى الاثنين الآخرين فوراً، ويضيف التعديل الذي نادراً ما توضحه الوصفات: ماذا تفعل إن كان فرنك مزوّداً بمروحة.</p>" +
  "<h3>معادلة الفهرنهايت والسيلسيوس</h3>" +
  "<ul><li>من السيلسيوس إلى الفهرنهايت: F = C &times; 9/5 + 32</li><li>من الفهرنهايت إلى السيلسيوس: C = (F &minus; 32) &times; 5/9</li></ul>" +
  "<p>هذا الجزء حساب دقيق تماماً. أما Gas Mark فمختلف: إنه مقياس تاريخي متدرّج لا يضم سوى اثنتي عشرة نقطة محددة، لذلك يطابق هذا الأداة رقمك مع أقرب نقطة بدل حساب Gas Mark بمعادلة.</p>" +
  "<div class=\"example\"><strong>المثال 1 — الرقم الكلاسيكي \"350 درجة\".</strong> (350&minus;32)&times;5/9 = 176.7°C، وهو ما تقرّبه الوصفات إلى 180°C — أي Gas Mark 4، فرن معتدل، وهي أكثر درجة خبز شيوعاً على الإطلاق.</div>" +
  "<div class=\"example\"><strong>المثال 2 — تحميص على حرارة عالية.</strong> 220°C تتحول إلى 220&times;9/5+32 = 428°F، وتوافق Gas Mark 7 الموصوف بأنه \"ساخن\"، وهو المعتاد لتحميص الخضار أو لإنهاء رغيف خبز بقشرة مقرمشة.</div>" +
  "<div class=\"example\"><strong>المثال 3 — خبز بطيء على حرارة منخفضة.</strong> Gas Mark 1/4 يساوي 110°C أو 225°F — فرن \"منخفض جداً\" يُستخدم للمرينغ واليخنات بطيئة الطهي وتجفيف الفاكهة، حيث الهدف حرارة لطيفة لوقت طويل لا طهي سريع.</div>" +
  "<h3>أفران المروحة (الحمل الحراري): قاعدة -20°C</h3>" +
  "<p>فرن المروحة (الحمل الحراري) يدوّر الهواء الساخن بمروحة مدمجة، فيطهو الطعام أسرع وأكثر تجانساً من الفرن التقليدي (الساكن) عند الضبط نفسه. لذلك توصي معظم كتب الطبخ وشركات تصنيع الأفران بخفض الحرارة نحو 20°C (أي 25-30°F تقريباً) عند استخدام فرن المروحة، أو بتقليل الوقت إن أبقيت الحرارة كما هي. يطبّق هذا الأداة قاعدة -20°C بمجرد تحويل المفتاح إلى وضع المروحة/الحمل الحراري، ويعرض دائماً الرقم المكافئ لنوع الفرن الآخر إلى جانب نتيجتك حتى تتمكن من تحويل الوصفة في الاتجاهين.</p>" +
  "<p>رقم 20°C قاعدة عملية شائعة لا قانون فيزيائي — فبعض الأفران تسخن أكثر أو أقل مما يوحي مؤشرها، والشركات المصنّعة تقترح أحياناً فروقاً مختلفة قليلاً. وإن كان الخبز حساساً (معجنات رقيقة، سوفليه) فمن الأفضل مراجعة دليل فرنك أو إجراء خبزة تجريبية أولى مع مقياس حرارة للفرن.</p>" +
  "<h2>جدول مرجعي كامل لـ Gas Mark والسيلسيوس والفهرنهايت</h2>" +
  T("<th>Gas Mark</th><th>°C (تقليدي)</th><th>°F</th><th>مروحة/حمل حراري °C</th><th>الوصف</th>",
    ["منخفض جداً","منخفض جداً","منخفض","منخفض","دافئ","معتدل","ساخن قليلاً","ساخن نوعاً ما","ساخن","ساخن","ساخن جداً","ساخن جداً"]) +
  "<h3>أخطاء شائعة</h3>" +
  "<ul><li><strong>التعامل مع Gas Mark كحساب دقيق:</strong> إنه جدول من اثنتي عشرة نقطة معيارية وليس تحويلاً خطياً — فقيمة سيلسيوس تقع بين علامتين ليس لها Gas Mark \"حقيقي\" خاص بها، بل أقرب علامة فقط.</li><li><strong>نسيان تعديل المروحة:</strong> اتباع وصفة فرن تقليدي بكامل حرارتها في فرن مروحة يؤدي غالباً إلى فرط تحمير السطح قبل نضج الداخل.</li><li><strong>افتراض أن كل فرن معاير بدقة:</strong> أفران المنازل قد تنحرف 10-20°C عن قراءة مؤشرها؛ ومقياس حرارة الفرن يحسم المسألة في الخبزات الحساسة للحرارة.</li></ul>" +
  "<p>كل تحويل في هذه الصفحة يجري محلياً داخل متصفحك؛ ولا يُرسل أي شيء تكتبه إلى أي مكان.</p>";

window.GUIDES["hi"] = S +
  "<h2>ओवन के तापमान के लिए तीन अलग-अलग पैमानों की ज़रूरत क्यों पड़ती है</h2>" +
  "<p>अमेरिका में लिखी रेसिपी फ़ारेनहाइट में तापमान देती है। दुनिया के बाक़ी ज़्यादातर हिस्सों में लिखी रेसिपी सेल्सियस में देती है। ब्रिटिश कुकबुक की रेसिपी — या डिजिटल डिस्प्ले के बजाय डायल वाला पुराना ओवन — इन दोनों के बजाय Gas Mark बताता है। इनमें से कोई ग़लत नहीं है; ये बस रसोई उपकरणों के अलग-अलग दौर और क्षेत्र हैं। यह कनवर्टर इन तीनों में से किसी एक को तुरंत बाक़ी दो में बदल देता है, और वह एक समायोजन भी जोड़ता है जिसे रेसिपी शायद ही कभी साफ़ बताती हैं: अगर आपके ओवन में पंखा है तो क्या करें।</p>" +
  "<h3>फ़ारेनहाइट-सेल्सियस सूत्र</h3>" +
  "<ul><li>सेल्सियस से फ़ारेनहाइट: F = C &times; 9/5 + 32</li><li>फ़ारेनहाइट से सेल्सियस: C = (F &minus; 32) &times; 5/9</li></ul>" +
  "<p>यह हिस्सा सटीक गणित है। Gas Mark अलग है: यह एक चरणबद्ध, ऐतिहासिक पैमाना है जिसमें केवल बारह निर्धारित बिंदु हैं, इसलिए यह टूल सूत्र से Gas Mark निकालने के बजाय आपके अंक को निकटतम बिंदु से मिलाता है।</p>" +
  "<div class=\"example\"><strong>उदाहरण 1 — क्लासिक \"350 डिग्री\"।</strong> (350&minus;32)&times;5/9 = 176.7°C, जिसे रेसिपी 180°C तक गोल कर देती हैं — Gas Mark 4, यानी मध्यम ओवन, बेकिंग का सबसे आम तापमान।</div>" +
  "<div class=\"example\"><strong>उदाहरण 2 — तेज़ आँच पर रोस्ट।</strong> 220°C का रूपांतरण 220&times;9/5+32 = 428°F होता है, जो Gas Mark 7 से मेल खाता है — इसे \"गर्म\" कहा जाता है और यह सब्ज़ियाँ भूनने या ब्रेड को कुरकुरी पपड़ी देने के लिए सामान्य है।</div>" +
  "<div class=\"example\"><strong>उदाहरण 3 — धीमी, कम आँच वाली बेकिंग।</strong> Gas Mark 1/4 यानी 110°C या 225°F — एक \"बहुत कम\" ओवन, जो मेरिंग, धीमे पके स्ट्यू और फल सुखाने के लिए इस्तेमाल होता है, जहाँ मक़सद तेज़ पकाना नहीं बल्कि लंबे समय तक हल्की गर्मी देना है।</div>" +
  "<h3>पंखा / कन्वेक्शन ओवन: -20°C का नियम</h3>" +
  "<p>पंखे (कन्वेक्शन) वाला ओवन अंदर लगे पंखे से गर्म हवा घुमाता है, जिससे उसी डायल सेटिंग पर खाना पारंपरिक (स्टैटिक) ओवन के मुक़ाबले जल्दी और ज़्यादा समान रूप से पकता है। इसीलिए ज़्यादातर रेसिपी किताबें और ओवन निर्माता पंखे वाले ओवन में तापमान लगभग 20°C (क़रीब 25-30°F) कम करने की सलाह देते हैं, या तापमान वही रखना हो तो समय घटाने की। टॉगल को पंखा/कन्वेक्शन पर करते ही यह टूल -20°C वाली परंपरा लागू कर देता है, और आपके परिणाम के साथ दूसरे प्रकार के ओवन का समतुल्य अंक हमेशा दिखाता है ताकि आप रेसिपी को किसी भी दिशा में बदल सकें।</p>" +
  "<p>20°C का आँकड़ा व्यापक रूप से इस्तेमाल होने वाला अनुमान है, भौतिकी का नियम नहीं — कुछ ओवन अपने डायल से ज़्यादा गर्म या ठंडे चलते हैं, और निर्माता कभी-कभी थोड़ा अलग अंतर सुझाते हैं। अगर कोई बेकिंग नाज़ुक है (बारीक पेस्ट्री, सूफ़ले), तो अपने ओवन की मैनुअल देख लेना या ओवन थर्मामीटर के साथ पहली परीक्षण बेकिंग करना बेहतर है।</p>" +
  "<h2>Gas Mark, सेल्सियस और फ़ारेनहाइट की पूरी संदर्भ तालिका</h2>" +
  T("<th>Gas Mark</th><th>°C (पारंपरिक)</th><th>°F</th><th>पंखा/कन्वेक्शन °C</th><th>विवरण</th>",
    ["बहुत कम","बहुत कम","कम","कम","हल्का गर्म","मध्यम","मध्यम गर्म","काफ़ी गर्म","गर्म","गर्म","बहुत गर्म","बहुत गर्म"]) +
  "<h3>आम ग़लतियाँ</h3>" +
  "<ul><li><strong>Gas Mark को सटीक गणित मानना:</strong> यह बारह मानक बिंदुओं की लुकअप तालिका है, रैखिक रूपांतरण नहीं — दो मार्क के बीच पड़ने वाले सेल्सियस मान का अपना कोई \"सही\" Gas Mark नहीं होता, बस निकटतम होता है।</li><li><strong>पंखे का समायोजन भूल जाना:</strong> पारंपरिक ओवन की रेसिपी को पूरे तापमान पर पंखे वाले ओवन में चलाने से अक्सर अंदर पकने से पहले बाहर ज़्यादा भूरा हो जाता है।</li><li><strong>यह मान लेना कि हर ओवन सही कैलिब्रेटेड है:</strong> घरेलू ओवन अपने डायल से 10-20°C तक भटक सकते हैं; तापमान के प्रति संवेदनशील बेकिंग में ओवन थर्मामीटर मामला तय कर देता है।</li></ul>" +
  "<p>इस पेज का हर रूपांतरण आपके ब्राउज़र में ही चलता है; आप जो टाइप करते हैं वह कहीं नहीं भेजा जाता।</p>";

window.GUIDES["bn"] = S +
  "<h2>ওভেনের তাপমাত্রার জন্য কেন তিনটি আলাদা স্কেল দরকার হয়</h2>" +
  "<p>যুক্তরাষ্ট্রে লেখা রেসিপি তাপমাত্রা দেয় ফারেনহাইটে। বিশ্বের বেশির ভাগ অন্য জায়গায় লেখা রেসিপি দেয় সেলসিয়াসে। ব্রিটিশ রান্নার বই থেকে নেওয়া রেসিপি — কিংবা ডিজিটাল ডিসপ্লের বদলে ডায়ালওয়ালা পুরোনো ওভেন — এই দুটির কোনোটির বদলে Gas Mark বলে দেয়। এর কোনোটিই ভুল নয়; এগুলো কেবল রান্নাঘরের সরঞ্জামের ভিন্ন যুগ ও ভিন্ন অঞ্চল। এই কনভার্টার তিনটির যেকোনো একটিকে সঙ্গে সঙ্গে বাকি দুটিতে বদলে দেয়, আর যোগ করে সেই সমন্বয়টিও যা রেসিপিতে খুব কমই স্পষ্ট করে বলা থাকে: আপনার ওভেনে ফ্যান থাকলে কী করবেন।</p>" +
  "<h3>ফারেনহাইট-সেলসিয়াস সূত্র</h3>" +
  "<ul><li>সেলসিয়াস থেকে ফারেনহাইট: F = C &times; 9/5 + 32</li><li>ফারেনহাইট থেকে সেলসিয়াস: C = (F &minus; 32) &times; 5/9</li></ul>" +
  "<p>এই অংশটুকু নিখুঁত অঙ্ক। Gas Mark আলাদা: এটি ধাপে ধাপে সাজানো এক ঐতিহাসিক স্কেল, যেখানে নির্ধারিত বিন্দু মাত্র বারোটি। তাই এই টুল সূত্র দিয়ে Gas Mark হিসাব না করে আপনার সংখ্যার সবচেয়ে কাছের বিন্দুটি মিলিয়ে দেয়।</p>" +
  "<div class=\"example\"><strong>উদাহরণ ১ — চিরচেনা \"৩৫০ ডিগ্রি\"।</strong> (350&minus;32)&times;5/9 = 176.7°C, যা রেসিপিতে গোল করে 180°C ধরা হয় — Gas Mark 4, মাঝারি ওভেন, বেকিংয়ের সবচেয়ে প্রচলিত তাপমাত্রা।</div>" +
  "<div class=\"example\"><strong>উদাহরণ ২ — চড়া আঁচে রোস্ট।</strong> 220°C রূপান্তরিত হয় 220&times;9/5+32 = 428°F-এ, যা Gas Mark 7-এর সঙ্গে মেলে — একে \"গরম\" বলা হয় এবং সবজি রোস্ট করা বা পাউরুটির খাস্তা ওপরের স্তর তৈরিতে এটিই স্বাভাবিক।</div>" +
  "<div class=\"example\"><strong>উদাহরণ ৩ — কম আঁচে ধীর বেকিং।</strong> Gas Mark 1/4 মানে 110°C বা 225°F — \"খুব কম\" ওভেন, যা মেরাং, ধীরে রান্না করা স্টু ও ফল শুকানোর কাজে লাগে, যেখানে লক্ষ্য দ্রুত রান্না নয় বরং দীর্ঘ সময় ধরে মৃদু তাপ।</div>" +
  "<h3>ফ্যান / কনভেকশন ওভেন: -20°C-এর নিয়ম</h3>" +
  "<p>ফ্যান (কনভেকশন) ওভেন ভেতরের ফ্যান দিয়ে গরম বাতাস ঘোরায়, ফলে একই ডায়াল সেটিংয়ে প্রচলিত (স্ট্যাটিক) ওভেনের চেয়ে খাবার দ্রুত ও বেশি সমানভাবে রান্না হয়। এ কারণেই বেশির ভাগ রান্নার বই ও ওভেন প্রস্তুতকারক ফ্যান ওভেনে তাপমাত্রা প্রায় 20°C (মোটামুটি 25-30°F) কমানোর পরামর্শ দেয়, অথবা তাপমাত্রা একই রাখলে সময় কমাতে বলে। টগলটি ফ্যান/কনভেকশনে দিলেই এই টুল -20°C প্রথাটি প্রয়োগ করে, এবং আপনার ফলাফলের পাশে সবসময় অন্য ধরনের ওভেনের সমতুল্য সংখ্যাটিও দেখায়, যাতে আপনি রেসিপি যেকোনো দিকেই রূপান্তর করতে পারেন।</p>" +
  "<p>20°C সংখ্যাটি বহুল প্রচলিত একটি হিসাব-নিয়ম, পদার্থবিদ্যার সূত্র নয় — কিছু ওভেন ডায়ালের ইঙ্গিতের চেয়ে বেশি গরম বা ঠান্ডা চলে, আর প্রস্তুতকারকেরা মাঝে মাঝে সামান্য ভিন্ন পার্থক্যের পরামর্শ দেয়। কোনো বেকিং যদি স্পর্শকাতর হয় (সূক্ষ্ম পেস্ট্রি, সুফলে), তবে ওভেনের ম্যানুয়াল দেখে নেওয়া বা ওভেন থার্মোমিটার নিয়ে প্রথমবার পরীক্ষামূলক বেক করা ভালো।</p>" +
  "<h2>Gas Mark, সেলসিয়াস ও ফারেনহাইটের পূর্ণ রেফারেন্স তালিকা</h2>" +
  T("<th>Gas Mark</th><th>°C (প্রচলিত)</th><th>°F</th><th>ফ্যান/কনভেকশন °C</th><th>বিবরণ</th>",
    ["খুব কম","খুব কম","কম","কম","ঈষদুষ্ণ","মাঝারি","মাঝারি গরম","বেশ গরম","গরম","গরম","খুব গরম","খুব গরম"]) +
  "<h3>সাধারণ ভুল</h3>" +
  "<ul><li><strong>Gas Mark-কে নিখুঁত অঙ্ক ভাবা:</strong> এটি বারোটি প্রমিত বিন্দুর একটি তালিকা, রৈখিক রূপান্তর নয় — দুই মার্কের মাঝে পড়া সেলসিয়াস মানের নিজস্ব কোনো \"আসল\" Gas Mark নেই, কেবল সবচেয়ে কাছেরটি আছে।</li><li><strong>ফ্যানের সমন্বয় ভুলে যাওয়া:</strong> প্রচলিত ওভেনের রেসিপি পুরো তাপমাত্রাতেই ফ্যান ওভেনে চালালে ভেতর সেদ্ধ হওয়ার আগেই বাইরে বেশি বাদামি হয়ে যায়।</li><li><strong>প্রতিটি ওভেন ঠিকভাবে ক্যালিব্রেট করা ধরে নেওয়া:</strong> ঘরোয়া ওভেন ডায়ালের পাঠ থেকে 10-20°C পর্যন্ত সরে যেতে পারে; তাপমাত্রা-সংবেদনশীল বেকিংয়ে ওভেন থার্মোমিটারই বিষয়টি মীমাংসা করে।</li></ul>" +
  "<p>এই পাতার প্রতিটি রূপান্তর আপনার ব্রাউজারেই চলে; আপনি যা লেখেন তা কোথাও পাঠানো হয় না।</p>";

window.GUIDES["id"] = S +
  "<h2>Mengapa suhu oven memerlukan tiga skala berbeda</h2>" +
  "<p>Resep yang ditulis di Amerika Serikat memakai Fahrenheit. Resep dari sebagian besar wilayah dunia lainnya memakai Celsius. Resep dari buku masak Britania — atau oven lama dengan tombol putar alih-alih layar digital — memakai Gas Mark, bukan keduanya. Tidak ada yang salah di antaranya; itu hanya era dan wilayah peralatan dapur yang berbeda. Konverter ini mengubah salah satu dari ketiganya menjadi dua lainnya secara langsung, dan menambahkan satu penyesuaian yang jarang dijelaskan resep dengan gamblang: apa yang harus dilakukan jika oven Anda memakai kipas.</p>" +
  "<h3>Rumus Fahrenheit-Celsius</h3>" +
  "<ul><li>Celsius ke Fahrenheit: F = C &times; 9/5 + 32</li><li>Fahrenheit ke Celsius: C = (F &minus; 32) &times; 5/9</li></ul>" +
  "<p>Bagian itu matematika yang pasti. Gas Mark berbeda: skalanya bertingkat dan historis dengan hanya dua belas titik yang ditetapkan, sehingga alat ini mencocokkan angka Anda dengan titik terdekat alih-alih menghitung Gas Mark lewat rumus.</p>" +
  "<div class=\"example\"><strong>Contoh 1 — \"350 derajat\" yang klasik.</strong> (350&minus;32)&times;5/9 = 176,7°C, yang dibulatkan resep menjadi 180°C — Gas Mark 4, oven sedang, suhu memanggang paling umum yang ada.</div>" +
  "<div class=\"example\"><strong>Contoh 2 — panggangan panas.</strong> 220°C menjadi 220&times;9/5+32 = 428°F, cocok dengan Gas Mark 7 yang digambarkan \"panas\" dan lazim untuk memanggang sayuran atau menuntaskan roti agar kulitnya renyah.</div>" +
  "<div class=\"example\"><strong>Contoh 3 — memanggang lambat pada suhu rendah.</strong> Gas Mark 1/4 setara 110°C atau 225°F — oven \"sangat rendah\" untuk meringue, semur masak lambat, dan pengeringan buah, di mana tujuannya panas lembut dalam waktu lama, bukan memasak cepat.</div>" +
  "<h3>Oven kipas / konveksi: aturan -20°C</h3>" +
  "<p>Oven kipas (konveksi) mengedarkan udara panas dengan kipas bawaan, sehingga memasak lebih cepat dan lebih merata dibanding oven konvensional (statis) pada setelan yang sama. Karena itu, sebagian besar buku resep dan produsen oven menyarankan menurunkan suhu sekitar 20°C (kira-kira 25-30°F) saat memakai oven kipas, atau memangkas waktunya jika suhunya tetap. Alat ini menerapkan konvensi -20°C begitu Anda mengalihkan sakelar ke kipas/konveksi, dan selalu menampilkan angka setara untuk jenis oven satunya di samping hasil Anda agar resep bisa dikonversi ke dua arah.</p>" +
  "<p>Angka 20°C adalah patokan yang lazim dipakai, bukan hukum fisika — sebagian oven memanas lebih tinggi atau lebih rendah daripada yang ditunjukkan tombolnya, dan produsen kadang menyarankan selisih yang sedikit berbeda. Jika suatu panggangan tergolong sensitif (pastri halus, soufflé), ada baiknya memeriksa buku panduan oven atau melakukan uji panggang pertama dengan termometer oven.</p>" +
  "<h2>Tabel rujukan lengkap Gas Mark, Celsius, dan Fahrenheit</h2>" +
  T("<th>Gas Mark</th><th>°C (konvensional)</th><th>°F</th><th>Kipas/konveksi °C</th><th>Keterangan</th>",
    ["Sangat rendah","Sangat rendah","Rendah","Rendah","Hangat","Sedang","Agak panas","Cukup panas","Panas","Panas","Sangat panas","Sangat panas"]) +
  "<h3>Kesalahan umum</h3>" +
  "<ul><li><strong>Menganggap Gas Mark sebagai hitungan pasti:</strong> ini tabel rujukan berisi dua belas titik baku, bukan konversi linear — nilai Celsius yang jatuh di antara dua mark tidak punya Gas Mark \"sejati\" sendiri, hanya yang terdekat.</li><li><strong>Lupa penyesuaian kipas:</strong> mengikuti resep oven konvensional pada suhu penuh di oven kipas kerap membuat bagian luar terlalu cokelat sebelum bagian dalam matang.</li><li><strong>Mengira semua oven terkalibrasi tepat:</strong> oven rumahan bisa meleset 10-20°C dari angka pada tombolnya; termometer oven menjawab keraguan itu untuk panggangan yang peka suhu.</li></ul>" +
  "<p>Setiap konversi di halaman ini berjalan secara lokal di peramban Anda; tidak ada yang Anda ketik dikirim ke mana pun.</p>";

window.GUIDES["ur"] = S +
  "<h2>اوون کے درجۂ حرارت کے لیے تین مختلف پیمانوں کی ضرورت کیوں پڑتی ہے</h2>" +
  "<p>امریکہ میں لکھی گئی ترکیب درجۂ حرارت فارن ہائیٹ میں بتاتی ہے۔ دنیا کے بیشتر باقی حصوں کی ترکیب سیلسیس میں بتاتی ہے۔ برطانوی کک بک کی ترکیب — یا ڈیجیٹل ڈسپلے کے بجائے ڈائل والا پرانا اوون — ان دونوں کے بجائے Gas Mark بتاتا ہے۔ ان میں سے کوئی غلط نہیں؛ یہ محض باورچی خانے کے آلات کے مختلف ادوار اور خطے ہیں۔ یہ کنورٹر ان تینوں میں سے کسی ایک کو فوراً باقی دو میں بدل دیتا ہے، اور وہ ایک ایڈجسٹمنٹ بھی شامل کرتا ہے جو ترکیبیں شاذ و نادر ہی واضح کرتی ہیں: اگر آپ کے اوون میں پنکھا ہو تو کیا کریں۔</p>" +
  "<h3>فارن ہائیٹ-سیلسیس فارمولا</h3>" +
  "<ul><li>سیلسیس سے فارن ہائیٹ: F = C &times; 9/5 + 32</li><li>فارن ہائیٹ سے سیلسیس: C = (F &minus; 32) &times; 5/9</li></ul>" +
  "<p>یہ حصہ بالکل درست حساب ہے۔ Gas Mark مختلف ہے: یہ ایک زینہ دار، تاریخی پیمانہ ہے جس میں صرف بارہ متعین نکات ہیں، اس لیے یہ ٹول فارمولے سے Gas Mark نکالنے کے بجائے آپ کے عدد کو قریب ترین نکتے سے ملاتا ہے۔</p>" +
  "<div class=\"example\"><strong>مثال 1 — کلاسک \"350 ڈگری\"۔</strong> (350&minus;32)&times;5/9 = 176.7°C، جسے ترکیبیں 180°C تک گول کر لیتی ہیں — یعنی Gas Mark 4، ایک معتدل اوون، اور بیکنگ کا سب سے عام درجۂ حرارت۔</div>" +
  "<div class=\"example\"><strong>مثال 2 — تیز آنچ پر روسٹ۔</strong> 220°C کا تبادلہ 220&times;9/5+32 = 428°F بنتا ہے، جو Gas Mark 7 سے مطابقت رکھتا ہے؛ اسے \"گرم\" کہا جاتا ہے اور یہ سبزیاں بھوننے یا ڈبل روٹی کو کرارا کرسٹ دینے کے لیے عام ہے۔</div>" +
  "<div class=\"example\"><strong>مثال 3 — کم آنچ پر سست بیکنگ۔</strong> Gas Mark 1/4 یعنی 110°C یا 225°F — ایک \"بہت کم\" اوون جو میرینگ، دیر تک پکنے والے اسٹو اور پھل خشک کرنے کے لیے استعمال ہوتا ہے، جہاں مقصد تیز پکانا نہیں بلکہ طویل وقت تک ہلکی حرارت دینا ہے۔</div>" +
  "<h3>پنکھے / کنویکشن اوون: -20°C کا اصول</h3>" +
  "<p>پنکھے (کنویکشن) والا اوون اندرونی پنکھے سے گرم ہوا گھماتا ہے، جس سے وہی ڈائل سیٹنگ پر کھانا روایتی (ساکن) اوون کے مقابلے میں تیزی سے اور زیادہ یکساں پکتا ہے۔ اسی لیے بیشتر ترکیب کی کتابیں اور اوون بنانے والے پنکھے والے اوون میں درجۂ حرارت تقریباً 20°C (یعنی قریباً 25-30°F) کم کرنے کا مشورہ دیتے ہیں، یا اگر درجۂ حرارت وہی رکھنا ہو تو وقت کم کرنے کا۔ ٹوگل کو پنکھا/کنویکشن پر کرتے ہی یہ ٹول -20°C کا یہ اصول لاگو کر دیتا ہے، اور آپ کے نتیجے کے ساتھ ہمیشہ دوسری قسم کے اوون کا مساوی عدد بھی دکھاتا ہے تاکہ آپ ترکیب کو کسی بھی رخ میں بدل سکیں۔</p>" +
  "<p>20°C کا عدد ایک عام مستعمل اصولِ انگشت ہے، طبیعیات کا قانون نہیں — کچھ اوون اپنے ڈائل کے مقابلے میں زیادہ گرم یا زیادہ ٹھنڈے چلتے ہیں، اور بنانے والے کبھی کبھار قدرے مختلف فرق تجویز کرتے ہیں۔ اگر کوئی بیکنگ حساس ہو (نازک پیسٹری، سوفلے) تو اوون کی ہدایت نامہ دیکھ لینا یا اوون تھرمامیٹر کے ساتھ پہلی آزمائشی بیکنگ کرنا بہتر ہے۔</p>" +
  "<h2>Gas Mark، سیلسیس اور فارن ہائیٹ کا مکمل حوالہ جدول</h2>" +
  T("<th>Gas Mark</th><th>°C (روایتی)</th><th>°F</th><th>پنکھا/کنویکشن °C</th><th>تفصیل</th>",
    ["بہت کم","بہت کم","کم","کم","نیم گرم","معتدل","قدرے گرم","خاصا گرم","گرم","گرم","بہت گرم","بہت گرم"]) +
  "<h3>عام غلطیاں</h3>" +
  "<ul><li><strong>Gas Mark کو درست حساب سمجھنا:</strong> یہ بارہ معیاری نکات کا جدول ہے، خطی تبادلہ نہیں — دو مارک کے درمیان آنے والی سیلسیس قدر کا اپنا کوئی \"اصل\" Gas Mark نہیں ہوتا، صرف قریب ترین ہوتا ہے۔</li><li><strong>پنکھے کی ایڈجسٹمنٹ بھول جانا:</strong> روایتی اوون کی ترکیب پورے درجۂ حرارت پر پنکھے والے اوون میں چلانے سے اکثر اندر پکنے سے پہلے باہر ضرورت سے زیادہ بھورا ہو جاتا ہے۔</li><li><strong>یہ فرض کر لینا کہ ہر اوون درست کیلبریٹ شدہ ہے:</strong> گھریلو اوون اپنے ڈائل کی ریڈنگ سے 10-20°C تک ہٹ سکتے ہیں؛ درجۂ حرارت کے لحاظ سے حساس بیکنگ میں اوون تھرمامیٹر ہی فیصلہ کرتا ہے۔</li></ul>" +
  "<p>اس صفحے کا ہر تبادلہ آپ کے براؤزر ہی میں چلتا ہے؛ آپ جو کچھ ٹائپ کرتے ہیں وہ کہیں نہیں بھیجا جاتا۔</p>";
