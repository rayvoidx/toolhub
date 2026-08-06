/* gst-calc guide translations. Keys = UI language codes. Values = innerHTML of .guide-content. */
window.GUIDES = window.GUIDES || {};

var GUIDE_S_GST = "<style>.guide-content{max-width:none;margin:32px 0 8px;line-height:1.7}.guide-content h2{font-size:22px;font-weight:700;margin:28px 0 10px;letter-spacing:-.01em}.guide-content h3{font-size:17px;font-weight:650;margin:20px 0 6px}.guide-content p{margin:0 0 12px;color:var(--ink)}.guide-content ul,.guide-content ol{margin:0 0 12px;padding-left:22px}.guide-content li{margin:4px 0}.guide-content .example{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:14px 0;background:color-mix(in srgb,var(--accent) 5%,var(--surface))}.guide-content table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14px}.guide-content th,.guide-content td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}.guide-content th{color:var(--muted);font-weight:650}</style>";

window.GUIDES["ko"] = GUIDE_S_GST +
"<h2>GST 더하기와 빼기는 서로 반대 연산입니다</h2>\n" +
"<p>GST(재화·용역세)는 세전 가격 위에 하나의 비율로 부과되지만, 실무에서 마주치는 문제는 두 방향입니다. 세전 가격을 알고 세금 포함 총액을 구해야 할 때가 있습니다 — 상품 가격을 매기는 판매자, 청구서를 쓰는 프리랜서가 그렇습니다. 반대로 이미 GST가 포함된 영수증이나 견적서를 들고 원래 가격과 세액을 따로 계산해야 할 때도 있습니다 — 장부 정리, 경비 정산, 공급자가 올바른 세율을 적용했는지 확인할 때입니다. 이 계산기는 두 방향을 모두 처리하며, 인도의 경우 세액을 인도 세금계산서에 따로 표시되는 CGST와 SGST 절반씩으로 나눠 보여줍니다.</p>\n" +
"<h3>사용 방법</h3>\n" +
"<ol>\n" +
"<li><strong>GST 이전 금액</strong>(세금을 더하는 경우)인지 <strong>GST 포함 금액</strong>(세금을 빼는 경우)인지 선택합니다.</li>\n" +
"<li><strong>금액</strong>을 입력합니다.</li>\n" +
"<li>세율을 선택합니다: <strong>인도 슬래브</strong> 칩(5%, 12%, 18%, 28%) 또는 <strong>호주 / 뉴질랜드 / 싱가포르</strong> 칩(10%, 15%, 9%)을 누르거나, 원하는 세율을 직접 입력합니다.</li>\n" +
"<li>인도 주(州) 내 거래라면 <strong>GST를 CGST + SGST로 분할</strong>에 체크해 동일 주 세금계산서에 표시해야 하는 두 절반을 확인합니다.</li>\n" +
"<li><strong>계산</strong>을 눌러 세전 금액, GST 세액, 총액을 한 번에 확인합니다.</li>\n" +
"</ol>\n" +
"<h3>두 가지 공식</h3>\n" +
"<div class=\"example\">\n" +
"<strong>GST 더하기:</strong> GST = 세전금액 &times; 세율 &divide; 100, 그다음 총액 = 세전금액 + GST.<br>\n" +
"<strong>GST 빼기:</strong> 세전금액 = 총액 &divide; (1 + 세율 &divide; 100), 그다음 GST = 총액 &minus; 세전금액.\n" +
"<p style=\"margin:10px 0 0\">두 번째 공식이 나눗셈인 이유는, 원래 세금이 지금 들고 있는 총액이 아니라 더 작은 세전 금액을 기준으로 계산되었기 때문입니다. 총액에서 그 비율만큼 빼는 것이 GST 계산에서 가장 흔한 오류입니다.</p>\n" +
"</div>\n" +
"<h3>예제 세 가지</h3>\n" +
"<div class=\"example\"><strong>예제 1 — 인도 표준 세율 18%로 상품 가격 매기기.</strong> 세전 가격 2,500에 GST = 2,500 &times; 0.18 = 450이므로 진열 가격은 2,950입니다. 동일 주 거래로 CGST/SGST 분할을 체크하면 CGST 225, SGST 225가 표시되고 합계는 다시 450이 됩니다.</div>\n" +
"<div class=\"example\"><strong>예제 2 — GST 포함 청구서 읽기.</strong> 공급자 청구서 총액이 18% GST 포함 11,800입니다. 세전금액 = 11,800 &divide; 1.18 = 정확히 10,000, GST = 1,800입니다. 11,800에서 18%를 빼면 9,676이 나와 실제 세전 가격을 324만큼 과소 계산하게 됩니다.</div>\n" +
"<div class=\"example\"><strong>예제 3 — 호주의 단일 세율 10%.</strong> 세전 용역 대금 AUD 800에 GST = 80이므로 청구 총액은 880입니다. 전 세계 공통의 GST 더하기 공식을 인도 슬래브 대신 호주의 단일 세율에 적용한 것뿐입니다.</div>\n" +
"<h2>이 계산기가 다루는 GST / VAT 세율</h2>\n" +
"<table>\n" +
"<thead><tr><th>국가</th><th>세율</th><th>비고</th></tr></thead>\n" +
"<tbody>\n" +
"<tr><td>인도</td><td>5%, 12%, 18%, 28%</td><td>품목·서비스 분류에 따라 슬래브가 정해짐. 대부분 품목은 18%, 사치품과 기호품은 28%</td></tr>\n" +
"<tr><td>호주</td><td>10%</td><td>대부분의 재화·용역에 적용되는 단일 GST 세율</td></tr>\n" +
"<tr><td>뉴질랜드</td><td>15%</td><td>단일 세율로는 세계에서 높은 편에 속함</td></tr>\n" +
"<tr><td>싱가포르</td><td>9%</td><td>7%에서 단계적으로 인상(2022~2024)되어 2024년 9% 도달</td></tr>\n" +
"</tbody>\n" +
"</table>\n" +
"<h2>CGST, SGST, IGST — 같은 세금의 두 가지 배분</h2>\n" +
"<p>인도의 GST는 이중 구조입니다. 한 주 안에서 이뤄지는 거래는 세율이 정확히 절반으로 나뉘어, CGST(중앙 GST)는 중앙정부가, SGST(주 GST)는 주정부가 징수합니다. 즉 18% GST는 9% + 9%가 됩니다. 주 경계를 넘는 거래는 대신 전체 세율이 IGST(통합 GST)로 한 번 부과되고, 중앙정부가 나중에 도착지 주와 정산합니다. 어느 쪽이든 소비자가 내는 세율과 총 세수는 동일하며, 구매자와 판매자가 같은 주에 있는지에 따라 회계상 배분만 달라집니다.</p>\n" +
"<h2>흔한 실수</h2>\n" +
"<ul>\n" +
"<li><strong>나누지 않고 빼기.</strong> 총액에서 GST를 빼는 계산은 결코 \"총액 − 총액의 세율%\"가 아닙니다. 그렇게 하면 세전 가격은 과소, 세액은 과대 계산됩니다. (1 + 세율/100)으로 나누세요.</li>\n" +
"<li><strong>잘못된 인도 슬래브 적용.</strong> 인도 슬래브는 품목 분류로 정해지며 임의로 고를 수 없습니다. 식당 계산서, 고급 승용차, 생필품이 각기 다른 슬래브에 속할 수 있으므로 해당 재화·용역에 적용되는 세율을 먼저 확인하세요.</li>\n" +
"<li><strong>세스(cess) 누락.</strong> 담배, 탄산음료, 대형차 등 28% 품목 일부에는 GST 위에 보상 세스가 추가로 붙습니다. 이 계산기는 이를 반영하지 않으므로 결과는 GST 부분만으로 보아야 합니다.</li>\n" +
"<li><strong>CGST/SGST와 IGST 혼동.</strong> 분할은 동일 주 거래에만 적용됩니다. 주 간 거래는 CGST + SGST가 아니라 전체 세율의 IGST를 사용합니다.</li>\n" +
"</ul>\n" +
"<h2>이 계산기가 하지 않는 것</h2>\n" +
"<p>이 도구는 하나의 금액에 하나의 세율을 적용할 뿐입니다. 특정 상품이 어느 슬래브에 속하는지 조회하지 않고, 세스나 기타 부가금을 더하지 않으며, 면세·역과세(reverse charge)·간이과세(composition scheme) 규정도 반영하지 않습니다. 세율은 정부 고시에 따라 어떤 정적 자료보다도 빠르게 바뀝니다. 결과는 빠르고 투명한 산술 확인용으로 사용하고, 실제 신고·납부에 활용하기 전에는 해당 거래의 정확한 세율·세스·처리 방식을 관할 세무당국이나 세무 전문가에게 확인하십시오.</p>";

window.GUIDES["ja"] = GUIDE_S_GST +
"<h2>GSTの加算と控除は正反対の計算です</h2>\n" +
"<p>GST（物品・サービス税）は税抜価格に単一の税率で上乗せされますが、日常の問題は二方向あります。税抜価格が分かっていて税込合計を求める場合 — 商品の値付けをする店主や、請求書を書くフリーランサーです。逆に、すでにGSTが含まれたレシートや見積書を手にして、元の価格と税額を分けて算出する必要がある場合 — 記帳、経費精算、仕入先が正しい税率を適用したかの確認です。この計算機は両方向に対応し、インドについてはGST額をインドの税務インボイスに別記されるCGSTとSGSTの半分ずつに分割して表示します。</p>\n" +
"<h3>使い方</h3>\n" +
"<ol>\n" +
"<li><strong>GST加算前の金額</strong>（税を加える）か<strong>GST込みの金額</strong>（税を差し引く）かを選びます。</li>\n" +
"<li><strong>金額</strong>を入力します。</li>\n" +
"<li>税率を選びます。<strong>インドの税率区分</strong>チップ（5%、12%、18%、28%）または<strong>オーストラリア / ニュージーランド / シンガポール</strong>チップ（10%、15%、9%）を押すか、任意の税率を直接入力します。</li>\n" +
"<li>インドの州内取引なら<strong>GSTをCGST + SGSTに分割</strong>にチェックし、同一州のインボイスに表示すべき2つの等分を確認します。</li>\n" +
"<li><strong>計算</strong>を押すと、税抜金額・GST額・税込合計がまとめて表示されます。</li>\n" +
"</ol>\n" +
"<h3>2つの公式</h3>\n" +
"<div class=\"example\">\n" +
"<strong>GSTを加える:</strong> GST = 税抜金額 &times; 税率 &divide; 100、次に 税込 = 税抜 + GST。<br>\n" +
"<strong>GSTを差し引く:</strong> 税抜 = 税込 &divide; (1 + 税率 &divide; 100)、次に GST = 税込 &minus; 税抜。\n" +
"<p style=\"margin:10px 0 0\">2つめが割り算なのは、元の税が手元の合計ではなく、より小さい税抜金額に対して計算されたからです。合計から税率分を引いてしまうのが、GST計算で最も多い誤りです。</p>\n" +
"</div>\n" +
"<h3>3つの計算例</h3>\n" +
"<div class=\"example\"><strong>例1 — インドの標準区分18%で値付けする。</strong> 税抜価格2,500に対しGST = 2,500 &times; 0.18 = 450なので、店頭価格は2,950です。同一州取引としてCGST/SGST分割にチェックすると、CGST 225とSGST 225が表示され、合計は同じ450になります。</div>\n" +
"<div class=\"example\"><strong>例2 — GST込みの請求書を読む。</strong> 仕入先の請求書は18% GST込みで合計11,800です。税抜 = 11,800 &divide; 1.18 = ちょうど10,000、GST = 1,800。11,800から18%を引くと9,676となり、本当の税抜価格を324過小評価してしまいます。</div>\n" +
"<div class=\"example\"><strong>例3 — オーストラリアの一律10%。</strong> 税抜のサービス料AUD 800に対しGST = 80、請求合計は880です。世界共通のGST加算公式を、インドの区分ではなくオーストラリアの単一税率に当てはめただけです。</div>\n" +
"<h2>この計算機が対象とするGST / VAT税率</h2>\n" +
"<table>\n" +
"<thead><tr><th>国</th><th>税率</th><th>備考</th></tr></thead>\n" +
"<tbody>\n" +
"<tr><td>インド</td><td>5%、12%、18%、28%</td><td>区分は商品・サービスのカテゴリで決まる。大半の品目は18%、贅沢品・嗜好品は28%</td></tr>\n" +
"<tr><td>オーストラリア</td><td>10%</td><td>ほとんどの物品・サービスに適用される単一税率</td></tr>\n" +
"<tr><td>ニュージーランド</td><td>15%</td><td>単一税率としては世界でも高い水準</td></tr>\n" +
"<tr><td>シンガポール</td><td>9%</td><td>7%から段階的に引き上げ（2022〜2024年）、2024年に9%へ</td></tr>\n" +
"</tbody>\n" +
"</table>\n" +
"<h2>CGST・SGST・IGST — 同じ税の2通りの配分</h2>\n" +
"<p>インドのGSTは二元制です。州内の取引では税率がちょうど半分に分かれ、CGST（中央GST）は中央政府が、SGST（州GST）は州政府が徴収します。つまり18%のGSTは9% + 9%になります。州をまたぐ取引では、代わりに全税率が一度にIGST（統合GST）として課され、中央政府が後で仕向地の州と精算します。どちらでも消費者が支払う税率と税収総額は同じで、買い手と売り手が同じ州かどうかで会計上の配分が変わるだけです。</p>\n" +
"<h2>よくある間違い</h2>\n" +
"<ul>\n" +
"<li><strong>割らずに引く。</strong> 合計からGSTを外す計算は決して「合計 − 合計の税率%」ではありません。必ず税抜を過小に、税額を過大にします。(1 + 税率/100)で割ってください。</li>\n" +
"<li><strong>誤った区分の適用。</strong> インドの区分はカテゴリで割り当てられ、自由に選べません。飲食店の会計、高級車、生活必需品が別々の区分になり得るため、対象の物品・サービスに適用される税率を先に確認してください。</li>\n" +
"<li><strong>セス（cess）の失念。</strong> たばこ、炭酸飲料、大型車など28%区分の一部にはGSTに加えて補償セスが課されます。本計算機はこれを扱わないため、結果はGST部分のみと考えてください。</li>\n" +
"<li><strong>CGST/SGSTとIGSTの混同。</strong> 分割は同一州内のみ。州間取引はCGST + SGSTではなく、全税率のIGSTを使います。</li>\n" +
"</ul>\n" +
"<h2>この計算機ができないこと</h2>\n" +
"<p>本ツールは1つの金額に1つの税率を適用するだけです。特定商品がどの区分に入るかは調べず、セスやその他の付加金も加えず、免税・リバースチャージ・簡易課税（composition scheme）の規定も考慮しません。税率は政府通達によって、どんな静的資料よりも速く変わります。出力は手早く透明な算術チェックとして扱い、申告・納税の判断に使う前に、具体的な取引に適用される正確な税率・セス・取扱いを所轄の税務当局または税務専門家に確認してください。</p>";

