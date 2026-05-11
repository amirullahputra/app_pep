// ══════════════════════════════════════════════════════════
// PANELS
// ══════════════════════════════════════════════════════════
import { PHASES, CAT, COMPOUNDS, SC, SP, MECHS, VSPECS, REDUNDANCY, SHELF_LIFE } from './data.js?v=21';
import {
  S, DM, _dmAllNames, dmDealt,
  rp, rpM, totCost, totVials,
  scCol, scSpill, stLabel, getPrio, budEff, sportScore, getConflicts,
  customDoses, inventoryCache, reconCache, getDose, isCustomDose,
  vialsConsumedRange, weeksUntilEmpty, invStatus,
  _lastSuggested,
  QUARTERS, quarterLabel, quarterFromWeek, weeksInQuarter, costForQuarter, quarterCost, quarterDateRange,
  parseCycleText, parseWeeklyTotal, tlCellStatus, tlDoseForWeek, tlVialSummary, tlGetCycle
} from './state.js?v=21';
import { saveBudgetToDB, saveCompoundEdit, loadAllPepData } from './supabase.js?v=21';

// mutable reference to _lastSuggested and _dmAllNames via state module
import * as stateModule from './state.js?v=21';

// ──────────────────────────────────────────
// P0 — OVERVIEW
// ──────────────────────────────────────────
export function pOverview(){
  if(!COMPOUNDS.length) return `<div class="card" style="padding:2rem;text-align:center;color:var(--t3)">⏳ Memuat data...</div>`;
  const qid = S.quarter || QUARTERS[0];
  const qLabel = quarterLabel(qid);

  // Tanggal aktual dari W1 = 6 Juli 2026
  const PROTOCOL_START_LOCAL = new Date('2026-07-06T00:00:00');
  const weekToDate = (w) => {
    const d = new Date(PROTOCOL_START_LOCAL);
    d.setDate(d.getDate()+(w-1)*7);
    return d;
  };
  const fmtDate = (d) => d.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'});

  const cw = S.currentWeek;
  const cwQuarter = quarterFromWeek(cw);
  const cwStart = weekToDate(cw);
  const cwEnd = new Date(cwStart); cwEnd.setDate(cwEnd.getDate()+6);

  const dealt = dmDealt();   // Set compound names di quarter aktif
  const dealtFilter = dealt.size > 0 ? (c => dealt.has(c.name)) : (()=>true);

  const activeThisWeek = COMPOUNDS.filter(c => {
    const dose = getDose(c.name, cw);
    return dose != null && dose > 0 && dealtFilter(c);
  }).map(c => ({...c, dose:getDose(c.name,cw), unit:VSPECS[c.name]?.unit||'mg', prio:getPrio(c.name,qid)}))
    .sort((a,b) => b.prio-a.prio);

  // Week card — dose minggu ini
  const weekCard = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:6px">
        <button onclick="if(S.currentWeek>1){S.currentWeek--;renderPanels();}" style="width:26px;height:26px;border-radius:6px;border:1.5px solid var(--bdr2);background:var(--bg2);cursor:pointer;font-size:14px;font-weight:700;color:var(--t1);flex-shrink:0">‹</button>
        <div style="text-align:center">
          <div style="font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:800;color:var(--t0);line-height:1">W${cw}</div>
          <div style="font-size:9px;color:var(--t3);white-space:nowrap">${fmtDate(cwStart)} — ${fmtDate(cwEnd)}</div>
        </div>
        <button onclick="if(S.currentWeek<56){S.currentWeek++;renderPanels();}" style="width:26px;height:26px;border-radius:6px;border:1.5px solid var(--bdr2);background:var(--bg2);cursor:pointer;font-size:14px;font-weight:700;color:var(--t1);flex-shrink:0">›</button>
      </div>
      <div style="flex:1;padding-left:8px;border-left:1px solid var(--bdr)">
        <div style="font-size:11px;font-weight:800;color:var(--acc)">${cwQuarter ? quarterLabel(cwQuarter) : '— pre-protocol'}</div>
        <div style="font-size:10px;color:var(--t2)">Week ${cw} dari 56</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:800;color:var(--acc)">${activeThisWeek.length}</div>
        <div style="font-size:9px;color:var(--t2)">compound aktif</div>
      </div>
    </div>
    <div style="height:1px;background:var(--bdr);margin-bottom:8px"></div>
    ${activeThisWeek.length === 0
      ? '<div style="text-align:center;padding:20px;color:var(--t3);font-size:12px">Tidak ada compound aktif minggu ini</div>'
      : activeThisWeek.map(c => {
          const st = stLabel(c.prio);
          const isCustom = isCustomDose(c.name, cw);
          return `<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--bdr)">
            <span class="lb ${CAT[c.cat].cls}" style="font-size:8px;flex-shrink:0;width:62px;text-align:center">${CAT[c.cat].n}</span>
            <div style="flex:1;font-size:11px;font-weight:700;color:var(--t0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.name}${isCustom?'<span style="color:var(--hor);font-size:9px;margin-left:3px">✎</span>':''}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--t0);flex-shrink:0;width:60px;text-align:right">${c.dose}${c.unit}</div>
            <span class="status-pill ${st.cls}" style="font-size:8px;flex-shrink:0;width:58px;text-align:center">${st.l}</span>
          </div>`;
        }).join('')
    }`;

  // Biaya per kategori (quarter aktif, dari DM-selected only)
  const cc = {}; Object.keys(CAT).forEach(k => cc[k] = 0);
  COMPOUNDS.filter(dealtFilter).forEach(c => {
    cc[c.cat] += costForQuarter(c.name, qid).cost;
  });
  const mxcc = Math.max(...Object.values(cc), 1);
  const catBars = Object.entries(cc).filter(([,v]) => v > 0).map(([k,v]) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span class="lb ${CAT[k].cls}" style="font-size:8px;min-width:62px;text-align:center;flex-shrink:0">${CAT[k].n}</span>
      <div style="flex:1;height:16px;background:var(--bg3);border-radius:4px;overflow:hidden">
        <div style="width:${v/mxcc*100}%;height:100%;background:${CAT[k].col};border-radius:4px"></div>
      </div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--t1);flex-shrink:0;min-width:68px;text-align:right">${rpM(v)}</div>
    </div>`).join('') || '<div style="color:var(--t3);font-size:11px;padding:10px 0">Belum ada compound dipilih di Decision Matrix untuk quarter ini</div>';

  // Compound list aktif di quarter (sorted by prio)
  const quarterActive = [...COMPOUNDS]
    .filter(dealtFilter)
    .map(c => ({ ...c, prio: getPrio(c.name, qid) }))
    .sort((a,b) => b.prio - a.prio);
  const maxPrio = quarterActive[0]?.prio || 100;

  // Recap vial untuk quarter
  const vialRecap = quarterActive.map(c => {
    const r = costForQuarter(c.name, qid);
    return { name: c.name, cat: c.cat, vials: r.vials, cost: r.cost };
  }).filter(r => r.vials > 0).sort((a,b) => b.vials - a.vials);
  const maxV = Math.max(1, ...vialRecap.map(r => r.vials));
  const totalV = vialRecap.reduce((a,r) => a + r.vials, 0);
  const totalCost = vialRecap.reduce((a,r) => a + r.cost, 0);

  return `
  <div class="grid2" style="margin-bottom:12px">
    <div class="card">
      <div class="card-title"><span class="ico">💉</span> Compound Aktif Minggu Ini · W${cw}</div>
      ${weekCard}
    </div>
    <div class="card">
      <div class="card-title"><span class="ico">📊</span> Biaya per Kategori — ${qLabel}</div>
      ${catBars}
    </div>
  </div>
  <div class="grid2">
    <div class="card">
      <div class="card-title"><span class="ico">🏆</span> Compound Selected — ${qLabel} (${quarterActive.length} aktif)</div>
      ${quarterActive.length === 0
        ? '<div style="color:var(--t3);font-size:11px;padding:14px 0;text-align:center">Belum ada compound dipilih untuk quarter ini. <button onclick="setTab(2)" style="background:var(--acc);color:#fff;border:none;border-radius:5px;padding:5px 12px;font-weight:700;cursor:pointer;margin-left:8px">Buka Decision Matrix →</button></div>'
        : quarterActive.map((c,i) => { const st = stLabel(c.prio); return `
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
            <div style="font-size:9px;color:var(--t3);width:14px;flex-shrink:0;text-align:right">${i+1}</div>
            <span class="lb ${CAT[c.cat].cls}" style="font-size:8px;flex-shrink:0;width:62px;text-align:center">${CAT[c.cat].n}</span>
            <div style="font-size:11px;font-weight:700;color:var(--t0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;width:110px">${c.name}</div>
            <div style="flex:1;height:14px;background:var(--bg3);border-radius:3px;overflow:hidden">
              <div style="width:${Math.round(c.prio/maxPrio*100)}%;height:100%;background:${scCol(c.prio)};border-radius:3px"></div>
            </div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:${scCol(c.prio)};flex-shrink:0;width:26px;text-align:right">${c.prio}</div>
            <span class="status-pill ${st.cls}" style="font-size:8px;flex-shrink:0;width:58px;text-align:center">${st.l}</span>
          </div>`; }).join('')
      }
    </div>
    <div class="card">
      <div class="card-title"><span class="ico">📦</span> Kebutuhan Vial — ${qLabel}</div>
      ${vialRecap.length === 0
        ? '<div style="color:var(--t3);font-size:11px;padding:14px 0">Tidak ada vial dibutuhkan untuk quarter ini.</div>'
        : vialRecap.map(r => `<div class="srow">
            <div class="srow-lbl" style="width:130px"><span class="lb ${CAT[r.cat].cls}" style="font-size:8px">${CAT[r.cat].n}</span> ${r.name}</div>
            <div class="srow-bar"><div class="srow-fill" style="width:${r.vials/maxV*100}%;background:${CAT[r.cat].col}"></div></div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--t1);min-width:55px;text-align:right">${r.vials} vial</div>
          </div>`).join('') + `<div style="border-top:2px solid var(--bdr2);margin-top:8px;padding-top:8px;display:flex;justify-content:space-between">
            <span style="font-size:11px;font-weight:800;color:var(--t1)">Total Cost: <span style="font-family:'JetBrains Mono',monospace;color:var(--acc)">${rpM(totalCost)}</span></span>
            <span style="font-size:11px;font-weight:800;color:var(--t1)">Total: <span style="font-family:'JetBrains Mono',monospace;color:var(--acc)">${totalV} vial</span></span>
          </div>`
      }
    </div>
  </div>`;
}

