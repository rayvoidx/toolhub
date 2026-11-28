import './style.css';
import { KINDS, LABELS, CONVERT_TABLE, defaults, calculate, emptyState, id, validateState, parseBackup, mergeBackup, addEntry, summary, projectText } from './core.mjs';
import { unitBarSvg, discountWaterfallSvg, tripDonutSvg, compoundAreaSvg, bmiGaugeSvg, salaryDonutSvg, loanCompareSvg, budgetDonutSvg, dateSpanSvg, percentBarSvg } from './charts.mjs';
import { native, storage, exportFile, shareText, setupBack } from './platform.js';

const el = document.querySelector('#app');
const fmt = (n, d = 2) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d });
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = emptyState(), tab = 'calculate', kind = 'unit', selected = '', result = null, editing = null, message = '', error = false, locked = false, rawBackup = '', busy = false, installPrompt = null, offlineReady = native, search = '';
const drafts = structuredClone(defaults);
let entryTitle = '';

const description = {
  unit: '배송비와 쿠폰까지 같은 단위로 비교',
  discount: '할인에 할인을 더할 때 실제 결제 금액',
  split: '남는 1원까지 빠짐없이 공평하게',
  trip: '연료·통행·주차 비중과 1인 분담금',
  compound: '원금과 월 적립금의 연도별 복리 성장 곡선',
  salary: '4대보험·세금 공제 도넛 차트와 월 실수령액',
  loan: '원리금·원금균등·만기일시 총이자 시각 비교',
  budget: '50/30/20 월 예산 배분 도넛과 연간 저축액',
  date: 'D-Day·날짜 간격과 평일·주말 타임라인',
  percent: '비중·증감 적용·증감률을 막대 그래프로 비교',
  convert: '길이·무게·평수·온도를 한눈에 동시 변환',
  health: 'BMI 위치 게이지와 기초대사·목표 칼로리',
};

const iconSvg = {
  unit: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M5 8h14M15 4l4 4-4 4M19 16H5M9 12l-4 4 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  discount: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M19 5L5 19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="7.5" cy="7.5" r="2.5" stroke="currentColor" stroke-width="2"/><circle cx="16.5" cy="16.5" r="2.5" stroke="currentColor" stroke-width="2"/></svg>',
  split: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="6.5" r="2" fill="currentColor"/><circle cx="12" cy="17.5" r="2" fill="currentColor"/></svg>',
  trip: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M5 18L19 6M11 6h8v8" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  compound: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M4 18c4-.5 7-3 10-7.5 1.7-2.5 3.5-4.3 6-5.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M4 20h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  salary: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><rect x="3" y="6" width="18" height="12" rx="2.5" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.8" stroke="currentColor" stroke-width="2"/></svg>',
  loan: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M3 10l9-6 9 6M5 10v9M19 10v9M9 19v-6h6v6M3 19h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  budget: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2"/><path d="M12 4v8l6.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  date: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><rect x="3.5" y="5.5" width="17" height="15" rx="2.5" stroke="currentColor" stroke-width="2"/><path d="M8 3.5v4M16 3.5v4M3.5 10.5h17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  percent: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M4 17l5-6 4 3 7-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 6h4v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  convert: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><rect x="3" y="8" width="18" height="8" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 8v3M12 8v5M16 8v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  health: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
};

function notify(text, isError = false) {
  message = text; error = isError;
  const box = document.querySelector('#notice');
  if (box) { box.textContent = text; box.className = 'notice' + (isError ? ' error' : ''); box.hidden = !text; }
}
function currentProject() { return state.projects.find((p) => p.id === selected); }
async function commit(next) {
  if (locked) throw Error('저장소를 읽지 못했습니다. 안내 탭에서 복구하거나 백업 후 초기화하세요.');
  const clean = validateState(next);
  await storage.set(JSON.stringify(clean));
  state = clean;
}
async function action(fn) {
  if (busy) return;
  busy = true;
  try { await fn(); } catch (e) { notify(e.message || '요청을 완료하지 못했습니다.', true); } finally { busy = false; }
}

