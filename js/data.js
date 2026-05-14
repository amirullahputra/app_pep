// ══════════════════════════════════════════════════════════
// DATA — placeholders populated at runtime from Supabase
// ══════════════════════════════════════════════════════════
// Master data (PHASES, COMPOUNDS, SC, SP, MECHS, VSPECS, SHELF_LIFE, REDUNDANCY)
// is now loaded dynamically via loadAllPepData() in supabase.js.
// data.js only keeps UI styling maps that aren't user-data.

// UI category styling (color/label) — not user-editable, hardcoded design choice
export const CAT={
  off:{n:'Fat Loss',cls:'l-off',col:'var(--f1)'},
  met:{n:'Metabolic',cls:'l-met',col:'var(--f2)'},
  def:{n:'Recovery',cls:'l-def',col:'var(--f3)'},
  hor:{n:'Hormonal',cls:'l-hor',col:'var(--hor)'},
  cns:{n:'CNS/Sleep',cls:'l-cns',col:'var(--cns)'},
  inf:{n:'Support',cls:'l-inf',col:'var(--inf)'},
};

// Layer weight allocations (percentages per phase) — UI tuning, not data
export const LW={
  off:{f1:40,f2:25,f3:10,col:'var(--f1)',n:'Offensive'},
  met:{f1:20,f2:12,f3:7, col:'var(--f2)',n:'Metabolic'},
  def:{f1:8, f2:20,f3:25,col:'var(--f3)',n:'Defensive'},
  hor:{f1:7, f2:15,f3:22,col:'var(--hor)',n:'Hormonal'},
  cns:{f1:10,f2:13,f3:18,col:'var(--cns)',n:'CNS/Sleep'},
  inf:{f1:15,f2:15,f3:18,col:'var(--inf)',n:'Support'},
};

// ── DYNAMIC DATA (populated by loadAllPepData) ──
// These are `let` so supabase.js can mutate. Other modules import these names
// and reference them indirectly (since they're populated AFTER init, not at parse).
// To get current value, ALWAYS access via these exports — don't cache locally.
export let PHASES = [];
export let COMPOUNDS = [];
export let REDUNDANCY = [];
export let SC = {};
export let SP = {};
export let MECHS = {};
export let VSPECS = {};
export let SHELF_LIFE = {};

// Setter — called by supabase.js after fetch
export function _setPepData({phases, compounds, redundancy, sc, sp, mechs, vspecs, shelf}){
  PHASES = phases;
  COMPOUNDS = compounds;
  REDUNDANCY = redundancy;
  SC = sc;
  SP = sp;
  MECHS = mechs;
  VSPECS = vspecs;
  SHELF_LIFE = shelf;
}