// ──────────────────────────────────────────
// P1 — DECISION MATRIX
// ──────────────────────────────────────────
function dmData(ph){
  const isAll=ph===0;
  const activePh=isAll?1:ph;
  return COMPOUNDS.map(c=>{
    const prio=isAll
      ?Math.round((getPrio(c.name,1)+getPrio(c.name,2)+getPrio(c.name,3))/3)
      :getPrio(c.name,activePh);
    const cur=SC[c.name]?.[`f${activePh}`]||{p:0};
    const st=stLabel(cur.p);
    const cost=isAll?totCost(c):(c.c[`f${activePh}`]?.cost||0);
    const eff=isAll?Math.round((budEff(c.name,1)+budEff(c.name,2)+budEff(c.name,3))/3):budEff(c.name,activePh);
    const ss=sportScore(c.name);
    const p1=getPrio(c.name,1),p2=getPrio(c.name,2),p3=getPrio(c.name,3);
    return{name:c.name,cat:c.cat,prio,st,cost,eff,ss,p1,p2,p3};
  });
}

function dmApplyFilters(rows){
  return rows.filter(r=>{
    if(DM.filterLayer!=='all'&&r.cat!==DM.filterLayer)return false;
    if(DM.filterStatus!=='all'&&r.st.l!==DM.filterStatus)return false;
    if(DM.filterSport!=='all'){
      if(DM.filterSport==='hi'&&r.ss<60)return false;
      if(DM.filterSport==='mid'&&(r.ss<40||r.ss>=60))return false;
      if(DM.filterSport==='lo'&&r.ss>=40)return false;
    }
    if(DM.filterEff!=='all'){
      if(DM.filterEff==='hi'&&r.eff<10)return false;
      if(DM.filterEff==='mid'&&(r.eff<5||r.eff>=10))return false;
      if(DM.filterEff==='lo'&&r.eff>=5)return false;
    }
    return true;
  });
}

function dmSort(rows){
  return[...rows].sort((a,b)=>{
    let va=a[DM.sortCol],vb=b[DM.sortCol];
    if(typeof va==='string')return DM.sortDir*(va.localeCompare(vb));
    return DM.sortDir*(vb-va);
  });
}

export function dmSortBy(col){
  if(DM.sortCol===col)DM.sortDir*=-1;
  else{DM.sortCol=col;DM.sortDir=-1;}
  window.renderPanels();
}

// dmPush: geser stage compound satu langkah maju. Kalau sudah 'deal', klik lagi → hapus dari pipeline
export function dmPush(name){
  const cur=DM.stages.get(name)||null;
  if(cur===null)DM.stages.set(name,'watchlist');
  else if(cur==='watchlist')DM.stages.set(name,'tentatif');
  else if(cur==='tentatif')DM.stages.set(name,'deal');
  else DM.stages.delete(name); // deal → keluar pipeline
  window.renderPanels();
}

export function dmSetStage(name,stage){
  if(!stage)DM.stages.delete(name);
  else DM.stages.set(name,stage);
  window.renderPanels();
}

export function dmToggle(name){dmPush(name);}
export function dmToggleAll(){
  const allIn=stateModule._dmAllNames.every(n=>DM.stages.has(n));
  stateModule._dmAllNames.forEach(n=>allIn?DM.stages.delete(n):(!DM.stages.has(n)&&DM.stages.set(n,'watchlist')));
  window.renderPanels();
}

export function dmSetFilter(key,val){DM[key]=val;window.renderPanels();}
export function dmUpdateSummary(){window.renderPanels();}