function field(key, label, { step = 'any', min = 0, max = 1000000000, hint = '' } = {}) {
  return `<label class="field">${label}<input name="${key}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" required value="${esc(drafts[kind][key])}">${hint ? `<small>${hint}</small>` : ''}</label>`;
}
function product(p, name) {
  return `<fieldset class="product"><legend>${name}</legend><div class="fields">${field(p + 'Price', '상품 가격 · 원', { step: 1 })}${field(p + 'Size', '개당 용량 / 수량', { min: 0.001, max: 1000000 })}<label class="field">단위<select name="${p}Unit">${[['g', 'g'], ['kg', 'kg'], ['ml', 'mL'], ['L', 'L'], ['ea', '개']].map(([v, t]) => `<option value="${v}" ${drafts.unit[p + 'Unit'] === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>${field(p + 'Count', '묶음 수', { step: 1, min: 1, max: 10000 })}${field(p + 'Ship', '배송비 · 원', { step: 1 })}${field(p + 'Coupon', '쿠폰 · 원', { step: 1 })}</div></fieldset>`;
}

function inputs() {
  if (kind === 'unit') return `<div class="products">${product('a', 'A 상품')}${product('b', 'B 상품')}</div>`;
  if (kind === 'discount') return `<div class="fields">${field('price', '정가 · 원', { step: 1 })}${field('first', '첫 할인 · %', { max: 100 })}${field('second', '추가 할인 · %', { max: 100 })}${field('coupon', '할인 후 정액 쿠폰 · 원', { step: 1 })}${field('shipping', '배송비 · 원', { step: 1 })}</div>`;
  if (kind === 'split') return `<div class="fields">${field('total', '나눌 총금액 · 원', { step: 1 })}${field('people', '인원', { step: 1, min: 1, max: 100 })}</div>`;
  if (kind === 'trip') return `<div class="fields">${field('distance', '총 주행거리 · km', { hint: '왕복 여행은 왕복 거리를 입력', max: 100000 })}${field('efficiency', '차량 연비 · km/L', { min: 0.1, max: 1000 })}${field('fuel', '리터당 연료 가격 · 원', { step: 1 })}${field('toll', '총 통행료 · 원', { step: 1 })}${field('parking', '총 주차비 · 원', { step: 1 })}${field('people', '함께 나눌 인원', { step: 1, min: 1, max: 100 })}</div>`;
  if (kind === 'compound') return `<div class="fields">${field('principal', '초기 원금 · 원', { step: 1 })}${field('monthly', '매월 추가 적립 · 원', { step: 1 })}${field('rate', '연 수익률 · %', { max: 50, hint: '세전 월 복리 기준' })}${field('years', '기간 · 년', { step: 1, min: 1, max: 50 })}</div>`;
  if (kind === 'salary') return `<div class="fields">${field('annual', '연봉 · 원', { step: 1, min: 1000000, max: 10000000000, hint: '퇴직금 별도 기준' })}${field('nonTaxMonthly', '월 비과세 식대 등 · 원', { step: 1, max: 2000000 })}${field('dependents', '부양가족 수 (본인 포함)', { step: 1, min: 1, max: 11 })}</div>`;
  if (kind === 'loan') return `<div class="fields">${field('amount', '대출 원금 · 원', { step: 1, min: 100000, max: 100000000000 })}${field('rate', '연 이자율 · %', { max: 50 })}${field('years', '상환 기간 · 년', { step: 1, min: 1, max: 50 })}</div>`;
  if (kind === 'budget') return `<div class="fields">${field('income', '월 실수령 소득 · 원', { step: 1, min: 10000, max: 10000000000 })}${field('needs', '필수 지출 · %', { max: 100, hint: '주거·식비·공과금' })}${field('wants', '여가·소비 · %', { max: 100, hint: '외식·취미·쇼핑' })}${field('save', '저축·투자 · %', { max: 100, hint: '합계 100% 기준' })}</div>`;
  if (kind === 'date') return `<div class="fields"><label class="field">시작일<input name="start" type="date" required value="${esc(drafts.date.start)}"></label><label class="field">종료일<input name="end" type="date" required value="${esc(drafts.date.end)}"></label><label class="field">시작일 포함 (1일차 기준)<select name="includeStart"><option value="no" ${drafts.date.includeStart !== 'yes' ? 'selected' : ''}>미포함 (순수 일수 차이)</option><option value="yes" ${drafts.date.includeStart === 'yes' ? 'selected' : ''}>포함 (시작일 = 1일차)</option></select></label></div>`;
  if (kind === 'percent') {
    const mode = drafts.percent.mode || 'change';
    const labelA = mode === 'ratio' ? '부분값 A' : mode === 'change' ? '기준값 A' : '변경 전 값 A';
    const labelB = mode === 'ratio' ? '전체값 B' : mode === 'change' ? '증감률 B · % (감소는 음수)' : '변경 후 값 B';
    return `<div class="fields"><label class="field">계산 방식<select name="mode">${[['change', 'A에서 B% 증감한 값'], ['rate', 'A → B 증감률(%)'], ['ratio', 'A는 B의 몇 %']].map(([v, t]) => `<option value="${v}" ${mode === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>${field('a', labelA, { min: -1000000000000, max: 1000000000000 })}${field('b', labelB, { min: -1000000000000, max: 1000000000000 })}</div>`;
  }
  if (kind === 'convert') {
    const cat = drafts.convert.category || 'length';
    const unitList = CONVERT_TABLE[cat] || CONVERT_TABLE.length;
    if (!unitList.some(([c]) => c === drafts.convert.unit)) drafts.convert.unit = unitList[0][0];
    return `<div class="fields"><label class="field">변환 종류<select name="category">${[['length', '길이 (cm·m·km·in·ft)'], ['weight', '무게 (g·kg·oz·lb)'], ['area', '면적 (㎡·평·ft²)'], ['temp', '온도 (°C·°F·K)']].map(([v, t]) => `<option value="${v}" ${cat === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label class="field">기준 단위<select name="unit">${unitList.map(([v, t]) => `<option value="${v}" ${drafts.convert.unit === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>${field('value', '변환할 값', { min: cat === 'temp' ? -273.15 : 0, max: 1000000000 })}</div>`;
  }
  return `<div class="fields">${field('height', '키 · cm', { min: 80, max: 250 })}${field('weight', '몸무게 · kg', { min: 20, max: 300 })}${field('age', '나이 · 세', { step: 1, min: 10, max: 110 })}<label class="field">성별<select name="sex"><option value="male" ${drafts.health.sex === 'male' ? 'selected' : ''}>남성</option><option value="female" ${drafts.health.sex === 'female' ? 'selected' : ''}>여성</option></select></label><label class="field">활동 수준<select name="activity">${[['1.2', '거의 앉아서 생활 (×1.2)'], ['1.375', '가벼운 운동 주 1~3회 (×1.375)'], ['1.55', '보통 운동 주 3~5회 (×1.55)'], ['1.725', '활발한 운동 주 6~7회 (×1.725)']].map(([v, t]) => `<option value="${v}" ${String(drafts.health.activity) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>`;
}

const rules = {
  unit: '계산식: (상품 가격 + 배송비 − 쿠폰) ÷ (개당 용량 × 묶음 수). g↔kg, mL↔L를 변환해 100g·100mL당 가격을 비교합니다.',
  discount: '할인은 순서대로 곱합니다. 20% 후 10%는 30%가 아닌 28% 할인입니다. 정액 쿠폰은 할인 뒤 적용하며 배송비에는 할인이 붙지 않습니다.',
  split: '총액을 인원으로 나눈 몫을 기본 금액으로 정하고, 나머지 원만큼의 사람이 1원씩 더 내 총액 오차 0원을 유지합니다.',
  trip: '연료비 = 총 주행거리 ÷ 연비 × 유가(원 단위 반올림). 통행료·주차비를 합산해 비중 도넛 차트와 1인 분담금을 보여줍니다.',
  compound: '매월 말 적립·월 복리 세전 추정치입니다. 실제 금융 상품의 이자소득세·수수료·변동 금리는 별도 확인이 필요합니다.',
  salary: '국민연금(4.5%, 월 상한 617만원)·건강보험(3.545%)·장기요양(12.95%)·고용보험(0.9%) 및 간이 근로소득세 추정치입니다. 실제 급여명세서의 회사별 공제 항목과 차이가 날 수 있습니다.',
  loan: '고정금리 기준 원금균등·원리금균등·만기일시 상환을 한 번에 비교합니다. 중도상환수수료·변동금리·거치기간은 포함하지 않습니다.',
  budget: '월 실수령 소득을 필수(50%)·여가(30%)·저축(20%) 등 합계 100% 비율로 배분해 도넛 차트와 연간 저축 목표를 계산합니다.',
  date: '두 날짜 사이의 총 일수, 주/일 환산, 평일(월~금)과 주말(토·일) 일수를 오프라인으로 계산합니다. 공휴일은 포함하지 않습니다.',
  percent: 'A에서 B% 증가·감소(음수 입력), A→B 증감률, 전체 대비 비중을 계산하고 기준값과 결과값을 막대 그래프로 비교합니다.',
  convert: '표준 국제 단위계(SI) 및 1평 = 3.305785㎡ 환산 계수를 사용합니다. 입력 즉시 같은 분류의 모든 단위를 한 번에 보여줍니다.',
  health: 'BMI는 대한비만학회 기준(정상 18.5~22.9), 기초대사량(BMR)은 Mifflin-St Jeor 공식을 사용합니다. 의료 진단 목적이 아닙니다.',
};

function splitDetail(r) {
  return `<div class="split-groups">${r.extra ? `<div><strong>${r.extra}명</strong><span>각 ${fmt(r.base + 1, 0)}원</span></div><div><strong>${r.people - r.extra}명</strong><span>각 ${fmt(r.base, 0)}원</span></div>` : `<div><strong>${r.people}명</strong><span>각 ${fmt(r.base, 0)}원</span></div>`}</div><p class="muted">배분 합계 ${fmt(r.total, 0)}원 · 남는 금액 0원</p>`;
}

function resultHTML() {
  if (!result) return '';
  let content = '';
  if (kind === 'unit') {
    content = `<p class="eyebrow">같은 단위로 비교한 결과</p><h3>${result.winner === 'tie' ? '단위가격이 같습니다' : result.winner + ' 상품이 ' + fmt(result.saving) + '% 저렴'}</h3>${unitBarSvg(result)}<div class="comparison">${result.rows.map((r) => `<div><span>${r.name}</span><strong>${fmt(r.rate)}원 <small>/ ${r.per}</small></strong><small>실결제 ${fmt(r.cost, 0)}원</small></div>`).join('')}</div>`;
  } else if (kind === 'discount') {
    content = `<p class="eyebrow">배송비 포함 최종 결제</p><h3>${fmt(result.total, 0)}<small> 원</small></h3>${discountWaterfallSvg(result)}<div class="metrics"><span>상품에서 절약<strong>${fmt(result.saved, 0)}원</strong></span><span>실효 할인율<strong>${fmt(result.percent)}%</strong></span><span>배송비<strong>${fmt(result.shipping, 0)}원</strong></span></div>`;
  } else if (kind === 'split') {
    content = `<p class="eyebrow">${fmt(result.total, 0)}원 · ${result.people}명</p><h3>한 사람의 1원까지 정확하게</h3>${splitDetail(result)}`;
  } else if (kind === 'trip') {
    content = `<p class="eyebrow">예상 이동 예산</p><h3>${fmt(result.total, 0)}<small> 원</small></h3>${tripDonutSvg(result)}${splitDetail(result.split)}`;
  } else if (kind === 'compound') {
    content = `<p class="eyebrow">${result.years}년 후 예상 잔액 (세전 월복리)</p><h3>${fmt(result.finalBalance, 0)}<small> 원</small></h3>${compoundAreaSvg(result)}<div class="metrics"><span>총 납입 원금<strong>${fmt(result.contributed, 0)}원</strong></span><span>누적 이자 수익<strong>+${fmt(result.totalInterest, 0)}원</strong></span><span>누적 수익률<strong>+${fmt(result.gainPct, 1)}%</strong></span></div>`;
  } else if (kind === 'salary') {
    content = `<p class="eyebrow">예상 월 실수령액 (세후)</p><h3>${fmt(result.netMonthly, 0)}<small> 원 / 월</small></h3>${salaryDonutSvg(result)}<div class="metrics"><span>세전 월급<strong>${fmt(result.grossMonthly, 0)}원</strong></span><span>총 공제액<strong>-${fmt(result.totalDeduction, 0)}원</strong></span><span>실효 공제율<strong>${fmt(result.effectiveRate, 1)}%</strong></span></div><p class="muted">국민연금 ${fmt(result.pension, 0)} · 건강보험 ${fmt(result.health, 0)} · 장기요양 ${fmt(result.care, 0)} · 고용보험 ${fmt(result.employment, 0)} · 소득세 ${fmt(result.incomeTax, 0)} · 지방세 ${fmt(result.localTax, 0)}원</p>`;
  } else if (kind === 'loan') {
    content = `<p class="eyebrow">원리금균등 월 납입액 (${result.months}개월)</p><h3>${fmt(result.amortized.monthly, 0)}<small> 원 / 월</small></h3>${loanCompareSvg(result)}<div class="metrics"><span>원금균등 (첫달→막달)<strong>${fmt(result.equal.first, 0)} → ${fmt(result.equal.last, 0)}</strong></span><span>만기일시 월 이자<strong>${fmt(result.bullet.monthly, 0)}원</strong></span><span>원금균등 이자 절감<strong>${fmt(result.savedEqualVsAmort, 0)}원</strong></span></div>`;
  } else if (kind === 'budget') {
    content = `<p class="eyebrow">월 실수령 ${fmt(result.income, 0)}원 배분</p><h3>월 저축 ${fmt(result.saveWon, 0)}<small> 원</small></h3>${budgetDonutSvg(result)}<div class="metrics"><span>필수 지출 (${result.needs}%)<strong>${fmt(result.needsWon, 0)}원</strong></span><span>여가·소비 (${result.wants}%)<strong>${fmt(result.wantsWon, 0)}원</strong></span><span>연간 저축 합계<strong>${fmt(result.annualSave, 0)}원</strong></span></div>`;
  } else if (kind === 'date') {
    content = `<p class="eyebrow">${result.start} ~ ${result.end}${result.includeStart ? ' (시작일 포함)' : ''}</p><h3>총 ${fmt(result.total, 0)}<small> 일</small></h3>${dateSpanSvg(result)}<div class="metrics"><span>주 환산<strong>${result.weeks}주 ${result.remDays}일</strong></span><span>평일 (월~금)<strong>${fmt(result.business, 0)}일</strong></span><span>주말 (토·일)<strong>${fmt(result.weekend, 0)}일</strong></span></div>`;
  } else if (kind === 'percent') {
    const headline = result.mode === 'ratio' ? `${fmt(result.result, 2)}<small> %</small>` : result.mode === 'change' ? `${fmt(result.result, 2)}` : `${result.result >= 0 ? '+' : ''}${fmt(result.result, 2)}<small> %</small>`;
    content = `<p class="eyebrow">${esc(result.label)}</p><h3>${headline}</h3>${percentBarSvg(result)}<div class="metrics"><span>기준값 A<strong>${fmt(result.a, 2)}</strong></span><span>입력값 B<strong>${fmt(result.b, 2)}</strong></span><span>변화량<strong>${result.delta >= 0 ? '+' : ''}${fmt(result.delta, 2)}</strong></span></div>`;
  } else if (kind === 'convert') {
    content = `<p class="eyebrow">한눈에 보는 단위 변환</p><h3>${fmt(result.sourceValue, 4)} <small>${esc(result.sourceUnit)}</small></h3><div class="conv-grid">${result.items.map((it) => `<div class="conv-card ${it.code === result.sourceUnit ? 'base' : ''}"><span>${esc(it.label)}</span><strong>${fmt(it.value, 4)}</strong></div>`).join('')}</div>`;
  } else {
    content = `<p class="eyebrow">BMI · 하루 권장 열량 추정</p><h3>BMI ${fmt(result.bmi, 1)} <small>· ${result.band}</small></h3>${bmiGaugeSvg(result)}<div class="metrics"><span>기초대사량(BMR)<strong>${fmt(result.bmr, 0)} kcal</strong></span><span>유지 칼로리<strong>${fmt(result.tdee, 0)} kcal</strong></span><span>감량 / 증량<strong>${fmt(result.cut, 0)} / ${fmt(result.bulk, 0)}</strong></span></div><p class="muted">키 ${result.height}cm 정상 체중 참고 구간: ${result.healthyMin} ~ ${result.healthyMax}kg</p>`;
  }
  return `<section class="result" aria-live="polite">${content}<div class="save-row"><label class="field">이 기록의 이름<input id="entry-title" maxlength="60" value="${esc(entryTitle)}" placeholder="예: 주말 장보기 / 10년 적금 계획"></label><button type="button" class="primary" data-action="save">${editing ? '기록 수정 저장' : '프로젝트에 기록'}</button></div><small>${currentProject() ? `저장 위치: ${esc(currentProject().name)}` : '상단에서 프로젝트를 먼저 만들어 주세요.'} · 입력을 바꾸면 다시 계산하세요.</small></section>`;
}

function projectPicker() {
  return `<section class="project-picker"><label class="field">기록할 프로젝트<select id="project-select"><option value="">프로젝트 선택</option>${state.projects.map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label><form id="new-project" class="new-project"><label class="field">새 프로젝트<input name="name" maxlength="60" required placeholder="예: 11월 생활·저축 계획"></label><button class="secondary">만들기</button></form></section>`;
}

function calcPage() {
  return `<section class="hero"><div><p class="eyebrow">VISUAL OFFLINE TOOLKIT</p><h1>그래프로 한눈에.<br>기록은 내 기기에.</h1><p>장보기·할인·정산·여행부터 복리 성장, 단위 변환, BMI 칼로리까지. <br class="desktop">시각 차트로 바로 비교하고 프로젝트에 쌓아 두세요.</p></div><div class="hero-card"><span>MY POCKET</span><strong>${state.projects.length}<small>개 프로젝트</small></strong><svg viewBox="0 0 220 44" class="hero-spark" aria-hidden="true"><path d="M4 38 C42 36, 86 27, 134 17 C168 10, 194 7, 216 4" fill="none" stroke="#b9e37b" stroke-width="3" stroke-linecap="round"/><circle cx="216" cy="4" r="4" fill="#b9e37b"/></svg><div><i></i>${native ? `설치된 앱 · ${KINDS.length}종 오프라인 도구` : '이 기기에 저장 · 계정 없이 시작'}</div><p>시각 비교 → 기록 → 체크 → 공유</p></div></section><div class="section-title"><h2>시각 생활 도구</h2><span>${KINDS.length}개의 오프라인 도구</span></div><div class="tool-grid">${KINDS.map((k) => `<article class="tool ${kind === k ? 'active' : ''}"><button data-action="tool" data-kind="${k}" class="tool-open" aria-pressed="${kind === k}"><span class="tool-icon ${k}">${iconSvg[k]}</span><strong>${LABELS[k]}</strong><small>${description[k]}</small></button><button class="favorite" data-action="favorite" data-kind="${k}" aria-label="${LABELS[k]} 즐겨찾기 ${state.favorites.includes(k) ? '해제' : '추가'}" aria-pressed="${state.favorites.includes(k)}">${state.favorites.includes(k) ? '★' : '☆'}</button></article>`).join('')}</div>${state.recent.length ? `<div class="recent"><span>최근 기록한 도구</span>${state.recent.map((k) => `<button data-action="tool" data-kind="${k}">${LABELS[k]} →</button>`).join('')}</div>` : ''}${state.favorites.length ? `<div class="recent"><span>★ 즐겨찾기</span>${state.favorites.map((k) => `<button data-action="tool" data-kind="${k}">${LABELS[k]}</button>`).join('')}</div>` : ''}${projectPicker()}<section class="calculator panel" id="calculator"><div class="section-title"><div><p class="eyebrow">${editing ? 'SAVED RECORD · 수정 중' : 'VISUAL CALCULATOR'}</p><h2>${LABELS[kind]}</h2></div><button class="quiet" data-action="example">예시값 불러오기</button></div><form id="calculate">${inputs()}<button class="primary calculate">${LABELS[kind]} 계산 · 그래프 보기 <span>→</span></button></form><div id="result">${resultHTML()}</div><details class="guide" open><summary>계산 방식과 사용 기준</summary><p>${rules[kind]}</p></details></section>`;
}

function projectsPage() {
  const p = currentProject(), filtered = state.projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  return `<section class="page-heading"><p class="eyebrow">YOUR LOCAL WORKSPACE</p><h1>다시 꺼내 쓰는 계산 기록</h1><p>계산 조건과 할 일을 한곳에. 최대 30개 프로젝트, 프로젝트당 기록·체크리스트 각 30개.</p></section>${projectPicker()}<label class="field search">프로젝트 찾기<input id="search" type="search" value="${esc(search)}" placeholder="이름으로 검색"></label><div class="project-grid">${filtered.map((p) => `<button data-action="select" data-id="${esc(p.id)}" class="project-card ${selected === p.id ? 'selected' : ''}" aria-pressed="${selected === p.id}"><span class="eyebrow">${esc(new Date(p.updatedAt).toLocaleDateString('ko-KR'))}</span><strong>${esc(p.name)}</strong><span>계산 ${p.entries.length}개 · 완료 ${p.tasks.filter((t) => t.done).length}/${p.tasks.length}</span></button>`).join('') || '<div class="empty">아직 프로젝트가 없거나 검색 결과가 없습니다. 위에서 첫 프로젝트를 만들어 보세요.</div>'}</div>${p ? `<section class="panel project-detail"><div class="section-title"><h2>${esc(p.name)}</h2><div class="actions"><button data-action="share" class="secondary">기록 공유</button><button data-action="duplicate" class="quiet">복제</button><button data-action="delete-project" class="danger">삭제</button></div></div><form id="edit-project"><div class="fields"><label class="field">프로젝트 이름<input name="name" value="${esc(p.name)}" maxlength="60" required></label><label class="field">메모<textarea name="note" maxlength="1000" rows="2" placeholder="가격을 비교한 매장, 여행 날짜 등">${esc(p.note)}</textarea></label></div><button class="secondary">이름·메모 저장</button></form><h3>계산 기록 <span class="count">${p.entries.length}</span></h3><div class="entries">${p.entries.map((e) => `<article class="entry"><div><span class="tag">${LABELS[e.kind]}</span><h4>${esc(e.title)}</h4><p>${esc(summary(e.kind, e.input))}</p><small>${esc(new Date(e.createdAt).toLocaleString('ko-KR'))}</small></div><div class="actions"><button data-action="edit-entry" data-id="${esc(e.id)}" class="secondary">열기·수정</button><button data-action="delete-entry" data-id="${esc(e.id)}" class="danger">삭제</button></div></article>`).join('') || '<p class="empty">계산 탭에서 결과를 저장하면 여기에 모입니다.</p>'}</div><h3>함께 챙길 일 <span class="count">${p.tasks.filter((t) => t.done).length}/${p.tasks.length}</span></h3><progress value="${p.tasks.filter((t) => t.done).length}" max="${p.tasks.length || 1}" aria-label="체크리스트 완료율"></progress><div class="tasks">${p.tasks.map((t) => `<div class="task"><label><input type="checkbox" data-task="${esc(t.id)}" ${t.done ? 'checked' : ''}><span>${esc(t.text)}</span></label><button class="quiet" data-action="delete-task" data-id="${esc(t.id)}" aria-label="${esc(t.text)} 삭제">×</button></div>`).join('')}</div><form id="add-task" class="new-project"><label class="field">체크리스트 추가<input name="text" maxlength="120" required placeholder="예: 매장 쿠폰 유효기간 확인"></label><button class="secondary">추가</button></form></section>` : ''}`;
}

function helpPage() {
  return `<section class="page-heading"><p class="eyebrow">PRIVATE BY DESIGN</p><h1>기록은 내 기기에,<br>계산은 언제든.</h1><p>ToolHub Pocket은 자주 다시 여는 ${KINDS.length}개 생활·금융·건강 도구를 시각 차트 앱으로 묶은 오프라인 워크스페이스입니다.</p></section><div class="help-grid"><section class="panel"><h2>이렇게 사용하세요</h2><ol><li>장보기·저축·여행 이름으로 프로젝트를 만드세요.</li><li>${KINDS.length}개 시각 도구로 계산하고 그래프와 조건을 함께 기록하세요.</li><li>체크리스트를 채우고, 다음에는 기록을 열어 조건을 바로 수정하세요.</li><li>기기 변경 전 JSON 백업을 내보내고 새 기기에서 가져오세요.</li></ol></section><section class="panel"><h2>백업과 가져오기</h2><p>이 기기에 최대 30개 프로젝트가 저장됩니다. 자동 동기화나 계정 복구는 제공하지 않으므로 중요한 기록은 백업해 두세요.</p><div class="actions"><button data-action="export" class="primary">전체 JSON 백업</button><label class="secondary file">JSON 가져오기<input id="import" type="file" accept=".json,application/json"></label></div><p class="muted">가져오기는 기존 기록을 보존하고 새 복사본으로 추가합니다. 파일 최대 1.5MB.</p></section><section class="panel"><h2>오프라인과 설치</h2><p id="offline-status">${native ? `Android·iOS 앱에는 ${KINDS.length}종 계산 코드와 차트 화면이 모두 포함되어 첫 실행부터 오프라인으로 동작합니다.` : offlineReady ? '웹 오프라인 준비 완료. 이 브라우저에서 방문한 /workspace/를 연결 없이 다시 열 수 있습니다.' : '웹은 처음 온라인으로 방문해 오프라인 파일을 저장해야 합니다.'}</p><p>전체 웹 도구와 상세 가이드는 인터넷 연결이 필요합니다.</p></section><section class="panel"><h2>개인정보와 문의</h2><p>이 워크스페이스는 계산 내용·메모·즐겨찾기를 서버로 전송하지 않으며 광고·분석 추적기를 포함하지 않습니다.</p><p>문의: <a href="mailto:jhighllight@gmail.com">jhighllight@gmail.com</a></p><button data-action="reset" class="danger">이 기기의 Pocket 기록 전체 삭제</button>${locked && rawBackup ? '<button data-action="raw-export" class="secondary">읽지 못한 원본 백업 다운로드</button>' : ''}</section></div><section class="panel"><h2>전체 웹 도구 &amp; 가이드</h2><div class="actions"><a href="https://tool-hub.me/guides/" target="_blank" rel="noopener" class="secondary">실생활 계산 가이드 ↗</a><a href="https://tool-hub.me/" target="_blank" rel="noopener" class="secondary">전체 웹 도구 둘러보기 ↗</a></div></section>`;
}

function render() {
  el.innerHTML = `<header><a class="brand" href="${native ? '#' : '/workspace/'}"><span class="brand-icon">th</span><span>ToolHub <b>Pocket</b><small>시각 생활 계산 워크스페이스</small></span></a><button id="install" class="secondary" ${!installPrompt ? 'hidden' : ''}>홈 화면에 설치</button><span class="connection">${native ? '기기 저장' : '브라우저 저장'} <i></i></span></header><nav aria-label="주 메뉴">${[['calculate', '시각 계산기', '01'], ['projects', '내 프로젝트', '02'], ['help', '백업·안내', '03']].map(([v, t, n]) => `<button data-tab="${v}" aria-current="${tab === v ? 'page' : 'false'}" class="${tab === v ? 'active' : ''}"><span>${n}</span>${t}</button>`).join('')}</nav><main><div id="notice" role="status" aria-live="polite" class="notice ${error ? 'error' : ''}" ${!message ? 'hidden' : ''}>${esc(message)}</div>${locked ? '<div class="notice error">기기 저장소를 읽지 못해 저장을 잠갔습니다. 계산은 계속할 수 있습니다. 백업·안내에서 복구하세요.</div>' : ''}${tab === 'calculate' ? calcPage() : tab === 'projects' ? projectsPage() : helpPage()}</main><footer><strong>ToolHub Pocket</strong><span>시각 차트와 기록으로 남기는 오프라인 생활 도구.</span><small>v0.4 · ${native ? 'Android / iOS' : 'Web'} · ${KINDS.length} Tools</small></footer>`;
}

function refreshResult() { document.querySelector('#result').innerHTML = resultHTML(); }
function switchTool(k) { kind = k; editing = null; entryTitle = ''; result = null; tab = 'calculate'; render(); document.querySelector('#calculator')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

el.addEventListener('input', (e) => {
  if (e.target.closest('#calculate')) { drafts[kind][e.target.name] = e.target.value; result = null; refreshResult(); }
  if (e.target.id === 'entry-title') entryTitle = e.target.value;
  if (e.target.id === 'search') { search = e.target.value; const pos = e.target.selectionStart; render(); const s = document.querySelector('#search'); s.focus(); s.setSelectionRange?.(pos, pos); }
});
el.addEventListener('change', (e) => {
  if (e.target.closest('#calculate') && kind === 'convert' && e.target.name === 'category') {
    drafts.convert.category = e.target.value;
    drafts.convert.unit = CONVERT_TABLE[e.target.value][0][0];
    result = null;
    render();
    return;
  }
  if (e.target.closest('#calculate') && kind === 'percent' && e.target.name === 'mode') {
    drafts.percent.mode = e.target.value;
    result = null;
    render();
    return;
  }
  if (e.target.id === 'project-select') { selected = e.target.value; editing = null; render(); }
  if (e.target.dataset.task) action(async () => { const next = structuredClone(state), p = next.projects.find((p) => p.id === selected); p.tasks.find((t) => t.id === e.target.dataset.task).done = e.target.checked; p.updatedAt = new Date().toISOString(); try { await commit(next); } finally { render(); } });
  if (e.target.id === 'import') action(async () => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 1500000) throw Error('파일은 1.5MB 이하여야 합니다.'); const imported = parseBackup(await file.text()); if (!confirm(`${imported.projects.length}개 프로젝트를 새 복사본으로 추가할까요? 기존 기록은 유지됩니다.`)) return; await commit(mergeBackup(state, imported)); notify(`${imported.projects.length}개 프로젝트를 가져왔습니다.`); render(); });
});
el.addEventListener('submit', (e) => {
  e.preventDefault(); const form = e.target, data = Object.fromEntries(new FormData(form));
  action(async () => {
    if (form.id === 'calculate') { drafts[kind] = { ...data }; try { result = calculate(kind, data); notify('계산 완료. 조건과 결과를 남기려면 프로젝트에 기록하세요.'); } catch (err) { result = null; throw err; } finally { refreshResult(); } return; }
    if (form.id === 'new-project') { const name = data.name.trim(); if (!name) throw Error('프로젝트 이름을 입력하세요.'); if (state.projects.length >= 30) throw Error('프로젝트는 최대 30개입니다.'); const now = new Date().toISOString(), p = { id: id(), name, note: '', createdAt: now, updatedAt: now, entries: [], tasks: [] }; await commit({ ...state, projects: [p, ...state.projects] }); selected = p.id; editing = null; notify('프로젝트를 만들었습니다. 계산을 기록해 보세요.'); }
    if (form.id === 'edit-project') { const next = structuredClone(state), p = next.projects.find((p) => p.id === selected); p.name = data.name.trim(); p.note = data.note; p.updatedAt = new Date().toISOString(); await commit(next); notify('이름과 메모를 저장했습니다.'); }
    if (form.id === 'add-task') { const text = data.text.trim(); if (!text) throw Error('할 일을 입력하세요.'); const next = structuredClone(state), p = next.projects.find((p) => p.id === selected); if (p.tasks.length >= 30) throw Error('체크리스트는 최대 30개입니다.'); p.tasks.push({ id: id(), text, done: false }); p.updatedAt = new Date().toISOString(); await commit(next); notify('할 일을 추가했습니다.'); }
    render();
  });
});
el.addEventListener('click', (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  if (btn.dataset.tab) { tab = btn.dataset.tab; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (btn.id === 'install') { action(async () => { await installPrompt?.prompt(); installPrompt = null; render(); }); return; }
  const a = btn.dataset.action; if (!a) return;
  action(async () => {
    if (a === 'tool') { switchTool(btn.dataset.kind); return; }
    if (a === 'example') { drafts[kind] = structuredClone(defaults[kind]); editing = null; result = null; entryTitle = ''; notify('예시값을 불러왔습니다. 내 조건으로 바꿔 계산하세요.'); }
    if (a === 'favorite') { const k = btn.dataset.kind; await commit({ ...state, favorites: state.favorites.includes(k) ? state.favorites.filter((x) => x !== k) : [...state.favorites, k] }); notify('즐겨찾기를 저장했습니다.'); }
    if (a === 'save') { if (!result) throw Error('조건을 먼저 계산하세요.'); const p = currentProject(); if (!p) throw Error('위에서 프로젝트를 만들거나 선택한 뒤 다시 저장하세요.'); const old = p.entries.find((e) => e.id === editing), entry = { id: editing || id(), kind, input: structuredClone(drafts[kind]), title: entryTitle.trim() || LABELS[kind], createdAt: old?.createdAt || new Date().toISOString() }; await commit(addEntry(state, selected, entry)); editing = entry.id; notify('기기에 저장했습니다. 내 프로젝트에서 조건을 다시 열 수 있습니다.'); }
    if (a === 'select') { selected = btn.dataset.id; editing = null; }
    if (a === 'edit-entry') { const entry = currentProject().entries.find((e) => e.id === btn.dataset.id); kind = entry.kind; drafts[kind] = structuredClone(entry.input); entryTitle = entry.title; editing = entry.id; result = calculate(kind, drafts[kind]); tab = 'calculate'; notify('저장한 기록을 열었습니다. 입력을 바꾼 뒤 다시 계산하고 수정 저장하세요.'); }
    if (a === 'delete-entry' || a === 'delete-task') { if (!confirm(a === 'delete-entry' ? '이 계산 기록을 삭제할까요?' : '이 할 일을 삭제할까요?')) return; const next = structuredClone(state), p = next.projects.find((p) => p.id === selected), key = a === 'delete-entry' ? 'entries' : 'tasks'; p[key] = p[key].filter((x) => x.id !== btn.dataset.id); p.updatedAt = new Date().toISOString(); await commit(next); if (editing === btn.dataset.id) editing = null; notify('삭제했습니다.'); }
    if (a === 'delete-project') { if (!confirm(`“${currentProject().name}”의 기록과 체크리스트를 모두 삭제할까요?`)) return; await commit({ ...state, projects: state.projects.filter((p) => p.id !== selected) }); selected = ''; editing = null; notify('프로젝트를 삭제했습니다.'); }
    if (a === 'duplicate') { const p = currentProject(), backup = { ...emptyState(), projects: [{ ...p, name: (p.name + ' 복사').slice(0, 60) }] }; const next = mergeBackup(state, backup); await commit(next); selected = state.projects.at(-1).id; notify('새 프로젝트로 복제했습니다.'); }
    if (a === 'share') { await shareText(projectText(currentProject())); notify('공유 또는 파일 내보내기를 요청했습니다.'); }
    if (a === 'export') { await exportFile(JSON.stringify(state, null, 2), `toolhub-pocket-${new Date().toISOString().slice(0, 10)}.json`); notify('백업 파일 내보내기를 요청했습니다.'); }
    if (a === 'raw-export') await exportFile(rawBackup, 'toolhub-pocket-recovery.txt', 'text/plain');
    if (a === 'reset') { if (!confirm('이 기기의 Pocket 프로젝트·체크리스트·즐겨찾기를 모두 삭제할까요? 되돌릴 수 없습니다.')) return; const empty = emptyState(); await storage.set(JSON.stringify(empty)); state = empty; locked = false; rawBackup = ''; selected = ''; editing = null; notify('Pocket 기록을 초기화했습니다.'); }
    render();
  });
});

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; const btn = document.querySelector('#install'); if (btn) btn.hidden = false; });
setupBack(() => { if (tab !== 'calculate') { tab = 'calculate'; render(); return true; } return false; });
try { const raw = await storage.get(); if (raw) { rawBackup = raw; state = parseBackup(raw); } selected = state.projects[0]?.id || ''; } catch (e) { locked = true; message = '저장소 읽기 실패: ' + e.message; error = true; }
render();
if (!native && 'serviceWorker' in navigator && !import.meta.env.DEV) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    if (reg.active) return;
    const worker = reg.installing || reg.waiting;
    if (!worker) throw Error('오프라인 준비 실패');
    return new Promise((resolve, reject) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') resolve();
        if (worker.state === 'redundant') reject(Error('오프라인 설치 실패'));
      });
    });
  }).then(() => {
    offlineReady = true;
    const box = document.querySelector('#offline-status');
    if (box) box.textContent = '웹 오프라인 준비 완료. 이 브라우저에서 /workspace/를 연결 없이 다시 열 수 있습니다.';
  }).catch(() => notify('오프라인 파일 저장에 실패했습니다. 현재 온라인 계산은 사용할 수 있습니다.', true));
}
