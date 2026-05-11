// ══════════════════════════════════════════════════════════
// MAIN — entry point
// ══════════════════════════════════════════════════════════

// Global error catcher
window.addEventListener('error', e => {
  const root = document.getElementById('panels-root');
  if(root) root.innerHTML = `<div style="padding:1.5rem;border:2px solid #EF4444;border-radius:8px;background:#FEE2E2;margin:1rem">
    <div style="font-size:14px;font-weight:800;color:#991B1B;margin-bottom:8px">🔥 JS Error</div>
    <div style="font-family:monospace;font-size:11.5px;color:#1A2140;white-space:pre-wrap;background:white;padding:10px;border-radius:6px">${e.message}\n  at ${e.filename||'?'}:${e.lineno||'?'}:${e.colno||'?'}</div>
  </div>`;
});
window.addEventListener('unhandledrejection', e => {
  const root = document.getElementById('panels-root');
  if(root) root.innerHTML = `<div style="padding:1.5rem;border:2px solid #EF4444;border-radius:8px;background:#FEE2E2;margin:1rem">
    <div style="font-size:14px;font-weight:800;color:#991B1B;margin-bottom:8px">🔥 Promise Rejection</div>
    <div style="font-family:monospace;font-size:11.5px;color:#1A2140;white-space:pre-wrap;background:white;padding:10px;border-radius:6px">${e.reason?.message||e.reason||'unknown'}</div>
  </div>`;
});

// Cache-bust: import URL pakai ?v=N supaya re-fetch saat ada perubahan
// export shape di file dependent. SEMUA imports HARUS pakai value yang SAMA
// untuk hindari module duplication. Bump together saat deploy.
import { PHASES, COMPOUNDS, SP } from './data.js?v=17';
import { S, rpM, initBudSel, QUARTERS, quarterLabel, quarterDateRange,
  quarterFromWeek, weeksInQuarter, costForQuarter, quarterCost } from './state.js?v=17';
import * as stateModule from './state.js?v=17';
import { DM, syncDMStages, buildDefaultSeed } from './state.js?v=17';
import {
  saveBudgetToDB, loadBudgetFromDB,
  loadCustomDoses, loadInventory, loadReconVials,
  loadAllPepData, loadQuartersFromDB, saveCompoundEdit,
  openDoseEdit, closeDoseModal, confirmDoseEdit, resetDoseEdit,
  openInvEdit, closeInvModal, confirmInvEdit,
  openReconModal, closeReconModal, confirmReconAdd, deleteReconVial,
  openAuthModal, closeAuthModal, doLogin, updateAuthUI, onAuthBtnClick,
  setupAuthListener,
  loadDMStages, setDMStage, removeDMStage, seedDMStages,
  supa
} from './supabase.js?v=17';
import {
  pOverview, pDecision, pVial, pTimeline, pBudget, pCompounds,
  dmSortBy, dmToggle, dmToggleAll, dmSetFilter, dmUpdateSummary,
  dmPush, dmSetStage
} from './panels.js?v=17';
import * as panelFns from './panels.js?v=17';
import * as supaFns from './supabase.js?v=17';

// ── Expose to window for inline onclick="" handlers ──
Object.assign(window, panelFns, supaFns, stateModule);

// ── RENDER PANELS ──
// New tab order: Overview → Timeline → Decision → Vial → Budget → Compounds
function renderPanels(){
  const fns=[pOverview,pTimeline,pDecision,pVial,pBudget,pCompounds];
  document.getElementById('panels-root').innerHTML=`<div class="panel act">${fns[S.tab]()}</div>`;
}
window.renderPanels = renderPanels;