window.GUIDES["zh"] = GUIDE_S_GST +
"<h2>加收 GST 与倒算 GST 是两个相反的运算</h2>\n" +
"<p>商品及服务税（GST）以单一百分比加在不含税价格之上，但日常遇到的问题分两个方向。有时你知道税前价格，需要算出含税总额——给商品定价的店主、开发票的自由职业者就是如此。另一些时候，你手里的收据或供应商报价已经包含 GST，需要把原价和税额分开算出来——用于记账、报销，或核对供应商是否用了正确税率。本计算器同时处理两个方向；对印度还会把 GST 金额拆成印度税务发票上分列的 CGST 与 SGST 两个一半。</p>\n" +
"<h3>使用方法</h3>\n" +
"<ol>\n" +
"<li>选择你手上的是<strong>税前金额</strong>（需要加税）还是<strong>含税金额</strong>（需要倒算）。</li>\n" +
"<li>输入<strong>金额</strong>。</li>\n" +
"<li>选择税率：点击<strong>印度税档</strong>标签（5%、12%、18%、28%）或<strong>澳大利亚 / 新西兰 / 新加坡</strong>标签（10%、15%、9%），也可直接输入任意税率。</li>\n" +
"<li>若为印度邦内交易，勾选<strong>将 GST 拆分为 CGST + SGST</strong>，查看同邦发票必须列示的两个等额部分。</li>\n" +
"<li>点击<strong>计算</strong>，一次看到税前金额、GST 税额与含税总额。</li>\n" +
"</ol>\n" +
"<h3>两个公式</h3>\n" +
"<div class=\"example\">\n" +
"<strong>加收 GST：</strong> GST = 税前 &times; 税率 &divide; 100，然后 含税 = 税前 + GST。<br>\n" +
"<strong>倒算 GST：</strong> 税前 = 含税 &divide; (1 + 税率 &divide; 100)，然后 GST = 含税 &minus; 税前。\n" +
"<p style=\"margin:10px 0 0\">第二个公式之所以是除法，正是因为当初的税是按较小的税前金额算出的，而不是按你现在手上的总额。用总额直接减去该百分比，是 GST 计算中最常见的错误。</p>\n" +
"</div>\n" +
"<h3>三个实例</h3>\n" +
"<div class=\"example\"><strong>例 1 —— 按印度标准 18% 档定价。</strong> 税前价 2,500，GST = 2,500 &times; 0.18 = 450，货架价即 2,950。按同邦交易勾选 CGST/SGST 拆分后显示 CGST 225、SGST 225，合计仍为 450。</div>\n" +
"<div class=\"example\"><strong>例 2 —— 读一张含税发票。</strong> 供应商发票总额 11,800，税率 18%。税前 = 11,800 &divide; 1.18 = 恰好 10,000，GST = 1,800。若用 11,800 直接减 18%，会得到 9,676，把真实税前价低估了 324。</div>\n" +
"<div class=\"example\"><strong>例 3 —— 澳大利亚统一 10%。</strong> 税前服务费 AUD 800，GST = 80，发票总额 880——用的是全球通行的加税公式，只是换成澳大利亚的单一税率而非印度税档。</div>\n" +
"<h2>本计算器覆盖的 GST / VAT 税率</h2>\n" +
"<table>\n" +
"<thead><tr><th>国家</th><th>税率</th><th>说明</th></tr></thead>\n" +
"<tbody>\n" +
"<tr><td>印度</td><td>5%、12%、18%、28%</td><td>税档按商品/服务类别确定；多数商品适用 18%，奢侈品与烟酒类为 28%</td></tr>\n" +
"<tr><td>澳大利亚</td><td>10%</td><td>对多数商品和服务适用的单一统一税率</td></tr>\n" +
"<tr><td>新西兰</td><td>15%</td><td>单一税率，属全球较高水平</td></tr>\n" +
"<tr><td>新加坡</td><td>9%</td><td>由 7% 分阶段上调（2022–2024），2024 年达到 9%</td></tr>\n" +
"</tbody>\n" +
"</table>\n" +
"<h2>CGST、SGST 与 IGST——同一笔税，两种分配</h2>\n" +
"<p>印度的 GST 是双重体制。邦内销售时税率恰好对半分：CGST（中央 GST）由中央政府征收，SGST（邦 GST）由邦政府征收，因此 18% 的 GST 变成 9% + 9%。跨邦销售则按全额税率一次性征收 IGST（综合 GST），中央政府事后与目的地邦结算。两种方式下消费者承担的税率和税收总额完全相同，只有会计上的分配随买卖双方是否同邦而变化。</p>\n" +
"<h2>常见错误</h2>\n" +
"<ul>\n" +
"<li><strong>用减法代替除法。</strong> 从总额中剔除 GST 绝不是「总额减去总额的税率%」；这样一定会低估税前价、高估税额。应除以 (1 + 税率/100)。</li>\n" +
"<li><strong>用错印度税档。</strong> 印度税档按类别指定，不能随意选择——餐厅账单、豪华轿车、粮油主食可能分属三个不同税档，请先确认具体商品或服务适用的税率。</li>\n" +
"<li><strong>忘记附加税（cess）。</strong> 印度 28% 档中的少数项目（如烟草、含气饮料、大排量汽车）在 GST 之外还有补偿性 cess，本计算器不做处理，结果仅为 GST 部分。</li>\n" +
"<li><strong>混淆 CGST/SGST 与 IGST。</strong> 拆分只适用于同邦交易；跨邦销售按全额税率使用 IGST，而非 CGST + SGST。</li>\n" +
"</ul>\n" +
"<h2>本计算器不做什么</h2>\n" +
"<p>本工具只是对一个金额套用一个税率——它不查询某商品属于哪一税档，不加 cess 或其他附加费，也不考虑免税、反向征收或简易计税（composition scheme）规则。税率还会随政府公告变动，快过任何静态资料的更新速度。请把结果当作快速、透明的算术核对，在用于合规申报之前，向当地税务机关或税务专业人士确认你这笔交易适用的确切税率、cess 与处理方式。</p>";

window.GUIDES["es"] = GUIDE_S_GST +
"<h2>Sumar el GST y quitarlo son operaciones opuestas</h2>\n" +
"<p>El GST (impuesto sobre bienes y servicios) se aplica como un porcentaje único sobre un precio neto, pero el problema cotidiano llega en dos direcciones. A veces conoces el precio antes de impuestos y necesitas el total con impuesto incluido: un comerciante fijando el precio de un producto, un profesional independiente emitiendo una factura. Otras veces tienes un recibo o un presupuesto que ya incluye el GST y necesitas separar el precio base del componente impositivo, para contabilidad, rendición de gastos o para verificar que el proveedor aplicó la tasa correcta. Esta calculadora resuelve ambas direcciones y, para India, además divide el GST en las mitades CGST y SGST que aparecen por separado en una factura fiscal india.</p>\n" +
"<h3>Cómo usar esta calculadora</h3>\n" +
"<ol>\n" +
"<li>Elige si tienes un <strong>importe antes del GST</strong> (lo estás sumando) o un <strong>importe con GST incluido</strong> (lo estás quitando).</li>\n" +
"<li>Introduce el <strong>importe</strong>.</li>\n" +
"<li>Elige una tasa: pulsa un chip de <strong>tramo de India</strong> (5 %, 12 %, 18 %, 28 %) o uno de <strong>Australia / Nueva Zelanda / Singapur</strong> (10 %, 15 %, 9 %), o escribe directamente cualquier tasa personalizada.</li>\n" +
"<li>Para una venta dentro del mismo estado de India, marca <strong>Dividir el GST en CGST + SGST</strong> para ver las dos mitades iguales que debe mostrar la factura.</li>\n" +
"<li>Pulsa <strong>Calcular</strong> para ver juntos el importe neto, el GST y el total bruto.</li>\n" +
"</ol>\n" +
"<h3>Las dos fórmulas</h3>\n" +
"<div class=\"example\">\n" +
"<strong>Sumar GST:</strong> GST = neto &times; tasa &divide; 100, y luego bruto = neto + GST.<br>\n" +
"<strong>Quitar GST:</strong> neto = bruto &divide; (1 + tasa &divide; 100), y luego GST = bruto &minus; neto.\n" +
"<p style=\"margin:10px 0 0\">La segunda fórmula es una división precisamente porque el impuesto original se calculó sobre la cifra neta, menor, y no sobre el total que tienes ahora: restar el porcentaje al total en lugar de dividir es el error de GST más frecuente.</p>\n" +
"</div>\n" +
"<h3>Tres ejemplos resueltos</h3>\n" +
"<div class=\"example\"><strong>Ejemplo 1: fijar precio con el tramo estándar del 18 % de India.</strong> Un precio neto de 2.500 genera GST = 2.500 &times; 0,18 = 450, así que el precio bruto en el estante es 2.950. Al marcar la división CGST/SGST para una venta dentro del mismo estado se ven CGST 225 y SGST 225, que suman de nuevo los mismos 450.</div>\n" +
"<div class=\"example\"><strong>Ejemplo 2: leer una factura con GST incluido.</strong> La factura de un proveedor muestra un total de 11.800 con GST del 18 %. Neto = 11.800 &divide; 1,18 = 10.000 exactos, y GST = 1.800. Restar el 18 % a 11.800 daría por error 9.676, subestimando el neto real en 324.</div>\n" +
"<div class=\"example\"><strong>Ejemplo 3: la tasa plana del 10 % de Australia.</strong> Un honorario neto de AUD 800 genera GST = 80, para una factura bruta de 880: la misma fórmula de suma usada en todo el mundo, solo que con la tasa única australiana en vez de un tramo indio.</div>\n" +
"<h2>Tasas de GST / IVA que cubre esta calculadora</h2>\n" +
"<table>\n" +
"<thead><tr><th>País</th><th>Tasa(s)</th><th>Notas</th></tr></thead>\n" +
"<tbody>\n" +
"<tr><td>India</td><td>5 %, 12 %, 18 %, 28 %</td><td>El tramo depende de la categoría del producto o servicio; el 18 % es el habitual y el 28 % se aplica a bienes de lujo y nocivos</td></tr>\n" +
"<tr><td>Australia</td><td>10 %</td><td>Tasa única de GST sobre la mayoría de bienes y servicios</td></tr>\n" +
"<tr><td>Nueva Zelanda</td><td>15 %</td><td>Tasa única, de las más altas del mundo entre las tasas planas</td></tr>\n" +
"<tr><td>Singapur</td><td>9 %</td><td>Llegó al 9 % en 2024 tras una subida escalonada desde el 7 % (2022–2024)</td></tr>\n" +
"</tbody>\n" +
"</table>\n" +
"<h2>CGST, SGST e IGST: el mismo impuesto, repartido de dos formas</h2>\n" +
"<p>El GST de India es un sistema dual. En una venta dentro de un mismo estado, la tasa se parte exactamente por la mitad: el CGST (GST central) lo recauda el gobierno central y el SGST (GST estatal) el gobierno del estado, de modo que un 18 % se convierte en 9 % + 9 %. En una venta entre estados, en cambio, se cobra la tasa completa una sola vez como IGST (GST integrado), que el gobierno central liquida después con el estado de destino. La tasa que paga el cliente y la recaudación total son idénticas en ambos casos: solo cambia el reparto contable según si comprador y vendedor están en el mismo estado.</p>\n" +
"<h2>Errores frecuentes</h2>\n" +
"<ul>\n" +
"<li><strong>Restar en lugar de dividir.</strong> Quitar el GST de un total nunca es «total menos el porcentaje del total»: siempre subestima el neto y sobreestima el impuesto. Divide entre (1 + tasa/100).</li>\n" +
"<li><strong>Aplicar el tramo indio equivocado.</strong> Los tramos de India se asignan por categoría, no se eligen libremente: una cuenta de restaurante, un coche de lujo y un alimento básico pueden estar en tres tramos distintos, así que confirma la tasa del bien o servicio concreto antes de fiarte del resultado.</li>\n" +
"<li><strong>Olvidar el cess.</strong> Algunos artículos del 28 % en India (tabaco, bebidas gaseosas, coches grandes) llevan un cess de compensación adicional sobre el GST que esta calculadora no modela: trata esos resultados solo como la parte del GST.</li>\n" +
"<li><strong>Confundir CGST/SGST con IGST.</strong> La división solo aplica dentro del mismo estado; una venta interestatal usa IGST a la tasa completa, no CGST + SGST.</li>\n" +
"</ul>\n" +
"<h2>Lo que esta calculadora no hace</h2>\n" +
"<p>Esta herramienta aplica una tasa a un importe: no averigua en qué tramo cae un producto concreto, no añade cess ni otros recargos, y no contempla exenciones, inversión del sujeto pasivo ni reglas del esquema de composición. Además, las tasas cambian por notificaciones gubernamentales más rápido de lo que puede seguir cualquier referencia estática. Toma el resultado como una comprobación aritmética rápida y transparente, y confirma la tasa exacta, el cess y el tratamiento fiscal de tu operación con tu autoridad tributaria o un profesional antes de usarlo para cumplir obligaciones.</p>";

