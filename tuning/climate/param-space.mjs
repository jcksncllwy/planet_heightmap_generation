/**
 * Tuning ranges for the app's climate — the new climate (v2/js/climate/config.js;
 * plans/V1_NEW_CLIMATE_PLAN.md): each parameter's literature range from
 * PARAM_PRIORS. `HIGH_IMPACT_KEYS` is the optimizer's default subset: the
 * couplings coupled-check.mjs --tune moves (the Köppen-level knobs).
 *
 * (The old climate's ranges — js/climate-config.js — went with it; see git
 * history before the migration.)
 */

import { PARAMS_DEFAULTS, PARAM_PRIORS } from '../../v2/js/climate/config.js';

/** The defaults the optimizer starts from and reports changes against. */
export const DEFAULTS = PARAMS_DEFAULTS;

export const PARAM_SPACE = Object.fromEntries(
    Object.entries(PARAM_PRIORS)
        .filter(([k, p]) => k in PARAMS_DEFAULTS && Number.isFinite(p.min) && Number.isFinite(p.max) && p.max > p.min)
        .map(([k, p]) => [k, { min: p.min, max: p.max }]),
);

export const HIGH_IMPACT_KEYS = ['RAIN_COLUMN_LOCAL', 'RAIN_STABILITY', 'RAIN_STORM_RH', 'RAIN_WIND_DIV_MOIST', 'RAIN_SOIL_MM', 'TEMP_INVERSION_C']
    .filter(k => k in PARAM_SPACE);

/** Keep a candidate inside its ranges (the new climate has no cross-parameter constraints to repair). */
export function repairParams(params) {
    for (const [k, v] of Object.entries(params)) {
        const r = PARAM_SPACE[k];
        if (r) params[k] = Math.max(r.min, Math.min(r.max, v));
    }
    return params;
}
