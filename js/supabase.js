// ══════════════════════════════════════════════════════════
// SUPABASE CONFIG + AUTH + DB FUNCTIONS
// ══════════════════════════════════════════════════════════
import { _setPepData, COMPOUNDS, VSPECS, SHELF_LIFE } from './data.js?v=80';
import { S, initBudSel, customDoses, inventoryCache, reconCache, getDose, QUARTERS, tlCellStatus, tlDoseForWeek, TL } from './state.js?v=80';
import { compoundFromDB } from './models.js?v=80';

const SUPA_URL='https://guhhoqpvwzzrlwgfugsb.supabase.co';
const SUPA_KEY='sb_publishable_yu8KTS5mId2hV7kVjScvZA_-geYqKHv';
export const supa=window.supabase.createClient(SUPA_URL,SUPA_KEY);

// ── REST helper (bypass supa client untuk public reads) ──
// Reason: supa client init bisa hang di Chrome incognito karena GoTrueClient
// navigator.locks/storage init. Plain fetch identik dengan curl yang work.
async function restFetch(table, query=''){
  const url = `${SUPA_URL}/rest/v1/${table}${query?'?'+query:''}`;
  const res = await fetch(url, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
  });
  if(!res.ok){
    const body = await res.text().catch(()=>'');
    throw new Error(`${table}: HTTP ${res.status} ${body.slice(0,200)}`);
  }
  return res.json();
}

// ── JWT cache (avoid supa.auth.getSession() yang juga hang) ──
// Token di-set saat onAuthStateChange fire (session ada di callback args).
// Fallback: ambil dari localStorage langsung (Supabase store di sb-*-auth-token).
let _jwt = null;

function readJwtFromStorage(){
  try {
    // Supabase stores session as: sb-<project-ref>-auth-token
    const projectRef = SUPA_URL.match(/https:\/\/([^.]+)/)?.[1];
    if(!projectRef) return null;
    const raw = localStorage.getItem(`sb-${projectRef}-auth-token`);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.access_token || parsed?.[0] || null;
  } catch(_){ return null; }
}