// ── QUARTER ROW ──
// Render 12 quarter cards (Q1 2026 — Q4 2028). Card aktif highlighted.
// Setiap card menampilkan info dinamis dari DM selection per-quarter:
//   - jumlah compound dipilih
//   - total cost (selected × weekly dose × harga vial)
//   - range minggu yang fall di quarter itu (kalau ada)
function renderQuarterRow(){
  // Compute costs untuk semua quarters supaya bisa cari max (untuk progress bar)
  const quarterStats = QUARTERS.map(qid => {
    const selected = DM.selectedByQuarter[qid] || new Set();
    const weeks = weeksInQuarter(qid);
    let totalCost = 0, totalVials = 0;
    selected.forEach(name => {
      const r = costForQuarter(name, qid);
      totalCost += r.cost;
      totalVials += r.vials;
    });
    return { qid, selected, weeks, totalCost, totalVials };
  });
  const maxCost = Math.max(1, ...quarterStats.map(q => q.totalCost));

  // Grand total (semua quarters)
  const grandTotal = quarterStats.reduce((a,q) => a + q.totalCost, 0);
  const grandCompounds = new Set(quarterStats.flatMap(q => [...q.selected])).size;
  const grandVials = quarterStats.reduce((a,q) => a + q.totalVials, 0);
  const grandWeeks = quarterStats.reduce((a,q) => a + q.weeks.length, 0);

  // Card "Semua Quarter" — grand total summary
  const allCard = `<div class="ph-card sel-all" style="grid-column:1/-1">
    <div class="ph-tag" style="color:var(--acc)">
      <div class="ph-dot" style="background:var(--acc)"></div>
      GRAND TOTAL · ${QUARTERS.length} QUARTERS (2026–2028)
    </div>
    <div class="ph-name">Multi-Quarter Protocol Overview</div>
    <div class="ph-desc">${grandCompounds} compounds aktif (terpilih di Decision Matrix) · ${grandWeeks} minggu total dose · biaya kumulatif dari DM</div>
    <div class="ph-grid">
      <div class="ph-stat"><div class="ph-stat-l">Grand Total</div><div class="ph-stat-v" style="color:var(--acc)">${rpM(grandTotal)}</div></div>
      <div class="ph-stat"><div class="ph-stat-l">Compounds</div><div class="ph-stat-v">${grandCompounds}</div></div>
      <div class="ph-stat"><div class="ph-stat-l">Total Vials</div><div class="ph-stat-v">${grandVials}</div></div>
      <div class="ph-stat"><div class="ph-stat-l">Total Weeks</div><div class="ph-stat-v">${grandWeeks}</div></div>
      <div class="ph-stat"><div class="ph-stat-l">Active Q</div><div class="ph-stat-v">${quarterStats.filter(q=>q.selected.size>0).length}/${QUARTERS.length}</div></div>
    </div>
  </div>`;

  // Card per quarter — dinamis
  const quarterCards = quarterStats.map(({ qid, selected, weeks, totalCost, totalVials }) => {
    const sel = S.quarter === qid;
    const pct = Math.round(totalCost/maxCost*100);
    const hasWeeks = weeks.length > 0;
    const wRange = hasWeeks ? `W${weeks[0]}–W${weeks[weeks.length-1]}` : '— pre-protocol';
    const dotColor = !hasWeeks ? 'var(--t3)' : selected.size > 0 ? 'var(--acc)' : 'var(--t3)';
    const isEmpty = selected.size === 0;

    return `<div class="ph-card${sel?' sel-quarter':''}${isEmpty?' empty':''}" onclick="setQuarter('${qid}')">
      <div class="ph-tag" style="color:${dotColor}">
        <div class="ph-dot" style="background:${dotColor}"></div>
        ${quarterLabel(qid).toUpperCase()}
      </div>
      <div class="ph-name">${quarterLabel(qid)}</div>
      <div class="ph-desc">${hasWeeks ? `${weeks.length} minggu dose · ${wRange}` : 'Pre-protocol — no doses yet'}</div>
      <div class="ph-grid" style="grid-template-columns:1fr 1fr">
        <div class="ph-stat"><div class="ph-stat-l">Compounds</div><div class="ph-stat-v">${selected.size}</div></div>
        <div class="ph-stat"><div class="ph-stat-l">Biaya</div><div class="ph-stat-v" style="color:${totalCost>0?'var(--acc)':'var(--t3)'}">${totalCost>0?rpM(totalCost):'—'}</div></div>
        <div class="ph-stat"><div class="ph-stat-l">Vials</div><div class="ph-stat-v">${totalVials||'—'}</div></div>
        <div class="ph-stat"><div class="ph-stat-l">Weeks</div><div class="ph-stat-v">${weeks.length||'—'}</div></div>
      </div>
      <div class="ph-bar"><div class="ph-bar-fill" style="width:${pct}%;background:var(--acc)"></div></div>
    </div>`;
  }).join('');

  document.getElementById('phase-row').innerHTML = allCard + quarterCards;
}
window.renderQuarterRow = renderQuarterRow;