window.GUIDES["fr"] = GUIDE_S_GST +
"<h2>Ajouter la GST et la retirer sont deux opérations inverses</h2>\n" +
"<p>La GST (taxe sur les biens et services) s'applique sous forme d'un pourcentage unique sur un prix hors taxe, mais le problème quotidien se pose dans deux sens. Parfois vous connaissez le prix hors taxe et cherchez le total toutes taxes comprises : un commerçant qui fixe un prix, un indépendant qui rédige une facture. D'autres fois, vous avez un reçu ou un devis qui inclut déjà la GST et devez isoler le prix de base et la part de taxe, pour la comptabilité, une note de frais, ou pour vérifier que le fournisseur a appliqué le bon taux. Ce calculateur traite les deux sens et, pour l'Inde, répartit aussi la GST en deux moitiés CGST et SGST, qui figurent séparément sur une facture fiscale indienne.</p>\n" +
"<h3>Comment utiliser ce calculateur</h3>\n" +
"<ol>\n" +
"<li>Indiquez si vous disposez d'un <strong>montant hors GST</strong> (vous ajoutez la taxe) ou d'un <strong>montant GST incluse</strong> (vous la retirez).</li>\n" +
"<li>Saisissez le <strong>montant</strong>.</li>\n" +
"<li>Choisissez un taux : appuyez sur une puce de <strong>tranche indienne</strong> (5 %, 12 %, 18 %, 28 %) ou <strong>Australie / Nouvelle-Zélande / Singapour</strong> (10 %, 15 %, 9 %), ou saisissez directement un taux personnalisé.</li>\n" +
"<li>Pour une vente intra-État en Inde, cochez <strong>Répartir la GST en CGST + SGST</strong> afin de voir les deux moitiés égales que la facture doit afficher.</li>\n" +
"<li>Appuyez sur <strong>Calculer</strong> pour voir ensemble le montant net, la GST et le total TTC.</li>\n" +
"</ol>\n" +
"<h3>Les deux formules</h3>\n" +
"<div class=\"example\">\n" +
"<strong>Ajouter la GST :</strong> GST = net &times; taux &divide; 100, puis TTC = net + GST.<br>\n" +
"<strong>Retirer la GST :</strong> net = TTC &divide; (1 + taux &divide; 100), puis GST = TTC &minus; net.\n" +
"<p style=\"margin:10px 0 0\">La seconde formule est une division précisément parce que la taxe initiale a été calculée sur le montant net, plus petit, et non sur le total que vous avez en main : soustraire le pourcentage du total au lieu de diviser est l'erreur de GST la plus fréquente.</p>\n" +
"</div>\n" +
"<h3>Trois exemples chiffrés</h3>\n" +
"<div class=\"example\"><strong>Exemple 1 — fixer un prix à la tranche standard indienne de 18 %.</strong> Un prix net de 2 500 donne GST = 2 500 &times; 0,18 = 450, donc le prix TTC en rayon est de 2 950. En cochant la répartition CGST/SGST pour une vente intra-État, on obtient CGST 225 et SGST 225, soit à nouveau 450 au total.</div>\n" +
"<div class=\"example\"><strong>Exemple 2 — lire une facture GST incluse.</strong> La facture d'un fournisseur affiche un total de 11 800 à 18 % de GST. Net = 11 800 &divide; 1,18 = exactement 10 000, et GST = 1 800. Retrancher 18 % de 11 800 donnerait à tort 9 676, sous-estimant le net réel de 324.</div>\n" +
"<div class=\"example\"><strong>Exemple 3 — le taux unique australien de 10 %.</strong> Des honoraires nets de 800 AUD donnent GST = 80, soit une facture de 880 : la même formule d'ajout utilisée partout dans le monde, appliquée au taux unique australien plutôt qu'à une tranche indienne.</div>\n" +
"<h2>Taux de GST / TVA couverts par ce calculateur</h2>\n" +
"<table>\n" +
"<thead><tr><th>Pays</th><th>Taux</th><th>Remarques</th></tr></thead>\n" +
"<tbody>\n" +
"<tr><td>Inde</td><td>5 %, 12 %, 18 %, 28 %</td><td>La tranche dépend de la catégorie du bien ou service ; 18 % pour la plupart des articles, 28 % pour le luxe et les produits taxés au titre de la santé publique</td></tr>\n" +
"<tr><td>Australie</td><td>10 %</td><td>Taux unique de GST sur la plupart des biens et services</td></tr>\n" +
"<tr><td>Nouvelle-Zélande</td><td>15 %</td><td>Taux unique, parmi les plus élevés au monde</td></tr>\n" +
"<tr><td>Singapour</td><td>9 %</td><td>Atteint 9 % en 2024 après une hausse progressive depuis 7 % (2022–2024)</td></tr>\n" +
"</tbody>\n" +
"</table>\n" +
"<h2>CGST, SGST et IGST — une même taxe, deux répartitions</h2>\n" +
"<p>La GST indienne est un système dual. Pour une vente au sein d'un même État, le taux est divisé exactement en deux : la CGST (GST centrale) revient au gouvernement central et la SGST (GST de l'État) au gouvernement de l'État, si bien qu'une GST de 18 % devient 9 % + 9 %. Pour une vente franchissant une frontière d'État, le taux plein est au contraire prélevé une seule fois sous forme d'IGST (GST intégrée), que le gouvernement central reverse ensuite à l'État de destination. Le taux payé par le client et la recette totale sont identiques dans les deux cas : seule la répartition comptable change selon que l'acheteur et le vendeur sont ou non dans le même État.</p>\n" +
"<h2>Erreurs fréquentes</h2>\n" +
"<ul>\n" +
"<li><strong>Soustraire au lieu de diviser.</strong> Retirer la GST d'un total n'est jamais « total moins taux % du total » : cela sous-estime toujours le net et surestime la taxe. Divisez par (1 + taux/100).</li>\n" +
"<li><strong>Appliquer la mauvaise tranche indienne.</strong> Les tranches sont attribuées par catégorie et ne se choisissent pas librement : une addition au restaurant, une voiture de luxe et un produit alimentaire de base peuvent relever de trois tranches différentes ; vérifiez le taux applicable au bien ou service concerné.</li>\n" +
"<li><strong>Oublier le cess.</strong> Quelques articles indiens à 28 % (tabac, boissons gazeuses, grosses cylindrées) supportent un cess de compensation en plus de la GST, non modélisé ici : ces résultats ne représentent que la part GST.</li>\n" +
"<li><strong>Confondre CGST/SGST et IGST.</strong> La répartition ne vaut qu'à l'intérieur d'un même État ; une vente inter-États utilise l'IGST au taux plein, et non CGST + SGST.</li>\n" +
"</ul>\n" +
"<h2>Ce que ce calculateur ne fait pas</h2>\n" +
"<p>Cet outil applique un taux unique à un montant : il ne détermine pas la tranche d'un produit donné, n'ajoute ni cess ni autres surtaxes, et ne tient pas compte des exonérations, de l'autoliquidation ni des règles du régime de composition. Les taux évoluent par notification gouvernementale plus vite qu'aucune référence statique ne peut suivre. Considérez le résultat comme une vérification arithmétique rapide et transparente, et confirmez le taux exact, le cess et le traitement applicables à votre opération auprès de votre administration fiscale ou d'un professionnel avant tout usage en matière de conformité.</p>";

