// ══════════════════════════════════════════════════════════
// SUPABASE CONFIG + AUTH + DB FUNCTIONS
// ══════════════════════════════════════════════════════════
import { _setPepData, COMPOUNDS, VSPECS } from './data.js?v=14';
import { S, initBudSel, customDoses, inventoryCache, reconCache, getDose, QUARTERS } from './state.js?v=14';

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

// ── DYNAMIC PEP DATA LOAD (compounds + phases + redundancy_rules) ──
let _pepLoaded = false;
let _quartersLoaded = false;
let _quartersCache = null;

function computeCostsPerPhase(compoundRow, phaseRows){
  const out = { f1:{mg:0,v:0,cost:0}, f2:{mg:0,v:0,cost:0}, f3:{mg:0,v:0,cost:0}, tot:{mg:0,v:0,cost:0} };
  const doses = compoundRow.doses_jsonb || {};
  const vSize = compoundRow.vial_size || 10;
  const vPrice = compoundRow.vial_price_idr || 0;

  Object.entries(doses).forEach(([weekStr, dose]) => {
    const wk = parseInt(weekStr);
    const phase = (phaseRows||[]).find(p => wk >= p.week_start && wk <= p.week_end);
    if(!phase) return;
    const fk = 'f'+phase.phase_id;
    if(!out[fk]) return;
    out[fk].mg += parseFloat(dose) || 0;
    out.tot.mg += parseFloat(dose) || 0;
  });

  ['f1','f2','f3'].forEach(p => {
    if(out[p].mg > 0){
      out[p].v = Math.ceil(out[p].mg / vSize);
      out[p].cost = out[p].v * vPrice;
    }
  });
  out.tot.v = out.f1.v + out.f2.v + out.f3.v;
  out.tot.cost = out.f1.cost + out.f2.cost + out.f3.cost;
  return out;
}

export async function loadAllPepData(){
  if(_pepLoaded) return;

  const dbg = (m) => { try { window.updateDebugOverlay && window.updateDebugOverlay(m); } catch(_){} };

  // Plain fetch() bypass supa client — work in Chrome incognito where
  // GoTrueClient init can hang on navigator.locks/storage.
  let compoundRows, phaseRows, ruleRows;
  try {
    dbg('fetch compounds...');
    compoundRows = await restFetch('compounds', 'select=*&order=sort_order.asc.nullslast,name.asc');
    dbg(`compounds:${compoundRows.length} · fetch phases...`);
    phaseRows = await restFetch('phases', 'select=*&order=sort_order.asc');
    dbg(`phases:${phaseRows.length} · fetch rules...`);
    ruleRows = await restFetch('redundancy_rules', 'select=*&order=sort_order.asc');
    dbg(`rules:${ruleRows.length} · transforming...`);
  } catch(e){
    dbg('FETCH FAIL: '+(e.message||e));
    throw e;
  }

  // Build derived structures
  const SC={}, SP={}, MECHS={}, VSPECS={}, SHELF_LIFE={};
  const COMPOUNDS = [];
  compoundRows.forEach(r => {
    SC[r.name] = {
      f1:{r:r.score_f1||0, p:r.score_f1||0},
      f2:{r:r.score_f2||0, p:r.score_f2||0},
      f3:{r:r.score_f3||0, p:r.score_f3||0}
    };
    SP[r.name] = {
      z2:r.sport_z2||0, pw:r.sport_pw||0, rc:r.sport_rc||0,
      hr:r.sport_hr||0, cn:r.sport_cn||0, risk:r.risk_text||''
    };
    MECHS[r.name] = r.mechanism || '';
    VSPECS[r.name] = {
      unit:r.vial_unit||'mg', vSize:r.vial_size||10,
      vPrice:r.vial_price_idr||0, label:r.vial_label||''
    };
    SHELF_LIFE[r.name] = { shelf:r.shelf_life_days, timing:r.timing_note||'' };

    COMPOUNDS.push({
      name:r.name, cat:r.category||'off',
      hiv_notes:r.hiv_notes, notes:r.notes,
      d: r.doses_jsonb || {},
      c: computeCostsPerPhase(r, phaseRows),
    });
  });

  // Phase shape compatibility with old data.js (PHASES had id, cls, name, bf, wS, wE, wk, defisit, label, desc, col, selCls)
  const PHASES = phaseRows.map(p => ({
    id: parseInt(p.phase_id),
    cls: p.color,
    name: p.name,
    bf: p.bf_range,
    wS: p.week_start, wE: p.week_end, wk: p.total_weeks,
    defisit: p.defisit, label: p.label, desc: p.description,
    col: `var(--${p.color})`,
    selCls: p.sel_class
  }));

  const REDUNDANCY = ruleRows.map(r => ({
    id:r.id, lvl:r.level, title:r.title, body:r.body,
    rec:r.recommendation, cmps:r.compound_names||[], thresh:r.threshold||2
  }));

  _setPepData({ phases:PHASES, compounds:COMPOUNDS, redundancy:REDUNDANCY, sc:SC, sp:SP, mechs:MECHS, vspecs:VSPECS, shelf:SHELF_LIFE });
  _pepLoaded = true;
  console.info(`[db] Loaded ${COMPOUNDS.length} compounds, ${PHASES.length} phases, ${REDUNDANCY.length} rules`);
}

