// ══════════════════════════════════════════════════════════
// MODELS — canonical data shapes + DB adapters
// ══════════════════════════════════════════════════════════
// Single source of truth untuk shape data yang dipakai di seluruh app.
// DB schema bisa berubah; frontend tetap stable selama adapter di-update.
//
// Convention: camelCase di canonical model, snake_case di DB row.

/**
 * Canonical Compound shape.
 * DB schema v2: structured cols (cycle_on_weeks INT, weekly_dose_mg NUMERIC, etc)
 * tanpa text parsing di frontend.
 *
 * @typedef {Object} Compound
 * @property {number}  id
 * @property {string}  name
 * @property {string}  category               // 'off'|'met'|'def'|'hor'|'cns'
 * @property {string}  mechanism
 * @property {string}  riskText
 * @property {string}  hivNotes
 * @property {string}  notes
 * @property {string}  timingNote
 * @property {string}  vialUnit               // 'mg'|'mcg'|'IU'|'tablet'|'bundle'
 * @property {number}  vialSize               // raw value in vialUnit
 * @property {number}  vialPriceIdr
 * @property {string}  vialLabel
 * @property {number}  shelfLifeDays
 * @property {number}  cycleOnWeeks           // 0 jika continuous/prn/dll
 * @property {number}  cycleOffWeeks          // 0 jika continuous/prn/dll
 * @property {string}  cycleType              // 'weeks'|'continuous'|'prn'|'none'|'goal'|'bundle_ref'|'taper'|'custom'|'unknown'
 * @property {number}  weeklyDoseValue        // raw value in weeklyDoseUnit
 * @property {string}  weeklyDoseUnit         // 'mg'|'mcg'|'IU'|'tablet'
 * @property {number}  weeklyDoseMg           // normalized ke mg (NULL untuk IU/tablet)
 * @property {number}  perInjectValue         // raw value (assumed same unit as weeklyDoseUnit)
 * @property {number}  perInjectMg            // normalized ke mg
 * @property {number}  freqPerWeek            // 1..7, atau 0 untuk PRN/bundle
 * @property {number}  efficiencyScore        // 0..100
 */

/**
 * Map DB row (snake_case) → canonical Compound (camelCase).
 * Defensive: missing/null cols become 0 / '' / 'unknown' instead of undefined.
 *
 * @param {Object} r — Supabase row dari `compounds` table
 * @returns {Compound}
 */
export function compoundFromDB(r) {
  return {
    // Identity
    id: r.id,
    name: r.name,
    category: r.category || 'off',

    // Display
    mechanism: r.mechanism || '',
    riskText: r.risk_text || '',
    hivNotes: r.hiv_notes || '',
    notes: r.notes || '',
    timingNote: r.timing_note || '',

    // Vial physical
    vialUnit: r.vial_unit || 'mg',
    vialSize: Number(r.vial_size) || 0,
    vialPriceIdr: Number(r.vial_price_idr) || 0,
    vialLabel: r.vial_label || '',
    shelfLifeDays: Number(r.shelf_life_days) || 0,

    // Cycle (structured — replaces parseCycleText regex)
    cycleOnWeeks: Number(r.cycle_on_weeks) || 0,
    cycleOffWeeks: Number(r.cycle_off_weeks) || 0,
    cycleType: r.cycle_type || 'unknown',

    // Dose (structured — replaces parseWeeklyTotal regex)
    weeklyDoseValue: Number(r.weekly_dose_value) || 0,
    weeklyDoseUnit: r.weekly_dose_unit || 'mg',
    weeklyDoseMg: Number(r.weekly_dose_mg) || 0,
    perInjectValue: Number(r.per_inject_value) || 0,
    perInjectMg: Number(r.per_inject_mg) || 0,
    freqPerWeek: Number(r.freq_per_week) || 0,

    // Scoring
    efficiencyScore: Number(r.efficiency_score) || 0
  };
}

/**
 * Convert numeric value antar unit (mcg ↔ mg). IU/tablet ga di-convert.
 * Centralized utility — replaces ad-hoc unit math di state.js.
 *
 * @param {number} value
 * @param {string} fromUnit
 * @param {string} toUnit
 * @returns {number}
 */
export function convertDose(value, fromUnit, toUnit) {
  if (!fromUnit || !toUnit) return value;
  const f = fromUnit.toLowerCase();
  const t = toUnit.toLowerCase();
  if (f === t) return value;
  if (f === 'mcg' && t === 'mg') return value / 1000;
  if (f === 'mg' && t === 'mcg') return value * 1000;
  return value;  // IU/tablet/bundle — no conversion known
}
