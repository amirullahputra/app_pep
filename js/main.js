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

import { PHASES, COMPOUNDS } from './data.js?v=3';
import { S, pCost, rpM, initBudSel } from './state.js?v=3';
import * as stateModule from './state.js?v=3';
import {
  saveBudgetToDB, loadBudgetFromDB,
  loadCustomDoses, loadInventory, loadReconVials,
  loadAllPepData, loadQuartersFromDB, saveCompoundEdit,
  openDoseEdit, closeDoseModal, confirmDoseEdit, resetDoseEdit,
  openInvEdit, closeInvModal, confirmInvEdit,
  openReconModal, closeReconModal, confirmReconAdd, deleteReconVial,
  openAuthModal, closeAuthModal, doLogin, updateAuthUI, onAuthBtnClick,
  setupAuthListener
} from './supabase.js?v=3';
import {
  pOverview, pDecision, pVial, pTimeline, pBudget, pCompounds,
  dmSortBy, dmToggle, dmToggleAll, dmSetFilter, dmUpdateSummary,
  dmPush, dmSetStage
} from './panels.js?v=3';
import * as panelFns from './panels.js?v=3';
import * as supaFns from './supabase.js?v=3';

// ── Expose to window for inline onclick="" handlers ──
Object.assign(window, panelFns, supaFns, stateModule);

// ── RENDER PANELS ──
// New tab order: Overview → Timeline → Decision → Vial → Budget → Compounds
function renderPanels(){
  const fns=[pOverview,pTimeline,pDecision,pVial,pBudget,pCompounds];
  document.getElementById('panels-root').innerHTML=`<div class="panel act">${fns[S.tab]()}</div>`;
}
window.renderPanels = renderPanels;

// ── PHASE ROW ──
function renderPhaseRow(){
  const max=Math.max(...PHASES.map(p=>pCost(p.id)));
  const grandTotal=COMPOUNDS.reduce((a,c)=>a+c.c.tot.cost,0);
  const totalVials=COMPOUNDS.reduce((a,c)=>a+(c.c.tot.v||0),0);
  const totalCpds=COMPOUNDS.length;

  const allCard=`<div class="ph-card${S.ph===0?' sel-all':''}" onclick="setPhase(0)" style="grid-column:1/-1">
    <div class="ph-tag" style="color:var(--acc)">
      <div class="ph-dot" style="background:var(--acc)"></div>
      ALL · W1–W56 · 56 Minggu
    </div>
    <div class="ph-name">Semua Fase — Grand Total Protocol</div>
    <div class="ph-desc">Overview keseluruhan 3 fase · 56 minggu · ${totalCpds} compounds aktif</div>
    <div class="ph-grid">
      <div class="ph-stat"><div class="ph-stat-l">Total Minggu</div><div class="ph-stat-v">56</div></div>
      <div class="ph-stat"><div class="ph-stat-l">Grand Total</div><div class="ph-stat-v" style="color:var(--acc)">${rpM(grandTotal)}</div></div>
      <div class="ph-stat"><div class="ph-stat-l">Compounds</div><div class="ph-stat-v">${totalCpds}</div></div>
      <div class="ph-stat"><div class="ph-stat-l">F1 Cost</div><div class="ph-stat-v" style="color:var(--f1)">${rpM(pCost(1))}</div></div>
      <div class="ph-stat"><div class="ph-stat-l">F2 Cost</div><div class="ph-stat-v" style="color:var(--f2)">${rpM(pCost(2))}</div></div>
      <div class="ph-stat"><div class="ph-stat-l">F3 Cost</div><div class="ph-stat-v" style="color:var(--f3)">${rpM(pCost(3))}</div></div>
      <div class="ph-stat"><div class="ph-stat-l">Total Vials</div><div class="ph-stat-v">${totalVials}</div></div>
      <div class="ph-stat"><div class="ph-stat-l">W Range</div><div class="ph-stat-v">W1–W56</div></div>
      <div class="ph-stat"><div class="ph-stat-l">Target</div><div class="ph-stat-v">79.5→57kg</div></div>
    </div>
    <div class="ph-bar"><div class="ph-bar-fill" style="width:100%;background:linear-gradient(90deg,var(--f1) 0%,var(--f2) 50%,var(--f3) 100%)"></div></div>
  </div>`;

  const phaseCards=PHASES.map(p=>{
    const c=pCost(p.id),pct=Math.round(c/max*100),sel=S.ph===p.id;
    const acv=COMPOUNDS.filter(cx=>(cx.c[`f${p.id}`]?.cost||0)>0).length;
    const tv=COMPOUNDS.reduce((a,cx)=>a+(cx.c[`f${p.id}`]?.v||0),0);
    return `<div class="ph-card${sel?' '+p.selCls:''}" onclick="setPhase(${p.id})">
      <div class="ph-tag" style="color:${p.col}">
        <div class="ph-dot" style="background:${p.col}"></div>
        ${p.cls.toUpperCase()} · ${p.bf}
      </div>
      <div class="ph-name">${p.name} — ${p.label}</div>
      <div class="ph-desc">${p.desc}</div>
      <div class="ph-grid">
        <div class="ph-stat"><div class="ph-stat-l">Minggu</div><div class="ph-stat-v">${p.wk}</div></div>
        <div class="ph-stat"><div class="ph-stat-l">Biaya</div><div class="ph-stat-v" style="color:${p.col}">${rpM(c)}</div></div>
        <div class="ph-stat"><div class="ph-stat-l">Active Cpd</div><div class="ph-stat-v">${acv}</div></div>
        <div class="ph-stat"><div class="ph-stat-l">Defisit</div><div class="ph-stat-v">${p.defisit}</div></div>
        <div class="ph-stat"><div class="ph-stat-l">Vials</div><div class="ph-stat-v">${tv}</div></div>
        <div class="ph-stat"><div class="ph-stat-l">W Range</div><div class="ph-stat-v">W${p.wS}–${p.wE}</div></div>
      </div>
      <div class="ph-bar"><div class="ph-bar-fill" style="width:${pct}%;background:${p.col}"></div></div>
    </div>`;
  }).join('');

  document.getElementById('phase-row').innerHTML=allCard+phaseCards;
}
window.renderPhaseRow = renderPhaseRow;

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

