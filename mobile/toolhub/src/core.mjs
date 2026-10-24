export const KINDS = ['unit', 'discount', 'split', 'trip'];
export const LIMITS = { projects: 30, entries: 30, tasks: 30, backup: 1500000 };
export const LABELS = { unit: '장보기 비교', discount: '할인 계산', split: '모임 정산', trip: '여행 예산' };
export const defaults = {
 unit: { aPrice:12000,aShip:0,aCoupon:0,aSize:500,aCount:2,aUnit:'g', bPrice:10900,bShip:2500,bCoupon:1000,bSize:1,bCount:1,bUnit:'kg' },
 discount: { price:100000,first:20,second:10,coupon:0,shipping:0 },
 split: { total:50000,people:3 },
 trip: { distance:320,efficiency:12,fuel:1700,toll:15000,parking:10000,people:4 }
};
const units = { g:['weight',1,'100g',100],kg:['weight',1000,'100g',100],ml:['volume',1,'100mL',100],L:['volume',1000,'100mL',100],ea:['count',1,'1개',1] };
export function number(value,name,min=0,max=1e9,integer=false) {
 if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim()==='' || !/^\d+(\.\d+)?$/.test(String(value))) throw Error(`${name}: 올바른 숫자를 입력하세요.`);
 const n=Number(value); if (!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n))) throw Error(`${name}: ${min}~${max}${integer?' 범위의 정수':' 범위'}를 입력하세요.`); return n;
}
function won(v,n) { return number(v,n,0,1e9,true); }
export function splitWon(total,people) {
 total=number(total,'총액',0,1e12,true);people=number(people,'인원',1,100,true);
 const base=Math.floor(total/people),extra=total%people;
 return { total,people,base,extra,shares:Array.from({length:people},(_,i)=>base+(i<extra?1:0)) };
}
export function calculate(kind,input) {
 if (!KINDS.includes(kind)||!input||typeof input!=='object') throw Error('지원하지 않는 계산입니다.');
 if (kind==='unit') {
  const rows=['a','b'].map((p,i)=>{
   const price=won(input[p+'Price'],'상품 가격'),shipping=won(input[p+'Ship'],'배송비'),coupon=won(input[p+'Coupon'],'쿠폰');
   const capacity=number(input[p+'Size'],'용량',0.001,1e6),count=number(input[p+'Count'],'묶음 수',1,10000,true),unit=units[input[p+'Unit']];
   if (!unit) throw Error('단위를 선택하세요.');
   const cost=price+shipping-coupon;if(cost<0)throw Error('쿠폰이 상품 가격과 배송비 합계를 넘습니다.');
   return { name:i?'B 상품':'A 상품',cost,category:unit[0],per:unit[2],rate:cost/(capacity*count*unit[1])*unit[3] };
  });
  if(rows[0].category!==rows[1].category)throw Error('같은 종류의 단위를 비교하세요. 무게·부피·개수는 서로 바꿀 수 없습니다.');
  const high=Math.max(...rows.map(r=>r.rate)),low=Math.min(...rows.map(r=>r.rate));
  return {rows,winner:Math.abs(rows[0].rate-rows[1].rate)<1e-9?'tie':rows[0].rate<rows[1].rate?'A':'B',saving:high===0?0:(high-low)/high*100};
 }
 if(kind==='discount'){
  const price=won(input.price,'정가'),first=number(input.first,'첫 할인',0,100),second=number(input.second,'추가 할인',0,100),coupon=won(input.coupon,'쿠폰'),shipping=won(input.shipping,'배송비');
  const discounted=price*(1-first/100)*(1-second/100),epsilon=Math.max(1,price)*Number.EPSILON*4;
  if(coupon-discounted>epsilon)throw Error('쿠폰은 할인 적용 후 상품 금액 이하여야 합니다.');
  const goods=Math.round(Math.max(0,discounted-coupon)+epsilon),total=goods+shipping;
  return {price,goods,total,shipping,saved:price-goods,percent:price===0?0:(price-goods)/price*100};
 }
 if(kind==='split')return splitWon(won(input.total,'총액'),number(input.people,'인원',1,100,true));
 const distance=number(input.distance,'총 주행거리',0,100000),efficiency=number(input.efficiency,'연비',0.1,1000),fuel=won(input.fuel,'리터당 가격'),toll=won(input.toll,'통행료'),parking=won(input.parking,'주차비'),people=number(input.people,'인원',1,100,true);
 const liters=distance/efficiency,fuelCost=Math.round(liters*fuel),total=fuelCost+toll+parking;
 return {liters,fuelCost,toll,parking,total,split:splitWon(total,people)};
}
export function emptyState(){return {version:1,projects:[],favorites:['unit'],recent:[]};}
export function id(){return globalThis.crypto.randomUUID();}
function str(v,max,name){if(typeof v!=='string'||v.length>max||!v.trim())throw Error(`${name} 형식이 잘못되었습니다.`);return v;}
function date(v){str(v,40,'날짜');if(!Number.isFinite(Date.parse(v)))throw Error('날짜 형식이 잘못되었습니다.');return v;}
export function validateState(raw){
 if(!raw||raw.version!==1||!Array.isArray(raw.projects)||raw.projects.length>LIMITS.projects||!Array.isArray(raw.favorites)||!Array.isArray(raw.recent))throw Error('ToolHub Pocket v1 백업 파일이 아니거나 최대 30개 프로젝트를 초과했습니다.');
 const ids=new Set();const unique=(v)=>{str(v,100,'ID');if(ids.has(v))throw Error('중복 ID가 있습니다.');ids.add(v);return v;};
 const projects=raw.projects.map(p=>{
  if(!Array.isArray(p.entries)||p.entries.length>30||!Array.isArray(p.tasks)||p.tasks.length>30)throw Error('프로젝트의 기록/체크리스트는 각각 최대 30개입니다.');
  return {id:unique(p.id),name:str(p.name,60,'프로젝트 이름'),note:typeof p.note==='string'&&p.note.length<=1000?p.note:'',createdAt:date(p.createdAt),updatedAt:date(p.updatedAt),
   entries:p.entries.map(e=>{calculate(e.kind,e.input);const input={};for(const key of Object.keys(defaults[e.kind]))input[key]=e.input[key];return {id:unique(e.id),kind:e.kind,input,createdAt:date(e.createdAt),title:str(e.title,60,'계산 이름')};}),
   tasks:p.tasks.map(t=>({id:unique(t.id),text:str(t.text,120,'체크리스트'),done:t.done===true}))};
 });
 if(raw.favorites.length>4||raw.recent.length>4||[...raw.favorites,...raw.recent].some(x=>!KINDS.includes(x)))throw Error('도구 목록 형식이 잘못되었습니다.');
 return {version:1,projects,favorites:[...new Set(raw.favorites)],recent:[...new Set(raw.recent)]};
}
export function parseBackup(text){if(typeof text!=='string'||text.length>LIMITS.backup)throw Error('백업 파일은 1.5MB 이하여야 합니다.');return validateState(JSON.parse(text));}
export function mergeBackup(current,backup,createId=id){
 const incoming=validateState(backup);if(current.projects.length+incoming.projects.length>30)throw Error('합친 프로젝트가 30개를 초과합니다. 일부 프로젝트를 먼저 백업·삭제하세요.');
 const projects=incoming.projects.map(p=>({...p,id:createId(),entries:p.entries.map(e=>({...e,id:createId()})),tasks:p.tasks.map(t=>({...t,id:createId()}))}));
 return validateState({...current,projects:[...current.projects,...projects],favorites:[...new Set([...current.favorites,...incoming.favorites])]});
}
export function addEntry(state,projectId,entry){
 const next=structuredClone(state),p=next.projects.find(p=>p.id===projectId);if(!p)throw Error('프로젝트를 먼저 선택하세요.');
 calculate(entry.kind,entry.input);const index=p.entries.findIndex(e=>e.id===entry.id);
 if(index<0){if(p.entries.length>=30)throw Error('프로젝트당 계산 기록은 최대 30개입니다.');p.entries.unshift(entry);}else p.entries[index]=entry;
 p.updatedAt=new Date().toISOString();next.recent=[entry.kind,...next.recent.filter(k=>k!==entry.kind)].slice(0,4);return validateState(next);
}
export function summary(kind,input){
 const r=calculate(kind,input),f=n=>n.toLocaleString('ko-KR',{maximumFractionDigits:2});
 if(kind==='unit')return `${r.winner==='tie'?'단위가격 동일':r.winner+' 상품이 '+f(r.saving)+'% 저렴'} · A ${f(r.rows[0].rate)}원 / B ${f(r.rows[1].rate)}원 (${r.rows[0].per}당)`;
 if(kind==='discount')return `최종 ${f(r.total)}원 · 상품 할인율 ${f(r.percent)}% · 배송비 ${f(r.shipping)}원`;
 if(kind==='split')return `${f(r.total)}원 / ${r.people}명 · ${r.extra?`${r.extra}명 ${f(r.base+1)}원, ${r.people-r.extra}명 ${f(r.base)}원`:`1인 ${f(r.base)}원`}`;
 return `총 ${f(r.total)}원 · 연료 ${f(r.fuelCost)}원 · ${r.split.people}명 분담`;
}
export function projectText(p){return [`ToolHub Pocket | ${p.name}`,p.note,...p.entries.map(e=>`${e.title}: ${summary(e.kind,e.input)}`),'체크리스트',...p.tasks.map(t=>`${t.done?'[완료]':'[ ]'} ${t.text}`),'기기에 저장한 계산 기록입니다. 실제 결제 조건과 영수증을 확인하세요.'].filter(Boolean).join('\n');}
