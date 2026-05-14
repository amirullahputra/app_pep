// ══════════════════════════════════════════════════════════
// STATE & UTILS
// ══════════════════════════════════════════════════════════
import { CAT, COMPOUNDS, SC, SP, VSPECS, REDUNDANCY } from './data.js?v=73';

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
  budSelByQuarter: {},  // {qid: Set<compoundName>} — semua quarter dari DB (final deal)
  vialPOV: 'all',
  vialSort: 'cost',
  vialTab: 'stok',
  filterCats: new Set(Object.keys(CAT)),
  search: '',
  user: null,
  qPage: 0,       // Quarter row pagination start index (0-based) — deprecated
  viewAll: false, // true = aggregate semua quarter (Grand Total active)
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
  // Pakai S.budSel (checkbox Budget tab) sebagai sumber active plan.
  // Logic: kalau user uncheck compound di Budget tab, dia exclude dari plan
  // aktif quarter ini → no conflict. Compound tetep di DM (watchlist/tentatif/
  // deal) untuk reference, tapi conflict alert ngikut checkbox.
  // Drop dari DM otomatis remove dari S.budSel via auto-prune di pBudget().
  const active = S.budSel || new Set();
  return REDUNDANCY.map(r=>({
    ...r,
    active: r.cmps.filter(c => active.has(c)),
    triggered: r.cmps.filter(c => active.has(c)).length >= r.thresh
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
  // Loop through future weeks, pakai tlDoseForWeek (handle cycle + custom doses)
  for(let w=curWeek;w<=56;w++){
    // Custom dose check first
    const custom = customDoses[c.name]?.[w];
    let d = 0;
    if(custom !== undefined){
      d = custom;
    } else {
      // Auto dose dari cycle effective
      const qid = quarterFromWeek(w);
      if(qid){
        d = tlDoseForWeek(w, c, qid);
      }
    }
    if(d > 0){
      remaining -= d/mgPerVial;
      if(remaining < 0) return w - curWeek;
    }
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

// Parser regex (parseCycleText, parseWeeklyTotal, doseInVialUnit) DIHAPUS di
// schema v2 refactor. DB sekarang punya structured cols:
//   compound.cycleOnWeeks / cycleOffWeeks (INTEGER)
//   compound.cycleType    (TEXT enum 'weeks'|'continuous'|'prn'|'none'|'goal'|'bundle_ref'|'taper')
//   compound.weeklyDoseMg / perInjectMg (NUMERIC, mg-normalized)
//   compound.freqPerWeek  (INTEGER)
// Unit conversion utility ada di models.js convertDose().

// Timeline state — per (quarter, compound) cycle config, in-memory (Phase B persist later)
// Key format: `${qid}|${compoundName}` → { on, off, start } (semua dalam weeks)
// start = 1-based week offset di dalam quarter (default 1 = mulai dari week pertama quarter)
export const TL = {
  cycles: {}
};

export function tlGetCycle(qid, name){
  return TL.cycles[`${qid}|${name}`] || {on: 0, off: 0, start: 1};
}

export function tlSetCycle(qid, name, field, value){
  const key = `${qid}|${name}`;
  if(!TL.cycles[key]) TL.cycles[key] = {on: 0, off: 0, start: 1};
  if(field === 'dose'){
    // DOSE override per quarter (in vial_unit). Empty/0 = fallback ke master weekly_total.
    const v = parseFloat(value);
    if(isNaN(v) || v <= 0){
      delete TL.cycles[key].dose;
    } else {
      TL.cycles[key].dose = v;
    }
    return;
  }
  const v = parseInt(value);
  const qWeeks = weeksInQuarter(qid).length || 56;
  if(field === 'start'){
    // start is 1-based, max = qWeeks (can't start past last week)
    TL.cycles[key].start = isNaN(v) ? 1 : Math.max(1, Math.min(qWeeks, v));
  } else {
    TL.cycles[key][field] = isNaN(v) ? 0 : Math.max(0, Math.min(qWeeks, v));
  }
}

// Seed defaults dari master compound (canonical structured fields)
export function tlSeedFromMaster(qid, name){
  const c = COMPOUNDS.find(x => x.name === name);
  if(!c) return;
  // Continuous compound → on=99 sentinel biar tlCellStatus return 'on' selalu
  const on  = c.cycleType === 'continuous' ? 99 : (c.cycleOnWeeks || 0);
  const off = c.cycleOffWeeks || 0;
  TL.cycles[`${qid}|${name}`] = {on, off, start: 1};
}

// Hitung status sel di Timeline grid — per quarter (dengan START offset)
// Return: 'on' | 'off' | 'inactive'
export function tlCellStatus(week, compound, qid){
  if(!compound || !qid) return 'inactive';
  const weeksInQ = weeksInQuarter(qid);
  if(!weeksInQ.includes(week)) return 'inactive';
  const cycle = tlGetCycle(qid, compound.name);
  const onLen = cycle.on || 0;
  const offLen = cycle.off || 0;
  const startW = cycle.start || 1;  // 1-based offset di dalam quarter
  if(onLen === 0) return 'inactive';
  if(onLen >= 99) return 'on';  // continuous sentinel
  const qStartW = weeksInQ[0];
  // delta dari start offset (week ke-N di quarter, dimulai dari startW)
  const delta = week - qStartW - (startW - 1);
  if(delta < 0) return 'inactive';  // sebelum start
  if(offLen === 0){
    // OFF=0 = one-shot: ON untuk `on` minggu pertama, sisanya INACTIVE (gak loop)
    return delta < onLen ? 'on' : 'inactive';
  }
  const cycleLen = onLen + offLen;
  return (delta % cycleLen) < onLen ? 'on' : 'off';
}

// Hitung dose untuk week tertentu: custom > override per quarter > canonical weekly dose > 0
// Output dalam vial_unit (mg/mcg/IU/tablet). Pakai weeklyDoseValue (raw, sama unit dengan vial).
export function tlDoseForWeek(week, compound, qid){
  if(!compound) return 0;
  const custom = customDoses[compound.name]?.[week];
  if(custom !== undefined) return custom;  // custom_doses disimpan dalam vial_unit
  const status = tlCellStatus(week, compound, qid);
  if(status !== 'on') return 0;
  const cycle = tlGetCycle(qid, compound.name);
  // Per-quarter override (dalam vial_unit)
  if(cycle.dose !== undefined && cycle.dose > 0) return cycle.dose;
  // Fallback: canonical weekly dose. weeklyDoseUnit udah match vial_unit di seed kebanyakan,
  // tapi convert kalau beda (mis. compound vial_unit=mg, weekly stored in mcg → convert ke mg).
  if(!compound.weeklyDoseValue) return 0;
  const vialUnit = compound.vialUnit || 'mg';
  if(compound.weeklyDoseUnit === vialUnit) return compound.weeklyDoseValue;
  // Cross-unit (mcg↔mg) via mg-normalized field
  if(vialUnit === 'mg' && compound.weeklyDoseMg) return compound.weeklyDoseMg;
  if(vialUnit === 'mcg' && compound.weeklyDoseMg) return compound.weeklyDoseMg * 1000;
  return compound.weeklyDoseValue;  // IU/tablet — no conversion
}

// Effective cycle: kalau user belum set via Timeline UI, fallback ke canonical defaults.
// Dipakai oleh Overview (cost/vial summary) supaya gak nunggu user buka Timeline dulu.
export function tlGetCycleEffective(qid, name){
  const set = TL.cycles[`${qid}|${name}`];
  if(set && (set.on > 0 || set.off > 0)) return {on:set.on, off:set.off, start:set.start||1};
  const c = COMPOUNDS.find(x => x.name === name);
  if(!c) return {on:0, off:0, start:1};
  const qWeeks = weeksInQuarter(qid).length || 13;
  const on  = c.cycleType === 'continuous' ? qWeeks : Math.min(c.cycleOnWeeks || 0, qWeeks);
  const off = c.cycleOffWeeks || 0;
  return {on, off, start: 1};
}

// Cost untuk compound di quarter — pakai effective cycle + weekly_total + vial_price.
// All doses normalized ke vial_unit untuk math correctness.
// Replaces buggy costForQuarter() yang ngandelin c.d[w] (dropped).
export function tlCostForQuarter(compound, qid){
  if(!compound || !qid) return {totalDose:0, vials:0, cost:0, unit:'mg'};
  const weeks = weeksInQuarter(qid);
  if(weeks.length === 0) return {totalDose:0, vials:0, cost:0, unit:'mg'};
  const cycle = tlGetCycleEffective(qid, compound.name);
  const vs = VSPECS[compound.name];
  const vSize = vs?.vSize || 1;
  const unit = vs?.unit || 'mg';
  const vPrice = vs?.vPrice || 0;
  // Override per quarter atau fallback ke canonical weekly dose (convert ke vial_unit)
  const userOverride = TL.cycles[`${qid}|${compound.name}`]?.dose;
  let perWeekDose;
  if(userOverride !== undefined && userOverride > 0){
    perWeekDose = userOverride;
  } else if(compound.weeklyDoseValue){
    if(compound.weeklyDoseUnit === unit) perWeekDose = compound.weeklyDoseValue;
    else if(unit === 'mg'  && compound.weeklyDoseMg) perWeekDose = compound.weeklyDoseMg;
    else if(unit === 'mcg' && compound.weeklyDoseMg) perWeekDose = compound.weeklyDoseMg * 1000;
    else perWeekDose = compound.weeklyDoseValue;  // IU/tablet no convert
  } else {
    perWeekDose = 0;
  }
  const startOffset = (cycle.start || 1) - 1;  // 0-based offset
  let totalDose = 0;
  weeks.forEach((w, i) => {
    const custom = customDoses[compound.name]?.[w];
    if(custom !== undefined){ totalDose += custom; return; }
    if(cycle.on === 0) return;
    const idx = i - startOffset;
    if(idx < 0) return;  // sebelum start week
    let isOn = false;
    if(cycle.off === 0) isOn = idx < cycle.on;
    else isOn = (idx % (cycle.on + cycle.off)) < cycle.on;
    if(isOn) totalDose += perWeekDose;
  });
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