// ── NAV ──
const TABS=[
  {ico:'📊',l:'Overview'},
  {ico:'🗓',l:'Timeline'},
  {ico:'🎯',l:'Decision Matrix'},
  {ico:'📦',l:'Vial Planner'},
  {ico:'💰',l:'Budget + Conflict'},
  {ico:'🧬',l:'Compounds'},
];

function renderNav(){
  document.getElementById('tab-nav').innerHTML=TABS.map((t,i)=>
    `<button class="tab-btn${S.tab===i?' act':''}" onclick="setTab(${i})">${t.ico} ${t.l}</button>`
  ).join('');
}
window.renderNav = renderNav;

// ── SET QUARTER / TAB ──
function setQuarter(qid){
  if(!QUARTERS.includes(qid)) return;
  S.quarter = qid;
  S.budQuarter = qid;  // budget tab follows main quarter
  syncDMStages();
  renderQuarterRow();
  renderPanels();
}
function setTab(n){S.tab=n;renderNav();renderPanels();}
window.setQuarter = setQuarter;
window.setTab = setTab;

// ── DECISION MATRIX — Drag & Drop Handlers (single "Selected for Fase N" zone) ──
window.onDmDragStart = function(ev, compoundName, source){
  ev.dataTransfer.setData('text/plain', JSON.stringify({ name: compoundName, source }));
  ev.dataTransfer.effectAllowed = 'move';
};
window.onDmDragOver = function(ev){
  ev.preventDefault();
  ev.currentTarget.classList.add('drag-over');
  ev.dataTransfer.dropEffect = 'move';
};
window.onDmDragLeave = function(ev){
  ev.currentTarget.classList.remove('drag-over');
};
// Drop ke "Selected" zone — add compound ke selectedByQuarter[S.quarter]
window.onDmDrop = async function(ev){
  ev.preventDefault();
  ev.currentTarget.classList.remove('drag-over');
  let payload;
  try { payload = JSON.parse(ev.dataTransfer.getData('text/plain')); }
  catch(_){ return; }
  const { name, source } = payload || {};
  if(!name) return;
  if(source === 'selected') return;
  const qid = S.quarter;
  if(!qid){ alert('Pilih Quarter dulu'); return; }
  if(!S.user){ alert('Login dulu untuk menyimpan Decision Matrix'); return; }
  if(!DM.selectedByQuarter[qid]) DM.selectedByQuarter[qid] = new Set();
  if(DM.selectedByQuarter[qid].has(name)) return;

  DM.selectedByQuarter[qid].add(name);
  syncDMStages();
  renderQuarterRow();
  renderPanels();

  try { await setDMStage(S.user.id, qid, name, 'deal'); }
  catch(e){
    alert('Gagal simpan: '+(e.message||e));
    DM.selectedByQuarter[qid].delete(name);
    syncDMStages();
    renderQuarterRow();
    renderPanels();
  }
};

// Klik card library untuk toggle add/remove
window.dmToggleSelect = async function(compoundName){
  const qid = S.quarter;
  if(!qid){ alert('Pilih Quarter dulu'); return; }
  if(!S.user){ alert('Login dulu untuk menyimpan Decision Matrix'); return; }
  if(!DM.selectedByQuarter[qid]) DM.selectedByQuarter[qid] = new Set();
  const isSelected = DM.selectedByQuarter[qid].has(compoundName);
  if(isSelected){
    return window.dmRemoveStage(compoundName);
  }
  DM.selectedByQuarter[qid].add(compoundName);
  syncDMStages();
  renderQuarterRow();
  renderPanels();
  try { await setDMStage(S.user.id, qid, compoundName, 'deal'); }
  catch(e){
    alert('Gagal simpan: '+(e.message||e));
    DM.selectedByQuarter[qid].delete(compoundName);
    syncDMStages();
    renderQuarterRow();
    renderPanels();
  }
};