// ── pDecision — Drag-Drop Builder (Library + Selected zone per quarter) ──
export function pDecision(){
  const qid = S.quarter;

  if(!qid){
    return `<div class="card">
      <div class="card-title"><span class="ico">🎯</span> Decision Matrix</div>
      <div class="dm-phase-prompt">Pilih Quarter di atas untuk mulai edit decision matrix.</div>
    </div>`;
  }

  const selectedSet = DM.selectedByQuarter[qid] || new Set();
  const showSeedBanner = DM.seedBanner[qid];
  const qLabel = quarterLabel(qid);

  // Schema v2: sport_*/score_*/doses_jsonb dropped. Card cuma tampilkan
  // nama + category color. Cost preview disabled sampai dose schedule
  // di-input via Timeline tab.
  const compoundCard = (c, source) => {
    const inLib = source === 'library';
    const inSelected = source === 'selected';
    const isSelected = selectedSet.has(c.name);
    const dimClass = inLib && isSelected ? ' in-stage' : '';
    const clickHandler = inLib
      ? `onclick="dmToggleSelect('${c.name.replace(/'/g,"\\'")}')"`
      : '';
    const removeBtn = inSelected
      ? `<button class="dm-card-remove" onclick="dmRemoveStage('${c.name.replace(/'/g,"\\'")}')" title="Hapus dari selected">✕</button>`
      : '';
    return `<div class="dm-card${dimClass}"
      draggable="true"
      ${clickHandler}
      ondragstart="onDmDragStart(event,'${c.name.replace(/'/g,"\\'")}','${source}')">
      <div class="dm-card-name" title="${c.name}">${c.name}</div>
      <div class="dm-card-meta">
        <span class="dm-cat-pill ${c.cat}">${(CAT[c.cat]?.n||c.cat).slice(0,3)}</span>
        ${removeBtn}
      </div>
    </div>`;
  };

  // ── LIBRARY (kiri 30%) — alphabetical sort ──
  const search = (DM.libSearch || '').toLowerCase();
  const filterLayer = DM.filterLayer || 'all';
  const filteredLibrary = COMPOUNDS.filter(c => {
    if(filterLayer !== 'all' && c.cat !== filterLayer) return false;
    if(search && !c.name.toLowerCase().includes(search)) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));

  const layerChips = ['all', ...Object.keys(CAT)].map(k => {
    const lbl = k === 'all' ? 'Semua' : (CAT[k]?.n || k);
    const active = filterLayer === k;
    return `<button class="dm-lib-chip${active?' act':''}" onclick="DM.filterLayer='${k}';renderPanels()">${lbl}</button>`;
  }).join('');

  const libraryHtml = `
    <div class="dm-lib">
      <div class="dm-lib-hdr">📚 Library <span style="font-size:9px;font-weight:600;color:var(--t3);margin-left:auto">${filteredLibrary.length}/${COMPOUNDS.length}</span></div>
      <input class="dm-lib-search" type="search" placeholder="🔍 Cari compound..." value="${DM.libSearch||''}"
        oninput="DM.libSearch=this.value;renderPanels()">
      <div class="dm-lib-filters">${layerChips}</div>
      ${filteredLibrary.length === 0
        ? '<div class="dm-zone-empty">Tidak ada match</div>'
        : filteredLibrary.map(c => compoundCard(c, 'library')).join('')
      }
    </div>`;

  // ── SELECTED ZONE (kanan 70%) — single drop zone, alphabetical sort ──
  const selectedCompounds = [...selectedSet]
    .map(n => COMPOUNDS.find(x => x.name === n))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  const selectedHtml = `
    <div class="dm-zone selected-zone"
      ondragover="onDmDragOver(event)"
      ondragleave="onDmDragLeave(event)"
      ondrop="onDmDrop(event)">
      <div class="dm-zone-hdr">
        <span>✅ Selected for ${qLabel}</span>
        <span class="dm-zone-cnt">${selectedCompounds.length}</span>
      </div>
      ${selectedCompounds.length === 0
        ? `<div class="dm-zone-empty">Drag compound dari Library ke sini, atau klik card di library untuk add.</div>`
        : selectedCompounds.map(c => compoundCard(c, 'selected')).join('')
      }
    </div>`;

  const seedBannerHtml = showSeedBanner ? `
    <div class="dm-seed-banner">
      <span style="flex:1">💡 Auto-seeded compounds dengan sport score ≥60. Edit sesuai kebutuhan.</span>
      <button onclick="DM.seedBanner['${qid}']=false;renderPanels()">Tutup</button>
    </div>` : '';

  return `
  <div class="card">
    <div class="card-title"><span class="ico">🎯</span> Decision Matrix — ${qLabel}</div>
    ${seedBannerHtml}
    <div class="dm-2col">
      ${libraryHtml}
      ${selectedHtml}
    </div>
    <div class="note" style="margin-top:12px">Drag compound dari Library ke Selected, atau klik card library untuk toggle add/remove. Klik ✕ di Selected untuk kembalikan ke library. Compound Selected otomatis masuk Vial Planner.</div>
  </div>`;
}


