// ══════════════════════════════════════════════════════════
// SUPABASE CONFIG + AUTH + DB FUNCTIONS
// ══════════════════════════════════════════════════════════
import { COMPOUNDS, VSPECS } from './data.js';
import { S, initBudSel, customDoses, inventoryCache, reconCache, getDose } from './state.js';
import { SHELF_LIFE } from './data.js';

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
      await Promise.all([loadBudgetFromDB(S.budPh),loadCustomDoses(),loadInventory(),loadReconVials()]);
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
