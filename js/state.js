// ══════════════════════════════════════════════════════════
// STATE & UTILS
// ══════════════════════════════════════════════════════════
import { CAT, COMPOUNDS, SC, SP, VSPECS, REDUNDANCY } from './data.js';

export let S={
  ph:1, tab:0,
  currentWeek:1,
  budCap:50000000, budPh:1,
  budSel:new Set(),
  vialPOV:'all',
  vialSort:'cost',
  filterCats:new Set(Object.keys(CAT)),
  search:'',
};

export function initBudSel(ph){
  S.budSel=new Set();
  COMPOUNDS.forEach(c=>{if((c.c[`f${ph}`]?.cost||0)>0)S.budSel.add(c.name);});
}
initBudSel(1);

// ── UTILS ──
export const rp=n=>'Rp '+Math.round(n).toLocaleString('id-ID');
export const rpM=n=>n>=1e6?'Rp '+(n/1e6).toFixed(n%1e6===0?0:1)+' jt':rp(n);
export const pCost=ph=>COMPOUNDS.reduce((a,c)=>a+(c.c[`f${ph}`]?.cost||0),0);
export const totCost=c=>c.c.tot.cost;
export const totVials=c=>c.c.tot.v||0;

export function scCol(s){return s>=60?'#15803D':s>=35?'#92400E':s>=15?'#B91C1C':'var(--t3)'}
export function scSpill(s){return s>=60?'sp-h':s>=35?'sp-m':s>=15?'sp-l':'sp-o'}
export function stLabel(s){
  if(s>=60)return{cls:'st-wajib',l:'WAJIB'};
  if(s>=35)return{cls:'st-opsional',l:'OPSIONAL'};
  if(s>=15)return{cls:'st-rendah',l:'RENDAH'};
  return{cls:'st-off',l:'OFF'};
}
export function phOfW(w){return w<=28?1:w<=44?2:3}
export function getPrio(name,ph){return SC[name]?.[`f${ph}`]?.p||0}
export function budEff(name,ph){
  const p=getPrio(name,ph),c=COMPOUNDS.find(x=>x.name===name)?.c[`f${ph}`]?.cost||0;
  return(!c||!p)?0:Math.round(p/(c/1e6));
}
export function sportScore(name){
  const s=SP[name];if(!s)return 0;
  return Math.round((s.z2*.3+s.pw*.2+s.rc*.2+s.hr*.15+s.cn*.15)*20);
}
export function getConflicts(){
  return REDUNDANCY.map(r=>({...r,active:r.cmps.filter(c=>S.budSel.has(c)),triggered:r.cmps.filter(c=>S.budSel.has(c)).length>=r.thresh}));
}

// ── CUSTOM DOSES ──
export let customDoses={};

export function getDose(compoundName,week){
  return customDoses[compoundName]?.[week]??COMPOUNDS.find(c=>c.name===compoundName)?.d[week]??null;
}

export function isCustomDose(compoundName,week){
  return customDoses[compoundName]?.[week]!==undefined;
}

// ── INVENTORY ──
export let inventoryCache={};

// reconCache[compoundName] = [{id, qty_vials, reconstituted_at (Date), expired_at (Date)}]
export let reconCache={};

export function vialsConsumedRange(c,fromWeek,toWeek){
  let totalMg=0;
  for(let w=fromWeek;w<=toWeek;w++){const d=getDose(c.name,w);if(d)totalMg+=d;}
  const vs=VSPECS[c.name];
  if(!vs||!vs.vSize||totalMg===0)return 0;
  return Math.ceil(totalMg/vs.vSize);
}

export function weeksUntilEmpty(c,curWeek){
  const inv=inventoryCache[c.name]||{qty:0};
  let remaining=inv.qty;
  if(remaining<=0)return 0;
  const vs=VSPECS[c.name];
  const mgPerVial=vs?.vSize||1;
  for(let w=curWeek;w<=56;w++){
    const d=getDose(c.name,w);
    if(d){remaining-=d/mgPerVial;if(remaining<0)return w-curWeek;}
  }
  return 56-curWeek+1;
}

export function invStatus(name){
  const inv=inventoryCache[name]||{qty:0,safetyStock:5};
  const{qty,safetyStock}=inv;
  if(qty===0)return{label:'KOSONG',col:'var(--warn)'};
  if(qty<=safetyStock)return{label:'ORDER',col:'var(--f2)'};
  return{label:'AMAN',col:'var(--f3)'};
}

// ── BUDGET AUTO PICK ──
export let _lastSuggested=[];

export function autoPickBudget(){
  S.budSel=new Set(_lastSuggested);
  // saveBudgetToDB is called from supabase.js — expose via window
  window.saveBudgetToDB();
  window.renderPanels();
}

// ── DM STATE ──
export const DM={
  checked:new Set(),
  filterLayer:'all',
  filterStatus:'all',
  filterSport:'all',
  filterEff:'all',
  sortCol:'prio',
  sortDir:-1
};

export let _dmAllNames=[];
