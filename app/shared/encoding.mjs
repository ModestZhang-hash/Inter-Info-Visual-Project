/** Okabe–Ito, plus indigo in place of yellow so small marks stay visible on white. */
export const POLICY_COLORS = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#332288"];
export const MARK_STROKE_2D = "#111111";
export const MARK_RING_3D = "#9B2242";
export const MARK_RING_COMPARISON = "#111111";
export const POLICY_SHAPES = ["●", "■", "◆", "▲", "⬟", "+", "×"];

function compareIds(left, right) {
  const a = Array.from(left, (character) => character.codePointAt(0));
  const b = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function stableConfigIndex(configs, policyConfigId) {
  const sorted = configs.map((config) => config.policy_config_id).sort(compareIds);
  return sorted.indexOf(policyConfigId);
}
