// CSP-safe inline SVG visualizations (zero inline style attributes; pure SVG attributes & CSS classes)
const fmt = (n, d = 1) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d });

export function unitBarSvg(r) {
  const max = Math.max(r.rows[0].rate, r.rows[1].rate, 1);
  const wA = Math.max(12, Math.round((r.rows[0].rate / max) * 260));
  const wB = Math.max(12, Math.round((r.rows[1].rate / max) * 260));
  const cA = r.winner === 'A' ? '#2e7d57' : '#8aa29e';
  const cB = r.winner === 'B' ? '#2e7d57' : '#8aa29e';
  return `<figure class="chart-card"><figcaption>단위가격 시각 비교 (${r.rows[0].per}당)</figcaption><svg viewBox="0 0 340 84" class="chart-svg" role="img" aria-label="A 상품과 B 상품 단위가격 비교 막대 그래프"><text x="0" y="18" class="svg-label">A 상품 · ${fmt(r.rows[0].rate, 2)}원</text><rect x="0" y="24" width="320" height="14" rx="7" fill="#dce5d6"/><rect x="0" y="24" width="${wA}" height="14" rx="7" fill="${cA}"/><text x="0" y="58" class="svg-label">B 상품 · ${fmt(r.rows[1].rate, 2)}원</text><rect x="0" y="64" width="320" height="14" rx="7" fill="#dce5d6"/><rect x="0" y="64" width="${wB}" height="14" rx="7" fill="${cB}"/></svg></figure>`;
}

export function discountWaterfallSvg(r) {
  const base = Math.max(r.price + r.shipping, 1);
  const goodsW = Math.max(6, Math.round((r.goods / base) * 320));
  const savedW = Math.max(0, Math.round((r.saved / base) * 320));
  const shipW = Math.max(0, Math.min(320 - goodsW - savedW, Math.round((r.shipping / base) * 320)));
  return `<figure class="chart-card"><figcaption>할인 전·후 금액 비중</figcaption><svg viewBox="0 0 320 52" class="chart-svg" role="img" aria-label="결제 금액과 절약 금액 비중 막대"><rect x="0" y="8" width="320" height="18" rx="9" fill="#dce5d6"/><rect x="0" y="8" width="${goodsW}" height="18" rx="9" fill="#17343c"/>${shipW > 0 ? `<rect x="${goodsW}" y="8" width="${shipW}" height="18" fill="#d97706"/>` : ''}${savedW > 0 ? `<rect x="${goodsW + shipW}" y="8" width="${Math.min(320 - goodsW - shipW, savedW)}" height="18" rx="6" fill="#6aa84f"/>` : ''}<circle cx="8" cy="41" r="4" fill="#17343c"/><text x="17" y="45" class="svg-sub">상품 결제 ${fmt(r.goods, 0)}원</text><circle cx="140" cy="41" r="4" fill="#6aa84f"/><text x="149" y="45" class="svg-sub">절약 ${fmt(r.saved, 0)}원</text>${r.shipping > 0 ? `<circle cx="242" cy="41" r="4" fill="#d97706"/><text x="251" y="45" class="svg-sub">배송 ${fmt(r.shipping, 0)}</text>` : ''}</svg></figure>`;
}