window.GUIDES["de"] = GUIDE_S_GST +
"<h2>GST aufschlagen und GST herausrechnen sind gegenläufige Rechenschritte</h2>\n" +
"<p>Die GST (Waren- und Dienstleistungssteuer) wird als einheitlicher Prozentsatz auf einen Nettopreis erhoben, doch der Alltagsfall kommt in zwei Richtungen. Mal kennt man den Nettopreis und braucht den Bruttobetrag — etwa als Händler bei der Preisfindung oder als Freiberufler beim Schreiben einer Rechnung. Mal hält man eine Quittung oder ein Angebot in der Hand, in dem die GST bereits enthalten ist, und muss Nettopreis und Steueranteil trennen — für die Buchhaltung, die Spesenabrechnung oder um zu prüfen, ob der Lieferant den richtigen Satz angesetzt hat. Dieser Rechner deckt beide Richtungen ab und teilt den GST-Betrag für Indien zusätzlich in die Hälften CGST und SGST auf, die auf einer indischen Steuerrechnung getrennt ausgewiesen werden.</p>\n" +
"<h3>So verwenden Sie den Rechner</h3>\n" +
"<ol>\n" +
"<li>Wählen Sie, ob Sie einen <strong>Betrag vor GST</strong> haben (Steuer aufschlagen) oder einen <strong>Betrag inklusive GST</strong> (Steuer herausrechnen).</li>\n" +
"<li>Geben Sie den <strong>Betrag</strong> ein.</li>\n" +
"<li>Wählen Sie den Satz: Tippen Sie auf einen Chip der <strong>indischen Steuerstufen</strong> (5 %, 12 %, 18 %, 28 %) oder auf <strong>Australien / Neuseeland / Singapur</strong> (10 %, 15 %, 9 %) — oder geben Sie einen beliebigen eigenen Satz ein.</li>\n" +
"<li>Bei einem Verkauf innerhalb eines indischen Bundesstaats setzen Sie den Haken bei <strong>GST in CGST + SGST aufteilen</strong>, um die beiden gleich großen Hälften zu sehen, die die Rechnung ausweisen muss.</li>\n" +
"<li>Klicken Sie auf <strong>Berechnen</strong>, um Nettobetrag, GST-Betrag und Bruttosumme zusammen zu sehen.</li>\n" +
"</ol>\n" +
"<h3>Die zwei Formeln</h3>\n" +
"<div class=\"example\">\n" +
"<strong>GST aufschlagen:</strong> GST = netto &times; Satz &divide; 100, dann brutto = netto + GST.<br>\n" +
"<strong>GST herausrechnen:</strong> netto = brutto &divide; (1 + Satz &divide; 100), dann GST = brutto &minus; netto.\n" +
"<p style=\"margin:10px 0 0\">Die zweite Formel ist genau deshalb eine Division, weil die Steuer ursprünglich auf den kleineren Nettobetrag berechnet wurde und nicht auf die Summe, die Sie jetzt vor sich haben. Den Prozentsatz einfach vom Bruttobetrag abzuziehen ist der häufigste GST-Fehler überhaupt.</p>\n" +
"</div>\n" +
"<h3>Drei Rechenbeispiele</h3>\n" +
"<div class=\"example\"><strong>Beispiel 1 — Preisfindung bei Indiens Standardstufe von 18 %.</strong> Ein Nettopreis von 2.500 ergibt GST = 2.500 &times; 0,18 = 450, der Bruttopreis im Regal ist also 2.950. Mit CGST/SGST-Aufteilung für einen Verkauf im selben Bundesstaat erscheinen CGST 225 und SGST 225 — zusammen wieder 450.</div>\n" +
"<div class=\"example\"><strong>Beispiel 2 — eine Rechnung inklusive GST lesen.</strong> Die Lieferantenrechnung weist 11.800 bei 18 % GST aus. Netto = 11.800 &divide; 1,18 = exakt 10.000, GST = 1.800. Zieht man stattdessen 18 % von 11.800 ab, erhält man fälschlich 9.676 und unterschätzt den echten Nettopreis um 324.</div>\n" +
"<div class=\"example\"><strong>Beispiel 3 — Australiens einheitliche 10 %.</strong> Ein Nettohonorar von 800 AUD ergibt GST = 80 und eine Bruttorechnung von 880 — dieselbe weltweit übliche Aufschlagsformel, nur mit Australiens Einheitssatz statt einer indischen Stufe.</div>\n" +
"<h2>GST-/Mehrwertsteuersätze, die dieser Rechner abdeckt</h2>\n" +
"<table>\n" +
"<thead><tr><th>Land</th><th>Satz/Sätze</th><th>Hinweise</th></tr></thead>\n" +
"<tbody>\n" +
"<tr><td>Indien</td><td>5 %, 12 %, 18 %, 28 %</td><td>Die Stufe hängt von der Waren-/Dienstleistungskategorie ab; 18 % gilt für die meisten Artikel, 28 % für Luxus- und Genussgüter</td></tr>\n" +
"<tr><td>Australien</td><td>10 %</td><td>Einheitlicher GST-Satz auf die meisten Waren und Dienstleistungen</td></tr>\n" +
"<tr><td>Neuseeland</td><td>15 %</td><td>Einheitssatz, weltweit einer der höchsten</td></tr>\n" +
"<tr><td>Singapur</td><td>9 %</td><td>2024 auf 9 % gestiegen, nach stufenweiser Anhebung von 7 % (2022–2024)</td></tr>\n" +
"</tbody>\n" +
"</table>\n" +
"<h2>CGST, SGST und IGST — dieselbe Steuer, zwei Aufteilungen</h2>\n" +
"<p>Indiens GST ist ein duales System. Bei einem Verkauf innerhalb eines Bundesstaats wird der Satz exakt halbiert: Die CGST (zentrale GST) erhebt die Zentralregierung, die SGST (bundesstaatliche GST) der jeweilige Bundesstaat — aus 18 % GST werden also 9 % + 9 %. Bei einem Verkauf über die Grenze eines Bundesstaats hinweg wird stattdessen der volle Satz einmalig als IGST (integrierte GST) erhoben, die der Bund später mit dem Bestimmungsstaat abrechnet. Der Satz für den Kunden und das Gesamtaufkommen sind in beiden Fällen identisch; nur die buchhalterische Aufteilung ändert sich, je nachdem ob Käufer und Verkäufer im selben Bundesstaat sitzen.</p>\n" +
"<h2>Häufige Fehler</h2>\n" +
"<ul>\n" +
"<li><strong>Subtrahieren statt dividieren.</strong> GST aus einer Summe herauszurechnen heißt nie „Summe minus Satz % der Summe“ — das unterschätzt stets den Nettopreis und überschätzt die Steuer. Teilen Sie durch (1 + Satz/100).</li>\n" +
"<li><strong>Die falsche indische Stufe anwenden.</strong> Die Stufen sind nach Kategorie zugewiesen, nicht frei wählbar — eine Restaurantrechnung, ein Luxusauto und ein Grundnahrungsmittel können in drei verschiedenen Stufen liegen. Prüfen Sie den Satz für die konkrete Ware oder Leistung.</li>\n" +
"<li><strong>Den Cess vergessen.</strong> Auf einige indische 28 %-Positionen (Tabak, kohlensäurehaltige Getränke, große Autos) kommt zusätzlich ein Ausgleichs-Cess, den dieser Rechner nicht abbildet — die Ergebnisse zeigen nur den GST-Anteil.</li>\n" +
"<li><strong>CGST/SGST mit IGST verwechseln.</strong> Die Aufteilung gilt nur innerhalb eines Bundesstaats; ein Verkauf zwischen Bundesstaaten nutzt IGST zum vollen Satz, nicht CGST + SGST.</li>\n" +
"</ul>\n" +
"<h2>Was dieser Rechner nicht leistet</h2>\n" +
"<p>Das Werkzeug wendet einen Satz auf einen Betrag an — es schlägt nicht nach, in welche Stufe ein bestimmtes Produkt fällt, addiert keinen Cess oder andere Zuschläge und berücksichtigt weder Befreiungen noch Reverse-Charge- oder Composition-Scheme-Regeln. Sätze ändern sich zudem durch Regierungsbekanntmachungen schneller, als eine statische Referenz folgen kann. Behandeln Sie das Ergebnis als schnelle, nachvollziehbare Rechenprobe und klären Sie den genauen Satz, den Cess und die steuerliche Behandlung Ihres konkreten Vorgangs mit Ihrer Steuerbehörde oder einer Steuerberatung, bevor Sie darauf Compliance-Entscheidungen stützen.</p>";

window.GUIDES["pt"] = GUIDE_S_GST +
"<h2>Somar o GST e retirá-lo são operações opostas</h2>\n" +
"<p>O GST (imposto sobre bens e serviços) incide como um percentual único sobre um preço líquido, mas o problema do dia a dia aparece em duas direções. Às vezes você sabe o preço antes do imposto e precisa do total com imposto incluído — um lojista precificando um produto, um profissional autônomo emitindo uma fatura. Outras vezes você tem um recibo ou orçamento que já inclui o GST e precisa separar o preço base do componente de imposto — para a contabilidade, prestação de contas de despesas ou para conferir se o fornecedor aplicou a alíquota certa. Esta calculadora resolve as duas direções e, no caso da Índia, ainda divide o valor do GST nas metades CGST e SGST que aparecem separadamente numa nota fiscal indiana.</p>\n" +
"<h3>Como usar esta calculadora</h3>\n" +
"<ol>\n" +
"<li>Escolha se você tem um <strong>valor antes do GST</strong> (está somando o imposto) ou um <strong>valor com GST incluído</strong> (está retirando).</li>\n" +
"<li>Digite o <strong>valor</strong>.</li>\n" +
"<li>Escolha a alíquota: toque num chip de <strong>faixa da Índia</strong> (5%, 12%, 18%, 28%) ou de <strong>Austrália / Nova Zelândia / Singapura</strong> (10%, 15%, 9%), ou digite qualquer alíquota personalizada.</li>\n" +
"<li>Para uma venda dentro do mesmo estado indiano, marque <strong>Dividir o GST em CGST + SGST</strong> para ver as duas metades iguais que a nota deve exibir.</li>\n" +
"<li>Toque em <strong>Calcular</strong> para ver juntos o valor líquido, o GST e o total bruto.</li>\n" +
"</ol>\n" +
"<h3>As duas fórmulas</h3>\n" +
"<div class=\"example\">\n" +
"<strong>Somar GST:</strong> GST = líquido &times; alíquota &divide; 100, depois bruto = líquido + GST.<br>\n" +
"<strong>Retirar GST:</strong> líquido = bruto &divide; (1 + alíquota &divide; 100), depois GST = bruto &minus; líquido.\n" +
"<p style=\"margin:10px 0 0\">A segunda fórmula é uma divisão justamente porque o imposto original foi calculado sobre o valor líquido, menor, e não sobre o total que você tem em mãos — subtrair o percentual do total em vez de dividir é o erro de GST mais comum.</p>\n" +
"</div>\n" +
"<h3>Três exemplos resolvidos</h3>\n" +
"<div class=\"example\"><strong>Exemplo 1 — precificar na faixa padrão indiana de 18%.</strong> Um preço líquido de 2.500 gera GST = 2.500 &times; 0,18 = 450, então o preço bruto na prateleira é 2.950. Marcando a divisão CGST/SGST para venda no mesmo estado, aparecem CGST 225 e SGST 225, somando os mesmos 450.</div>\n" +
"<div class=\"example\"><strong>Exemplo 2 — ler uma fatura com GST incluído.</strong> A fatura do fornecedor mostra total de 11.800 com GST de 18%. Líquido = 11.800 &divide; 1,18 = exatamente 10.000, e GST = 1.800. Subtrair 18% de 11.800 daria 9.676 por engano, subestimando o líquido real em 324.</div>\n" +
"<div class=\"example\"><strong>Exemplo 3 — a alíquota única de 10% da Austrália.</strong> Um honorário líquido de AUD 800 gera GST = 80, para uma fatura bruta de 880 — a mesma fórmula de soma usada no mundo todo, só que com a alíquota única australiana em vez de uma faixa indiana.</div>\n" +
"<h2>Alíquotas de GST / IVA cobertas por esta calculadora</h2>\n" +
"<table>\n" +
"<thead><tr><th>País</th><th>Alíquota(s)</th><th>Observações</th></tr></thead>\n" +
"<tbody>\n" +
"<tr><td>Índia</td><td>5%, 12%, 18%, 28%</td><td>A faixa depende da categoria do produto/serviço; 18% é o padrão para a maioria dos itens e 28% para bens de luxo e supérfluos tributados</td></tr>\n" +
"<tr><td>Austrália</td><td>10%</td><td>Alíquota única de GST sobre a maioria dos bens e serviços</td></tr>\n" +
"<tr><td>Nova Zelândia</td><td>15%</td><td>Alíquota única, das mais altas do mundo</td></tr>\n" +
"<tr><td>Singapura</td><td>9%</td><td>Chegou a 9% em 2024 após aumento escalonado a partir de 7% (2022–2024)</td></tr>\n" +
"</tbody>\n" +
"</table>\n" +
"<h2>CGST, SGST e IGST — o mesmo imposto, repartido de dois jeitos</h2>\n" +
"<p>O GST indiano é um sistema dual. Numa venda dentro de um mesmo estado, a alíquota é dividida exatamente ao meio: o CGST (GST central) é arrecadado pelo governo central e o SGST (GST estadual) pelo governo do estado, de modo que 18% de GST viram 9% + 9%. Numa venda entre estados, a alíquota cheia é cobrada uma única vez como IGST (GST integrado), que o governo central depois acerta com o estado de destino. A alíquota paga pelo cliente e a arrecadação total são idênticas nos dois casos — muda apenas a repartição contábil, conforme comprador e vendedor estejam ou não no mesmo estado.</p>\n" +
"<h2>Erros comuns</h2>\n" +
"<ul>\n" +
"<li><strong>Subtrair em vez de dividir.</strong> Retirar o GST de um total nunca é \"total menos alíquota% do total\" — isso sempre subestima o líquido e superestima o imposto. Divida por (1 + alíquota/100).</li>\n" +
"<li><strong>Aplicar a faixa indiana errada.</strong> As faixas da Índia são atribuídas por categoria, não escolhidas livremente — uma conta de restaurante, um carro de luxo e um item básico de mercearia podem estar em três faixas diferentes, então confirme a alíquota do bem ou serviço específico.</li>\n" +
"<li><strong>Esquecer o cess.</strong> Alguns itens indianos de 28% (como tabaco, refrigerantes e carros grandes) têm um cess de compensação além do GST, que esta calculadora não modela — trate esses resultados apenas como a parcela de GST.</li>\n" +
"<li><strong>Confundir CGST/SGST com IGST.</strong> A divisão só vale dentro do mesmo estado; uma venda interestadual usa IGST na alíquota cheia, e não CGST + SGST.</li>\n" +
"</ul>\n" +
"<h2>O que esta calculadora não faz</h2>\n" +
"<p>Esta ferramenta aplica uma alíquota a um valor — não descobre em que faixa um produto específico se enquadra, não acrescenta cess nem outras sobretaxas e não considera isenções, substituição/reversão de responsabilidade nem regras do regime de composição. As alíquotas também mudam por notificações do governo mais rápido do que qualquer referência estática consegue acompanhar. Trate o resultado como uma conferência aritmética rápida e transparente, e confirme a alíquota exata, o cess e o tratamento fiscal da sua operação com a autoridade tributária local ou um profissional antes de usá-lo para fins de conformidade.</p>";

