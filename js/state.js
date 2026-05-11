// ══════════════════════════════════════════════════════════
// STATE & UTILS
// ══════════════════════════════════════════════════════════
import { CAT, COMPOUNDS, SC, SP, VSPECS, REDUNDANCY } from './data.js?v=25';

// ── QUARTER STRUCTURE ──
// 12 calendar quarters Q1 2026 sampai Q4 2028. Pakai underscore (Q1_2026)
// supaya konsisten dengan quarter_id di Supabase.
export const QUARTERS = [
  'Q1_2026','Q2_2026','Q3_2026','Q4_2026',
  'Q1_2027','Q2_2027','Q3_2027','Q4_2027',
  'Q1_2028','Q2_2028','Q3_2028','Q4_2028'
];

// Protocol W1 = Senin 6 Juli 2026 = Q3 2026
export const PROTOCOL_START = new Date('2026-07-06T00:00:00');

// Map week number (1-56) → quarter id berdasarkan tanggal kalender
export function quarterFromWeek(w){
  if(w < 1) return null;
  const d = new Date(PROTOCOL_START);
  d.setDate(d.getDate() + (w-1)*7);
  const year = d.getFullYear();
  const q = Math.floor(d.getMonth()/3) + 1; // 1..4
  return `Q${q}_${year}`;
}

// Map quarter id → array week numbers (1-56) yang fall di quarter itu
export function weeksInQuarter(qid){
  const out = [];
  for(let w=1; w<=56; w++){
    if(quarterFromWeek(w) === qid) out.push(w);
  }
  return out;
}

// 'Q3_2026' → 'Q3 2026'
export function quarterLabel(qid){ return qid.replace('_',' '); }

// Date range untuk quarter
export function quarterDateRange(qid){
  const [q, yr] = qid.split('_');
  const year = parseInt(yr);
  const qNum = parseInt(q.replace('Q',''));
  const startMonth = (qNum-1)*3; // 0,3,6,9
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth+3, 0); // last day
  return { start, end };
}

// Quarter saat ini berdasarkan today
export function currentQuarter(){
  const today = new Date();
  const q = Math.floor(today.getMonth()/3) + 1;
  return `Q${q}_${today.getFullYear()}`;
}

// Cost untuk compound di quarter ttt (sum dose dari weeks yg fall di quarter × harga vial)
export function costForQuarter(compoundName, qid){
  const c = COMPOUNDS.find(x => x.name === compoundName);
  if(!c) return { mg:0, vials:0, cost:0 };
  const weeks = weeksInQuarter(qid);
  let totalMg = 0;
  weeks.forEach(w => {
    const dose = c.d?.[w];
    if(dose) totalMg += parseFloat(dose) || 0;
  });
  const vs = VSPECS[compoundName];
  const vSize = vs?.vSize || 10;
  const vPrice = vs?.vPrice || 0;
  const vials = totalMg > 0 ? Math.ceil(totalMg/vSize) : 0;
  return { mg: totalMg, vials, cost: vials * vPrice };
}

// Default quarter: kalau today di antara protocol range → quarter aktif; else Q3_2026
function defaultQuarter(){
  const cur = currentQuarter();
  if(QUARTERS.includes(cur)) return cur;
  return 'Q3_2026'; // anchor: start protocol
}

export let S={
  quarter: defaultQuarter(),   // currently selected quarter (replaces S.ph)
  tab: 0,
  currentWeek: 1,
  budCap: 50000000,
  budQuarter: defaultQuarter(),  // budget tab independent quarter selector
  budSel: new Set(),
  vialPOV: 'all',
  vialSort: 'cost',
  vialTab: 'stok',
  filterCats: new Set(Object.keys(CAT)),
  search: '',
  user: null,
};

// Sumber S.budSel default: semua compound yang punya cost>0 di quarter aktif
export function initBudSel(qid){
  S.budSel = new Set();
  if(!qid) return;
  COMPOUNDS.forEach(c => {
    const cost = costForQuarter(c.name, qid).cost;
    if(cost > 0) S.budSel.add(c.name);
  });
}