// ── SET PHASE / TAB ──
function setPhase(n){S.ph=n;renderPhaseRow();renderPanels();}
function setTab(n){S.tab=n;renderNav();renderPanels();}
window.setPhase = setPhase;
window.setTab = setTab;

// ── BUDGET HELPERS ──
function toggleBudSel(n){S.budSel.has(n)?S.budSel.delete(n):S.budSel.add(n);saveBudgetToDB();renderPanels();}
async function switchBudPhase(ph){S.budPh=ph;await loadBudgetFromDB(ph);renderPanels();}
function toggleCat(k){
  if(S.filterCats.has(k)){if(S.filterCats.size>1)S.filterCats.delete(k);}
  else S.filterCats.add(k);
  renderPanels();
}
window.toggleBudSel = toggleBudSel;
window.switchBudPhase = switchBudPhase;
window.toggleCat = toggleCat;

// ── DOWNLOAD ──
function dlPage(){
  const a=document.createElement('a');
  a.download='peptide_master_v3.html';
  a.href='data:text/html;charset=utf-8,'+encodeURIComponent(document.documentElement.outerHTML);
  a.click();
}
window.dlPage = dlPage;

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
  const phase=PHASES.find(p=>week>=p.wS&&week<=p.wE)||null;
  const weekStart=new Date(PROTOCOL_START.getTime()+(week-1)*7*24*60*60*1000);
  const weekEnd=new Date(weekStart.getTime()+6*24*60*60*1000);

  const nextWeekMs=weekEnd-now+1000;
  const hrs=Math.floor((nextWeekMs%(1000*60*60*24))/(1000*60*60));
  const mins=Math.floor((nextWeekMs%(1000*60*60))/(1000*60));
  const secs=Math.floor((nextWeekMs%(1000*60))/1000);

  return{belumMulai:false,week,dayOfWeek,phase,hrs,mins,secs,totalDays,done:week>56};
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

  const phaseCol=t.phase?.col||'var(--acc)';
  el.innerHTML=`
    <div style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:800;color:${phaseCol}">W${t.week}</div>
    <div style="width:1px;height:20px;background:var(--bdr)"></div>
    <div style="font-size:11px;font-weight:700;color:${phaseCol}">${t.phase?.name||'—'} · Hari ${t.dayOfWeek}</div>
    <div style="width:1px;height:20px;background:var(--bdr)"></div>
    <div style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--t2)">${String(t.hrs).padStart(2,'0')}:${String(t.mins).padStart(2,'0')}:<span style="color:var(--warn)">${String(t.secs).padStart(2,'0')}</span></div>`;

  if(S.currentWeek!==t.week){S.currentWeek=t.week;renderPanels();}
}
window.renderTimer = renderTimer;

// ── MODAL EVENT LISTENERS ──
document.getElementById('auth-modal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeAuthModal();});
document.getElementById('dose-modal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeDoseModal();});
document.getElementById('cmp-edit-modal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeCmpEdit();});

// ── AUTH LISTENER ──
try { setupAuthListener(); } catch(e){ console.error('setupAuthListener:',e); }

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

// ── INIT ──
(async () => {
  const errs = [];
  try { await loadAllPepData(); } catch(e){ errs.push('loadAllPepData: '+(e.message||e)); }
  try { window._quarters = await loadQuartersFromDB(); } catch(e){ errs.push('loadQuarters: '+(e.message||e)); window._quarters=[]; }
  setInterval(renderTimer,1000);
  renderTimer();
  renderPhaseRow();
  renderNav();
  renderPanels();
  if(errs.length) showInitError(errs.join('\n'));
})();
