export const KINDS = ['unit', 'discount', 'split', 'trip', 'compound', 'salary', 'loan', 'budget', 'date', 'percent', 'convert', 'health'];
export const LIMITS = { projects: 30, entries: 30, tasks: 30, backup: 1500000 };
export const LABELS = {
  unit: '장보기 비교',
  discount: '할인 계산',
  split: '모임 정산',
  trip: '여행 예산',
  compound: '복리·적금',
  salary: '연봉 실수령',
  loan: '대출 상환',
  budget: '월 예산 배분',
  date: 'D-Day·날짜',
  percent: '퍼센트·증감',
  convert: '단위 변환',
  health: 'BMI·칼로리',
};
export const defaults = {
  unit: { aPrice: 12000, aShip: 0, aCoupon: 0, aSize: 500, aCount: 2, aUnit: 'g', bPrice: 10900, bShip: 2500, bCoupon: 1000, bSize: 1, bCount: 1, bUnit: 'kg' },
  discount: { price: 100000, first: 20, second: 10, coupon: 0, shipping: 0 },
  split: { total: 50000, people: 3 },
  trip: { distance: 320, efficiency: 12, fuel: 1700, toll: 15000, parking: 10000, people: 4 },
  compound: { principal: 10000000, monthly: 300000, rate: 5, years: 10 },
  salary: { annual: 50000000, nonTaxMonthly: 200000, dependents: 1 },
  loan: { amount: 100000000, rate: 4.5, years: 20 },
  budget: { income: 3500000, needs: 50, wants: 30, save: 20 },
  date: { start: '2026-11-28', end: '2026-12-31', includeStart: 'no' },
  percent: { mode: 'change', a: 100000, b: 15 },
  convert: { category: 'length', value: 100, unit: 'cm' },
  health: { height: 172, weight: 68, age: 32, sex: 'male', activity: 1.55 },
};
const units = { g: ['weight', 1, '100g', 100], kg: ['weight', 1000, '100g', 100], ml: ['volume', 1, '100mL', 100], L: ['volume', 1000, '100mL', 100], ea: ['count', 1, '1개', 1] };
export const CONVERT_TABLE = {
  length: [
    ['mm', '밀리미터 (mm)', 0.001],
    ['cm', '센티미터 (cm)', 0.01],
    ['m', '미터 (m)', 1],
    ['km', '킬로미터 (km)', 1000],
    ['in', '인치 (in)', 0.0254],
    ['ft', '피트 (ft)', 0.3048],
  ],
  weight: [
    ['g', '그램 (g)', 1],
    ['kg', '킬로그램 (kg)', 1000],
    ['oz', '온스 (oz)', 28.349523125],
    ['lb', '파운드 (lb)', 453.59237],
  ],
  area: [
    ['m2', '제곱미터 (㎡)', 1],
    ['pyeong', '평', 3.305785],
    ['ft2', '제곱피트 (ft²)', 0.09290304],
  ],
  temp: [
    ['C', '섭씨 (°C)', 1],
    ['F', '화씨 (°F)', 1],
    ['K', '켈빈 (K)', 1],
  ],
};