// ── Authenticated REST (untuk RLS-protected user tables) ──
// Pakai _jwt cache (set via onAuthStateChange) atau fallback ke localStorage.
// Sengaja avoid `await supa.auth.getSession()` karena GoTrueClient juga hang.
async function authFetch(table, query='', opts={}){
  const jwt = _jwt || readJwtFromStorage();
  if(!jwt) throw new Error(`${table}: no auth session`);
  const url = `${SUPA_URL}/rest/v1/${table}${query?'?'+query:''}`;
  const headers = {
    apikey: SUPA_KEY,
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
    ...(opts.headers || {})
  };
  const res = await fetch(url, { method: opts.method || 'GET', headers, body: opts.body });
  if(!res.ok){
    const body = await res.text().catch(()=>'');
    throw new Error(`${table}: HTTP ${res.status} ${body.slice(0,200)}`);
  }
  if(res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── DYNAMIC PEP DATA LOAD (compounds + redundancy_rules) ──
// Schema slimdown v=18: compounds table sekarang 14 kolom (lihat
// supabase_setup/16_schema_slimdown_v2.sql). doses_jsonb, sport_*, score_*,
// sort_order semua di-DROP. Dose schedule akan input manual via Timeline tab
// (separate future session). Budget/Vial otomatis kosong sampai dose di-input.
let _pepLoaded = false;

// Explicit columns matching schema v2 structured (no text parsing di frontend).
// Adapter compoundFromDB() map ke canonical camelCase shape.
const COMPOUND_COLS = [
  'id','name','category',
  'mechanism','risk_text','hiv_notes','notes','timing_note',
  'vial_unit','vial_size','vial_price_idr','vial_label','shelf_life_days',
  'cycle_on_weeks','cycle_off_weeks','cycle_type',
  'weekly_dose_value','weekly_dose_unit','weekly_dose_mg',
  'per_inject_value','per_inject_mg','freq_per_week',
  'efficiency_score','created_at'
].join(',');

const EMPTY_COST = { f1:{mg:0,v:0,cost:0}, f2:{mg:0,v:0,cost:0}, f3:{mg:0,v:0,cost:0}, tot:{mg:0,v:0,cost:0} };

export async function loadAllPepData(){
  if(_pepLoaded) return;

  const dbg = (m) => { try { window.updateDebugOverlay && window.updateDebugOverlay(m); } catch(_){} };

  // Plain fetch() bypass supa client — work in Chrome incognito where
  // GoTrueClient init can hang on navigator.locks/storage.
  let compoundRows, ruleRows;
  try {
    dbg('fetch compounds...');
    compoundRows = await restFetch('compounds', `select=${COMPOUND_COLS}&order=efficiency_score.desc.nullslast,name.asc`);
    dbg(`compounds:${compoundRows.length} · fetch rules...`);
    ruleRows = await restFetch('redundancy_rules', 'select=*&order=sort_order.asc');
    dbg(`rules:${ruleRows.length} · transforming...`);
  } catch(e){
    dbg('FETCH FAIL: '+(e.message||e));
    throw e;
  }

  // Build derived structures via canonical Compound adapter.
  // SC/SP stub zeros (sport_profiles + phase_costs tables di-drop, scoring
  // dipindah ke compounds.efficiency_score sebagai single signal).
  const SC={}, SP={}, MECHS={}, VSPECS={}, SHELF_LIFE={};
  const COMPOUNDS = compoundRows.map(r => {
    const c = compoundFromDB(r);
    // Side-objects untuk legacy code path (akan di-collapse ke canonical later)
    SC[c.name] = { f1:{r:0,p:0}, f2:{r:0,p:0}, f3:{r:0,p:0} };
    SP[c.name] = { z2:0, pw:0, rc:0, hr:0, cn:0, risk: c.riskText };
    MECHS[c.name] = c.mechanism;
    VSPECS[c.name] = {
      unit: c.vialUnit, vSize: c.vialSize,
      vPrice: c.vialPriceIdr, label: c.vialLabel
    };
    SHELF_LIFE[c.name] = { shelf: c.shelfLifeDays, timing: c.timingNote };
    // Compound itself: canonical shape + legacy aliases (cat for data.js compat, d/c stubs)
    return {
      ...c,
      cat: c.category,        // legacy alias dipakai di panels.js filter
      d: {},                  // doses_jsonb dropped — Timeline tab input manual
      c: EMPTY_COST           // cost stub
    };
  });

  const REDUNDANCY = ruleRows.map(r => ({
    id:r.id, lvl:r.level, title:r.title, body:r.body,
    rec:r.recommendation, cmps:r.compound_names||[], thresh:r.threshold||2
  }));

  _setPepData({ phases:[], compounds:COMPOUNDS, redundancy:REDUNDANCY, sc:SC, sp:SP, mechs:MECHS, vspecs:VSPECS, shelf:SHELF_LIFE });
  _pepLoaded = true;
  console.info(`[db] Loaded ${COMPOUNDS.length} compounds, ${REDUNDANCY.length} rules (schema v2 — dose schedule disabled)`);
}

export async function saveCompoundEdit(name, updates){
  // updates: object with any fields to update on compounds row.
  // Pakai return=representation untuk verify update kena RLS — kalau policy reject,
  // response = [] (empty array) tanpa error. Throw biar UI bisa kasih tau user.
  const data = await authFetch('compounds', `name=eq.${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(updates)
  });
  if(!Array.isArray(data) || data.length === 0){
    throw new Error('RLS policy reject — run migrate_compounds_update_policy.sql');
  }
  _pepLoaded = false;
}

// loadQuartersFromDB removed: 'quarters' table dropped pasca DB consolidation.
// Quarter list dipakai via static QUARTERS array di state.js (12 quarter Q1_2026..Q4_2028).
// Kalau butuh metadata quarter (bb/bf targets, dates), fetch dari master_timeline.

//── DECISION MATRIX STAGES (per-quarter, per-user) ──
// Table: decision_matrix_stages(id, user_id, quarter_id, compound_name, stage, sort_order, ...)
// RLS: auth.uid() = user_id (FOR ALL TO authenticated)

// Load semua selection user, group by quarter_id → { 'Q3_2026': Map<name, stage>, ... }
// Pakai authFetch (plain fetch + JWT) untuk bypass supa client hang.
export async function loadDMStages(userId){
  const empty = Object.fromEntries(QUARTERS.map(q => [q, new Map()]));
  if(!userId) return empty;
  const data = await authFetch('decision_matrix_stages',
    `select=quarter_id,compound_name,stage,sort_order&user_id=eq.${userId}`);
  const out = { ...empty };
  (data||[]).forEach(r => {
    if(!out[r.quarter_id]) out[r.quarter_id] = new Map();
    out[r.quarter_id].set(r.compound_name, r.stage);
  });
  return out;
}

// Set stage. UPSERT pada (user_id, quarter_id, compound_name).
export async function setDMStage(userId, quarterId, compoundName, stage){
  if(!userId) throw new Error('Login dulu');
  const row = {
    user_id: userId, quarter_id: quarterId, compound_name: compoundName, stage,
    updated_at: new Date().toISOString()
  };
  await authFetch('decision_matrix_stages', 'on_conflict=user_id,quarter_id,compound_name', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row)
  });
}

// Remove
export async function removeDMStage(userId, quarterId, compoundName){
  if(!userId) throw new Error('Login dulu');
  await authFetch('decision_matrix_stages',
    `user_id=eq.${userId}&quarter_id=eq.${quarterId}&compound_name=eq.${encodeURIComponent(compoundName)}`,
    { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

// Bulk seed (sport >=60 → 'deal')
export async function seedDMStages(userId, quarterId, rows){
  if(!userId || !rows?.length) return { inserted: [] };
  const payload = rows.map((r,i) => ({
    user_id: userId, quarter_id: quarterId,
    compound_name: r.compound_name, stage: r.stage,
    sort_order: r.sort_order ?? (100+i)
  }));
  try {
    const data = await authFetch('decision_matrix_stages', '', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(payload)
    });
    return { inserted: data || [] };
  } catch(e){
    if(String(e.message).includes('23505')) return { inserted: [] };
    console.error('seedDMStages:', e); throw e;
  }
}

// ── SAVE INDICATOR ──
export function showSaveInd(){
  const el=document.getElementById('save-ind');
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),2000);
}

// ── BUDGET DB (per-quarter) ──
export async function loadBudgetFromDB(qid){
  if(!S.user){initBudSel(qid);return;}
  const data = await authFetch('budget_selections',
    `select=selected_compounds,budget_cap&user_id=eq.${S.user.id}&quarter_id=eq.${qid}`);
  const row = data?.[0];
  if(row){
    S.budSel=new Set(row.selected_compounds||[]);
    if(row.budget_cap)S.budCap=row.budget_cap;
  }else{
    initBudSel(qid);
  }
  S.budSelByQuarter[qid] = new Set(S.budSel);
}

// Load semua budget selection user across all quarters → S.budSelByQuarter
// Source of truth untuk Overview "final deal" (vs DM = hope).
export async function loadAllBudgetSelections(){
  S.budSelByQuarter = {};
  if(!S.user) return;
  const data = await authFetch('budget_selections',
    `select=quarter_id,selected_compounds&user_id=eq.${S.user.id}`);
  (data||[]).forEach(r => {
    S.budSelByQuarter[r.quarter_id] = new Set(r.selected_compounds||[]);
  });
}

export async function saveBudgetToDB(){
  if(!S.user)return;
  await authFetch('budget_selections', 'on_conflict=user_id,quarter_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: S.user.id, quarter_id: S.budQuarter,
      selected_compounds: [...S.budSel], budget_cap: S.budCap,
      updated_at: new Date().toISOString()
    })
  });
  S.budSelByQuarter[S.budQuarter] = new Set(S.budSel);
  showSaveInd();
}

// ── TIMELINE CYCLES (per quarter per compound) ──
// Key di TL.cycles: `${qid}|${name}` → { on, off, start, dose? }
export async function loadAllTLCycles(){
  Object.keys(TL.cycles).forEach(k => delete TL.cycles[k]);
  if(!S.user) return;
  const data = await authFetch('timeline_cycles',
    `select=quarter_id,compound_name,on_weeks,off_weeks,start_week,dose_override&user_id=eq.${S.user.id}`);
  (data||[]).forEach(r => {
    const key = `${r.quarter_id}|${r.compound_name}`;
    const cycle = { on: r.on_weeks||0, off: r.off_weeks||0, start: r.start_week||1 };
    if(r.dose_override !== null && r.dose_override !== undefined) cycle.dose = r.dose_override;
    TL.cycles[key] = cycle;
  });
}

export async function saveTLCycles(){
  if(!S.user){ alert('Login dulu untuk simpan timeline.'); return; }
  const rows = Object.entries(TL.cycles).map(([key, cyc]) => {
    const [quarter_id, compound_name] = key.split('|');
    return {
      user_id: S.user.id,
      quarter_id,
      compound_name,
      on_weeks: cyc.on||0,
      off_weeks: cyc.off||0,
      start_week: cyc.start||1,
      dose_override: (cyc.dose !== undefined && cyc.dose > 0) ? cyc.dose : null,
      updated_at: new Date().toISOString()
    };
  });
  if(rows.length === 0){ showSaveInd(); return; }
  await authFetch('timeline_cycles', 'on_conflict=user_id,quarter_id,compound_name', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows)
  });
  showSaveInd();
}

// ── CUSTOM DOSES ──
export async function loadCustomDoses(){
  if(!S.user){ Object.keys(customDoses).forEach(k=>delete customDoses[k]); return; }
  const data = await authFetch('custom_doses',
    `select=compound_name,week,dose&user_id=eq.${S.user.id}`);
  Object.keys(customDoses).forEach(k=>delete customDoses[k]);
  (data||[]).forEach(r=>{
    if(!customDoses[r.compound_name])customDoses[r.compound_name]={};
    customDoses[r.compound_name][r.week]=r.dose;
  });
}

export async function saveCustomDose(compoundName,week,dose){
  if(!S.user){alert('Login dulu untuk simpan custom dose!');return;}
  if(dose===null){
    await authFetch('custom_doses',
      `user_id=eq.${S.user.id}&compound_name=eq.${encodeURIComponent(compoundName)}&week=eq.${week}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    if(customDoses[compoundName])delete customDoses[compoundName][week];
  }else{
    await authFetch('custom_doses', 'on_conflict=user_id,compound_name,week', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        user_id:S.user.id, compound_name:compoundName, week, dose,
        updated_at:new Date().toISOString()
      })
    });
    if(!customDoses[compoundName])customDoses[compoundName]={};
    customDoses[compoundName][week]=dose;
  }
  showSaveInd();
  window.renderPanels();
}