// ── UTILS ──
export const rp=n=>'Rp '+Math.round(n).toLocaleString('id-ID');
export const rpM=n=>n>=1e6?'Rp '+(n/1e6).toFixed(n%1e6===0?0:1)+' jt':rp(n);

// quarterCost: total biaya quarter dari SEMUA compounds (legacy pCost equivalent)
export const quarterCost = qid => COMPOUNDS.reduce((a,c) => a + costForQuarter(c.name, qid).cost, 0);

export const totCost=c=>c.c?.tot?.cost||0;
export const totVials=c=>c.c?.tot?.v||0;

export function scCol(s){return s>=60?'#15803D':s>=35?'#92400E':s>=15?'#B91C1C':'var(--t3)'}
export function scSpill(s){return s>=60?'sp-h':s>=35?'sp-m':s>=15?'sp-l':'sp-o'}
export function stLabel(s){
  if(s>=60)return{cls:'st-wajib',l:'WAJIB'};
  if(s>=35)return{cls:'st-opsional',l:'OPSIONAL'};
  if(s>=15)return{cls:'st-rendah',l:'RENDAH'};
  return{cls:'st-off',l:'OFF'};
}

// quarterOfWeek alias (phOfW was: 1/2/3 from week)
export function quarterOfWeek(w){return quarterFromWeek(w);}

// Priority score per compound (legacy `getPrio(name,ph)` returned phase score).
// Sekarang quarter-agnostic — pakai score_avg dari compound row (di-load ke SC).
// Kalau ada SC[name].f1 dst, average them. Else fallback ke 0.
export function getPrio(name, qid){
  const sc = SC[name];
  if(!sc) return 0;
  // Average across 3 fases yang ada di SC schema lama
  const scores = [sc.f1?.p||0, sc.f2?.p||0, sc.f3?.p||0].filter(v=>v>0);
  if(!scores.length) return 0;
  return Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
}