export function tripDonutSvg(r) {
  const total = Math.max(r.total, 1);
  const circ = 2 * Math.PI * 36;
  const fLen = (r.fuelCost / total) * circ;
  const tLen = (r.toll / total) * circ;
  const pLen = Math.max(0, circ - fLen - tLen);
  return `<figure class="chart-card chart-donut-row"><svg viewBox="0 0 100 100" class="donut-svg" role="img" aria-label="여행 예산 구성 도넛 차트"><circle cx="50" cy="50" r="36" fill="none" stroke="#dce5d6" stroke-width="14"/><circle cx="50" cy="50" r="36" fill="none" stroke="#17343c" stroke-width="14" stroke-dasharray="${fLen.toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 50 50)"/><circle cx="50" cy="50" r="36" fill="none" stroke="#5b9a68" stroke-width="14" stroke-dasharray="${tLen.toFixed(1)} ${circ.toFixed(1)}" stroke-dashoffset="${(-fLen).toFixed(1)}" transform="rotate(-90 50 50)"/><circle cx="50" cy="50" r="36" fill="none" stroke="#e48159" stroke-width="14" stroke-dasharray="${pLen.toFixed(1)} ${circ.toFixed(1)}" stroke-dashoffset="${(-(fLen + tLen)).toFixed(1)}" transform="rotate(-90 50 50)"/><text x="50" y="53" text-anchor="middle" class="svg-center">${r.split.people}인</text></svg><div class="donut-legend"><p><i class="dot-ink"></i>연료비 <strong>${Math.round((r.fuelCost / total) * 100)}%</strong> (${fmt(r.fuelCost, 0)}원)</p><p><i class="dot-green"></i>통행료 <strong>${Math.round((r.toll / total) * 100)}%</strong> (${fmt(r.toll, 0)}원)</p><p><i class="dot-coral"></i>주차비 <strong>${Math.round((r.parking / total) * 100)}%</strong> (${fmt(r.parking, 0)}원)</p></div></figure>`;
}

export function compoundAreaSvg(r) {
  const maxVal = Math.max(r.finalBalance, 1);
  const w = 320, h = 116, padB = 22, top = 10;
  const usableH = h - padB - top;
  const n = Math.max(r.series.length - 1, 1);
  const x = (i) => Math.round((i / n) * w);
  const y = (v) => Math.round(top + usableH - (v / maxVal) * usableH);
  const balPts = r.series.map((pt, i) => `${x(i)},${y(pt.balance)}`).join(' ');
  const prinPts = r.series.map((pt, i) => `${x(i)},${y(pt.principal)}`).join(' ');
  const balArea = `0,${top + usableH} ${balPts} ${w},${top + usableH}`;
  const prinArea = `0,${top + usableH} ${prinPts} ${w},${top + usableH}`;
  return `<figure class="chart-card"><figcaption>연도별 원금 vs 복리 성장 곡선 (${r.years}년)</figcaption><svg viewBox="0 0 ${w} ${h}" class="chart-svg" role="img" aria-label="복리 성장 곡선 그래프"><polygon points="${balArea}" fill="#b9e37b" fill-opacity="0.55"/><polygon points="${prinArea}" fill="#17343c" fill-opacity="0.22"/><polyline points="${prinPts}" fill="none" stroke="#17343c" stroke-width="2" stroke-dasharray="4 3"/><polyline points="${balPts}" fill="none" stroke="#2d6a4f" stroke-width="3" stroke-linecap="round"/><text x="0" y="${h - 5}" class="svg-sub">시작</text><text x="${w / 2}" y="${h - 5}" text-anchor="middle" class="svg-sub">${Math.round(r.years / 2)}년차</text><text x="${w}" y="${h - 5}" text-anchor="end" class="svg-sub">${r.years}년차 · ${fmt(r.finalBalance, 0)}원</text></svg><div class="legend-inline"><span><i class="dot-green"></i>최종 잔액(복리)</span><span><i class="dot-ink"></i>총 납입 원금</span></div></figure>`;
}

export function bmiGaugeSvg(r) {
  const clamped = Math.max(14, Math.min(34, r.bmi));
  const pos = Math.round(((clamped - 14) / 20) * 300) + 10;
  return `<figure class="chart-card"><figcaption>BMI 스펙트럼 위치 (대한비만학회 기준)</figcaption><svg viewBox="0 0 320 58" class="chart-svg" role="img" aria-label="BMI 지수 ${fmt(r.bmi, 1)} 위치 게이지"><rect x="10" y="22" width="68" height="12" rx="6" fill="#38bdf8"/><rect x="80" y="22" width="67" height="12" rx="3" fill="#2e7d57"/><rect x="149" y="22" width="30" height="12" rx="3" fill="#d97706"/><rect x="181" y="22" width="129" height="12" rx="6" fill="#d9534f"/><polygon points="${pos},19 ${pos - 6},9 ${pos + 6},9" fill="#17343c"/><text x="10" y="50" class="svg-sub">저체중 &lt;18.5</text><text x="90" y="50" class="svg-sub">정상 18.5~22.9</text><text x="186" y="50" class="svg-sub">과체중·비만 23+</text></svg></figure>`;
}