window.dmRemoveStage = async function(compoundName){
  const qid = S.quarter;
  if(!qid) return;
  if(!S.user){ alert('Login dulu'); return; }
  if(!DM.selectedByQuarter[qid]?.has(compoundName)) return;

  DM.selectedByQuarter[qid].delete(compoundName);
  syncDMStages();
  renderQuarterRow();
  renderPanels();

  try { await removeDMStage(S.user.id, qid, compoundName); }
  catch(e){
    alert('Gagal hapus: '+(e.message||e));
    DM.selectedByQuarter[qid].add(compoundName);
    syncDMStages();
    renderQuarterRow();
    renderPanels();
  }
};

// Load DM selections untuk user — convert DB rows ke Set per quarter
async function refreshDMStages(){
  if(!S.user) return;
  try {
    const fresh = await loadDMStages(S.user.id);
    // fresh: { 'Q3_2026': Map<name, stage>, ... } → convert ke Set
    DM.selectedByQuarter = Object.fromEntries(
      QUARTERS.map(qid => [qid, new Set([...(fresh[qid] || new Map()).keys()])])
    );
    // No auto-seed: user requested fresh start, biarkan kosong sampai user pilih sendiri
    syncDMStages();
  } catch(e){ console.error('refreshDMStages:', e); }
}
window.refreshDMStages = refreshDMStages;

// ── BUDGET HELPERS ──
function toggleBudSel(n){S.budSel.has(n)?S.budSel.delete(n):S.budSel.add(n);saveBudgetToDB();renderPanels();}
async function switchBudQuarter(qid){S.budQuarter=qid;await loadBudgetFromDB(qid);renderPanels();}
function toggleCat(k){
  if(S.filterCats.has(k)){if(S.filterCats.size>1)S.filterCats.delete(k);}
  else S.filterCats.add(k);
  renderPanels();
}
window.toggleBudSel = toggleBudSel;
window.switchBudQuarter = switchBudQuarter;
window.toggleCat = toggleCat;

// ── DOWNLOAD ──
function dlPage(){
  const a=document.createElement('a');
  a.download='peptide_master_v3.html';
  a.href='data:text/html;charset=utf-8,'+encodeURIComponent(document.documentElement.outerHTML);
  a.click();
}
window.dlPage = dlPage;

// Export CSV moved out of UI — pakai file static `library_pep.csv` di
// folder root `c:\Users\Auobvee\Desktop\App\`. Lihat plan file untuk
// regenerate (Python script di /tmp).

// ── TIMER ──
const PROTOCOL_START=new Date('2026-07-06T00:00:00');

function getProtocolTime(){
  const now=new Date();
  const diffMs=now-PROTOCOL_START;
  const belumMulai=diffMs<0;

  if(belumMulai){
    const absDiff=Math.abs(diffMs);
    const days=Math.floor(absDiff/(1000*60*60*24));
    const hrs=Math.floor((absDiff%(1000*60*60*24))/(1000*60*60));
    const mins=Math.floor((absDiff%(1000*60*60))/(1000*60));
    const secs=Math.floor((absDiff%(1000*60))/1000);
    return{belumMulai:true,days,hrs,mins,secs,week:0,dayOfWeek:0,phase:null};
  }

  const totalDays=Math.floor(diffMs/(1000*60*60*24));
  const week=Math.min(Math.floor(totalDays/7)+1,56);
  const dayOfWeek=(totalDays%7)+1;
  const qid = quarterFromWeek(week);   // 'Q3_2026' etc.
  const weekStart=new Date(PROTOCOL_START.getTime()+(week-1)*7*24*60*60*1000);
  const weekEnd=new Date(weekStart.getTime()+6*24*60*60*1000);

  const nextWeekMs=weekEnd-now+1000;
  const hrs=Math.floor((nextWeekMs%(1000*60*60*24))/(1000*60*60));
  const mins=Math.floor((nextWeekMs%(1000*60*60))/(1000*60));
  const secs=Math.floor((nextWeekMs%(1000*60))/1000);

  return{belumMulai:false,week,dayOfWeek,qid,hrs,mins,secs,totalDays,done:week>56};
}