// ── DOSE EDIT MODAL ──
let _doseEditTarget={name:'',week:0,defaultDose:0,unit:''};

export function openDoseEdit(compoundName,week){
  const c=COMPOUNDS.find(x=>x.name===compoundName);
  // Auto default: pakai tlDoseForWeek (handles cycle override + weeklyDoseValue + unit conv).
  // Output sudah dalam vial_unit, jadi user edit dalam vial_unit yang konsisten.
  let defaultDose = c?.d?.[week] || 0;
  if(!defaultDose && c){
    defaultDose = tlDoseForWeek(week, c, S.quarter) || 0;
  }
  const currentDose=getDose(compoundName,week)??defaultDose;
  const unit=VSPECS[compoundName]?.unit||'mg';
  _doseEditTarget={name:compoundName,week,defaultDose,unit};

  document.getElementById('de-title').textContent=`${compoundName} — W${week}`;
  document.getElementById('de-default').textContent=`Default: ${defaultDose}${unit}`;
  document.getElementById('de-input').value=currentDose;
  document.getElementById('de-unit').textContent=unit;
  // isCustomDose is accessed via window to avoid circular import issues
  const isCustom=customDoses[compoundName]?.[week]!==undefined;
  document.getElementById('de-custom-badge').style.display=isCustom?'inline':'none';
  document.getElementById('dose-modal').classList.add('open');
  setTimeout(()=>document.getElementById('de-input').focus(),50);
}