// ──────────────────────────────────────────
// P2 — VIAL / INVENTORY TRACKER
// ──────────────────────────────────────────
export function pVial(){
  const curWeek=S.currentWeek||1;
  const qid = S.quarter || QUARTERS[0];
  const today=new Date();
  const vt=S.vialTab||'stok';

  // ── FILTER BY pipeline (tentatif + deal dari Decision Matrix) ──
  const dealtNames=dmDealt();
  const dealtCpds=dealtNames.size>0?COMPOUNDS.filter(c=>dealtNames.has(c.name)):COMPOUNDS;
  const noDeal=dealtNames.size===0;

  // ── SUMMARY COUNTS (hanya dari yang di-deal) ──
  const emptyCount=dealtCpds.filter(c=>(inventoryCache[c.name]?.qty||0)===0).length;
  const orderCount=dealtCpds.filter(c=>{const inv=inventoryCache[c.name]||{qty:0,safetyStock:5};return inv.qty>0&&inv.qty<=inv.safetyStock;}).length;
  const okCount=dealtCpds.length-emptyCount-orderCount;
  const expiringSoonCount=dealtCpds.filter(c=>(reconCache[c.name]||[]).some(r=>{const d=Math.ceil((r.expiredAt-today)/(1000*60*60*24));return d>0&&d<=7;})).length;
  const expiredCount=dealtCpds.filter(c=>(reconCache[c.name]||[]).some(r=>r.expiredAt<=today)).length;
  const hasReconCount=dealtCpds.filter(c=>(reconCache[c.name]||[]).some(r=>r.expiredAt>today)).length;

  // ── SUMMARY BAR ──
  const summaryBar=`
  <div style="font-size:10px;color:var(--t3);margin-bottom:6px">
    ${noDeal
      ?'Menampilkan semua compound — centang di Decision Matrix untuk filter'
      :`Dari <b style="color:var(--t1)">${dealtCpds.length} compound</b> yang di-deal di Decision Matrix`}
  </div>
  <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
    <div class="card" style="flex:1;min-width:80px;text-align:center;padding:10px 8px;border-top:3px solid var(--f3)">
      <div style="font-size:24px;font-weight:800;font-family:'JetBrains Mono',monospace;color:var(--f3)">${okCount}</div>
      <div style="font-size:10px;color:var(--t2);font-weight:700">AMAN</div>
    </div>
    <div class="card" style="flex:1;min-width:80px;text-align:center;padding:10px 8px;border-top:3px solid var(--f2)">
      <div style="font-size:24px;font-weight:800;font-family:'JetBrains Mono',monospace;color:var(--f2)">${orderCount}</div>
      <div style="font-size:10px;color:var(--t2);font-weight:700">ORDER</div>
    </div>
    <div class="card" style="flex:1;min-width:80px;text-align:center;padding:10px 8px;border-top:3px solid var(--warn)">
      <div style="font-size:24px;font-weight:800;font-family:'JetBrains Mono',monospace;color:var(--warn)">${emptyCount}</div>
      <div style="font-size:10px;color:var(--t2);font-weight:700">KOSONG</div>
    </div>
    <div style="width:1px;background:var(--bdr);flex-shrink:0"></div>
    <div class="card" style="flex:1;min-width:80px;text-align:center;padding:10px 8px;border-top:3px solid #7c3aed">
      <div style="font-size:24px;font-weight:800;font-family:'JetBrains Mono',monospace;color:#7c3aed">${hasReconCount}</div>
      <div style="font-size:10px;color:var(--t2);font-weight:700">AKTIF REKON</div>
    </div>
    <div class="card" style="flex:1;min-width:80px;text-align:center;padding:10px 8px;border-top:3px solid var(--f2)">
      <div style="font-size:24px;font-weight:800;font-family:'JetBrains Mono',monospace;color:var(--f2)">${expiringSoonCount}</div>
      <div style="font-size:10px;color:var(--t2);font-weight:700">EXP ≤7H</div>
    </div>
    <div class="card" style="flex:1;min-width:80px;text-align:center;padding:10px 8px;border-top:3px solid var(--warn)">
      <div style="font-size:24px;font-weight:800;font-family:'JetBrains Mono',monospace;color:var(--warn)">${expiredCount}</div>
      <div style="font-size:10px;color:var(--t2);font-weight:700">EXPIRED</div>
    </div>
  </div>`;

  // ── DOSE SCHEDULE BANNER (schema v2 — doses_jsonb dropped) ──
  const doseSchedBanner = `
  <div class="conflict-banner cb-warn" style="margin-bottom:12px">
    <div class="cb-ico">⏳</div>
    <div>
      <div class="cb-title">Forecast vial pakai dose schedule yang belum di-input</div>
      <div style="font-size:11px;color:var(--t1)">Schema v2: dose per-week akan di-input manual via tab <b>Timeline</b> (UI sedang di-build). Sampai itu, kolom "weeks until empty" dan "vial needed forecast" akan tampil 0/—. Inventory manual tracking di tab Stok/Rekon tetap jalan normal.</div>
    </div>
  </div>`;

  // ── TAB SWITCHER ──
  const noDealBanner=noDeal?`
  <div class="note" style="margin-bottom:12px;border-left:3px solid var(--f2);background:var(--warn-bg)">
    <span style="font-weight:800;color:var(--f2)">Belum ada compound yang di-deal.</span>
    Pergi ke tab <b>Decision Matrix</b>, centang compound yang mau dipakai — list di sini otomatis mengikuti.
  </div>`:'';

  const tabBar=`
  ${noDealBanner}
  <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;flex-wrap:wrap">
    <button onclick="S.vialTab='stok';renderPanels()" style="padding:8px 20px;border-radius:8px;border:2px solid ${vt==='stok'?'var(--acc)':'var(--bdr)'};background:${vt==='stok'?'var(--acc)':'var(--bg2)'};color:${vt==='stok'?'#fff':'var(--t1)'};font-weight:800;font-size:12px;cursor:pointer">
      📦 Stok Lyophilized
    </button>
    <button onclick="S.vialTab='rekon';renderPanels()" style="padding:8px 20px;border-radius:8px;border:2px solid ${vt==='rekon'?'#7c3aed':'var(--bdr)'};background:${vt==='rekon'?'#7c3aed':'var(--bg2)'};color:${vt==='rekon'?'#fff':'var(--t1)'};font-weight:800;font-size:12px;cursor:pointer">
      🧪 Reconstituted Vials
    </button>
    ${!noDeal?`<div style="font-size:10px;color:var(--t3);margin-left:4px">${dealtCpds.length} compound dari Decision Matrix</div>`:''}
  </div>`;

  // ── TAB 1: STOK LYOPHILIZED ──
  const sortedStok=[...dealtCpds].sort((a,b)=>{
    const rank={ORDER:0,KOSONG:1,AMAN:2};
    return(rank[invStatus(a.name).label]||2)-(rank[invStatus(b.name).label]||2);
  });

  const stokRows=sortedStok.map(c=>{
    const vs=VSPECS[c.name]||{vPrice:0,label:'—',vSize:1,unit:'mg'};
    const inv=inventoryCache[c.name]||{qty:0,safetyStock:5};
    const st=invStatus(c.name);
    const tv=totVials(c);
    const consumed=vialsConsumedRange(c,1,curWeek-1);
    const remaining=Math.max(0,tv-consumed);
    const wte=weeksUntilEmpty(c,curWeek);
    const wteLabel=inv.qty===0?'—':(wte>=56-curWeek+1?'Cukup s/d akhir':`~W${curWeek+wte}`);
    const wteCol=inv.qty===0?'var(--t3)':wte<4?'var(--warn)':wte<8?'var(--f2)':'var(--f3)';
    const needTotal=Math.max(remaining,1);
    const haveRatio=Math.min(1,inv.qty/needTotal);
    const ssRatio=Math.min(1,inv.safetyStock/needTotal);

    return`<tr onclick="openInvEdit('${c.name}')" style="cursor:pointer">
      <td><span class="lb ${CAT[c.cat].cls}">${CAT[c.cat].n}</span></td>
      <td>
        <div style="font-size:13px;font-weight:700;color:var(--t0)">${c.name}</div>
        <div style="font-size:10px;color:var(--t3)">${vs.label}</div>
      </td>
      <td class="c">
        <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:800;background:${st.col}22;color:${st.col};border:1px solid ${st.col}44">${st.label}</span>
      </td>
      <td class="c">
        <div style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:800;color:${st.col}">${inv.qty}</div>
        <div style="font-size:9px;color:var(--t3)">vial on hand</div>
      </td>
      <td class="c">
        <div style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--t2)">${inv.safetyStock}</div>
        <div style="font-size:9px;color:var(--t3)">min order</div>
      </td>
      <td>
        <div style="width:100%;height:8px;border-radius:4px;background:var(--bg3);position:relative;overflow:hidden;margin-bottom:3px">
          <div style="position:absolute;left:0;top:0;height:100%;width:${Math.round(haveRatio*100)}%;background:${st.col};border-radius:4px"></div>
          <div style="position:absolute;left:${Math.round(ssRatio*100)}%;top:0;height:100%;width:2px;background:var(--f2);opacity:.9"></div>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="font-size:9px;color:var(--t3)">sisa butuh ${remaining}v</span>
          <span style="font-size:9px;color:var(--t3)">protokol ${tv}v</span>
        </div>
      </td>
      <td>
        <div style="font-size:11px;font-weight:700;color:${wteCol}">${wteLabel}</div>
        <div style="font-size:9px;color:var(--t3)">${rp(vs.vPrice)}/vial</div>
      </td>
    </tr>`;
  }).join('');

  const stokPanel=`
  <div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div class="card-title" style="margin:0">📦 Stok Lyophilized — Vial Mentah On Hand</div>
      <div style="font-size:10px;color:var(--t3)">Klik baris untuk edit stok</div>
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr style="position:sticky;top:0;background:var(--bg1);z-index:2">
          <th>Layer</th>
          <th>Compound</th>
          <th class="c">Status</th>
          <th class="c">Stok (vial)</th>
          <th class="c">Min Order</th>
          <th>Stok vs Kebutuhan Protokol</th>
          <th>Estimasi Habis</th>
        </tr></thead>
        <tbody>${stokRows}</tbody>
      </table>
    </div>
    <div class="note" style="margin-top:8px">
      Bar hijau = stok saat ini · Garis kuning = safety stock · <span style="color:var(--f3);font-weight:700">AMAN</span> stok > min order · <span style="color:var(--f2);font-weight:700">ORDER</span> stok ≤ min order · <span style="color:var(--warn);font-weight:700">KOSONG</span> = 0 vial
    </div>
  </div>`;

  // ── TAB 2: RECONSTITUTED ──
  const allReconRows=dealtCpds.map(c=>{
    const sl=SHELF_LIFE[c.name];
    const shelfDays=sl?.shelf||null;
    const shelfLabel=shelfDays?`${shelfDays} hari`:(sl?'Oral/Kapsul':'—');
    const shelfCol=shelfDays?(shelfDays<=21?'var(--warn)':shelfDays<=30?'var(--f2)':'var(--f3)'):'var(--t3)';
    const reconList=reconCache[c.name]||[];
    const activeRecon=reconList.filter(r=>r.expiredAt>today);
    const expiredRecon=reconList.filter(r=>r.expiredAt<=today);
    const totalQty=activeRecon.reduce((a,r)=>a+r.qty,0);
    const nearestExp=activeRecon.length?activeRecon.reduce((a,r)=>r.expiredAt<a.expiredAt?r:a,activeRecon[0]):null;
    const daysLeft=nearestExp?Math.ceil((nearestExp.expiredAt-today)/(1000*60*60*24)):null;
    const expCol=daysLeft===null?'var(--t3)':daysLeft<=3?'var(--warn)':daysLeft<=7?'var(--f2)':'var(--f3)';

    // detail rows per batch
    const batchRows=reconList.map(r=>{
      const dl=Math.ceil((r.expiredAt-today)/(1000*60*60*24));
      const bc=r.expiredAt<=today?'var(--warn)':dl<=3?'var(--warn)':dl<=7?'var(--f2)':'var(--f3)';
      const expFmt=r.expiredAt.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'});
      const reconFmt=r.reconDate.toLocaleDateString('id-ID',{day:'numeric',month:'short'});
      const statusTxt=r.expiredAt<=today?'EXPIRED':dl<=3?`${dl}h lagi!`:dl<=7?`${dl}h lagi`:`${dl}h lagi`;
      return`<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--bdr)">
        <div style="font-size:9px;color:var(--t3);flex-shrink:0;width:70px">${reconFmt}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:var(--t0);flex-shrink:0;width:40px">${r.qty}v</div>
        <div style="flex:1;font-size:9px;color:var(--t3)">${r.notes||'—'}</div>
        <div style="font-size:9px;font-weight:700;color:${bc};flex-shrink:0">Exp: ${expFmt} · <span style="font-weight:800">${statusTxt}</span></div>
        <button onclick="event.stopPropagation();deleteReconVial('${r.id}','${c.name}')" style="padding:2px 7px;border-radius:4px;border:1px solid var(--warn-bdr);background:var(--warn-bg);color:var(--warn);font-size:9px;font-weight:700;cursor:pointer;flex-shrink:0">Hapus</button>
      </div>`;
    }).join('');

    return`<tr>
      <td style="vertical-align:top;padding-top:10px"><span class="lb ${CAT[c.cat].cls}">${CAT[c.cat].n}</span></td>
      <td style="vertical-align:top;padding-top:10px">
        <div style="font-size:13px;font-weight:700;color:var(--t0)">${c.name}</div>
        <div style="font-size:10px;color:${shelfCol};font-weight:700">${shelfLabel}</div>
        <div style="font-size:9px;color:var(--t3);margin-top:1px">${sl?.timing||'—'}</div>
      </td>
      <td class="c" style="vertical-align:top;padding-top:10px">
        ${activeRecon.length===0
          ?`<div style="font-size:10px;color:var(--t3)">—</div>`
          :`<div style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:800;color:${expCol}">${totalQty}</div>
            <div style="font-size:9px;color:${expCol};font-weight:700">vial aktif</div>`}
        ${expiredRecon.length?`<div style="font-size:9px;color:var(--warn);font-weight:800;margin-top:2px">${expiredRecon.length} EXPIRED</div>`:''}
      </td>
      <td class="c" style="vertical-align:top;padding-top:10px">
        ${daysLeft===null
          ?`<div style="font-size:10px;color:var(--t3)">—</div>`
          :`<div style="font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:800;color:${expCol}">${daysLeft}h</div>
            <div style="font-size:9px;color:${expCol};font-weight:700">terdekat</div>`}
      </td>
      <td style="vertical-align:top">
        <div style="max-width:340px">
          ${reconList.length===0
            ?`<div style="font-size:10px;color:var(--t3);padding:6px 0">Belum ada rekonstituasi</div>`
            :batchRows}
        </div>
        <button onclick="openReconModal('${c.name}')" style="margin-top:6px;padding:4px 12px;border-radius:var(--r);border:1.5px solid #7c3aed44;background:#7c3aed11;font-size:10px;font-weight:700;cursor:pointer;color:#7c3aed">+ Tambah Rekonstituasi</button>
      </td>
    </tr>`;
  }).join('');

  const reconPanel=`
  <div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div class="card-title" style="margin:0">🧪 Reconstituted Vials — Vial Sudah Dilarutkan</div>
      <div style="font-size:10px;color:var(--t3)">Shelf life dihitung otomatis dari tanggal rekonstituasi</div>
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr style="position:sticky;top:0;background:var(--bg1);z-index:2">
          <th>Layer</th>
          <th>Compound &amp; Timing</th>
          <th class="c">Vial Aktif</th>
          <th class="c">Exp Terdekat</th>
          <th>Riwayat Batch</th>
        </tr></thead>
        <tbody>${allReconRows}</tbody>
      </table>
    </div>
    <div class="note" style="margin-top:8px">
      Shelf life = ketahanan setelah rekonstituasi · <span style="color:var(--warn);font-weight:700">≤21 hari</span> = cepat rusak, jangan rekonstitusi terlalu banyak sekaligus · Expired otomatis berdasarkan tanggal rekon + shelf life
    </div>
  </div>`;

  return`
  ${doseSchedBanner}
  ${summaryBar}
  ${tabBar}
  ${vt==='stok'?stokPanel:reconPanel}

  <div id="inv-modal" class="modal-overlay" onclick="if(event.target===this)closeInvModal()">
    <div class="modal-box" style="max-width:360px">
      <div class="modal-title" id="inv-modal-title">Edit Inventory</div>
      <input type="hidden" id="inv-modal-name">
      <div style="display:flex;flex-direction:column;gap:12px;margin:16px 0">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--t2);display:block;margin-bottom:5px">STOK SEKARANG (vial)</label>
          <input id="inv-qty-input" type="number" min="0" placeholder="0"
            style="width:100%;padding:10px 12px;border:1.5px solid var(--bdr);border-radius:var(--r);font-size:16px;font-weight:700;font-family:'JetBrains Mono',monospace;background:var(--bg2);color:var(--t0)">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--t2);display:block;margin-bottom:5px">MIN ORDER / SAFETY STOCK (vial)</label>
          <input id="inv-ss-input" type="number" min="0" placeholder="5"
            style="width:100%;padding:10px 12px;border:1.5px solid var(--bdr);border-radius:var(--r);font-size:16px;font-weight:700;font-family:'JetBrains Mono',monospace;background:var(--bg2);color:var(--t0)">
          <div style="font-size:10px;color:var(--t3);margin-top:4px">Kalau stok ≤ angka ini → status ORDER</div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="closeInvModal()" style="flex:1;padding:10px;border-radius:var(--r);border:1px solid var(--bdr);background:var(--bg2);font-weight:700;cursor:pointer;color:var(--t1)">Batal</button>
        <button onclick="confirmInvEdit()" style="flex:2;padding:10px;border-radius:var(--r);border:none;background:var(--acc);color:#fff;font-weight:800;cursor:pointer">Simpan</button>
      </div>
    </div>
  </div>

  <div id="recon-modal" class="modal-overlay" onclick="if(event.target===this)closeReconModal()">
    <div class="modal-box" style="max-width:420px">
      <button class="modal-close" onclick="closeReconModal()">✕</button>
      <div class="modal-title" id="recon-modal-title">Rekonstituasi Vial</div>
      <div class="modal-sub">Catat vial yang sudah direkonstituasi. Expired otomatis dihitung dari shelf life.</div>
      <input type="hidden" id="recon-modal-name">
      <div id="recon-existing" style="margin-bottom:14px;max-height:180px;overflow-y:auto"></div>
      <div style="border-top:1px solid var(--bdr);padding-top:12px;margin-bottom:4px">
        <div style="font-size:10px;font-weight:800;color:var(--t2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">+ Tambah Entri Rekonstituasi</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div>
            <label style="font-size:10px;font-weight:700;color:var(--t2);display:block;margin-bottom:4px">JUMLAH VIAL</label>
            <input id="recon-qty-input" type="number" min="1" value="1"
              style="width:100%;padding:8px 10px;border:1.5px solid var(--bdr);border-radius:var(--r);font-size:15px;font-weight:700;font-family:'JetBrains Mono',monospace;background:var(--bg2);color:var(--t0)">
          </div>
          <div>
            <label style="font-size:10px;font-weight:700;color:var(--t2);display:block;margin-bottom:4px">TGL REKONSTITUASI</label>
            <input id="recon-date-input" type="date"
              style="width:100%;padding:8px 10px;border:1.5px solid var(--bdr);border-radius:var(--r);font-size:13px;font-weight:600;background:var(--bg2);color:var(--t0)">
          </div>
        </div>
        <div style="margin-bottom:12px">
          <label style="font-size:10px;font-weight:700;color:var(--t2);display:block;margin-bottom:4px">CATATAN (opsional)</label>
          <input id="recon-notes-input" type="text" placeholder="misal: batch A, sudah dibuka..."
            style="width:100%;padding:8px 10px;border:1.5px solid var(--bdr);border-radius:var(--r);font-size:12px;background:var(--bg2);color:var(--t0)">
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="closeReconModal()" style="flex:1;padding:10px;border-radius:var(--r);border:1px solid var(--bdr);background:var(--bg2);font-weight:700;cursor:pointer;color:var(--t1)">Tutup</button>
        <button onclick="confirmReconAdd()" style="flex:2;padding:10px;border-radius:var(--r);border:none;background:var(--acc);color:#fff;font-weight:800;cursor:pointer">+ Catat Rekonstituasi</button>
      </div>
    </div>
  </div>`;
}