// Efficiency: priority / cost (juta) untuk quarter ttt
export function budEff(name, qid){
  const p = getPrio(name, qid);
  const c = costForQuarter(name, qid).cost;
  return (!c || !p) ? 0 : Math.round(p/(c/1e6));
}
export function sportScore(name){
  const s=SP[name];if(!s)return 0;
  return Math.round((s.z2*.3+s.pw*.2+s.rc*.2+s.hr*.15+s.cn*.15)*20);
}
export function getConflicts(){
  // Pakai DM.selectedByQuarter[S.quarter] sebagai sumber (bukan S.budSel)
  // — BC tab read-only, konflik ngikut keputusan di DM
  const dmSel = DM.selectedByQuarter[S.quarter || QUARTERS[0]] || new Set();
  return REDUNDANCY.map(r=>({
    ...r,
    active: r.cmps.filter(c => dmSel.has(c)),
    triggered: r.cmps.filter(c => dmSel.has(c)).length >= r.thresh
  }));
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
// selectedByQuarter PER-QUARTER: { [quarter_id]: Set<compoundName> }
// Replaces phase-based model.
export const DM = {
  selectedByQuarter: Object.fromEntries(QUARTERS.map(q => [q, new Set()])),
  stages: new Map(),    // backward-compat Map<name, 'deal'> derived dari selectedByQuarter[S.quarter]
  filterLayer: 'all',
  filterStatus: 'all',
  filterSport: 'all',
  filterEff: 'all',
  sortCol: 'prio',
  sortDir: -1,
  seedBanner: Object.fromEntries(QUARTERS.map(q => [q, false])),
  libSearch: ''
};

// Sync DM.stages ke quarter aktif. Panggil setiap kali S.quarter atau selectedByQuarter berubah.
export function syncDMStages(){
  const qid = S.quarter || QUARTERS[0];
  if(!DM.selectedByQuarter[qid]) DM.selectedByQuarter[qid] = new Set();
  DM.stages = new Map([...DM.selectedByQuarter[qid]].map(n => [n, 'deal']));
}

// Default seed: compounds dengan sport score >=60 → selected for quarter.
export function buildDefaultSeed(){
  const seed = [];
  COMPOUNDS.forEach(c => {
    const s = SP[c.name];
    if(!s) return;
    const score = Math.round((s.z2*.3+s.pw*.2+s.rc*.2+s.hr*.15+s.cn*.15)*20);
    if(score >= 60) seed.push({ compound_name: c.name, stage: 'deal' });
  });
  return seed;
}

// helper: semua selected compound di quarter aktif
export function dmDealt(){
  return new Set(DM.selectedByQuarter[S.quarter || QUARTERS[0]] || new Set());
}
// backward compat shim agar pVial() tidak crash sebelum di-update
export const _dmCheckedShim=()=>dmDealt();

export let _dmAllNames=[];

// ══════════════════════════════════════════════════════════
// TIMELINE (Phase A — in-memory only, reset on refresh)
// ══════════════════════════════════════════════════════════

// Parse cycle text dari kolom on_cycle/off_cycle → {type, min, max}
// type ∈ 'weeks' | 'continuous' | 'prn' | 'none' | 'goal' | 'bundle_ref' | 'taper' | 'custom' | 'unknown'
export function parseCycleText(text){
  if(!text) return {type:'unknown'};
  const t = String(text).toLowerCase();
  if(/continuous/.test(t)) return {type:'continuous'};
  if(/^prn$/.test(t.trim())) return {type:'prn'};
  if(/tidak ada off/.test(t)) return {type:'none'};
  if(/sesuai target/.test(t)) return {type:'goal'};
  if(/via .* cycle|ikuti jadwal|lihat masing/.test(t)) return {type:'bundle_ref'};
  if(/taper/.test(t)) return {type:'taper'};
  const m = String(text).match(/(\d+)(?:-(\d+))?\s*(minggu|hari|bulan)/i);
  if(m){
    const lo = parseInt(m[1]);
    const hi = parseInt(m[2]||m[1]);
    const u = m[3].toLowerCase();
    const f = u==='minggu' ? 1 : u==='hari' ? 1/7 : 4.33;
    return {type:'weeks', min:Math.max(1,Math.round(lo*f)), max:Math.max(1,Math.round(hi*f))};
  }
  return {type:'custom', raw:text};
}

// Parse weekly_total → {value, unit} atau {raw} kalau gak match angka
export function parseWeeklyTotal(text){
  if(!text) return null;
  const m = String(text).match(/^([\d.]+)(?:-([\d.]+))?\s*(mg|mcg|IU|tablet)/i);
  if(m) return {value:parseFloat(m[1]), valueMax:parseFloat(m[2]||m[1]), unit:m[3]};
  return {raw:text};
}

// Timeline state — per (quarter, compound) cycle config, in-memory (Phase B persist later)
// Key format: `${qid}|${compoundName}` → { on: int weeks, off: int weeks }
export const TL = {
  cycles: {}
};

export function tlGetCycle(qid, name){
  return TL.cycles[`${qid}|${name}`] || {on: 0, off: 0};
}

export function tlSetCycle(qid, name, field, value){
  const key = `${qid}|${name}`;
  if(!TL.cycles[key]) TL.cycles[key] = {on: 0, off: 0};
  const v = parseInt(value);
  const qWeeks = weeksInQuarter(qid).length || 56;
  TL.cycles[key][field] = isNaN(v) ? 0 : Math.max(0, Math.min(qWeeks, v));
}

// Seed defaults dari master compound (parsed dari on_cycle/off_cycle CSV)
export function tlSeedFromMaster(qid, name){
  const c = COMPOUNDS.find(x => x.name === name);
  if(!c) return;
  const onP = parseCycleText(c.on_cycle);
  const offP = parseCycleText(c.off_cycle);
  const on = onP.type === 'weeks' ? onP.max
           : onP.type === 'continuous' ? 99
           : 0;
  const off = offP.type === 'weeks' ? offP.max
            : offP.type === 'none' ? 0
            : 0;
  TL.cycles[`${qid}|${name}`] = {on, off};
}

// Hitung status sel di Timeline grid — per quarter
// Return: 'on' | 'off' | 'inactive'
export function tlCellStatus(week, compound, qid){
  if(!compound || !qid) return 'inactive';
  const weeksInQ = weeksInQuarter(qid);
  if(!weeksInQ.includes(week)) return 'inactive';
  const cycle = tlGetCycle(qid, compound.name);
  const onLen = cycle.on || 0;
  const offLen = cycle.off || 0;
  if(onLen === 0) return 'inactive';
  if(onLen >= 99) return 'on';  // continuous sentinel
  const qStartW = weeksInQ[0];
  const delta = week - qStartW;
  if(delta < 0) return 'inactive';
  if(offLen === 0){
    // OFF=0 = one-shot: ON untuk `on` minggu pertama, sisanya INACTIVE (gak loop)
    return delta < onLen ? 'on' : 'inactive';
  }
  const cycleLen = onLen + offLen;
  return (delta % cycleLen) < onLen ? 'on' : 'off';
}

// Hitung dose untuk week tertentu: custom > auto (weekly_total kalau ON) > 0
export function tlDoseForWeek(week, compound, qid){
  if(!compound) return 0;
  const custom = customDoses[compound.name]?.[week];
  if(custom !== undefined) return custom;
  const status = tlCellStatus(week, compound, qid);
  if(status !== 'on') return 0;
  const wt = parseWeeklyTotal(compound.weekly_total);
  return wt?.value || 0;
}

// Effective cycle: kalau user belum set via Timeline UI, fallback ke master CSV defaults.
// Dipakai oleh Overview (cost/vial summary) supaya gak nunggu user buka Timeline dulu.
export function tlGetCycleEffective(qid, name){
  const set = TL.cycles[`${qid}|${name}`];
  if(set && (set.on > 0 || set.off > 0)) return set;
  const c = COMPOUNDS.find(x => x.name === name);
  if(!c) return {on:0, off:0};
  const onP = parseCycleText(c.on_cycle);
  const offP = parseCycleText(c.off_cycle);
  const qWeeks = weeksInQuarter(qid).length || 13;
  const on = onP.type === 'weeks' ? Math.min(onP.max, qWeeks)
           : onP.type === 'continuous' ? qWeeks
           : 0;
  const off = offP.type === 'weeks' ? offP.max : 0;
  return {on, off};
}

// Cost untuk compound di quarter — pakai effective cycle + weekly_total + vial_price.
// Replaces buggy costForQuarter() yang ngandelin c.d[w] (dropped).
export function tlCostForQuarter(compound, qid){
  if(!compound || !qid) return {totalDose:0, vials:0, cost:0, unit:'mg'};
  const weeks = weeksInQuarter(qid);
  if(weeks.length === 0) return {totalDose:0, vials:0, cost:0, unit:'mg'};
  const cycle = tlGetCycleEffective(qid, compound.name);
  const wt = parseWeeklyTotal(compound.weekly_total);
  const perWeekDose = wt?.value || 0;
  let totalDose = 0;
  weeks.forEach((w, i) => {
    const custom = customDoses[compound.name]?.[w];
    if(custom !== undefined){ totalDose += custom; return; }
    if(cycle.on === 0) return;
    let isOn = false;
    if(cycle.off === 0) isOn = i < cycle.on;
    else isOn = (i % (cycle.on + cycle.off)) < cycle.on;
    if(isOn) totalDose += perWeekDose;
  });
  const vs = VSPECS[compound.name];
  const vSize = vs?.vSize || 1;
  const unit = vs?.unit || 'mg';
  const vPrice = vs?.vPrice || 0;
  const vials = (totalDose > 0 && vSize > 0) ? Math.ceil(totalDose / vSize) : 0;
  const cost = vials * vPrice;
  return {totalDose, vials, cost, unit};
}

// Vial summary per compound — total dose + vial needs (scoped to quarter weeks)
export function tlVialSummary(compound, weeks, qid){
  if(!compound) return {totalDose:0, vials:0, unit:'mg', dosedWeeks:0};
  let totalDose = 0;
  let dosedWeeks = 0;
  weeks.forEach(w => {
    const d = tlDoseForWeek(w, compound, qid);
    if(d > 0){ totalDose += d; dosedWeeks++; }
  });
  const vs = VSPECS[compound.name];
  const vSize = vs?.vSize || 1;
  const unit = vs?.unit || 'mg';
  const vials = (totalDose > 0 && vSize > 0) ? Math.ceil(totalDose / vSize) : 0;
  return {totalDose, vials, unit, dosedWeeks};
}