function renderTimer(){
  const t=getProtocolTime();
  const el=document.getElementById('topbar-timer');
  if(!el)return;

  if(t.belumMulai){
    el.innerHTML=`
      <div style="font-size:10px;font-weight:700;color:var(--t2)">Mulai dalam</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:800;color:var(--acc)">${t.days}h ${t.hrs}j ${t.mins}m <span style="color:var(--warn)">${t.secs}d</span></div>`;
    return;
  }

  if(t.done){
    el.innerHTML=`<div style="font-size:11px;font-weight:800;color:var(--f3)">✅ Selesai</div>`;
    return;
  }

  const qLabel = t.qid ? t.qid.replace('_',' ') : '—';
  el.innerHTML=`
    <div style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:800;color:var(--acc)">W${t.week}</div>
    <div style="width:1px;height:20px;background:var(--bdr)"></div>
    <div style="font-size:11px;font-weight:700;color:var(--acc)">${qLabel} · Hari ${t.dayOfWeek}</div>
    <div style="width:1px;height:20px;background:var(--bdr)"></div>
    <div style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--t2)">${String(t.hrs).padStart(2,'0')}:${String(t.mins).padStart(2,'0')}:<span style="color:var(--warn)">${String(t.secs).padStart(2,'0')}</span></div>`;

  if(S.currentWeek!==t.week){S.currentWeek=t.week;renderPanels();}
}
window.renderTimer = renderTimer;

// ── MODAL EVENT LISTENERS ──
document.getElementById('auth-modal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeAuthModal();});
document.getElementById('dose-modal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeDoseModal();});
document.getElementById('cmp-edit-modal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeCmpEdit();});

// ── ERROR BANNER ──
function showInitError(msg){
  const root = document.getElementById('panels-root');
  if(!root) return;
  root.innerHTML = `<div class="card" style="padding:1.25rem 1.5rem;border-left:4px solid var(--warn);background:var(--warn-bg)">
    <div style="font-size:14px;font-weight:800;color:var(--warn);margin-bottom:8px">⚠️ Init Error — App tidak bisa load data</div>
    <div style="font-size:11.5px;color:var(--t1);font-family:'JetBrains Mono',monospace;white-space:pre-wrap;background:var(--bg1);padding:10px;border-radius:6px;border:1px solid var(--bdr)">${msg}</div>
    <div style="font-size:10.5px;color:var(--t3);margin-top:10px">Buka F12 → Console untuk detail.</div>
  </div>`;
}

// ── DEBUG OVERLAY (selalu visible, no F12 needed) ──
function updateDebugOverlay(extra){
  const el = document.getElementById('app-debug');
  if(!el) return;
  const lines = [
    `PHASES=${PHASES?.length||0}`,
    `COMPOUNDS=${COMPOUNDS?.length||0}`,
    `tab=${S?.tab}`,
    `user=${S?.user?'yes':'no'}`,
  ];
  if(extra) lines.push(extra);
  el.textContent = lines.join(' · ');
}
window.updateDebugOverlay = updateDebugOverlay;

// ── INIT ──
(async () => {
  const errs = [];
  updateDebugOverlay('init...');
  try { await loadAllPepData(); updateDebugOverlay('pepData ok'); } catch(e){ errs.push('loadAllPepData: '+(e.message||e)); updateDebugOverlay('pepData FAIL'); }
  try { window._quarters = await loadQuartersFromDB(); } catch(e){ errs.push('loadQuarters: '+(e.message||e)); window._quarters=[]; }

  // Setup auth listener AFTER data loaded — prevents race where onAuthStateChange
  // fires during/before loadAllPepData and renderPanels is called with empty PHASES
  try { setupAuthListener(); } catch(e){ errs.push('setupAuthListener: '+(e.message||e)); }

  setInterval(renderTimer,1000);
  renderTimer();
  try { renderQuarterRow(); } catch(e){ errs.push('renderQuarterRow: '+(e.message||e)); }
  try { renderNav(); } catch(e){ errs.push('renderNav: '+(e.message||e)); }
  try { renderPanels(); updateDebugOverlay('rendered'); } catch(e){ errs.push('renderPanels: '+(e.message||e)); updateDebugOverlay('render FAIL: '+(e.message||e)); }
  if(errs.length) showInitError(errs.join('\n'));
})();