// ──────────────────────────────────────────
// P3 — TIMELINE
// ──────────────────────────────────────────
export function pTimeline(){
  const qid = S.quarter || QUARTERS[0];
  const qLabel = quarterLabel(qid);
  const weeks = weeksInQuarter(qid);

  if(weeks.length === 0){
    return `<div class="card">
      <div class="card-title"><span class="ico">🗓</span> Timeline — ${qLabel}</div>
      <div style="padding:2rem;text-align:center;color:var(--t2);font-size:13px;line-height:1.7">
        <div style="font-size:36px;margin-bottom:10px">⏳</div>
        <div><b>${qLabel}</b> pre-protocol — belum ada week aktif (protocol mulai W1 = 6 Juli 2026 = Q3 2026).</div>
        <div style="margin-top:8px;font-size:11px">Pilih quarter Q3 2026 atau setelahnya di atas.</div>
      </div>
    </div>`;
  }

  // Y axis: ONLY compound dari DM di quarter ini (bukan union)
  const yNames = DM.selectedByQuarter[qid] || new Set();
  const yCompounds = [...yNames]
    .map(n => COMPOUNDS.find(c => c.name === n))
    .filter(Boolean)
    .sort((a,b) => a.name.localeCompare(b.name));

  if(yCompounds.length === 0){
    return `<div class="card">
      <div class="card-title"><span class="ico">🗓</span> Timeline — ${qLabel}</div>
      <div style="padding:2rem;text-align:center;color:var(--t2);font-size:13px;line-height:1.7">
        <div style="font-size:36px;margin-bottom:10px">📋</div>
        <div>Belum ada compound dipilih untuk <b>${qLabel}</b> di Decision Matrix.</div>
        <button class="btn" style="margin-top:14px;padding:8px 16px;background:var(--acc);color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer" onclick="setTab(2)">Buka Decision Matrix →</button>
      </div>
    </div>`;
  }

  // X axis: week numbers in current quarter
  const wkRow = `<div class="tl-wk-row">${weeks.map(w =>
    `<div class="tl-wk">W${w}</div>`
  ).join('')}</div>`;

  // Grand summary for this quarter
  let grandTotalVials = 0;
  let grandTotalCost = 0;

  const rows = yCompounds.map(c => {
    const cycle = tlGetCycle(qid, c.name);
    const wt = parseWeeklyTotal(c.weekly_total);
    const wtLabel = wt?.value ? `${wt.value}${wt.unit}/wk` : (c.weekly_total || '—');
    const escName = c.name.replace(/'/g,"\\'");

    const cells = weeks.map(w => {
      const status = tlCellStatus(w, c, qid);
      const dose = tlDoseForWeek(w, c, qid);
      const hasCustom = customDoses[c.name]?.[w] !== undefined;
      const catCls = CAT[c.cat]?.cls || '';
      const cls = status==='on' ? `tl-cell tl-on ${catCls}${hasCustom?' tl-custom':''}`
                : status==='off' ? `tl-cell tl-off${hasCustom?' tl-custom':''}`
                : `tl-cell tl-inactive${hasCustom?' tl-custom':''}`;
      const doseStr = dose > 0 ? `${dose}` : '';
      const tip = `${c.name} W${w} · ${status.toUpperCase()}${dose>0?` · ${dose}${wt?.unit||''}`:''}${hasCustom?' (custom)':''} · click to edit`;
      return `<div class="${cls}" title="${tip}" onclick="openDoseEdit('${escName}',${w})">${doseStr}</div>`;
    }).join('');

    // Per-row summary
    const sum = tlVialSummary(c, weeks, qid);
    grandTotalVials += sum.vials;
    const vPrice = VSPECS[c.name]?.vPrice || 0;
    const rowCost = sum.vials * vPrice;
    grandTotalCost += rowCost;

    // Master suggestion hint
    const onP = parseCycleText(c.on_cycle);
    const offP = parseCycleText(c.off_cycle);
    const masterOn = onP.type === 'weeks' ? onP.max : onP.type === 'continuous' ? '∞' : '—';
    const masterOff = offP.type === 'weeks' ? offP.max : offP.type === 'none' ? 0 : '—';
    const masterHint = `Default dari master: ${masterOn}w on / ${masterOff}w off · ${wtLabel}`;

    const summaryHtml = sum.vials > 0
      ? `<span class="tl-sum-v">${sum.vials}<small>v</small></span><span class="tl-sum-d">${Math.round(sum.totalDose)}${sum.unit}</span>${rowCost>0?`<span class="tl-sum-c">${rpM(rowCost)}</span>`:''}`
      : `<span class="tl-sum-empty">—</span>`;

    return `<div class="tl-row">
      <div class="tl-lbl">
        <div class="tl-lbl-top">
          <span class="lb ${CAT[c.cat]?.cls||''}" style="font-size:8px">${(c.cat||'off').toUpperCase()}</span>
          <span class="tl-name" title="${c.name}">${c.name}</span>
        </div>
        <div class="tl-cycle-input">
          ON:<input type="number" min="0" max="${weeks.length}" value="${cycle.on||''}" onchange="tlSetOn('${qid}','${escName}',this.value)" placeholder="0">
          OFF:<input type="number" min="0" max="${weeks.length}" value="${cycle.off||''}" onchange="tlSetOff('${qid}','${escName}',this.value)" placeholder="0">
          <button class="tl-seed-btn" onclick="tlSeedDefaults('${qid}','${escName}')" title="${masterHint}">↻</button>
        </div>
      </div>
      <div class="tl-cells">${cells}</div>
      <div class="tl-sum">${summaryHtml}</div>
    </div>`;
  }).join('');

  return `<div class="card">
    <div class="card-title">
      <span class="ico">🗓</span> Timeline — ${qLabel} · ${yCompounds.length} compounds · ${weeks.length} weeks
      <span style="margin-left:auto;font-size:11px;font-weight:700;color:var(--t2)">
        Total: <span style="color:var(--acc)">${grandTotalVials} vial</span> · ${rpM(grandTotalCost)}
      </span>
    </div>
    <div class="tl-legend">
      <span><span class="tl-sw tl-sw-on"></span> ON cycle</span>
      <span><span class="tl-sw tl-sw-off"></span> OFF (washout)</span>
      <span><span class="tl-sw tl-sw-inactive"></span> Inactive (ON belum di-set)</span>
      <span style="margin-left:auto">💡 Set <b>ON/OFF</b> per compound (klik <b>↻</b> untuk default master) · <b>Click cell</b> untuk edit dose</span>
    </div>
    <div class="tl-wrap"><div class="tl-grid">${wkRow}${rows}</div></div>
    <div class="note" style="margin-top:8px;font-size:10px;color:var(--t3);line-height:1.5">
      <b>Per-quarter scope</b>: pattern cycle scoped ke ${qLabel} aja. Pindah quarter di card row atas untuk plan quarter lain.
      <b>ON/OFF</b>: lo set manual per compound (jumlah minggu). Tombol <b>↻</b> isi dengan master suggestion dari <code>on_cycle</code>/<code>off_cycle</code> CSV.
      <b>Dose default</b>: cell ON otomatis isi value <code>weekly_total</code> peptide. <b>Click cell</b> untuk override (saved ke <code>custom_doses</code> — butuh login).
      <b>Vial calc</b>: ⌈total dose ÷ vial_size⌉.
    </div>
  </div>`;
}

// ──────────────────────────────────────────
// P4 — BUDGET + CONFLICT
// ──────────────────────────────────────────
export function pBudget(){
  const qid = S.budQuarter || S.quarter;
  const cap = S.budCap;
  const qLabel = quarterLabel(qid);

  // Schema v2: dose schedule (doses_jsonb) dropped — cost calc always 0.
  // Show banner pointing user ke Timeline tab (manual dose entry — next session).
  const doseBanner = `<div class="conflict-banner cb-warn" style="margin-bottom:14px">
    <div class="cb-ico">⏳</div>
    <div>
      <div class="cb-title">Dosis per minggu belum di-input</div>
      <div style="font-size:11px;color:var(--t1)">Schema sudah di-slim ke v2. Dose schedule akan di-input manual via tab <b>Timeline</b> (UI sedang di-build). Sampai itu, semua angka biaya di sini akan menunjukkan <b>—</b>.</div>
    </div>
  </div>`;

  // Filter by Decision Matrix selection untuk quarter ini.
  const dmSelected = DM.selectedByQuarter[qid] || new Set();

  // Empty state: DM Quarter X belum punya selection
  if(dmSelected.size === 0){
    return `
    <div class="card">
      <div class="card-title"><span class="ico">💰</span> Budget + Conflict — ${qLabel}</div>
      <div class="ph-toggle-row" style="margin-bottom:16px;flex-wrap:wrap;gap:4px">
        <span style="font-size:10px;color:var(--t2);font-weight:700">Quarter:</span>
        ${QUARTERS.map(q=>`<button class="ph-tgl${qid===q?' tacc':''}" onclick="switchBudQuarter('${q}')">${quarterLabel(q)}</button>`).join('')}
      </div>
      <div style="padding:2rem;text-align:center;color:var(--t3);font-size:13px;line-height:1.6">
        <div style="font-size:32px;margin-bottom:8px">🎯</div>
        <div>Belum ada compound dipilih untuk <b>${qLabel}</b> di Decision Matrix.</div>
        <div style="margin-top:8px;font-size:11px">Pilih compound di Decision Matrix dulu, baru bisa hitung budget.</div>
        <button class="btn" style="margin-top:14px;padding:8px 16px;background:var(--acc);color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer" onclick="setTab(2)">Buka Decision Matrix →</button>
      </div>
    </div>`;
  }

  const sorted=[...COMPOUNDS]
    .filter(c=>dmSelected.has(c.name))
    .map(c=>{
      const ci = costForQuarter(c.name, qid);
      return { ...c, prio: getPrio(c.name, qid), cost: ci.cost, eff: budEff(c.name, qid), ss: sportScore(c.name) };
    })
    .sort((a,b)=>b.prio-a.prio);

  // Auto-prune S.budSel ke subset dari DM-selected (hapus phantom dari fase lain)
  const visibleNames = new Set(sorted.map(c=>c.name));
  [...S.budSel].forEach(n => { if(!visibleNames.has(n)) S.budSel.delete(n); });
  // Kalau S.budSel kosong setelah prune, auto-fill semua DM-selected (default: all checked)
  if(S.budSel.size === 0){
    sorted.forEach(c => S.budSel.add(c.name));
  }

  const selCost=sorted.filter(c=>S.budSel.has(c.name)).reduce((a,c)=>a+c.cost,0);
  const selCount=sorted.filter(c=>S.budSel.has(c.name)).length;
  const selPct=Math.min(100,Math.round(selCost/cap*100));
  const over=selCost>cap;
  let sugCost=0,suggested=[];
  sorted.forEach(c=>{if(sugCost+c.cost<=cap){sugCost+=c.cost;suggested.push(c.name);}});

  const conflicts=getConflicts(),actConf=conflicts.filter(r=>r.triggered);

  const cBanner=actConf.length>0
    ?`<div class="conflict-banner cb-warn"><div class="cb-ico">⚠️</div><div><div class="cb-title">${actConf.length} KONFLIK AKTIF dalam seleksi lo!</div><div class="cb-list">${actConf.map(r=>`• ${r.lvl} — ${r.title}`).join('<br>')}</div><div style="font-size:10px;color:var(--t2);margin-top:4px">Scroll ke Live Monitor →</div></div></div>`
    :`<div class="conflict-banner cb-ok"><div class="cb-ico">✅</div><div><div class="cb-title">Tidak ada konflik terdeteksi</div><div style="font-size:11px;color:var(--t1)">Seleksi ${selCount} compounds saat ini aman dari conflict rules.</div></div></div>`;

  const cmpRows=sorted.map(c=>{
    const sel=S.budSel.has(c.name),conf=actConf.some(r=>r.active.includes(c.name));
    return`<div class="bopt-row${conf?' in-conflict':''}">
      <div class="chk${sel?' on':''}" onclick="toggleBudSel('${c.name}')"></div>
      <div class="bopt-info">
        <div class="bopt-name" style="${conf?'color:var(--warn)':''}">${c.name}${conf?' ⚠':''}</div>
        <div class="bopt-sub">
          <span class="lb ${CAT[c.cat].cls}" style="font-size:8.5px">${CAT[c.cat].n}</span>
          <span>Prio <strong>${c.prio}</strong></span>
          <span>★${c.ss}</span>
          <span>Eff <strong style="color:${c.eff>=10?'var(--f3)':c.eff>=5?'var(--f2)':'var(--t3)'}">${c.eff>0?c.eff+'x':'—'}</strong></span>
        </div>
      </div>
      <div class="bopt-cost">${rpM(c.cost)}</div>
    </div>`;
  }).join('');

  const redAlerts=conflicts.map(r=>{
    const cls=r.triggered?`la-${r.lvl.toLowerCase()}`:'la-ok';
    return`<div class="live-alert ${cls}">
      <div class="la-title">${r.triggered?'⚠':'✓'} ${r.lvl} — ${r.title}</div>
      ${r.triggered?`<div class="la-body">${r.body}</div><div class="la-rec">→ ${r.rec}</div>`:''}
      <div class="la-cmps">${r.cmps.map(c=>`<span class="la-cmp${r.active.includes(c)?' hit':''}">${c}</span>`).join('')}</div>
    </div>`;
  }).join('');

  const effRanking=[...sorted].sort((a,b)=>b.eff-a.eff).slice(0,8);
  // update _lastSuggested via module
  stateModule._lastSuggested.length=0;
  suggested.forEach(n=>stateModule._lastSuggested.push(n));

  return`
  ${doseBanner}
  <div class="bud-controls">
    <div class="bud-val-row"><div class="bud-val" id="budDisp">${rpM(cap)}</div><div class="bud-lbl">budget cap</div></div>
    <input type="range" min="5000000" max="200000000" step="5000000" value="${cap}"
      oninput="S.budCap=+this.value;document.getElementById('budDisp').textContent='Rp '+Math.round(+this.value).toLocaleString('id-ID');saveBudgetToDB();renderPanels()">
    <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--t3);margin-top:3px">
      <span>Rp 5 jt</span><span>Rp 200 jt</span>
    </div>
    <div class="ph-toggle-row" style="flex-wrap:wrap;gap:4px">
      <span style="font-size:10px;color:var(--t2);font-weight:700">Quarter:</span>
      ${QUARTERS.map(q=>`<button class="ph-tgl${qid===q?' tacc':''}" onclick="switchBudQuarter('${q}')">${quarterLabel(q)}</button>`).join('')}
      <button class="auto-btn" onclick="autoPickBudget()">✨ Auto Pilih Optimal</button>
    </div>
  </div>

  <div class="bud-progress">
    <div style="display:flex;justify-content:space-between;margin-bottom:6px">
      <span style="font-size:12px;font-weight:700;color:var(--t1)">Dipilih: <span style="color:var(--acc)">${rpM(selCost)}</span> · ${selCount} compounds</span>
      <span style="font-size:12px;font-weight:700;color:var(--t1)">Sisa: <span style="color:${over?'var(--warn)':'var(--f3)'}">${over?'OVER BUDGET':rpM(cap-selCost)}</span></span>
    </div>
    <div class="bud-prog-bar"><div class="bud-prog-fill" style="width:${selPct}%;background:${over?'var(--warn)':'var(--acc)'}"></div></div>
    <div style="font-size:10px;color:var(--t2);margin-top:3px">${selPct}% dari cap · ${qLabel}</div>
  </div>

  ${cBanner}

  <div class="grid2">
    <div class="card">
      <div class="card-title"><span class="ico">💰</span> Pilih Compound — ${qLabel}</div>
      ${cmpRows}
      <div class="note">Centang untuk include. Conflict langsung terdeteksi real-time. Auto Pilih = greedy by Priority Score sampai budget habis.</div>
    </div>
    <div>
      <div class="card" style="margin-bottom:10px">
        <div class="card-title">
          <span class="live-dot" style="background:${actConf.length>0?'var(--warn)':'var(--f3)'}"></span>
          Live Conflict Monitor — ${actConf.length}/${REDUNDANCY.length} aktif
        </div>
        ${redAlerts}
      </div>
      <div class="card">
        <div class="card-title"><span class="ico">⚡</span> Top Budget Efficiency — ${qLabel}</div>
        ${effRanking.map(c=>{const sel=S.budSel.has(c.name);return`<div class="srow" style="${sel?'':'opacity:.4'}">
          <div class="srow-lbl">${c.name}</div>
          <div class="srow-bar"><div class="srow-fill" style="width:${Math.min(100,c.eff*5)}%;background:${c.eff>=10?'var(--f3)':c.eff>=5?'var(--f2)':'var(--f1)'}"><span class="srow-txt">${c.eff}x</span></div></div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;color:var(--acc)">${rpM(c.cost)}</div>
        </div>`;}).join('')}
        <div class="note">Efisiensi = Priority Score ÷ Biaya (juta Rp). Dim = belum dipilih.</div>
      </div>
    </div>
  </div>`;
}

// ──────────────────────────────────────────
// P5 — COMPOUNDS (List View Horizontal — tagged static/dynamic)
// Visi: lihat SEMUA field master library jelas. Tagged [S]/[D] supaya
// user tau prioritas update. Edit lewat existing cmp-edit-modal.
// ──────────────────────────────────────────
export function pCompounds(){
  const qid = S.quarter || QUARTERS[0];

  // Filter logic — tetap pakai existing S.filterCats + S.search
  const filtered = [...COMPOUNDS]
    .filter(c => S.filterCats.has(c.cat) && (!S.search || c.name.toLowerCase().includes(S.search.toLowerCase())))
    .sort((a,b) => a.name.localeCompare(b.name));

  const filterBar = `<div class="filter-bar" style="margin-bottom:.75rem">
    <span class="fl">Layer:</span>
    ${Object.entries(CAT).map(([k,v]) => `
      <div class="fp${S.filterCats.has(k)?' act':''}" onclick="toggleCat('${k}')">
        <div class="dot" style="background:${v.col}"></div>${v.n}
      </div>`).join('')}
    <input class="srch" placeholder="Cari compound..." value="${S.search}" oninput="S.search=this.value;renderPanels()">
    <span style="margin-left:auto;font-size:11px;color:var(--t2);font-weight:700">${filtered.length}/${COMPOUNDS.length} compounds</span>
  </div>`;

  // Legend
  const legend = `<div class="cmp-legend">
    <span class="cmp-tag cmp-tag-S">S</span> Static (master, jarang berubah)
    <span class="cmp-tag cmp-tag-D" style="margin-left:10px">D</span> Dynamic (sering update via app)
    <span style="margin-left:14px;font-size:10px;color:var(--t3)">Schema v2 — 12 kolom render (id/created_at tidak ditampilkan)</span>
  </div>`;

  // Render rows — 14-col schema (id/created_at hidden, 12 visible cols + action)
  const rows = filtered.map(c => {
    const vspec = VSPECS[c.name] || {};
    const shelf = SHELF_LIFE[c.name] || {};
    const sp = SP[c.name] || {risk:''};
    const mech = MECHS[c.name] || '';
    const mechTrunc = mech.length > 60 ? mech.slice(0,57)+'…' : mech;
    const notes = c.notes || '';
    const notesTrunc = notes.length > 40 ? notes.slice(0,37)+'…' : notes;
    const escName = c.name.replace(/'/g,"\\'");

    return `<tr>
      <td class="cmp-tbl-sticky">
        <div style="font-weight:800;font-size:12px;color:var(--t0)">${c.name}</div>
      </td>
      <td><span class="lb ${CAT[c.cat]?.cls||''}">${CAT[c.cat]?.n||c.cat||'—'}</span></td>
      <td class="ellipsis-cell" title="${mech.replace(/"/g,'&quot;')}">${mechTrunc||'—'}</td>
      <td class="ellipsis-cell" title="${(sp.risk||'').replace(/"/g,'&quot;')}">${sp.risk||'—'}</td>
      <td class="ellipsis-cell" title="${(c.hiv_notes||'').replace(/"/g,'&quot;')}">${c.hiv_notes||'—'}</td>
      <td class="ellipsis-cell" title="${notes.replace(/"/g,'&quot;')}">${notesTrunc||'—'}</td>
      <td>${vspec.unit||'—'}</td>
      <td>${shelf.shelf?shelf.shelf+'d':'—'}</td>
      <td class="dyn-cell">${vspec.vSize||'—'}</td>
      <td class="dyn-cell">${vspec.vPrice>0?rpM(vspec.vPrice):'—'}</td>
      <td class="dyn-cell ellipsis-cell" title="${(vspec.label||'').replace(/"/g,'&quot;')}">${vspec.label||'—'}</td>
      <td class="dyn-cell ellipsis-cell" title="${(shelf.timing||'').replace(/"/g,'&quot;')}">${shelf.timing||'—'}</td>
      <td><button class="cmp-edit-btn" onclick="openCmpEdit('${escName}')">✏️ Edit</button></td>
    </tr>`;
  }).join('');

  // 12 visible cols + Action (id/created_at hidden as META)
  const header = `
    <thead>
      <tr class="cmp-tbl-grp-row">
        <th class="cmp-tbl-sticky cmp-grp-id">🔵 ID</th>
        <th class="cmp-grp-static" colspan="7">🟢 STATIC — master data</th>
        <th class="cmp-grp-dynamic" colspan="4">🟠 DYNAMIC — frequently update</th>
        <th class="cmp-grp-action">⚙️</th>
      </tr>
      <tr class="cmp-tbl-hdr-row">
        <th class="cmp-tbl-sticky">Name <span class="cmp-tag cmp-tag-S">S</span></th>
        <th>Cat <span class="cmp-tag cmp-tag-S">S</span></th>
        <th>Mechanism <span class="cmp-tag cmp-tag-S">S</span></th>
        <th>Risk <span class="cmp-tag cmp-tag-S">S</span></th>
        <th>HIV <span class="cmp-tag cmp-tag-S">S</span></th>
        <th>Notes <span class="cmp-tag cmp-tag-S">S</span></th>
        <th>Unit <span class="cmp-tag cmp-tag-S">S</span></th>
        <th>Shelf <span class="cmp-tag cmp-tag-S">S</span></th>
        <th>Size <span class="cmp-tag cmp-tag-D">D</span></th>
        <th>Price <span class="cmp-tag cmp-tag-D">D</span></th>
        <th>Label <span class="cmp-tag cmp-tag-D">D</span></th>
        <th>Timing <span class="cmp-tag cmp-tag-D">D</span></th>
        <th>Action</th>
      </tr>
    </thead>`;

  const tableHtml = `
    <div class="cmp-tbl-wrap">
      <table class="cmp-tbl">
        ${header}
        <tbody>${rows||'<tr><td colspan="13" style="text-align:center;padding:2rem;color:var(--t3)">Tidak ada compound match filter</td></tr>'}</tbody>
      </table>
    </div>
    <div class="cmp-info-footer">
      <strong>📊 Schema v2</strong>: ${COMPOUNDS.length} compounds · 14 kolom DB total (id, created_at, 8 STATIC, 4 DYNAMIC). Dose schedule + sport profile + score: di-drop, akan rework next session (manual entry via Timeline).
      <br><span style="color:var(--t3);font-size:10px">Hover cell untuk detail lengkap. Klik Edit untuk modal full.</span>
    </div>`;

  return `${filterBar}${legend}${tableHtml}`;
}

// ── COMPOUND EDIT MODAL ──
window.openCmpEdit = function(name){
  const c=COMPOUNDS.find(x=>x.name===name);
  const sp=SP[name]||{risk:''};
  const vs=VSPECS[name]||{unit:'mg',vSize:10,vPrice:0,label:''};
  const sl=SHELF_LIFE[name]||{shelf:0,timing:''};
  if(!c)return;
  S._editCmpName=name;
  document.getElementById('cmp-edit-title').textContent='Edit: '+name;
  document.getElementById('ce-name').value=name;
  document.getElementById('ce-cat').value=c.cat||'off';
  document.getElementById('ce-mechanism').value=MECHS[name]||'';
  document.getElementById('ce-risk').value=sp.risk||'';
  document.getElementById('ce-unit').value=vs.unit||'mg';
  document.getElementById('ce-vsize').value=vs.vSize||10;
  document.getElementById('ce-vprice').value=vs.vPrice||0;
  document.getElementById('ce-vlabel').value=vs.label||'';
  document.getElementById('ce-shelf').value=sl.shelf||0;
  document.getElementById('ce-timing').value=sl.timing||'';
  document.getElementById('cmp-edit-err').textContent='';
  document.getElementById('cmp-edit-modal').classList.add('open');
};

window.closeCmpEdit = function(){
  document.getElementById('cmp-edit-modal').classList.remove('open');
};

window.saveCmpEdit = async function(){
  const name=S._editCmpName;
  if(!name)return;
  const errEl=document.getElementById('cmp-edit-err');
  errEl.textContent='Menyimpan...';

  // Schema v2 — sport_*, doses_jsonb sudah di-DROP. Cuma 9 editable fields.
  const updates={
    category: document.getElementById('ce-cat').value,
    mechanism: document.getElementById('ce-mechanism').value.trim()||null,
    risk_text: document.getElementById('ce-risk').value.trim()||null,
    vial_unit: document.getElementById('ce-unit').value,
    vial_size: parseFloat(document.getElementById('ce-vsize').value)||10,
    vial_price_idr: parseInt(document.getElementById('ce-vprice').value)||0,
    vial_label: document.getElementById('ce-vlabel').value.trim()||null,
    shelf_life_days: parseInt(document.getElementById('ce-shelf').value)||null,
    timing_note: document.getElementById('ce-timing').value.trim()||null,
  };

  try{
    await saveCompoundEdit(name, updates);
    await loadAllPepData();
    closeCmpEdit();
    renderPanels();
  }catch(e){
    errEl.textContent='Error: '+(e.message||e);
  }
};