export function closeDoseModal(){document.getElementById('dose-modal').classList.remove('open');}

export async function confirmDoseEdit(){
  const val=parseFloat(document.getElementById('de-input').value);
  if(isNaN(val)||val<0){alert('Masukkan angka yang valid!');return;}
  await saveCustomDose(_doseEditTarget.name,_doseEditTarget.week,val);
  closeDoseModal();
}

export async function resetDoseEdit(){
  await saveCustomDose(_doseEditTarget.name,_doseEditTarget.week,null);
  closeDoseModal();
}

// ── INVENTORY ──
export async function loadInventory(){
  if(!S.user){
    Object.keys(inventoryCache).forEach(k=>delete inventoryCache[k]);
    return;
  }
  const [inv, ss] = await Promise.all([
    authFetch('inventory',   `select=compound_name,qty_vials&user_id=eq.${S.user.id}`),
    authFetch('safety_stock', `select=compound_name,min_vials&user_id=eq.${S.user.id}`)
  ]);
  Object.keys(inventoryCache).forEach(k=>delete inventoryCache[k]);
  COMPOUNDS.forEach(c=>{inventoryCache[c.name]={qty:0,safetyStock:5};});
  (inv||[]).forEach(r=>{
    if(!inventoryCache[r.compound_name])inventoryCache[r.compound_name]={qty:0,safetyStock:5};
    inventoryCache[r.compound_name].qty=r.qty_vials;
  });
  (ss||[]).forEach(r=>{
    if(!inventoryCache[r.compound_name])inventoryCache[r.compound_name]={qty:0,safetyStock:5};
    inventoryCache[r.compound_name].safetyStock=r.min_vials;
  });
}

export function openInvEdit(name){
  const cur=inventoryCache[name]||{qty:0,safetyStock:5};
  document.getElementById('inv-modal-title').textContent=name;
  document.getElementById('inv-qty-input').value=cur.qty;
  document.getElementById('inv-ss-input').value=cur.safetyStock;
  document.getElementById('inv-modal-name').value=name;
  document.getElementById('inv-modal').classList.add('open');
}

export function closeInvModal(){document.getElementById('inv-modal').classList.remove('open');}