window.GUIDES["ru"] = GUIDE_S_GST +
"<h2>Начисление GST и его выделение — противоположные операции</h2>\n" +
"<p>GST (налог на товары и услуги) начисляется единым процентом сверх цены без налога, но на практике задача возникает в двух направлениях. Иногда известна цена до налога и нужна сумма с налогом — так считает продавец, назначающий цену, или фрилансер, выставляющий счёт. В других случаях у вас на руках чек или счёт поставщика, где GST уже включён, и нужно отдельно получить базовую цену и сумму налога — для учёта, авансового отчёта или проверки того, применил ли поставщик верную ставку. Этот калькулятор считает в обе стороны, а для Индии дополнительно делит сумму GST на половины CGST и SGST, которые в индийском налоговом счёте показываются отдельно.</p>\n" +
"<h3>Как пользоваться калькулятором</h3>\n" +
"<ol>\n" +
"<li>Выберите, что у вас есть: <strong>сумма без GST</strong> (налог начисляем) или <strong>сумма с GST</strong> (налог выделяем).</li>\n" +
"<li>Введите <strong>сумму</strong>.</li>\n" +
"<li>Выберите ставку: нажмите чип <strong>индийской ставки</strong> (5 %, 12 %, 18 %, 28 %) либо <strong>Австралия / Новая Зеландия / Сингапур</strong> (10 %, 15 %, 9 %), или введите любую свою ставку.</li>\n" +
"<li>Для продажи внутри одного штата Индии отметьте <strong>Разделить GST на CGST + SGST</strong>, чтобы увидеть две равные половины, которые обязан показывать счёт.</li>\n" +
"<li>Нажмите <strong>Рассчитать</strong> — вы увидите сумму без налога, сумму GST и итог с налогом вместе.</li>\n" +
"</ol>\n" +
"<h3>Две формулы</h3>\n" +
"<div class=\"example\">\n" +
"<strong>Начислить GST:</strong> GST = сумма без налога &times; ставка &divide; 100, затем итог = сумма без налога + GST.<br>\n" +
"<strong>Выделить GST:</strong> сумма без налога = итог &divide; (1 + ставка &divide; 100), затем GST = итог &minus; сумма без налога.\n" +
"<p style=\"margin:10px 0 0\">Вторая формула — именно деление, потому что исходный налог считался от меньшей суммы без налога, а не от того итога, который у вас на руках. Вычитание процента из итога вместо деления — самая частая ошибка в расчётах GST.</p>\n" +
"</div>\n" +
"<h3>Три разобранных примера</h3>\n" +
"<div class=\"example\"><strong>Пример 1 — ценообразование по стандартной индийской ставке 18 %.</strong> При цене без налога 2 500 GST = 2 500 &times; 0,18 = 450, значит цена на полке — 2 950. Если отметить деление CGST/SGST для продажи внутри штата, получим CGST 225 и SGST 225, что в сумме снова даёт 450.</div>\n" +
"<div class=\"example\"><strong>Пример 2 — чтение счёта с включённым GST.</strong> В счёте поставщика итог 11 800 при ставке 18 %. Сумма без налога = 11 800 &divide; 1,18 = ровно 10 000, GST = 1 800. Если же вычесть 18 % из 11 800, получится ошибочные 9 676 — занижение реальной базы на 324.</div>\n" +
"<div class=\"example\"><strong>Пример 3 — единая ставка Австралии 10 %.</strong> При стоимости услуги без налога AUD 800 GST = 80, итог счёта — 880: та же универсальная формула начисления, только с единой австралийской ставкой вместо индийской.</div>\n" +
"<h2>Ставки GST / НДС, которые охватывает калькулятор</h2>\n" +
"<table>\n" +
"<thead><tr><th>Страна</th><th>Ставки</th><th>Примечания</th></tr></thead>\n" +
"<tbody>\n" +
"<tr><td>Индия</td><td>5 %, 12 %, 18 %, 28 %</td><td>Ставка зависит от категории товара или услуги; 18 % — для большинства позиций, 28 % — для luxury-товаров и подакцизных категорий</td></tr>\n" +
"<tr><td>Австралия</td><td>10 %</td><td>Единая ставка GST на большинство товаров и услуг</td></tr>\n" +
"<tr><td>Новая Зеландия</td><td>15 %</td><td>Единая ставка, одна из самых высоких в мире среди плоских ставок</td></tr>\n" +
"<tr><td>Сингапур</td><td>9 %</td><td>Достигла 9 % в 2024 году после поэтапного повышения с 7 % (2022–2024)</td></tr>\n" +
"</tbody>\n" +
"</table>\n" +
"<h2>CGST, SGST и IGST — один налог, два способа распределения</h2>\n" +
"<p>GST в Индии — двойная система. При продаже внутри одного штата ставка делится ровно пополам: CGST (центральный GST) поступает федеральному правительству, SGST (штатный GST) — правительству штата, поэтому 18 % превращаются в 9 % + 9 %. При продаже через границу штата вся ставка взимается один раз как IGST (интегрированный GST), который центр затем распределяет со штатом назначения. Ставка для покупателя и общая сумма поступлений в обоих случаях одинаковы — меняется только учётное распределение в зависимости от того, находятся ли продавец и покупатель в одном штате.</p>\n" +
"<h2>Частые ошибки</h2>\n" +
"<ul>\n" +
"<li><strong>Вычитание вместо деления.</strong> Выделение GST из итога — это никогда не «итог минус ставка % от итога»: так база всегда занижается, а налог завышается. Делите на (1 + ставка/100).</li>\n" +
"<li><strong>Неверная индийская ставка.</strong> Ставки в Индии закреплены за категориями, их нельзя выбирать произвольно: счёт в ресторане, автомобиль премиум-класса и базовый продукт питания могут попадать в три разные ставки, поэтому уточните ставку для конкретного товара или услуги.</li>\n" +
"<li><strong>Забытый cess.</strong> На часть индийских позиций со ставкой 28 % (табак, газированные напитки, крупные автомобили) сверх GST начисляется компенсационный сбор cess, который калькулятор не учитывает — результат отражает только часть GST.</li>\n" +
"<li><strong>Путаница CGST/SGST и IGST.</strong> Деление применяется только внутри одного штата; межштатная продажа облагается IGST по полной ставке, а не CGST + SGST.</li>\n" +
"</ul>\n" +
"<h2>Чего калькулятор не делает</h2>\n" +
"<p>Инструмент применяет одну ставку к одной сумме: он не определяет, к какой ставке относится конкретный товар, не добавляет cess и другие надбавки, не учитывает освобождения, обратное начисление и правила упрощённой схемы (composition scheme). Ставки к тому же меняются правительственными уведомлениями быстрее, чем это отражает любой статичный справочник. Используйте результат как быструю и прозрачную арифметическую проверку, а точную ставку, cess и порядок учёта по вашей операции подтвердите в налоговом органе или у налогового консультанта, прежде чем опираться на расчёт в отчётности.</p>";

window.GUIDES["ar"] = GUIDE_S_GST +
"<h2>إضافة ضريبة GST وإزالتها عمليتان متعاكستان</h2>\n" +
"<p>تُفرض ضريبة السلع والخدمات (GST) كنسبة مئوية واحدة فوق السعر الصافي، لكن المسألة اليومية تأتي في اتجاهين. أحيانًا تعرف السعر قبل الضريبة وتحتاج إلى الإجمالي شامل الضريبة — كتاجر يسعّر منتجًا، أو مستقل يحرّر فاتورة. وأحيانًا تكون بيدك إيصال أو عرض سعر يتضمن الضريبة أصلًا، وتحتاج إلى فصل السعر الأساسي عن مكوّن الضريبة — لأغراض المحاسبة أو المطالبة بالمصروفات أو التأكد من أن المورّد طبّق النسبة الصحيحة. تتعامل هذه الحاسبة مع الاتجاهين، كما تقسّم مبلغ الضريبة في حالة الهند إلى نصفَي CGST وSGST اللذين يظهران منفصلين في الفاتورة الضريبية الهندية.</p>\n" +
"<h3>كيفية استخدام الحاسبة</h3>\n" +
"<ol>\n" +
"<li>اختر ما إذا كان لديك <strong>مبلغ قبل الضريبة</strong> (أي تضيفها) أو <strong>مبلغ شامل الضريبة</strong> (أي تزيلها).</li>\n" +
"<li>أدخل <strong>المبلغ</strong>.</li>\n" +
"<li>اختر النسبة: اضغط على شريحة <strong>شرائح الهند</strong> (5%، 12%، 18%، 28%) أو <strong>أستراليا / نيوزيلندا / سنغافورة</strong> (10%، 15%، 9%)، أو اكتب أي نسبة مخصّصة مباشرة.</li>\n" +
"<li>في البيع داخل الولاية الهندية نفسها، فعّل خيار <strong>تقسيم GST إلى CGST + SGST</strong> لرؤية النصفين المتساويين اللذين يجب أن تُظهرهما الفاتورة.</li>\n" +
"<li>اضغط <strong>احسب</strong> لترى المبلغ الصافي ومبلغ الضريبة والإجمالي معًا.</li>\n" +
"</ol>\n" +
"<h3>المعادلتان</h3>\n" +
"<div class=\"example\">\n" +
"<strong>إضافة الضريبة:</strong> الضريبة = الصافي &times; النسبة &divide; 100، ثم الإجمالي = الصافي + الضريبة.<br>\n" +
"<strong>إزالة الضريبة:</strong> الصافي = الإجمالي &divide; (1 + النسبة &divide; 100)، ثم الضريبة = الإجمالي &minus; الصافي.\n" +
"<p style=\"margin:10px 0 0\">المعادلة الثانية قسمة تحديدًا لأن الضريبة الأصلية حُسبت على المبلغ الصافي الأصغر، لا على الإجمالي الذي بيدك الآن؛ وطرح النسبة من الإجمالي بدل القسمة هو أشهر خطأ في حسابات GST.</p>\n" +
"</div>\n" +
"<h3>ثلاثة أمثلة محلولة</h3>\n" +
"<div class=\"example\"><strong>المثال 1 — تسعير منتج بشريحة الهند القياسية 18%.</strong> سعر صافٍ قدره 2,500 ينتج ضريبة = 2,500 &times; 0.18 = 450، فيكون سعر الرف الإجمالي 2,950. وبتفعيل تقسيم CGST/SGST لبيع داخل الولاية نفسها تظهر CGST 225 وSGST 225، ومجموعهما 450 نفسه.</div>\n" +
"<div class=\"example\"><strong>المثال 2 — قراءة فاتورة شاملة للضريبة.</strong> فاتورة المورّد إجماليها 11,800 بنسبة 18%. الصافي = 11,800 &divide; 1.18 = 10,000 بالضبط، والضريبة = 1,800. أما طرح 18% من 11,800 فيعطي 9,676 خطأً، ويقلّل الصافي الحقيقي بمقدار 324.</div>\n" +
"<div class=\"example\"><strong>المثال 3 — نسبة أستراليا الموحدة 10%.</strong> أتعاب خدمة صافية قدرها 800 دولار أسترالي تنتج ضريبة = 80، فيصبح إجمالي الفاتورة 880 — المعادلة نفسها المستخدمة عالميًا، لكن بنسبة أستراليا الموحدة بدل شريحة هندية.</div>\n" +
"<h2>نسب GST / ضريبة القيمة المضافة التي تغطيها الحاسبة</h2>\n" +
"<table>\n" +
"<thead><tr><th>الدولة</th><th>النسبة</th><th>ملاحظات</th></tr></thead>\n" +
"<tbody>\n" +
"<tr><td>الهند</td><td>5%، 12%، 18%، 28%</td><td>تتحدد الشريحة حسب فئة السلعة أو الخدمة؛ 18% هي الشائعة لمعظم البنود، و28% للكماليات والسلع الضارة</td></tr>\n" +
"<tr><td>أستراليا</td><td>10%</td><td>نسبة موحدة على معظم السلع والخدمات</td></tr>\n" +
"<tr><td>نيوزيلندا</td><td>15%</td><td>نسبة موحدة، من أعلى النسب الموحدة عالميًا</td></tr>\n" +
"<tr><td>سنغافورة</td><td>9%</td><td>بلغت 9% في 2024 بعد رفع تدريجي من 7% (2022–2024)</td></tr>\n" +
"</tbody>\n" +
"</table>\n" +
"<h2>CGST وSGST وIGST — ضريبة واحدة بتقسيمين</h2>\n" +
"<p>نظام GST في الهند مزدوج. ففي البيع داخل الولاية الواحدة تُقسم النسبة إلى نصفين متساويين تمامًا: CGST (الضريبة المركزية) تحصّلها الحكومة المركزية، وSGST (ضريبة الولاية) تحصّلها حكومة الولاية، فتصبح 18% هي 9% + 9%. أما البيع عبر حدود الولايات فتُفرض فيه النسبة كاملة مرة واحدة باسم IGST (الضريبة المتكاملة)، وتسوّيها الحكومة المركزية لاحقًا مع ولاية الوجهة. النسبة التي يدفعها العميل وإجمالي الحصيلة متطابقان في الحالتين؛ ما يتغير هو التوزيع المحاسبي فقط بحسب وجود البائع والمشتري في الولاية نفسها من عدمه.</p>\n" +
"<h2>أخطاء شائعة</h2>\n" +
"<ul>\n" +
"<li><strong>الطرح بدل القسمة.</strong> إزالة الضريبة من الإجمالي ليست أبدًا «الإجمالي ناقص نسبة% من الإجمالي»؛ فهذا يقلّل الصافي ويضخّم الضريبة دائمًا. اقسم على (1 + النسبة/100).</li>\n" +
"<li><strong>تطبيق شريحة هندية خاطئة.</strong> الشرائح في الهند تُحدَّد بحسب الفئة ولا تُختار بحرية — فاتورة مطعم وسيارة فارهة وسلعة غذائية أساسية قد تقع في ثلاث شرائح مختلفة، فتأكد من النسبة المطبّقة على السلعة أو الخدمة تحديدًا.</li>\n" +
"<li><strong>نسيان رسم cess.</strong> بعض بنود شريحة 28% في الهند (كالتبغ والمشروبات الغازية والسيارات الكبيرة) تحمل رسم تعويض إضافيًا فوق GST لا تحسبه هذه الأداة — فاعتبر النتيجة جزء GST فقط.</li>\n" +
"<li><strong>الخلط بين CGST/SGST وIGST.</strong> التقسيم يسري داخل الولاية نفسها فقط؛ أما البيع بين الولايات فيستخدم IGST بالنسبة الكاملة لا CGST + SGST.</li>\n" +
"</ul>\n" +
"<h2>ما لا تفعله هذه الحاسبة</h2>\n" +
"<p>تطبّق هذه الأداة نسبة واحدة على مبلغ واحد؛ فهي لا تحدد الشريحة التي يقع فيها منتج بعينه، ولا تضيف رسم cess أو أي رسوم إضافية، ولا تراعي الإعفاءات أو آلية الاحتساب العكسي أو قواعد نظام التسوية المبسّط (composition scheme). كما تتغير النسب بإشعارات حكومية أسرع من أي مرجع ثابت. تعامل مع النتيجة كتحقق حسابي سريع وشفاف، وتأكد من النسبة الدقيقة والرسوم والمعالجة الضريبية لمعاملتك لدى الجهة الضريبية المحلية أو مختص ضرائب قبل الاعتماد عليها في الامتثال.</p>";