export function salaryDonutSvg(r) {
  const total = Math.max(r.grossMonthly, 1);
  const circ = 2 * Math.PI * 36;
  const nLen = (r.netMonthly / total) * circ;
  const iLen = (r.insurance / total) * circ;
  const tLen = Math.max(0, circ - nLen - iLen);
  return `<figure class="chart-card chart-donut-row"><svg viewBox="0 0 100 100" class="donut-svg" role="img" aria-label="월급 실수령액 및 공제 구성 도넛 차트"><circle cx="50" cy="50" r="36" fill="none" stroke="#dce5d6" stroke-width="14"/><circle cx="50" cy="50" r="36" fill="none" stroke="#2e7d57" stroke-width="14" stroke-dasharray="${nLen.toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 50 50)"/><circle cx="50" cy="50" r="36" fill="none" stroke="#17343c" stroke-width="14" stroke-dasharray="${iLen.toFixed(1)} ${circ.toFixed(1)}" stroke-dashoffset="${(-nLen).toFixed(1)}" transform="rotate(-90 50 50)"/><circle cx="50" cy="50" r="36" fill="none" stroke="#e48159" stroke-width="14" stroke-dasharray="${tLen.toFixed(1)} ${circ.toFixed(1)}" stroke-dashoffset="${(-(nLen + iLen)).toFixed(1)}" transform="rotate(-90 50 50)"/><text x="50" y="53" text-anchor="middle" class="svg-center">${Math.round((r.netMonthly / total) * 100)}%</text></svg><div class="donut-legend"><p><i class="dot-green"></i>실수령액 <strong>${fmt(r.netMonthly, 0)}원</strong></p><p><i class="dot-ink"></i>4대보험 <strong>${fmt(r.insurance, 0)}원</strong></p><p><i class="dot-coral"></i>소득·지방세 <strong>${fmt(r.tax, 0)}원</strong></p></div></figure>`;
}

export function loanCompareSvg(r) {
  const maxI = Math.max(r.bullet.interest, r.amortized.interest, r.equal.interest, 1);
  const wEq = Math.max(10, Math.round((r.equal.interest / maxI) * 280));
  const wAm = Math.max(10, Math.round((r.amortized.interest / maxI) * 280));
  const wBu = Math.max(10, Math.round((r.bullet.interest / maxI) * 280));
  return `<figure class="chart-card"><figcaption>상환 방식별 총 이자 비교 (${r.years}년 · 연 ${r.rate}%)</figcaption><svg viewBox="0 0 320 116" class="chart-svg" role="img" aria-label="대출 3방식 총이자 비교 막대 그래프"><text x="0" y="15" class="svg-label">원금균등 · 총이자 ${fmt(r.equal.interest, 0)}원</text><rect x="0" y="21" width="300" height="12" rx="6" fill="#dce5d6"/><rect x="0" y="21" width="${wEq}" height="12" rx="6" fill="#2e7d57"/><text x="0" y="53" class="svg-label">원리금균등 · 총이자 ${fmt(r.amortized.interest, 0)}원</text><rect x="0" y="59" width="300" height="12" rx="6" fill="#dce5d6"/><rect x="0" y="59" width="${wAm}" height="12" rx="6" fill="#17343c"/><text x="0" y="91" class="svg-label">만기일시 · 총이자 ${fmt(r.bullet.interest, 0)}원</text><rect x="0" y="97" width="300" height="12" rx="6" fill="#dce5d6"/><rect x="0" y="97" width="${wBu}" height="12" rx="6" fill="#e48159"/></svg></figure>`;
}