export async function confirmInvEdit(){
  const name=document.getElementById('inv-modal-name').value;
  const qty=parseInt(document.getElementById('inv-qty-input').value)||0;
  const ss=parseInt(document.getElementById('inv-ss-input').value)||0;
  closeInvModal();
  if(!S.user){alert('Login dulu untuk simpan inventory.');return;}
  if(!inventoryCache[name])inventoryCache[name]={qty:0,safetyStock:5};
  inventoryCache[name].qty=qty;
  inventoryCache[name].safetyStock=ss;
  const upsertOpts = { method:'POST', headers:{Prefer:'resolution=merge-duplicates,return=minimal'} };
  await Promise.all([
    authFetch('inventory', 'on_conflict=user_id,compound_name', { ...upsertOpts, body: JSON.stringify({user_id:S.user.id,compound_name:name,qty_vials:qty,last_updated:new Date().toISOString()}) }),
    authFetch('safety_stock', 'on_conflict=user_id,compound_name', { ...upsertOpts, body: JSON.stringify({user_id:S.user.id,compound_name:name,min_vials:ss}) })
  ]);
  showSaveInd();
  window.renderPanels();
}

// ── RECONSTITUTED VIALS ──
export async function loadReconVials(){
  Object.keys(reconCache).forEach(k=>delete reconCache[k]);
  if(!S.user)return;
  const data = await authFetch('reconstituted_vials',
    `select=id,compound_name,qty_vials,reconstituted_at,notes,diluent_type,volume_ml,syringe_scale_iu,freq_per_week&user_id=eq.${S.user.id}&order=reconstituted_at.desc`);
  (data||[]).forEach(r=>{
    const sl=SHELF_LIFE[r.compound_name];
    const reconDate=new Date(r.reconstituted_at);
    const baseShelf=sl?.shelf||30;
    const dil=r.diluent_type||'BAC';
    const mult=dil==='Lipozide'?2.5:dil==='Saline'?0.7:1.0;
    const shelfDays=Math.round(baseShelf*mult);
    const expiredAt=new Date(reconDate);
    expiredAt.setDate(expiredAt.getDate()+shelfDays);
    if(!reconCache[r.compound_name])reconCache[r.compound_name]=[];
    reconCache[r.compound_name].push({
      id:r.id,
      qty:r.qty_vials,
      reconDate,
      expiredAt,
      notes:r.notes||'',
      diluentType:dil,
      volumeMl:r.volume_ml||null,
      syringeScaleIu:r.syringe_scale_iu||100,
      freqPerWeek:r.freq_per_week||null
    });
  });
}

export async function addReconVial(compoundName, qty, reconDateStr, notes, diluent, volumeMl, syringeIu, freqPerWeek){
  if(!S.user){alert('Login dulu!');return;}
  let data;
  try {
    data = await authFetch('reconstituted_vials', '', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: S.user.id, compound_name: compoundName,
        qty_vials: qty, reconstituted_at: reconDateStr, notes: notes || null,
        diluent_type: diluent || 'BAC',
        volume_ml: volumeMl || null,
        syringe_scale_iu: syringeIu || 100,
        freq_per_week: freqPerWeek || null
      })
    });
  } catch(e){ alert('Gagal simpan: '+(e.message||e)); return; }
  const row = Array.isArray(data) ? data[0] : data;
  const sl=SHELF_LIFE[compoundName];
  const reconDate=new Date(reconDateStr);
  const baseShelf=sl?.shelf||30;
  const dil=diluent||'BAC';
  const mult=dil==='Lipozide'?2.5:dil==='Saline'?0.7:1.0;
  const shelfDays=Math.round(baseShelf*mult);
  const expiredAt=new Date(reconDate);
  expiredAt.setDate(expiredAt.getDate()+shelfDays);
  if(!reconCache[compoundName])reconCache[compoundName]=[];
  reconCache[compoundName].unshift({id:row.id,qty,reconDate,expiredAt,notes:notes||'',diluentType:dil,volumeMl:volumeMl||null,syringeScaleIu:syringeIu||100,freqPerWeek:freqPerWeek||null});
  showSaveInd();
  window.renderPanels();
}