window.GUIDES["hi"] = GUIDE_S_GST +
"<h2>GST जोड़ना और GST हटाना उलटी प्रक्रियाएँ हैं</h2>\n" +
"<p>GST (वस्तु एवं सेवा कर) शुद्ध यानी कर-रहित मूल्य पर एक ही प्रतिशत के रूप में लगता है, पर रोज़मर्रा की समस्या दो दिशाओं में आती है। कभी आपको कर-पूर्व मूल्य पता होता है और कर-सहित कुल राशि चाहिए होती है — जैसे किसी दुकानदार को उत्पाद की कीमत तय करते समय या फ्रीलांसर को बिल बनाते समय। कभी आपके हाथ में ऐसा बिल या कोटेशन होता है जिसमें GST पहले से शामिल है और आपको मूल कीमत तथा कर का हिस्सा अलग-अलग निकालना होता है — बहीखाते, खर्च दावे, या यह जाँचने के लिए कि आपूर्तिकर्ता ने सही दर लगाई या नहीं। यह कैलकुलेटर दोनों दिशाओं में काम करता है और भारत के लिए GST राशि को CGST तथा SGST के दो बराबर हिस्सों में भी बाँटता है, जो भारतीय टैक्स इनवॉइस पर अलग-अलग दिखते हैं।</p>\n" +
"<h3>इस कैलकुलेटर का उपयोग कैसे करें</h3>\n" +
"<ol>\n" +
"<li>चुनें कि आपके पास <strong>GST से पहले की राशि</strong> है (कर जोड़ना है) या <strong>GST सहित राशि</strong> (कर हटाना है)।</li>\n" +
"<li><strong>राशि</strong> दर्ज करें।</li>\n" +
"<li>दर चुनें: <strong>भारतीय स्लैब</strong> चिप (5%, 12%, 18%, 28%) या <strong>ऑस्ट्रेलिया / न्यूज़ीलैंड / सिंगापुर</strong> चिप (10%, 15%, 9%) दबाएँ, या कोई भी दर सीधे टाइप करें।</li>\n" +
"<li>राज्य के भीतर की बिक्री के लिए <strong>GST को CGST + SGST में बाँटें</strong> पर टिक करें, ताकि वे दो बराबर हिस्से दिखें जो एक ही राज्य के इनवॉइस पर दिखाना ज़रूरी है।</li>\n" +
"<li><strong>गणना करें</strong> दबाएँ और शुद्ध राशि, GST राशि तथा कुल राशि एक साथ देखें।</li>\n" +
"</ol>\n" +
"<h3>दो सूत्र</h3>\n" +
"<div class=\"example\">\n" +
"<strong>GST जोड़ना:</strong> GST = शुद्ध राशि &times; दर &divide; 100, फिर कुल = शुद्ध राशि + GST।<br>\n" +
"<strong>GST हटाना:</strong> शुद्ध राशि = कुल &divide; (1 + दर &divide; 100), फिर GST = कुल &minus; शुद्ध राशि।\n" +
"<p style=\"margin:10px 0 0\">दूसरा सूत्र भाग इसलिए है क्योंकि मूल कर उस छोटी शुद्ध राशि पर लगाया गया था, न कि उस कुल राशि पर जो अभी आपके पास है। कुल में से सीधे उतना प्रतिशत घटा देना GST की सबसे आम गलती है।</p>\n" +
"</div>\n" +
"<h3>तीन हल किए गए उदाहरण</h3>\n" +
"<div class=\"example\"><strong>उदाहरण 1 — भारत के मानक 18% स्लैब पर कीमत तय करना।</strong> 2,500 की शुद्ध कीमत पर GST = 2,500 &times; 0.18 = 450, इसलिए शेल्फ पर कुल कीमत 2,950 होगी। एक ही राज्य की बिक्री के लिए CGST/SGST विभाजन टिक करने पर CGST 225 और SGST 225 दिखते हैं, जिनका योग वही 450 है।</div>\n" +
"<div class=\"example\"><strong>उदाहरण 2 — GST-सहित इनवॉइस पढ़ना।</strong> आपूर्तिकर्ता के बिल में 18% GST के साथ कुल 11,800 है। शुद्ध = 11,800 &divide; 1.18 = ठीक 10,000, और GST = 1,800। इसके बजाय 11,800 में से 18% घटाने पर गलत 9,676 आता, जो असली शुद्ध कीमत को 324 कम आँकता।</div>\n" +
"<div class=\"example\"><strong>उदाहरण 3 — ऑस्ट्रेलिया की एकसमान 10% दर।</strong> AUD 800 की शुद्ध सेवा फीस पर GST = 80, यानी कुल बिल 880 — वही GST जोड़ने वाला विश्वव्यापी सूत्र, बस भारतीय स्लैब की जगह ऑस्ट्रेलिया की एकल दर पर।</div>\n" +
"<h2>यह कैलकुलेटर किन GST / VAT दरों को कवर करता है</h2>\n" +
"<table>\n" +
"<thead><tr><th>देश</th><th>दर(ें)</th><th>टिप्पणी</th></tr></thead>\n" +
"<tbody>\n" +
"<tr><td>भारत</td><td>5%, 12%, 18%, 28%</td><td>स्लैब वस्तु/सेवा की श्रेणी पर निर्भर करता है; अधिकांश वस्तुओं पर 18% और विलासिता व अहितकर वस्तुओं पर 28%</td></tr>\n" +
"<tr><td>ऑस्ट्रेलिया</td><td>10%</td><td>अधिकांश वस्तुओं व सेवाओं पर एकसमान GST दर</td></tr>\n" +
"<tr><td>न्यूज़ीलैंड</td><td>15%</td><td>एकल दर, दुनिया की सबसे ऊँची एकसमान दरों में से एक</td></tr>\n" +
"<tr><td>सिंगापुर</td><td>9%</td><td>7% से चरणबद्ध वृद्धि (2022–2024) के बाद 2024 में 9% तक पहुँची</td></tr>\n" +
"</tbody>\n" +
"</table>\n" +
"<h2>CGST, SGST और IGST — एक ही कर, दो तरह का बँटवारा</h2>\n" +
"<p>भारत का GST दोहरी व्यवस्था है। एक ही राज्य के भीतर बिक्री पर दर ठीक आधी-आधी बँटती है: CGST (केंद्रीय GST) केंद्र सरकार वसूलती है और SGST (राज्य GST) राज्य सरकार, यानी 18% GST 9% + 9% बन जाता है। राज्य की सीमा पार बिक्री पर पूरी दर एक बार IGST (एकीकृत GST) के रूप में लगती है, जिसका निपटान केंद्र बाद में गंतव्य राज्य के साथ करता है। दोनों ही स्थितियों में ग्राहक द्वारा चुकाई गई दर और कुल राजस्व एक समान रहते हैं — सिर्फ़ लेखांकन का बँटवारा बदलता है, यह इस पर निर्भर करता है कि क्रेता और विक्रेता एक ही राज्य में हैं या नहीं।</p>\n" +
"<h2>आम गलतियाँ</h2>\n" +
"<ul>\n" +
"<li><strong>भाग देने की जगह घटाना।</strong> कुल में से GST निकालना कभी भी \"कुल घटा कुल का दर%\" नहीं होता — इससे शुद्ध कीमत हमेशा कम और कर ज़्यादा आँका जाता है। (1 + दर/100) से भाग दें।</li>\n" +
"<li><strong>ग़लत भारतीय स्लैब लगाना।</strong> भारत में स्लैब श्रेणी के अनुसार तय होते हैं, मनमर्ज़ी से नहीं चुने जाते — रेस्तराँ का बिल, लक्ज़री कार और रोज़मर्रा का किराना तीन अलग स्लैब में हो सकते हैं, इसलिए संबंधित वस्तु या सेवा की दर पहले पक्की कर लें।</li>\n" +
"<li><strong>सेस भूल जाना।</strong> भारत की 28% श्रेणी की कुछ वस्तुओं (जैसे तंबाकू, एरेटेड ड्रिंक्स, बड़ी कारें) पर GST के ऊपर अतिरिक्त कॉम्पेंसेशन सेस लगता है, जिसे यह कैलकुलेटर नहीं जोड़ता — ऐसे परिणाम केवल GST हिस्से के रूप में देखें।</li>\n" +
"<li><strong>CGST/SGST और IGST में भ्रम।</strong> विभाजन केवल एक ही राज्य के भीतर लागू होता है; अंतर-राज्यीय बिक्री पर CGST + SGST नहीं, बल्कि पूरी दर का IGST लगता है।</li>\n" +
"</ul>\n" +
"<h2>यह कैलकुलेटर क्या नहीं करता</h2>\n" +
"<p>यह टूल एक राशि पर एक दर लगाता है — यह नहीं बताता कि कोई विशेष उत्पाद किस स्लैब में आता है, न सेस या अन्य अधिभार जोड़ता है, और न ही छूट, रिवर्स चार्ज या कंपोज़िशन स्कीम के नियमों को ध्यान में रखता है। दरें सरकारी अधिसूचनाओं से इतनी तेज़ी से बदलती हैं कि कोई भी स्थिर संदर्भ साथ नहीं रख सकता। परिणाम को एक तेज़ और पारदर्शी अंकगणितीय जाँच मानें, और अनुपालन के लिए भरोसा करने से पहले अपने लेन-देन पर लागू सटीक दर, सेस और कर-प्रक्रिया की पुष्टि स्थानीय कर प्राधिकरण या कर पेशेवर से करें।</p>";