export async function saveCompoundEdit(name, updates){
  // updates: object with any fields to update on compounds row
  const { error } = await supa.from('compounds').update(updates).eq('name', name);
  if(error){ console.error('saveCompoundEdit:', error); throw error; }
  // Force reload on next call
  _pepLoaded = false;
}

export async function loadQuartersFromDB(){
  if(_quartersLoaded)return _quartersCache||[];
  // Plain fetch() bypass supa client (sama alasan dengan loadAllPepData)
  try {
    _quartersCache = await restFetch('quarters',
      'select=quarter_id,phase_type,window_raw,total_weeks,bb_start,bb_end,bf_start,bf_end&order=quarter_id.asc');
  } catch(e){
    console.error('[db] loadQuartersFromDB:', e);
    throw e;
  }
  _quartersLoaded=true;
  console.info(`[db] Loaded ${_quartersCache.length} quarters`);
  return _quartersCache;
}

// ── DECISION MATRIX STAGES (per-quarter, per-user) ──
// Table: decision_matrix_stages(id, user_id, quarter_id, compound_name, stage, sort_order, ...)
// RLS: auth.uid() = user_id (FOR ALL TO authenticated)

// Load semua selection user, group by quarter_id → { 'Q3_2026': Map<name, stage>, ... }
export async function loadDMStages(userId){
  const empty = Object.fromEntries(QUARTERS.map(q => [q, new Map()]));
  if(!userId) return empty;
  const { data, error } = await supa.from('decision_matrix_stages')
    .select('quarter_id, compound_name, stage, sort_order')
    .eq('user_id', userId);
  if(error){ console.error('loadDMStages:', error); throw error; }
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
    user_id: userId,
    quarter_id: quarterId,
    compound_name: compoundName,
    stage,
    updated_at: new Date().toISOString()
  };
  const { error } = await supa.from('decision_matrix_stages')
    .upsert(row, { onConflict: 'user_id,quarter_id,compound_name' });
  if(error){ console.error('setDMStage:', error); throw error; }
}

// Remove
export async function removeDMStage(userId, quarterId, compoundName){
  if(!userId) throw new Error('Login dulu');
  const { error } = await supa.from('decision_matrix_stages')
    .delete()
    .eq('user_id', userId).eq('quarter_id', quarterId).eq('compound_name', compoundName);
  if(error){ console.error('removeDMStage:', error); throw error; }
}

// Bulk seed (sport >=60 → 'deal')
export async function seedDMStages(userId, quarterId, rows){
  if(!userId || !rows?.length) return { inserted: [] };
  const payload = rows.map((r,i) => ({
    user_id: userId,
    quarter_id: quarterId,
    compound_name: r.compound_name,
    stage: r.stage,
    sort_order: r.sort_order ?? (100+i)
  }));
  const { data, error } = await supa.from('decision_matrix_stages')
    .upsert(payload, { onConflict: 'user_id,quarter_id,compound_name', ignoreDuplicates: true })
    .select();
  if(error && error.code !== '23505'){
    console.error('seedDMStages:', error); throw error;
  }
  return { inserted: data || [] };
}

// ── SAVE INDICATOR ──
export function showSaveInd(){
  const el=document.getElementById('save-ind');
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),2000);
}

// ── BUDGET DB (per-quarter) ──
export async function loadBudgetFromDB(qid){
  const{data:{user}}=await supa.auth.getUser();
  if(!user){initBudSel(qid);return;}
  const{data}=await supa.from('budget_selections')
    .select('selected_compounds,budget_cap')
    .eq('user_id',user.id).eq('quarter_id',qid).maybeSingle();
  if(data){
    S.budSel=new Set(data.selected_compounds||[]);
    if(data.budget_cap)S.budCap=data.budget_cap;
  }else{
    initBudSel(qid);
  }
}