export async function deleteReconVial(id, compoundName){
  if(!S.user)return;
  await authFetch('reconstituted_vials',
    `id=eq.${id}&user_id=eq.${S.user.id}`,
    { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  if(reconCache[compoundName]){
    reconCache[compoundName]=reconCache[compoundName].filter(r=>r.id!==id);
  }
  showSaveInd();
  window.renderPanels();
}

export function openReconModal(name){
  document.getElementById('recon-modal-name').value=name;
  document.getElementById('recon-modal-title').textContent=name;
  document.getElementById('recon-qty-input').value=1;
  document.getElementById('recon-date-input').value=new Date().toISOString().split('T')[0];
  document.getElementById('recon-notes-input').value='';
  document.getElementById('recon-diluent-input').value='BAC';
  document.getElementById('recon-volume-input').value=2;
  document.getElementById('recon-syringe-input').value=100;
  // Pre-fill freq dari compound default (user bisa override)
  const _cDef = COMPOUNDS.find(x=>x.name===name);
  document.getElementById('recon-freq-input').value = _cDef?.freqPerWeek || 7;

  // Render existing recon entries
  const entries=reconCache[name]||[];
  const today=new Date();
  document.getElementById('recon-existing').innerHTML=entries.length===0
    ?'<div style="color:var(--t3);font-size:11px;padding:8px 0">Belum ada vial yang direkonstitusi</div>'
    :entries.map(e=>{
      const daysLeft=Math.ceil((e.expiredAt-today)/(1000*60*60*24));
      const expCol=daysLeft<=3?'var(--warn)':daysLeft<=7?'var(--f2)':'var(--f3)';
      const expFmt=e.expiredAt.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'});
      const reconFmt=e.reconDate.toLocaleDateString('id-ID',{day:'numeric',month:'short'});
      const diluentInfo = e.volumeMl ? ` · ${e.volumeMl}ml ${e.diluentType||'BAC'}${e.freqPerWeek?` · ${e.freqPerWeek}×/wk`:''}` : '';
      return`<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--bdr)">
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;color:var(--t0)">${e.qty} vial — ${reconFmt}${diluentInfo}</div>
          <div style="font-size:10px;color:${expCol};font-weight:700">Exp: ${expFmt} (${daysLeft>0?daysLeft+'h lagi':'EXPIRED'})</div>
          ${e.notes?`<div style="font-size:10px;color:var(--t2)">${e.notes}</div>`:''}
        </div>
        <button onclick="deleteReconVial('${e.id}','${name}')" style="padding:4px 10px;border-radius:var(--r);border:1px solid var(--warn-bdr);background:var(--warn-bg);color:var(--warn);font-size:10px;font-weight:700;cursor:pointer">Hapus</button>
      </div>`;
    }).join('');

  document.getElementById('recon-modal').classList.add('open');
  // Trigger initial calc
  window.recalcReconIU && window.recalcReconIU();
}

// Live calculator: konsentrasi + IU per inject + vial habis kapan
export function recalcReconIU(){
  const name = document.getElementById('recon-modal-name')?.value;
  const c = COMPOUNDS.find(x => x.name === name);
  const out = document.getElementById('recon-calc-output');
  if(!c || !out) return;

  const qty     = parseFloat(document.getElementById('recon-qty-input').value) || 1;
  const volume  = parseFloat(document.getElementById('recon-volume-input').value) || 0;
  const syringe = parseInt(document.getElementById('recon-syringe-input').value) || 100;
  const diluent = document.getElementById('recon-diluent-input').value || 'BAC';
  const freqPerWeek = parseInt(document.getElementById('recon-freq-input').value) || 0;

  if(!volume || !c.vialSize){
    out.innerHTML = '<div style="color:var(--t3)">Isi volume diluent untuk lihat kalibrasi IU</div>';
    return;
  }

  // Konsentrasi dalam vial_unit/ml (mg/ml atau mcg/ml)
  const conc = c.vialSize / volume;  // e.g. 10mg / 2ml = 5 mg/ml

  // Weekly dose dalam vial_unit — pull dari Timeline (customDoses) per S.currentWeek.
  // tlDoseForWeek priority: customDoses[name][week] > cycle override > compound.weeklyDoseValue.
  // Kalau user edit dose di Timeline tab, otomatis ke-reflect di sini.
  const curWeek = S.currentWeek || 1;
  let weeklyInVU = tlDoseForWeek(curWeek, c, S.quarter) || 0;
  // Fallback final kalau Timeline 0/off-cycle: pakai canonical static
  if(!weeklyInVU){
    weeklyInVU = c.weeklyDoseValue || 0;
    if(c.weeklyDoseUnit && c.vialUnit && c.weeklyDoseUnit !== c.vialUnit){
      if(c.vialUnit === 'mg' && c.weeklyDoseMg) weeklyInVU = c.weeklyDoseMg;
      else if(c.vialUnit === 'mcg' && c.weeklyDoseMg) weeklyInVU = c.weeklyDoseMg * 1000;
    }
  }

  // Per inject = weekly / freq (USER nentuin freq, bukan compound profile)
  const perInjectInVU = freqPerWeek > 0 ? weeklyInVU / freqPerWeek : 0;

  // Volume per inject (ml) = perInjectInVU / conc
  const volumePerInject = perInjectInVU > 0 ? perInjectInVU / conc : 0;
  const iuMark = volumePerInject * syringe;  // 100 IU/ml means 1ml = 100 IU

  // Total injections per vial
  const totalInjects = perInjectInVU > 0 ? Math.floor(c.vialSize / perInjectInVU) : 0;

  // Days to finish (totalInjects across qty vials / freq per day)
  const totalInjectsAcrossQty = totalInjects * qty;
  const daysToFinish = freqPerWeek > 0 ? Math.ceil(totalInjectsAcrossQty / (freqPerWeek / 7)) : 0;

  // Shelf life (diluent affects — Lipozide longer)
  const baseShelf = c.shelfLifeDays || 30;
  const shelfMultiplier = diluent === 'Lipozide' ? 2.5 : diluent === 'Saline' ? 0.7 : 1.0;
  const effectiveShelf = Math.round(baseShelf * shelfMultiplier);

  // Effective expiry = min(shelf, days to finish)
  const effectiveDays = daysToFinish > 0 ? Math.min(effectiveShelf, daysToFinish) : effectiveShelf;

  const concFmt = conc < 1 ? conc.toFixed(2) : conc.toFixed(1);
  const ivFmt   = volumePerInject < 0.01 ? volumePerInject.toFixed(3) : volumePerInject.toFixed(2);
  const iuFmt   = iuMark < 1 ? iuMark.toFixed(2) : Math.round(iuMark * 10) / 10;

  out.innerHTML = `
    <div style="font-size:9.5px;font-weight:800;color:#7c3aed;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">⚗ Kalibrasi IU Syringe</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;color:var(--t1)">
      <div><span style="color:var(--t3)">Konsentrasi:</span> <b>${concFmt} ${c.vialUnit}/ml</b></div>
      <div><span style="color:var(--t3)">Vol/inject:</span> <b>${ivFmt} ml</b></div>
      <div style="grid-column:1/-1;padding:6px 10px;background:#7c3aed11;border-radius:6px;text-align:center">
        <span style="color:var(--t3);font-size:10.5px">Per inject (${perInjectInVU.toFixed(perInjectInVU<1?2:1)} ${c.vialUnit}) × ${freqPerWeek}/wk di syringe ${syringe} IU/ml =</span>
        <span style="display:block;font-size:18px;font-weight:800;color:#7c3aed;font-family:'JetBrains Mono',monospace">${iuFmt} IU</span>
      </div>
      <div><span style="color:var(--t3)">Inject/vial:</span> <b>${totalInjects}×</b></div>
      <div><span style="color:var(--t3)">Total injects:</span> <b>${totalInjectsAcrossQty}× (${qty} vial)</b></div>
      <div><span style="color:var(--t3)">Habis dalam:</span> <b>${daysToFinish || '—'} hari</b></div>
      <div><span style="color:var(--t3)">Shelf (${diluent}):</span> <b>${effectiveShelf} hari</b></div>
      <div style="grid-column:1/-1;text-align:center;padding-top:4px;border-top:1px dashed #7c3aed44;margin-top:4px">
        <span style="color:var(--t3);font-size:10.5px">Effective expiry: </span>
        <b style="color:#7c3aed;font-size:13px">${effectiveDays} hari</b>
      </div>
    </div>`;
}

export function closeReconModal(){document.getElementById('recon-modal').classList.remove('open');}

export async function confirmReconAdd(){
  const name=document.getElementById('recon-modal-name').value;
  const qty=parseInt(document.getElementById('recon-qty-input').value)||0;
  const dateStr=document.getElementById('recon-date-input').value;
  const notes=document.getElementById('recon-notes-input').value.trim();
  const diluent=document.getElementById('recon-diluent-input').value||'BAC';
  const volumeMl=parseFloat(document.getElementById('recon-volume-input').value)||null;
  const syringeIu=parseInt(document.getElementById('recon-syringe-input').value)||100;
  const freqPerWeek=parseInt(document.getElementById('recon-freq-input').value)||null;
  if(!qty||qty<1){alert('Jumlah vial harus ≥1');return;}
  if(!dateStr){alert('Tanggal rekonstituasi wajib diisi');return;}
  if(!freqPerWeek||freqPerWeek<1){alert('Frekuensi injeksi per minggu wajib diisi');return;}
  closeReconModal();
  await addReconVial(name,qty,dateStr,notes,diluent,volumeMl,syringeIu,freqPerWeek);
}

// ── AUTH ──
export function openAuthModal(){document.getElementById('auth-modal').classList.add('open');}
export function closeAuthModal(){document.getElementById('auth-modal').classList.remove('open');document.getElementById('auth-err').textContent='';}

export function updateAuthUI(user){
  const lbl=document.getElementById('auth-user-label');
  const btn=document.getElementById('auth-action-btn');
  if(user){
    lbl.textContent='👤 '+user.email.split('@')[0];
    btn.textContent='Logout';
    btn.classList.add('logout');
  }else{
    lbl.textContent='';
    btn.textContent='Login';
    btn.classList.remove('logout');
  }
}

export function onAuthBtnClick(){
  const btn=document.getElementById('auth-action-btn');
  if(btn.classList.contains('logout')){
    doLogout();
  }else{
    openAuthModal();
  }
}

// Logout manual — bypass supa.auth.signOut() yang hang (GoTrueClient lock).
// Clear localStorage session + JWT cache + reset UI state.
export function doLogout(){
  // 1. Clear Supabase session di localStorage
  const projectRef = SUPA_URL.match(/https:\/\/([^.]+)/)?.[1];
  if(projectRef){
    localStorage.removeItem(`sb-${projectRef}-auth-token`);
    // Hapus juga key lain yang prefix-nya sama (Supabase kadang stash multiple)
    Object.keys(localStorage)
      .filter(k => k.startsWith(`sb-${projectRef}-`))
      .forEach(k => localStorage.removeItem(k));
  }

  // 2. Reset module state
  _jwt = null;
  S.user = null;

  // 3. Clear user-data caches (sync dengan onAuthStateChange branch !user)
  Object.keys(customDoses).forEach(k=>delete customDoses[k]);
  Object.keys(inventoryCache).forEach(k=>delete inventoryCache[k]);
  Object.keys(reconCache).forEach(k=>delete reconCache[k]);
  S.budSel = new Set();

  // 4. Update UI
  updateAuthUI(null);
  window.renderPanels && window.renderPanels();

  // 5. Best-effort supa.auth.signOut() async di background (kalau ga hang,
  // bagus untuk sinkron dengan Supabase backend; kalau hang, ga ngeblok user)
  try { supa.auth.signOut(); } catch(_){}
}

export async function doLogin(){
  const email=document.getElementById('auth-user').value.trim();
  const pass=document.getElementById('auth-pass').value;
  const errEl=document.getElementById('auth-err');
  errEl.textContent='';
  if(!email){errEl.textContent='Email tidak boleh kosong.';return;}
  const{error}=await supa.auth.signInWithPassword({email,password:pass});
  if(error){errEl.textContent='Email atau password salah.';return;}
  closeAuthModal();
}

// Auth state change listener — set up in main.js after imports
// Timeout wrapper: kalau supa.from() hang (GoTrueClient lock quirk),
// individual load gak boleh block render. Default 8 detik.
function withTimeout(promise, ms, name){
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms))
  ]).catch(e => { console.warn(`[load] ${name} failed: ${e.message}`); return null; });
}