window.GUIDES["bn"] = GUIDE_S_GST +
"<h2>GST যোগ করা আর GST বাদ দেওয়া দুটি বিপরীত হিসাব</h2>\n" +
"<p>GST (পণ্য ও পরিষেবা কর) করমুক্ত বা নিট দামের উপরে একটিমাত্র শতাংশ হিসেবে বসে, কিন্তু বাস্তব সমস্যাটি আসে দুই দিক থেকে। কখনও আপনি করপূর্ব দাম জানেন এবং কর-সহ মোট দাম বের করতে চান — যেমন দোকানদার পণ্যের দাম ঠিক করার সময়, বা ফ্রিল্যান্সার চালান লেখার সময়। আবার কখনও হাতে এমন রসিদ বা কোটেশন থাকে যেখানে GST আগেই ধরা আছে, আর আপনাকে মূল দাম ও করের অংশ আলাদা করে বের করতে হয় — হিসাবরক্ষণ, খরচের দাবি, কিংবা সরবরাহকারী সঠিক হার ধরেছেন কি না তা যাচাইয়ের জন্য। এই ক্যালকুলেটর দুই দিকই সামলায়, আর ভারতের ক্ষেত্রে GST-এর অঙ্কটিকে CGST ও SGST — এই দুই সমান ভাগে ভেঙে দেখায়, যা ভারতীয় কর চালানে আলাদাভাবে থাকে।</p>\n" +
"<h3>ব্যবহারের নিয়ম</h3>\n" +
"<ol>\n" +
"<li>বেছে নিন আপনার কাছে <strong>GST-পূর্ব অঙ্ক</strong> আছে (কর যোগ করছেন) নাকি <strong>GST-সহ অঙ্ক</strong> (কর বাদ দিচ্ছেন)।</li>\n" +
"<li><strong>অঙ্কটি</strong> লিখুন।</li>\n" +
"<li>হার বাছুন: <strong>ভারতের স্ল্যাব</strong> চিপ (5%, 12%, 18%, 28%) বা <strong>অস্ট্রেলিয়া / নিউজিল্যান্ড / সিঙ্গাপুর</strong> চিপ (10%, 15%, 9%) চাপুন, অথবা নিজের পছন্দের যেকোনো হার সরাসরি লিখুন।</li>\n" +
"<li>ভারতের একই রাজ্যের ভেতরের বিক্রির জন্য <strong>GST-কে CGST + SGST-তে ভাগ করুন</strong> টিক দিন, যাতে চালানে দেখানো বাধ্যতামূলক দুই সমান ভাগ দেখা যায়।</li>\n" +
"<li><strong>হিসাব করুন</strong> চাপুন — নিট অঙ্ক, GST-এর অঙ্ক ও মোট একসঙ্গে দেখা যাবে।</li>\n" +
"</ol>\n" +
"<h3>দুটি সূত্র</h3>\n" +
"<div class=\"example\">\n" +
"<strong>GST যোগ:</strong> GST = নিট &times; হার &divide; 100, তারপর মোট = নিট + GST।<br>\n" +
"<strong>GST বাদ:</strong> নিট = মোট &divide; (1 + হার &divide; 100), তারপর GST = মোট &minus; নিট।\n" +
"<p style=\"margin:10px 0 0\">দ্বিতীয় সূত্রটি ভাগ, কারণ মূল করটি হিসাব হয়েছিল ছোট নিট অঙ্কের উপর — এখন হাতে থাকা মোটের উপর নয়। মোট থেকে সরাসরি ওই শতাংশ বিয়োগ করাই GST হিসাবের সবচেয়ে সাধারণ ভুল।</p>\n" +
"</div>\n" +
"<h3>তিনটি উদাহরণ</h3>\n" +
"<div class=\"example\"><strong>উদাহরণ ১ — ভারতের সাধারণ ১৮% স্ল্যাবে দাম ঠিক করা।</strong> নিট দাম 2,500 হলে GST = 2,500 &times; 0.18 = 450, তাই দোকানের মোট দাম 2,950। একই রাজ্যের বিক্রির জন্য CGST/SGST ভাগ টিক দিলে CGST 225 ও SGST 225 দেখায়, যোগ করলে সেই 450-ই।</div>\n" +
"<div class=\"example\"><strong>উদাহরণ ২ — GST-সহ চালান পড়া।</strong> সরবরাহকারীর চালানে ১৮% GST-সহ মোট 11,800। নিট = 11,800 &divide; 1.18 = ঠিক 10,000, GST = 1,800। বদলে 11,800 থেকে ১৮% বিয়োগ করলে ভুলভাবে 9,676 আসত, আসল নিট দাম 324 কম দেখাত।</div>\n" +
"<div class=\"example\"><strong>উদাহরণ ৩ — অস্ট্রেলিয়ার একক ১০% হার।</strong> নিট সেবা ফি AUD 800 হলে GST = 80, মোট চালান 880 — বিশ্বজুড়ে ব্যবহৃত সেই একই যোগের সূত্র, কেবল ভারতীয় স্ল্যাবের বদলে অস্ট্রেলিয়ার একক হারে।</div>\n" +
"<h2>এই ক্যালকুলেটর যেসব GST / VAT হার ধরে</h2>\n" +
"<table>\n" +
"<thead><tr><th>দেশ</th><th>হার</th><th>মন্তব্য</th></tr></thead>\n" +
"<tbody>\n" +
"<tr><td>ভারত</td><td>5%, 12%, 18%, 28%</td><td>স্ল্যাব নির্ভর করে পণ্য/পরিষেবার শ্রেণির উপর; বেশির ভাগ পণ্যে ১৮%, বিলাস ও ক্ষতিকর পণ্যে ২৮%</td></tr>\n" +
"<tr><td>অস্ট্রেলিয়া</td><td>10%</td><td>বেশির ভাগ পণ্য ও পরিষেবায় একক GST হার</td></tr>\n" +
"<tr><td>নিউজিল্যান্ড</td><td>15%</td><td>একক হার, বিশ্বের উচ্চতম একক হারগুলোর একটি</td></tr>\n" +
"<tr><td>সিঙ্গাপুর</td><td>9%</td><td>৭% থেকে ধাপে ধাপে বেড়ে (২০২২–২০২৪) ২০২৪ সালে ৯%</td></tr>\n" +
"</tbody>\n" +
"</table>\n" +
"<h2>CGST, SGST ও IGST — একই কর, দুই রকম ভাগ</h2>\n" +
"<p>ভারতের GST দ্বৈত ব্যবস্থা। একই রাজ্যের ভেতরের বিক্রিতে হার ঠিক অর্ধেক করে ভাগ হয়: CGST (কেন্দ্রীয় GST) আদায় করে কেন্দ্রীয় সরকার, আর SGST (রাজ্য GST) রাজ্য সরকার — তাই ১৮% GST হয় ৯% + ৯%। রাজ্যের সীমা পেরিয়ে বিক্রি হলে পুরো হারটিই একবারে IGST (সমন্বিত GST) হিসেবে বসে, যা কেন্দ্র পরে গন্তব্য রাজ্যের সঙ্গে নিষ্পত্তি করে। দুই ক্ষেত্রেই ক্রেতার দেওয়া হার ও মোট রাজস্ব একই থাকে — কেবল হিসাবের ভাগটুকু বদলায়, ক্রেতা ও বিক্রেতা একই রাজ্যে কি না তার উপর নির্ভর করে।</p>\n" +
"<h2>সাধারণ ভুল</h2>\n" +
"<ul>\n" +
"<li><strong>ভাগ না করে বিয়োগ করা।</strong> মোট থেকে GST বার করা কখনোই \"মোট বিয়োগ মোটের হার%\" নয় — তাতে নিট দাম কম আর কর বেশি দেখায়। (1 + হার/100) দিয়ে ভাগ করুন।</li>\n" +
"<li><strong>ভুল ভারতীয় স্ল্যাব ব্যবহার।</strong> ভারতে স্ল্যাব শ্রেণি অনুযায়ী নির্ধারিত, ইচ্ছেমতো বাছা যায় না — রেস্তোরাঁর বিল, বিলাসবহুল গাড়ি আর নিত্যপ্রয়োজনীয় মুদিপণ্য তিনটি আলাদা স্ল্যাবে পড়তে পারে, তাই নির্দিষ্ট পণ্য বা সেবার হার আগে নিশ্চিত করুন।</li>\n" +
"<li><strong>সেস ভুলে যাওয়া।</strong> ভারতের ২৮% স্ল্যাবের কিছু পণ্যে (তামাক, কোমল পানীয়, বড় গাড়ি) GST-এর উপরে অতিরিক্ত ক্ষতিপূরণ সেস বসে, যা এই ক্যালকুলেটর ধরে না — ফলাফলকে শুধু GST অংশ হিসেবেই দেখুন।</li>\n" +
"<li><strong>CGST/SGST ও IGST গুলিয়ে ফেলা।</strong> ভাগটি কেবল একই রাজ্যের ভেতরে প্রযোজ্য; আন্তঃরাজ্য বিক্রিতে CGST + SGST নয়, পুরো হারে IGST বসে।</li>\n" +
"</ul>\n" +
"<h2>এই ক্যালকুলেটর যা করে না</h2>\n" +
"<p>এই টুল একটি অঙ্কে একটি হার প্রয়োগ করে মাত্র — কোন পণ্য কোন স্ল্যাবে পড়ে তা খুঁজে দেয় না, সেস বা অন্য সারচার্জ যোগ করে না, আর ছাড়, রিভার্স চার্জ বা কম্পোজিশন স্কিমের নিয়মও ধরে না। সরকারি বিজ্ঞপ্তিতে হার এত দ্রুত বদলায় যে কোনো স্থির তালিকা তা ধরে রাখতে পারে না। ফলাফলকে দ্রুত ও স্বচ্ছ পাটিগণিতিক যাচাই হিসেবে নিন, এবং কমপ্লায়েন্সের কাজে নির্ভর করার আগে আপনার নির্দিষ্ট লেনদেনের সঠিক হার, সেস ও কর-প্রক্রিয়া স্থানীয় কর কর্তৃপক্ষ বা কর পেশাদারের কাছ থেকে নিশ্চিত করুন।</p>";

window.GUIDES["id"] = GUIDE_S_GST +
"<h2>Menambahkan GST dan mengeluarkan GST adalah dua operasi yang berlawanan</h2>\n" +
"<p>GST (pajak barang dan jasa) dikenakan sebagai satu persentase di atas harga bersih, tetapi masalah sehari-hari datang dari dua arah. Kadang Anda tahu harga sebelum pajak dan perlu total termasuk pajak — pedagang yang menetapkan harga produk, pekerja lepas yang membuat faktur. Di lain waktu Anda memegang struk atau penawaran yang sudah termasuk GST dan perlu memisahkan harga dasar dari komponen pajaknya — untuk pembukuan, klaim biaya, atau memeriksa apakah pemasok memakai tarif yang benar. Kalkulator ini menangani kedua arah dan, untuk India, juga membagi nilai GST menjadi dua bagian CGST dan SGST yang tampil terpisah pada faktur pajak India.</p>\n" +
"<h3>Cara memakai kalkulator ini</h3>\n" +
"<ol>\n" +
"<li>Pilih apakah Anda punya <strong>jumlah sebelum GST</strong> (menambahkan pajak) atau <strong>jumlah termasuk GST</strong> (mengeluarkan pajak).</li>\n" +
"<li>Masukkan <strong>jumlahnya</strong>.</li>\n" +
"<li>Pilih tarif: ketuk chip <strong>slab India</strong> (5%, 12%, 18%, 28%) atau chip <strong>Australia / Selandia Baru / Singapura</strong> (10%, 15%, 9%), atau ketik tarif kustom apa pun.</li>\n" +
"<li>Untuk penjualan dalam satu negara bagian di India, centang <strong>Bagi GST menjadi CGST + SGST</strong> untuk melihat dua bagian sama besar yang wajib tercantum pada faktur.</li>\n" +
"<li>Tekan <strong>Hitung</strong> untuk melihat jumlah bersih, nilai GST, dan total bruto sekaligus.</li>\n" +
"</ol>\n" +
"<h3>Dua rumusnya</h3>\n" +
"<div class=\"example\">\n" +
"<strong>Menambahkan GST:</strong> GST = bersih &times; tarif &divide; 100, lalu bruto = bersih + GST.<br>\n" +
"<strong>Mengeluarkan GST:</strong> bersih = bruto &divide; (1 + tarif &divide; 100), lalu GST = bruto &minus; bersih.\n" +
"<p style=\"margin:10px 0 0\">Rumus kedua berupa pembagian justru karena pajak awalnya dihitung dari angka bersih yang lebih kecil, bukan dari total yang kini Anda pegang — mengurangi persentase dari total alih-alih membaginya adalah kesalahan GST yang paling sering terjadi.</p>\n" +
"</div>\n" +
"<h3>Tiga contoh perhitungan</h3>\n" +
"<div class=\"example\"><strong>Contoh 1 — menetapkan harga pada slab standar India 18%.</strong> Harga bersih 2.500 menghasilkan GST = 2.500 &times; 0,18 = 450, sehingga harga bruto di rak menjadi 2.950. Mencentang pembagian CGST/SGST untuk penjualan dalam satu negara bagian menampilkan CGST 225 dan SGST 225, yang kembali berjumlah 450.</div>\n" +
"<div class=\"example\"><strong>Contoh 2 — membaca faktur yang sudah termasuk GST.</strong> Faktur pemasok menunjukkan total 11.800 dengan GST 18%. Bersih = 11.800 &divide; 1,18 = tepat 10.000, dan GST = 1.800. Mengurangi 18% dari 11.800 justru memberi 9.676, mengecilkan harga bersih sebenarnya sebesar 324.</div>\n" +
"<div class=\"example\"><strong>Contoh 3 — tarif tunggal 10% Australia.</strong> Biaya jasa bersih AUD 800 menghasilkan GST = 80, sehingga faktur bruto 880 — rumus penambahan yang sama seperti di seluruh dunia, hanya dengan tarif tunggal Australia alih-alih slab India.</div>\n" +
"<h2>Tarif GST / PPN yang dicakup kalkulator ini</h2>\n" +
"<table>\n" +
"<thead><tr><th>Negara</th><th>Tarif</th><th>Catatan</th></tr></thead>\n" +
"<tbody>\n" +
"<tr><td>India</td><td>5%, 12%, 18%, 28%</td><td>Slab tergantung kategori barang/jasa; 18% untuk sebagian besar barang, 28% untuk barang mewah dan barang kena cukai</td></tr>\n" +
"<tr><td>Australia</td><td>10%</td><td>Tarif GST tunggal untuk sebagian besar barang dan jasa</td></tr>\n" +
"<tr><td>Selandia Baru</td><td>15%</td><td>Tarif tunggal, termasuk yang tertinggi di dunia</td></tr>\n" +
"<tr><td>Singapura</td><td>9%</td><td>Mencapai 9% pada 2024 setelah kenaikan bertahap dari 7% (2022–2024)</td></tr>\n" +
"</tbody>\n" +
"</table>\n" +
"<h2>CGST, SGST, dan IGST — pajak yang sama, dua cara pembagian</h2>\n" +
"<p>GST India memakai sistem ganda. Untuk penjualan dalam satu negara bagian, tarif dibagi tepat dua: CGST (GST pusat) dipungut pemerintah pusat dan SGST (GST negara bagian) oleh pemerintah negara bagian, sehingga GST 18% menjadi 9% + 9%. Untuk penjualan lintas negara bagian, tarif penuh justru dipungut sekali sebagai IGST (GST terintegrasi), yang kemudian diselesaikan pemerintah pusat dengan negara bagian tujuan. Tarif yang dibayar pembeli dan total penerimaan sama saja di kedua kasus — yang berubah hanya pembagian akuntansinya, tergantung apakah pembeli dan penjual berada di negara bagian yang sama.</p>\n" +
"<h2>Kesalahan umum</h2>\n" +
"<ul>\n" +
"<li><strong>Mengurangi, bukan membagi.</strong> Mengeluarkan GST dari total tidak pernah berarti \"total dikurangi tarif% dari total\" — cara itu selalu mengecilkan nilai bersih dan membesarkan pajaknya. Bagilah dengan (1 + tarif/100).</li>\n" +
"<li><strong>Salah memilih slab India.</strong> Slab India ditentukan berdasarkan kategori, bukan dipilih bebas — tagihan restoran, mobil mewah, dan bahan pokok bisa masuk tiga slab berbeda, jadi pastikan dulu tarif untuk barang atau jasa yang bersangkutan.</li>\n" +
"<li><strong>Melupakan cess.</strong> Beberapa barang slab 28% di India (seperti tembakau, minuman berkarbonasi, dan mobil besar) dikenai cess kompensasi tambahan di atas GST yang tidak dimodelkan kalkulator ini — anggap hasilnya hanya bagian GST-nya.</li>\n" +
"<li><strong>Mencampuradukkan CGST/SGST dengan IGST.</strong> Pembagian hanya berlaku dalam satu negara bagian; penjualan antarnegara bagian memakai IGST dengan tarif penuh, bukan CGST + SGST.</li>\n" +
"</ul>\n" +
"<h2>Yang tidak dilakukan kalkulator ini</h2>\n" +
"<p>Alat ini hanya menerapkan satu tarif pada satu jumlah — tidak mencari slab suatu produk tertentu, tidak menambahkan cess atau pungutan lain, dan tidak memperhitungkan pengecualian, mekanisme reverse charge, maupun aturan skema komposisi. Tarif juga berubah melalui pemberitahuan pemerintah lebih cepat daripada yang bisa diikuti referensi statis mana pun. Perlakukan hasilnya sebagai pemeriksaan aritmetika yang cepat dan transparan, lalu pastikan tarif, cess, dan perlakuan pelaporan yang tepat untuk transaksi Anda kepada otoritas pajak setempat atau konsultan pajak sebelum memakainya untuk kepatuhan.</p>";

