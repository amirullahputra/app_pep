// ══════════════════════════════════════════════════════════
// SUPABASE CONFIG + AUTH + DB FUNCTIONS
// ══════════════════════════════════════════════════════════
import { COMPOUNDS, VSPECS } from './data.js';
import { S, initBudSel, customDoses, inventoryCache, getDose } from './state.js';

const SUPA_URL='https://guhhoqpvwzzrlwgfugsb.supabase.co';
const SUPA_KEY='sb_publishable_yu8KTS5mId2hV7kVjScvZA_-geYqKHv';
// Supabase loaded via CDN as window.supabase
export const supa=window.supabase.createClient(SUPA_URL,SUPA_KEY);

// ── SAVE INDICATOR ──
export function showSaveInd(){
  const el=document.getElementById('save-ind');
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),2000);
}

// ── BUDGET DB ──
export async function loadBudgetFromDB(ph){
  const{data:{user}}=await supa.auth.getUser();
  if(!user){initBudSel(ph);return;}
  const{data}=await supa.from('budget_selections')
    .select('selected_compounds,budget_cap')
    .eq('user_id',user.id).eq('phase',ph).maybeSingle();
  if(data){
    S.budSel=new Set(data.selected_compounds||[]);
    if(data.budget_cap)S.budCap=data.budget_cap;
  }else{
    initBudSel(ph);
  }
}

export async function saveBudgetToDB(){
  const{data:{user}}=await supa.auth.getUser();
  if(!user)return;
  await supa.from('budget_selections').upsert({
    user_id:user.id,
    phase:S.budPh,
    selected_compounds:[...S.budSel],
    budget_cap:S.budCap,
    updated_at:new Date().toISOString()
  },{onConflict:'user_id,phase'});
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

// ── AUTH ──
export function openAuthModal(){document.getElementById('auth-modal').classList.add('open');}
export function closeAuthModal(){document.getElementById('auth-modal').classList.remove('open');document.getElementById('auth-err').textContent='';}

export function updateAuthUI(user){
  const lbl=document.getElementById('auth-user-label');
  const btn=document.getElementById('auth-action-btn');
  if(user){
    const username=user.email.replace('@peptideapp.local','');
    lbl.textContent='👤 '+username;
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

function usernameToEmail(u){return u.trim().toLowerCase().replace(/\s+/g,'_')+'@peptideapp.local';}

export async function doLogin(){
  const user=document.getElementById('auth-user').value.trim();
  const pass=document.getElementById('auth-pass').value;
  const errEl=document.getElementById('auth-err');
  errEl.textContent='';
  if(!user){errEl.textContent='Username tidak boleh kosong.';return;}
  const email=usernameToEmail(user);
  const{error}=await supa.auth.signInWithPassword({email,password:pass});
  if(error){errEl.textContent='Username atau password salah.';return;}
  closeAuthModal();
}

// Auth state change listener — set up in main.js after imports
export function setupAuthListener(){
  supa.auth.onAuthStateChange(async(event,session)=>{
    updateAuthUI(session?.user||null);
    if(session?.user){
      await Promise.all([loadBudgetFromDB(S.budPh),loadCustomDoses(),loadInventory()]);
      window.renderPanels();
    }else{
      // clear customDoses
      Object.keys(customDoses).forEach(k=>delete customDoses[k]);
      // clear inventoryCache
      Object.keys(inventoryCache).forEach(k=>delete inventoryCache[k]);
      window.renderPanels();
    }
  });
}