export function setupAuthListener(){
  // Init JWT cache dari localStorage sebelum auth state listener fires
  _jwt = readJwtFromStorage();

  supa.auth.onAuthStateChange(async(event,session)=>{
    const user = session?.user || null;
    S.user = user;
    _jwt = session?.access_token || null;  // cache JWT untuk authFetch
    updateAuthUI(user);

    // Auto-close login modal on successful sign-in (single source of truth,
    // tahan terhadap timing/hang di doLogin yang bisa skip closeAuthModal).
    if(user) closeAuthModal();

    if(!user){
      Object.keys(customDoses).forEach(k=>delete customDoses[k]);
      Object.keys(inventoryCache).forEach(k=>delete inventoryCache[k]);
      window.renderPanels();
      return;
    }

    // Render IMMEDIATELY (logged-in state) — sebelum load DB.
    // Card data masih kosong, tapi UI udah responsive (button → email,
    // tab navigation, dst). Avoid "blank stuck" kalau load lambat.
    window.renderPanels();

    // Load 5 user-specific tables PARALLEL, masing-masing dengan 8s timeout.
    // Salah satu hang gak block yang lain — render lagi setelah semua selesai/timeout.
    await Promise.allSettled([
      withTimeout(loadBudgetFromDB(S.budQuarter), 8000, 'budget'),
      withTimeout(loadAllBudgetSelections(), 8000, 'budgetAll'),
      withTimeout(loadAllTLCycles(), 8000, 'tlCycles'),
      withTimeout(loadCustomDoses(), 8000, 'customDoses'),
      withTimeout(loadInventory(), 8000, 'inventory'),
      withTimeout(loadReconVials(), 8000, 'reconVials'),
      withTimeout(window.refreshDMStages ? window.refreshDMStages() : Promise.resolve(), 8000, 'DM')
    ]);
    window.renderPanels();
  });
}
