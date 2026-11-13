/** Short axis ticks for figures. Stored metric values are not rounded here. */

export function niceStep(span, target = 5) {
  if (!(span > 0)) throw new Error("Axis span must be positive");
  const rough = span / Math.max(target, 1);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const err = rough / pow;
  const factor = err <= 1.5 ? 1 : err <= 3 ? 2 : err <= 7 ? 5 : 10;
  return factor * pow;
}

export function niceTicks(min, max, target = 5) {
  if (!(max > min)) return [];
  const step = niceStep(max - min, target);
  const start = Math.ceil((min - step * 1e-9) / step) * step;
  const ticks = [];
  for (let value = start; value <= max + step * 1e-9; value += step) {
    const rounded = Number(value.toPrecision(12));
    if (rounded > min + (max - min) * 1e-6 && rounded < max - (max - min) * 1e-6) ticks.push(rounded);
    if (ticks.length > 8) break;
  }
  return ticks.length ? ticks : [min, max];
}

export function formatTick(value) {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round(value * 1e9) / 1e9;
  if (Math.abs(rounded) >= 100) return String(Math.round(rounded));
  const digits = Math.abs(rounded) >= 10 ? 1 : Math.abs(rounded) >= 1 ? 2 : 3;
  return String(Number(rounded.toFixed(digits)));
}