export async function saveBudgetToDB(){
  const{data:{user}}=await supa.auth.getUser();
  if(!user)return;
  await supa.from('budget_selections').upsert({
    user_id:user.id,
    quarter_id:S.budQuarter,
    selected_compounds:[...S.budSel],
    budget_cap:S.budCap,
    updated_at:new Date().toISOString()
  },{onConflict:'user_id,quarter_id'});
  showSaveInd();
}

// ── CUSTOM DOSES ──
export async function loadCustomDoses(){
  const{data:{user}}=await supa.auth.getUser();
  if(!user){
    // clear customDoses
    Object.keys(customDoses).forEach(k=>delete customDoses[k]);
    return;
  }
  const{data}=await supa.from('custom_doses')
    .select('compound_name,week,dose')
    .eq('user_id',user.id);
  // clear and repopulate
  Object.keys(customDoses).forEach(k=>delete customDoses[k]);
  if(data){
    data.forEach(r=>{
      if(!customDoses[r.compound_name])customDoses[r.compound_name]={};
      customDoses[r.compound_name][r.week]=r.dose;
    });
  }
}

export async function saveCustomDose(compoundName,week,dose){
  const{data:{user}}=await supa.auth.getUser();
  if(!user){alert('Login dulu untuk simpan custom dose!');return;}

  if(dose===null){
    await supa.from('custom_doses').delete()
      .eq('user_id',user.id).eq('compound_name',compoundName).eq('week',week);
    if(customDoses[compoundName])delete customDoses[compoundName][week];
  }else{
    await supa.from('custom_doses').upsert({
      user_id:user.id,compound_name:compoundName,week,dose,
      updated_at:new Date().toISOString()
    },{onConflict:'user_id,compound_name,week'});
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
  const defaultDose=c?.d[week]||0;
  const currentDose=getDose(compoundName,week)||defaultDose;
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
  const{data:{user}}=await supa.auth.getUser();
  if(!user){
    Object.keys(inventoryCache).forEach(k=>delete inventoryCache[k]);
    return;
  }
  const[invRes,ssRes]=await Promise.all([
    supa.from('inventory').select('compound_name,qty_vials').eq('user_id',user.id),
    supa.from('safety_stock').select('compound_name,min_vials').eq('user_id',user.id)
  ]);
  Object.keys(inventoryCache).forEach(k=>delete inventoryCache[k]);
  COMPOUNDS.forEach(c=>{inventoryCache[c.name]={qty:0,safetyStock:5};});
  if(invRes.data)invRes.data.forEach(r=>{
    if(!inventoryCache[r.compound_name])inventoryCache[r.compound_name]={qty:0,safetyStock:5};
    inventoryCache[r.compound_name].qty=r.qty_vials;
  });
  if(ssRes.data)ssRes.data.forEach(r=>{
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
  const{data:{user}}=await supa.auth.getUser();
  if(!user){alert('Login dulu untuk simpan inventory.');return;}
  if(!inventoryCache[name])inventoryCache[name]={qty:0,safetyStock:5};
  inventoryCache[name].qty=qty;
  inventoryCache[name].safetyStock=ss;
  await Promise.all([
    supa.from('inventory').upsert({user_id:user.id,compound_name:name,qty_vials:qty,last_updated:new Date().toISOString()},{onConflict:'user_id,compound_name'}),
    supa.from('safety_stock').upsert({user_id:user.id,compound_name:name,min_vials:ss},{onConflict:'user_id,compound_name'})
  ]);
  showSaveInd();
  window.renderPanels();
}

// ── RECONSTITUTED VIALS ──
export async function loadReconVials(){
  const{data:{user}}=await supa.auth.getUser();
  Object.keys(reconCache).forEach(k=>delete reconCache[k]);
  if(!user)return;
  const{data}=await supa.from('reconstituted_vials')
    .select('id,compound_name,qty_vials,reconstituted_at,notes')
    .eq('user_id',user.id)
    .order('reconstituted_at',{ascending:false});
  if(!data)return;
  data.forEach(r=>{
    const sl=SHELF_LIFE[r.compound_name];
    const reconDate=new Date(r.reconstituted_at);
    const shelfDays=sl?.shelf||30;
    const expiredAt=new Date(reconDate);
    expiredAt.setDate(expiredAt.getDate()+shelfDays);
    if(!reconCache[r.compound_name])reconCache[r.compound_name]=[];
    reconCache[r.compound_name].push({
      id:r.id,
      qty:r.qty_vials,
      reconDate,
      expiredAt,
      notes:r.notes||''
    });
  });
}

export async function addReconVial(compoundName, qty, reconDateStr, notes){
  const{data:{user}}=await supa.auth.getUser();
  if(!user){alert('Login dulu!');return;}
  const{data,error}=await supa.from('reconstituted_vials').insert({
    user_id:user.id,
    compound_name:compoundName,
    qty_vials:qty,
    reconstituted_at:reconDateStr,
    notes:notes||null
  }).select().single();
  if(error){alert('Gagal simpan: '+error.message);return;}
  const sl=SHELF_LIFE[compoundName];
  const reconDate=new Date(reconDateStr);
  const shelfDays=sl?.shelf||30;
  const expiredAt=new Date(reconDate);
  expiredAt.setDate(expiredAt.getDate()+shelfDays);
  if(!reconCache[compoundName])reconCache[compoundName]=[];
  reconCache[compoundName].unshift({id:data.id,qty,reconDate,expiredAt,notes:notes||''});
  showSaveInd();
  window.renderPanels();
}

export async function deleteReconVial(id, compoundName){
  const{data:{user}}=await supa.auth.getUser();
  if(!user)return;
  await supa.from('reconstituted_vials').delete().eq('id',id).eq('user_id',user.id);
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
  // render existing recon entries
  const entries=reconCache[name]||[];
  const sl=SHELF_LIFE[name];
  const today=new Date();
  document.getElementById('recon-existing').innerHTML=entries.length===0
    ?'<div style="color:var(--t3);font-size:11px;padding:8px 0">Belum ada vial yang direkonstitusi</div>'
    :entries.map(e=>{
      const daysLeft=Math.ceil((e.expiredAt-today)/(1000*60*60*24));
      const expCol=daysLeft<=3?'var(--warn)':daysLeft<=7?'var(--f2)':'var(--f3)';
      const expFmt=e.expiredAt.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'});
      const reconFmt=e.reconDate.toLocaleDateString('id-ID',{day:'numeric',month:'short'});
      return`<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--bdr)">
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;color:var(--t0)">${e.qty} vial — Rekon: ${reconFmt}</div>
          <div style="font-size:10px;color:${expCol};font-weight:700">Exp: ${expFmt} (${daysLeft>0?daysLeft+'h lagi':'EXPIRED'})</div>
          ${e.notes?`<div style="font-size:10px;color:var(--t2)">${e.notes}</div>`:''}
        </div>
        <button onclick="deleteReconVial('${e.id}','${name}')" style="padding:4px 10px;border-radius:var(--r);border:1px solid var(--warn-bdr);background:var(--warn-bg);color:var(--warn);font-size:10px;font-weight:700;cursor:pointer">Hapus</button>
      </div>`;
    }).join('');
  document.getElementById('recon-modal').classList.add('open');
}

export function closeReconModal(){document.getElementById('recon-modal').classList.remove('open');}

export async function confirmReconAdd(){
  const name=document.getElementById('recon-modal-name').value;
  const qty=parseInt(document.getElementById('recon-qty-input').value)||0;
  const dateStr=document.getElementById('recon-date-input').value;
  const notes=document.getElementById('recon-notes-input').value.trim();
  if(!qty||qty<1){alert('Jumlah vial harus ≥1');return;}
  if(!dateStr){alert('Tanggal rekonstituasi wajib diisi');return;}
  closeReconModal();
  await addReconVial(name,qty,dateStr,notes);
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
    supa.auth.signOut();
  }else{
    openAuthModal();
  }
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
export function setupAuthListener(){
  supa.auth.onAuthStateChange(async(event,session)=>{
    const user = session?.user || null;
    S.user = user;
    updateAuthUI(user);
    if(user){
      // Use allSettled supaya satu fail nggak block render
      await Promise.allSettled([
        loadBudgetFromDB(S.budQuarter),
        loadCustomDoses(),
        loadInventory(),
        loadReconVials(),
        window.refreshDMStages ? window.refreshDMStages() : Promise.resolve()
      ]);
      window.renderPanels();
    }else{
      Object.keys(customDoses).forEach(k=>delete customDoses[k]);
      Object.keys(inventoryCache).forEach(k=>delete inventoryCache[k]);
      window.renderPanels();
    }
  });
}