export function number(value, name, min = 0, max = 1e9, integer = false) {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '' || !/^\d+(\.\d+)?$/.test(String(value))) {
    throw Error(`${name}: 올바른 숫자를 입력하세요.`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw Error(`${name}: ${min}~${max}${integer ? ' 범위의 정수' : ' 범위'}를 입력하세요.`);
  }
  return n;
}
function signedNumber(value, name, min, max) {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '' || !/^-?\d+(\.\d+)?$/.test(String(value))) {
    throw Error(`${name}: 올바른 숫자를 입력하세요.`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw Error(`${name}: ${min}~${max} 범위를 입력하세요.`);
  return n;
}
function won(v, n, max = 1e9) { return number(v, n, 0, max, true); }
export function splitWon(total, people) {
  total = number(total, '총액', 0, 1e12, true);
  people = number(people, '인원', 1, 100, true);
  const base = Math.floor(total / people), extra = total % people;
  return { total, people, base, extra, shares: Array.from({ length: people }, (_, i) => base + (i < extra ? 1 : 0)) };
}

function krAnnualIncomeTax(taxable) {
  if (taxable <= 0) return 0;
  const brackets = [
    [14000000, 0.06, 0],
    [50000000, 0.15, 1260000],
    [88000000, 0.24, 5760000],
    [150000000, 0.35, 15440000],
    [300000000, 0.38, 19940000],
    [500000000, 0.40, 25940000],
    [1000000000, 0.42, 35940000],
    [Infinity, 0.45, 65940000],
  ];
  for (const [cap, rate, sub] of brackets) {
    if (taxable <= cap) return Math.max(0, taxable * rate - sub);
  }
  return 0;
}

function earnedIncomeDeduction(annual) {
  if (annual <= 5000000) return annual * 0.7;
  if (annual <= 15000000) return 3500000 + (annual - 5000000) * 0.4;
  if (annual <= 45000000) return 7500000 + (annual - 15000000) * 0.15;
  if (annual <= 100000000) return 12000000 + (annual - 45000000) * 0.05;
  return Math.min(20000000, 14750000 + (annual - 100000000) * 0.02);
}

export function calculate(kind, input) {
  if (!KINDS.includes(kind) || !input || typeof input !== 'object') throw Error('지원하지 않는 계산입니다.');
  if (kind === 'unit') {
    const rows = ['a', 'b'].map((p, i) => {
      const price = won(input[p + 'Price'], '상품 가격'), shipping = won(input[p + 'Ship'], '배송비'), coupon = won(input[p + 'Coupon'], '쿠폰');
      const capacity = number(input[p + 'Size'], '용량', 0.001, 1e6), count = number(input[p + 'Count'], '묶음 수', 1, 10000, true), unit = units[input[p + 'Unit']];
      if (!unit) throw Error('단위를 선택하세요.');
      const cost = price + shipping - coupon;
      if (cost < 0) throw Error('쿠폰이 상품 가격과 배송비 합계를 넘습니다.');
      return { name: i ? 'B 상품' : 'A 상품', cost, category: unit[0], per: unit[2], rate: cost / (capacity * count * unit[1]) * unit[3] };
    });
    if (rows[0].category !== rows[1].category) throw Error('같은 종류의 단위를 비교하세요. 무게·부피·개수는 서로 바꿀 수 없습니다.');
    const high = Math.max(...rows.map(r => r.rate)), low = Math.min(...rows.map(r => r.rate));
    return { rows, winner: Math.abs(rows[0].rate - rows[1].rate) < 1e-9 ? 'tie' : rows[0].rate < rows[1].rate ? 'A' : 'B', saving: high === 0 ? 0 : (high - low) / high * 100 };
  }
  if (kind === 'discount') {
    const price = won(input.price, '정가'), first = number(input.first, '첫 할인', 0, 100), second = number(input.second, '추가 할인', 0, 100), coupon = won(input.coupon, '쿠폰'), shipping = won(input.shipping, '배송비');
    const discounted = price * (1 - first / 100) * (1 - second / 100), epsilon = Math.max(1, price) * Number.EPSILON * 4;
    if (coupon - discounted > epsilon) throw Error('쿠폰은 할인 적용 후 상품 금액 이하여야 합니다.');
    const goods = Math.round(Math.max(0, discounted - coupon) + epsilon), total = goods + shipping;
    return { price, goods, total, shipping, saved: price - goods, percent: price === 0 ? 0 : (price - goods) / price * 100 };
  }
  if (kind === 'split') return splitWon(won(input.total, '총액'), number(input.people, '인원', 1, 100, true));
  if (kind === 'trip') {
    const distance = number(input.distance, '총 주행거리', 0, 100000), efficiency = number(input.efficiency, '연비', 0.1, 1000), fuel = won(input.fuel, '리터당 가격'), toll = won(input.toll, '통행료'), parking = won(input.parking, '주차비'), people = number(input.people, '인원', 1, 100, true);
    const liters = distance / efficiency, fuelCost = Math.round(liters * fuel), total = fuelCost + toll + parking;
    return { liters, fuelCost, toll, parking, total, split: splitWon(total, people) };
  }
  if (kind === 'compound') {
    const principal = won(input.principal, '초기 원금');
    const monthly = won(input.monthly, '월 적립액');
    const rate = number(input.rate, '연 수익률', 0, 50);
    const years = number(input.years, '투자 기간', 1, 50, true);
    const r = rate / 100 / 12;
    let balance = principal;
    let contributed = principal;
    const series = [{ year: 0, principal: contributed, balance: Math.round(balance), interest: 0 }];
    for (let y = 1; y <= years; y++) {
      for (let m = 0; m < 12; m++) {
        balance = balance * (1 + r) + monthly;
        contributed += monthly;
      }
      const rounded = Math.round(balance);
      series.push({ year: y, principal: contributed, balance: rounded, interest: Math.max(0, rounded - contributed) });
    }
    const finalBalance = series.at(-1).balance;
    const totalInterest = Math.max(0, finalBalance - contributed);
    const gainPct = contributed === 0 ? 0 : (totalInterest / contributed) * 100;
    return { principal, monthly, rate, years, contributed, totalInterest, finalBalance, gainPct, series };
  }
  if (kind === 'salary') {
    const annual = number(input.annual, '연봉', 1000000, 1e10, true);
    const nonTaxMonthly = won(input.nonTaxMonthly, '비과세 식대(월)', 2000000);
    const dependents = number(input.dependents, '부양가족 수(본인 포함)', 1, 11, true);
    const grossMonthly = Math.round(annual / 12);
    const taxableMonthly = Math.max(0, grossMonthly - nonTaxMonthly);
    const pensionBase = Math.min(6170000, Math.max(390000, taxableMonthly));
    const pension = taxableMonthly === 0 ? 0 : Math.floor((pensionBase * 0.045) / 10) * 10;
    const health = Math.floor((taxableMonthly * 0.03545) / 10) * 10;
    const care = Math.floor((health * 0.1295) / 10) * 10;
    const employment = Math.floor((taxableMonthly * 0.009) / 10) * 10;
    const insurance = pension + health + care + employment;
    const taxableAnnual = Math.max(0, taxableMonthly * 12);
    const earnedDed = earnedIncomeDeduction(taxableAnnual);
    const personalDed = dependents * 1500000;
    const pensionDed = pension * 12;
    const taxBase = Math.max(0, taxableAnnual - earnedDed - personalDed - pensionDed - 130000);
    const rawAnnualTax = krAnnualIncomeTax(taxBase);
    const taxCredit = rawAnnualTax <= 1300000 ? rawAnnualTax * 0.55 : 715000 + (rawAnnualTax - 1300000) * 0.30;
    const cappedCredit = Math.min(taxCredit, taxableAnnual <= 33000000 ? 740000 : taxableAnnual <= 70000000 ? 660000 : 500000);
    const incomeTax = Math.floor(Math.max(0, rawAnnualTax - cappedCredit) / 12 / 10) * 10;
    const localTax = Math.floor((incomeTax * 0.1) / 10) * 10;
    const tax = incomeTax + localTax;
    const totalDeduction = insurance + tax;
    const netMonthly = Math.max(0, grossMonthly - totalDeduction);
    const effectiveRate = grossMonthly === 0 ? 0 : (totalDeduction / grossMonthly) * 100;
    return { annual, grossMonthly, nonTaxMonthly, dependents, pension, health, care, employment, insurance, incomeTax, localTax, tax, totalDeduction, netMonthly, effectiveRate };
  }
  if (kind === 'loan') {
    const amount = number(input.amount, '대출 원금', 100000, 1e11, true);
    const rate = number(input.rate, '연 이자율', 0, 50);
    const years = number(input.years, '상환 기간(년)', 1, 50, true);
    const n = years * 12;
    const r = rate / 100 / 12;
    const amortMonthly = r === 0 ? Math.round(amount / n) : Math.round((amount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
    const amortTotal = amortMonthly * n;
    const amortInterest = Math.max(0, amortTotal - amount);
    const equalPrincipal = amount / n;
    const equalFirst = Math.round(equalPrincipal + amount * r);
    const equalLast = Math.round(equalPrincipal + equalPrincipal * r);
    const equalInterest = Math.round((amount * r * (n + 1)) / 2);
    const equalTotal = amount + equalInterest;
    const bulletMonthly = Math.round(amount * r);
    const bulletInterest = bulletMonthly * n;
    const bulletTotal = amount + bulletInterest;
    return {
      amount, rate, years, months: n,
      amortized: { monthly: amortMonthly, interest: amortInterest, total: amortTotal },
      equal: { first: equalFirst, last: equalLast, interest: equalInterest, total: equalTotal },
      bullet: { monthly: bulletMonthly, interest: bulletInterest, total: bulletTotal },
      savedEqualVsAmort: Math.max(0, amortInterest - equalInterest),
    };
  }
  if (kind === 'budget') {
    const income = number(input.income, '월 실수령 소득', 10000, 1e10, true);
    const needs = number(input.needs, '필수 지출 비율(%)', 0, 100);
    const wants = number(input.wants, '여가·소비 비율(%)', 0, 100);
    const save = number(input.save, '저축·투자 비율(%)', 0, 100);
    if (Math.abs(needs + wants + save - 100) > 1e-6) {
      throw Error('필수·여가·저축 비율의 합은 정확히 100%여야 합니다.');
    }
    const needsWon = Math.round((income * needs) / 100);
    const wantsWon = Math.round((income * wants) / 100);
    const saveWon = Math.max(0, income - needsWon - wantsWon);
    return { income, needs, wants, save, needsWon, wantsWon, saveWon, annualSave: saveWon * 12 };
  }
  if (kind === 'date') {
    const parseIso = (v, label) => {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) throw Error(`${label}: YYYY-MM-DD 형식의 날짜를 입력하세요.`);
      const [y, m, d] = v.trim().split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw Error(`${label}: 존재하지 않는 날짜입니다.`);
      return dt;
    };
    const sRaw = parseIso(input.start, '시작일');
    const eRaw = parseIso(input.end, '종료일');
    const includeStart = input.includeStart === 'yes';
    const swapped = sRaw.getTime() > eRaw.getTime();
    const s = swapped ? eRaw : sRaw;
    const e = swapped ? sRaw : eRaw;
    const diff = Math.round((e.getTime() - s.getTime()) / 86400000);
    if (diff > 36525) throw Error('날짜 간격은 최대 100년(36,525일) 이하로 입력하세요.');
    const total = diff + (includeStart ? 1 : 0);
    let business = 0;
    let weekend = 0;
    const cur = new Date(s.getTime());
    const steps = includeStart ? diff + 1 : diff;
    for (let i = 0; i < steps; i++) {
      const dow = cur.getUTCDay();
      if (dow === 0 || dow === 6) weekend++;
      else business++;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    const weeks = Math.floor(total / 7);
    const remDays = total % 7;
    const toIso = (d) => d.toISOString().slice(0, 10);
    return { start: toIso(s), end: toIso(e), includeStart, swapped, diff, total, weeks, remDays, business, weekend };
  }
  if (kind === 'percent') {
    const mode = input.mode;
    if (!['ratio', 'change', 'rate'].includes(mode)) throw Error('퍼센트 계산 방식을 선택하세요.');
    const a = signedNumber(input.a, '기준값 A', -1e12, 1e12);
    const b = signedNumber(input.b, '비교/비율값 B', -1e12, 1e12);
    if (mode === 'ratio') {
      if (b === 0) throw Error('전체값 B는 0이 될 수 없습니다.');
      const pct = (a / b) * 100;
      return { mode, a, b, result: pct, delta: a, label: `${a} ÷ ${b}` };
    }
    if (mode === 'change') {
      const delta = Math.round(((a * b) / 100) * 1e10) / 1e10;
      const after = Math.round((a + delta) * 1e10) / 1e10;
      return { mode, a, b, result: after, delta, label: `${b >= 0 ? '+' : ''}${b}% 적용` };
    }
    if (a === 0) throw Error('시작값 A는 0이 될 수 없습니다.');
    const rate = ((b - a) / a) * 100;
    return { mode, a, b, result: rate, delta: b - a, label: `${a} → ${b}` };
  }
  if (kind === 'convert') {
    const category = input.category;
    const table = CONVERT_TABLE[category];
    if (!table) throw Error('변환 분류를 선택하세요.');
    const spec = table.find(([code]) => code === input.unit);
    if (!spec) throw Error('기준 단위를 선택하세요.');
    if (category === 'temp') {
      const val = signedNumber(input.value, '온도 값', -500, 10000);
      const c = spec[0] === 'C' ? val : spec[0] === 'F' ? (val - 32) * 5 / 9 : val - 273.15;
      if (c < -273.15 - 1e-9) throw Error('온도 값: 절대영도(-273.15°C) 미만은 계산할 수 없습니다.');
      const items = [
        { code: 'C', label: '섭씨 (°C)', value: c },
        { code: 'F', label: '화씨 (°F)', value: c * 9 / 5 + 32 },
        { code: 'K', label: '켈빈 (K)', value: c + 273.15 },
      ];
      return { category, sourceUnit: spec[0], sourceValue: val, items };
    }
    const val = number(input.value, '변환할 값', 0, 1e12);
    const base = val * spec[2];
    const items = table.map(([code, label, factor]) => ({ code, label, value: base / factor }));
    return { category, sourceUnit: spec[0], sourceValue: val, items };
  }
  const height = number(input.height, '키 (cm)', 80, 250);
  const weight = number(input.weight, '몸무게 (kg)', 20, 300);
  const age = number(input.age, '나이', 10, 110, true);
  const sex = input.sex === 'female' ? 'female' : input.sex === 'male' ? 'male' : null;
  if (!sex) throw Error('성별을 선택하세요.');
  const activity = number(input.activity, '활동 계수', 1.1, 2.2);
  const hM = height / 100;
  const bmi = weight / (hM * hM);
  const band = bmi < 18.5 ? '저체중' : bmi < 23 ? '정상' : bmi < 25 ? '과체중' : '비만';
  const bmr = Math.round(10 * weight + 6.25 * height - 5 * age + (sex === 'male' ? 5 : -161));
  const tdee = Math.round(bmr * activity);
  return {
    height, weight, age, sex, activity,
    bmi, band, bmr, tdee,
    cut: Math.max(1200, tdee - 400),
    bulk: tdee + 300,
    healthyMin: Math.round(18.5 * hM * hM * 10) / 10,
    healthyMax: Math.round(22.9 * hM * hM * 10) / 10,
  };
}
export function emptyState() { return { version: 1, projects: [], favorites: ['unit', 'salary', 'compound'], recent: [] }; }
export function id() { return globalThis.crypto.randomUUID(); }
function str(v, max, name) { if (typeof v !== 'string' || v.length > max || !v.trim()) throw Error(`${name} 형식이 잘못되었습니다.`); return v; }
function date(v) { str(v, 40, '날짜'); if (!Number.isFinite(Date.parse(v))) throw Error('날짜 형식이 잘못되었습니다.'); return v; }
export function validateState(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.projects) || raw.projects.length > LIMITS.projects || !Array.isArray(raw.favorites) || !Array.isArray(raw.recent)) {
    throw Error('ToolHub Pocket v1 백업 파일이 아니거나 최대 30개 프로젝트를 초과했습니다.');
  }
  const ids = new Set();
  const unique = (v) => { str(v, 100, 'ID'); if (ids.has(v)) throw Error('중복 ID가 있습니다.'); ids.add(v); return v; };
  const projects = raw.projects.map(p => {
    if (!Array.isArray(p.entries) || p.entries.length > 30 || !Array.isArray(p.tasks) || p.tasks.length > 30) throw Error('프로젝트의 기록/체크리스트는 각각 최대 30개입니다.');
    return {
      id: unique(p.id), name: str(p.name, 60, '프로젝트 이름'), note: typeof p.note === 'string' && p.note.length <= 1000 ? p.note : '', createdAt: date(p.createdAt), updatedAt: date(p.updatedAt),
      entries: p.entries.map(e => {
        calculate(e.kind, e.input);
        const input = {};
        for (const key of Object.keys(defaults[e.kind])) input[key] = e.input[key];
        return { id: unique(e.id), kind: e.kind, input, createdAt: date(e.createdAt), title: str(e.title, 60, '계산 이름') };
      }),
      tasks: p.tasks.map(t => ({ id: unique(t.id), text: str(t.text, 120, '체크리스트'), done: t.done === true })),
    };
  });
  if (raw.favorites.length > KINDS.length || raw.recent.length > KINDS.length || [...raw.favorites, ...raw.recent].some(x => !KINDS.includes(x))) {
    throw Error('도구 목록 형식이 잘못되었습니다.');
  }
  return { version: 1, projects, favorites: [...new Set(raw.favorites)], recent: [...new Set(raw.recent)] };
}
export function parseBackup(text) { if (typeof text !== 'string' || text.length > LIMITS.backup) throw Error('백업 파일은 1.5MB 이하여야 합니다.'); return validateState(JSON.parse(text)); }
export function mergeBackup(current, backup, createId = id) {
  const incoming = validateState(backup);
  if (current.projects.length + incoming.projects.length > 30) throw Error('합친 프로젝트가 30개를 초과합니다. 일부 프로젝트를 먼저 백업·삭제하세요.');
  const projects = incoming.projects.map(p => ({ ...p, id: createId(), entries: p.entries.map(e => ({ ...e, id: createId() })), tasks: p.tasks.map(t => ({ ...t, id: createId() })) }));
  return validateState({ ...current, projects: [...current.projects, ...projects], favorites: [...new Set([...current.favorites, ...incoming.favorites])] });
}
export function addEntry(state, projectId, entry) {
  const next = structuredClone(state), p = next.projects.find(p => p.id === projectId);
  if (!p) throw Error('프로젝트를 먼저 선택하세요.');
  calculate(entry.kind, entry.input);
  const index = p.entries.findIndex(e => e.id === entry.id);
  if (index < 0) { if (p.entries.length >= 30) throw Error('프로젝트당 계산 기록은 최대 30개입니다.'); p.entries.unshift(entry); } else p.entries[index] = entry;
  p.updatedAt = new Date().toISOString();
  next.recent = [entry.kind, ...next.recent.filter(k => k !== entry.kind)].slice(0, 4);
  return validateState(next);
}
export function summary(kind, input) {
  const r = calculate(kind, input), f = n => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  if (kind === 'unit') return `${r.winner === 'tie' ? '단위가격 동일' : r.winner + ' 상품이 ' + f(r.saving) + '% 저렴'} · A ${f(r.rows[0].rate)}원 / B ${f(r.rows[1].rate)}원 (${r.rows[0].per}당)`;
  if (kind === 'discount') return `최종 ${f(r.total)}원 · 상품 할인율 ${f(r.percent)}% · 배송비 ${f(r.shipping)}원`;
  if (kind === 'split') return `${f(r.total)}원 / ${r.people}명 · ${r.extra ? `${r.extra}명 ${f(r.base + 1)}원, ${r.people - r.extra}명 ${f(r.base)}원` : `1인 ${f(r.base)}원`}`;
  if (kind === 'trip') return `총 ${f(r.total)}원 · 연료 ${f(r.fuelCost)}원 · ${r.split.people}명 분담`;
  if (kind === 'compound') return `${r.years}년 후 ${f(r.finalBalance)}원 · 원금 ${f(r.contributed)}원 + 이자 ${f(r.totalInterest)}원 (+${f(r.gainPct)}%)`;
  if (kind === 'salary') return `월 실수령 ${f(r.netMonthly)}원 · 총 공제 ${f(r.totalDeduction)}원 (실효 공제율 ${f(r.effectiveRate)}%)`;
  if (kind === 'loan') return `원리금균등 월 ${f(r.amortized.monthly)}원 · 총이자 ${f(r.amortized.interest)}원 (원금균등 시 ${f(r.savedEqualVsAmort)}원 절감)`;
  if (kind === 'budget') return `필수 ${f(r.needsWon)}원(${r.needs}%) · 여가 ${f(r.wantsWon)}원(${r.wants}%) · 저축 ${f(r.saveWon)}원(${r.save}%)`;
  if (kind === 'date') return `${r.start} ~ ${r.end} · 총 ${f(r.total)}일 (${r.weeks}주 ${r.remDays}일 · 평일 ${f(r.business)}일)`;
  if (kind === 'percent') return r.mode === 'ratio' ? `${f(r.a)}은(는) ${f(r.b)}의 ${f(r.result)}%` : r.mode === 'change' ? `${f(r.a)}에서 ${r.b >= 0 ? '+' : ''}${f(r.b)}% → ${f(r.result)}` : `${f(r.a)} → ${f(r.b)} (${r.result >= 0 ? '+' : ''}${f(r.result)}%)`;
  if (kind === 'convert') return `${f(r.sourceValue)} ${r.sourceUnit} → ${r.items.filter(x => x.code !== r.sourceUnit).slice(0, 2).map(x => `${f(x.value)} ${x.code}`).join(' · ')}`;
  return `BMI ${f(r.bmi)} (${r.band}) · 유지 ${f(r.tdee)}kcal · 기초대사 ${f(r.bmr)}kcal`;
}
export function projectText(p) {
  return [`ToolHub Pocket | ${p.name}`, p.note, ...p.entries.map(e => `${e.title}: ${summary(e.kind, e.input)}`), '체크리스트', ...p.tasks.map(t => `${t.done ? '[완료]' : '[ ]'} ${t.text}`), '기기에 저장한 계산 기록입니다. 실제 결제 조건과 영수증을 확인하세요.'].filter(Boolean).join('\n');
}