window.GUIDES["ur"] = GUIDE_S_GST +
"<h2>GST شامل کرنا اور GST نکالنا دو الٹ عمل ہیں</h2>\n" +
"<p>GST (سامان اور خدمات پر ٹیکس) خالص یعنی ٹیکس سے پہلے کی قیمت پر ایک ہی شرح فیصد کے طور پر لگتا ہے، مگر روزمرہ کا مسئلہ دو سمتوں سے آتا ہے۔ کبھی آپ کو ٹیکس سے پہلے کی قیمت معلوم ہوتی ہے اور ٹیکس سمیت کل رقم درکار ہوتی ہے — جیسے دکاندار قیمت مقرر کرتے وقت یا فری لانسر انوائس بناتے وقت۔ کبھی آپ کے پاس ایسی رسید یا کوٹیشن ہوتی ہے جس میں GST پہلے سے شامل ہے اور آپ کو اصل قیمت اور ٹیکس کا حصہ الگ الگ نکالنا ہوتا ہے — حساب کتاب، اخراجات کے دعوے، یا یہ جانچنے کے لیے کہ سپلائر نے درست شرح لگائی یا نہیں۔ یہ کیلکولیٹر دونوں سمتیں سنبھالتا ہے اور بھارت کے لیے GST کی رقم کو CGST اور SGST کے دو برابر حصوں میں بھی تقسیم کرتا ہے، جو بھارتی ٹیکس انوائس پر الگ الگ درج ہوتے ہیں۔</p>\n" +
"<h3>اس کیلکولیٹر کا استعمال</h3>\n" +
"<ol>\n" +
"<li>منتخب کریں کہ آپ کے پاس <strong>GST سے پہلے کی رقم</strong> ہے (ٹیکس شامل کرنا ہے) یا <strong>GST سمیت رقم</strong> (ٹیکس نکالنا ہے)۔</li>\n" +
"<li><strong>رقم</strong> درج کریں۔</li>\n" +
"<li>شرح منتخب کریں: <strong>بھارتی سلیب</strong> چِپ (5%، 12%، 18%، 28%) یا <strong>آسٹریلیا / نیوزی لینڈ / سنگاپور</strong> چِپ (10%، 15%، 9%) دبائیں، یا کوئی بھی اپنی شرح براہِ راست لکھ دیں۔</li>\n" +
"<li>بھارت میں ایک ہی ریاست کے اندر فروخت کے لیے <strong>GST کو CGST + SGST میں تقسیم کریں</strong> پر نشان لگائیں، تاکہ وہ دو برابر حصے نظر آئیں جو انوائس پر دکھانا لازم ہے۔</li>\n" +
"<li><strong>حساب کریں</strong> دبائیں اور خالص رقم، GST کی رقم اور کل رقم ایک ساتھ دیکھیں۔</li>\n" +
"</ol>\n" +
"<h3>دو فارمولے</h3>\n" +
"<div class=\"example\">\n" +
"<strong>GST شامل کرنا:</strong> GST = خالص &times; شرح &divide; 100، پھر کل = خالص + GST۔<br>\n" +
"<strong>GST نکالنا:</strong> خالص = کل &divide; (1 + شرح &divide; 100)، پھر GST = کل &minus; خالص۔\n" +
"<p style=\"margin:10px 0 0\">دوسرا فارمولا تقسیم اسی لیے ہے کہ اصل ٹیکس چھوٹی خالص رقم پر لگایا گیا تھا، اُس کل رقم پر نہیں جو اِس وقت آپ کے پاس ہے۔ کل میں سے وہی فیصد گھٹا دینا GST کے حساب کی سب سے عام غلطی ہے۔</p>\n" +
"</div>\n" +
"<h3>تین حل شدہ مثالیں</h3>\n" +
"<div class=\"example\"><strong>مثال 1 — بھارت کے معیاری 18% سلیب پر قیمت مقرر کرنا۔</strong> 2,500 کی خالص قیمت پر GST = 2,500 &times; 0.18 = 450، چنانچہ کل قیمت 2,950 بنے گی۔ ایک ہی ریاست کی فروخت کے لیے CGST/SGST تقسیم پر نشان لگانے سے CGST 225 اور SGST 225 نظر آتے ہیں، جن کا مجموعہ وہی 450 ہے۔</div>\n" +
"<div class=\"example\"><strong>مثال 2 — GST سمیت انوائس پڑھنا۔</strong> سپلائر کی انوائس پر 18% GST کے ساتھ کل 11,800 ہے۔ خالص = 11,800 &divide; 1.18 = بالکل 10,000، اور GST = 1,800۔ اس کے بجائے 11,800 میں سے 18% گھٹانے پر غلط طور پر 9,676 آتا، یعنی اصل خالص قیمت 324 کم دکھائی دیتی۔</div>\n" +
"<div class=\"example\"><strong>مثال 3 — آسٹریلیا کی یکساں 10% شرح۔</strong> AUD 800 کی خالص سروس فیس پر GST = 80، یعنی کل انوائس 880 — وہی عالمی سطح پر رائج شمولیت کا فارمولا، بس بھارتی سلیب کے بجائے آسٹریلیا کی واحد شرح پر۔</div>\n" +
"<h2>یہ کیلکولیٹر کن GST / VAT شرحوں کا احاطہ کرتا ہے</h2>\n" +
"<table>\n" +
"<thead><tr><th>ملک</th><th>شرح</th><th>نوٹ</th></tr></thead>\n" +
"<tbody>\n" +
"<tr><td>بھارت</td><td>5%، 12%، 18%، 28%</td><td>سلیب کا انحصار شے یا خدمت کی قسم پر ہے؛ زیادہ تر اشیاء پر 18% اور آسائشی و مضر اشیاء پر 28%</td></tr>\n" +
"<tr><td>آسٹریلیا</td><td>10%</td><td>زیادہ تر اشیاء و خدمات پر واحد یکساں GST شرح</td></tr>\n" +
"<tr><td>نیوزی لینڈ</td><td>15%</td><td>واحد شرح، دنیا کی بلند ترین یکساں شرحوں میں سے ایک</td></tr>\n" +
"<tr><td>سنگاپور</td><td>9%</td><td>7% سے مرحلہ وار اضافے (2022–2024) کے بعد 2024 میں 9% تک پہنچی</td></tr>\n" +
"</tbody>\n" +
"</table>\n" +
"<h2>CGST، SGST اور IGST — ایک ہی ٹیکس، دو طرح کی تقسیم</h2>\n" +
"<p>بھارت کا GST دوہرا نظام ہے۔ ایک ہی ریاست کے اندر فروخت پر شرح بالکل آدھی آدھی بٹ جاتی ہے: CGST (مرکزی GST) وفاقی حکومت وصول کرتی ہے اور SGST (ریاستی GST) ریاستی حکومت، یوں 18% GST 9% + 9% بن جاتا ہے۔ ریاست کی سرحد پار فروخت پر پوری شرح ایک ہی بار IGST (مربوط GST) کے طور پر لگتی ہے، جس کا حساب مرکز بعد میں منزل والی ریاست سے چکاتا ہے۔ دونوں صورتوں میں گاہک کی ادا کردہ شرح اور کل آمدنی یکساں رہتی ہے — صرف حسابی تقسیم بدلتی ہے، اس بنیاد پر کہ خریدار اور فروخت کنندہ ایک ہی ریاست میں ہیں یا نہیں۔</p>\n" +
"<h2>عام غلطیاں</h2>\n" +
"<ul>\n" +
"<li><strong>تقسیم کے بجائے تفریق۔</strong> کل رقم سے GST نکالنا کبھی بھی \"کل منفی کل کا شرح فیصد\" نہیں ہوتا — اس سے خالص قیمت ہمیشہ کم اور ٹیکس زیادہ نکلتا ہے۔ (1 + شرح/100) پر تقسیم کریں۔</li>\n" +
"<li><strong>غلط بھارتی سلیب لگانا۔</strong> بھارت میں سلیب زمرے کے مطابق مقرر ہیں، اپنی مرضی سے منتخب نہیں کیے جاتے — ریستوران کا بل، پُرتعیش گاڑی اور بنیادی کھانے پینے کی شے تین مختلف سلیبوں میں ہو سکتی ہیں، لہٰذا متعلقہ شے یا خدمت کی شرح پہلے تصدیق کر لیں۔</li>\n" +
"<li><strong>سیس بھول جانا۔</strong> بھارت کی 28% والی چند اشیاء (تمباکو، بوتل بند مشروبات، بڑی گاڑیاں) پر GST کے اوپر اضافی کمپنسیشن سیس بھی لگتا ہے، جسے یہ کیلکولیٹر شامل نہیں کرتا — ان نتائج کو صرف GST کا حصہ سمجھیں۔</li>\n" +
"<li><strong>CGST/SGST اور IGST کو خلط ملط کرنا۔</strong> تقسیم صرف ایک ہی ریاست کے اندر لاگو ہوتی ہے؛ بین الریاستی فروخت پر CGST + SGST نہیں بلکہ پوری شرح کا IGST لگتا ہے۔</li>\n" +
"</ul>\n" +
"<h2>یہ کیلکولیٹر کیا نہیں کرتا</h2>\n" +
"<p>یہ ٹول ایک رقم پر ایک شرح لگاتا ہے — یہ نہیں بتاتا کہ کوئی خاص مصنوعہ کس سلیب میں آتا ہے، نہ سیس یا دیگر سرچارج جوڑتا ہے، اور نہ استثنا، ریورس چارج یا کمپوزیشن اسکیم کے قواعد کو مدِنظر رکھتا ہے۔ شرحیں سرکاری نوٹیفکیشنز سے اتنی تیزی سے بدلتی ہیں کہ کوئی بھی مستقل فہرست ساتھ نہیں چل سکتی۔ نتیجے کو ایک تیز اور شفاف حسابی جانچ سمجھیں، اور تعمیل کے لیے اس پر انحصار سے پہلے اپنی مخصوص لین دین کی درست شرح، سیس اور ٹیکس ٹریٹمنٹ کی تصدیق مقامی ٹیکس ادارے یا ٹیکس ماہر سے کر لیں۔</p>";
