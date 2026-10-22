export const POLICY_COLORS = ["#197b65", "#bf6845", "#596ab3", "#a0771f", "#8b5aa0", "#428b9d", "#7a8450"];
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
