const HAND_PLACED = {
  "手工放置 A": "Hand-placed A",
  "手工放置 B": "Hand-placed B",
  "手工放置 C": "Hand-placed C",
  "手工放置 D": "Hand-placed D",
  "手工放置 E": "Hand-placed E",
  "手工放置 F": "Hand-placed F",
  "手工放置 G": "Hand-placed G",
};

const ZH = {
  axes: {
    makespan_s: { short: "M", label: "总完成时间 M (s) ↓" },
    energy_j: { short: "E", label: "任务相关能耗 E (J) ↓" },
    mean_latency_s: { short: "L", label: "平均端到端延迟 L (s) ↓" },
  },
  notComputed: "未计算",
  nonDominated: "非支配",
  dominated: "被支配",
  relations: { strict_improvement: "严格更优", equal: "相等", equivalent_within_tolerance: "容差内等价" },
  pairProjected: "二维",
  pairFull: "三维",
  dominanceLine: (projected, full, status) => `二维：${status(projected)}；三维：${status(full)}`,
  fixtureSubtitle: "手工数据的支配关系演示；不代表正式实验前沿",
  completeSubtitle: "深色描边：此二维投影非支配；金色虚线圈：完整三维非支配",
  incompleteSubtitle: "参照集合未齐，支配状态暂不显示",
  emptyPlot: "当前坐标范围或筛选下没有可见点",
  horizontal: "横轴",
  vertical: "纵轴",
  samePair: (name) => `与 3A 的 ${name} 使用同一组二维标签`,
  reversePair: (name) => `反向轴 · 与 ${name} 使用同一组二维标签`,
  matrixLabel: "散点图矩阵",
  parallelLabel: "平行坐标：M、E、L 均最小化。折线位置按坐标域绘制，悬停文字保留原始值。",
  view3dLabel: "固定斜投影的三维参考视图：M、E、L 均最小化，不能旋转。",
  emptyRuns: "当前筛选下没有可见的完整运行",
  sameProjection: "同一投影位置",
  overlapLine: (ids) => ids.length > 1 ? `\n同一投影位置：${ids.join("，")}` : "",
  fullStatus: (dominated) => dominated ? "三维：被支配" : "三维：非支配",
};

const EN = {
  axes: {
    makespan_s: { short: "M", label: "Makespan M (s) ↓" },
    energy_j: { short: "E", label: "Task energy E (J) ↓" },
    mean_latency_s: { short: "L", label: "Mean latency L (s) ↓" },
  },
  notComputed: "not computed",
  nonDominated: "non-dominated",
  dominated: "dominated",
  relations: { strict_improvement: "strictly better", equal: "equal", equivalent_within_tolerance: "equivalent within tolerance" },
  pairProjected: "2D",
  pairFull: "3D",
  dominanceLine: (projected, full, status) => `2D: ${status(projected)}; 3D: ${status(full)}`,
  fixtureSubtitle: "Hand-placed dominance demonstration; not an experimental front",
  completeSubtitle: "Black outline: non-dominated in this 2D projection; rose dashed ring: non-dominated in all three objectives",
  incompleteSubtitle: "Reference set incomplete; dominance status is hidden",
  emptyPlot: "No visible points in the current range or filter",
  horizontal: "X",
  vertical: "Y",
  samePair: (name) => `Same 2D labels as the ${name} pair`,
  reversePair: (name) => `Reversed axes · same 2D labels as ${name}`,
  matrixLabel: "Scatterplot matrix",
  parallelLabel: "Parallel coordinates: M, E, and L are minimized. Line positions use the axis ranges; hover text keeps the stored values.",
  view3dLabel: "Fixed oblique 3D reference: M, E, and L are minimized. Rotation is not available.",
  emptyRuns: "No visible complete runs under the current filter",
  sameProjection: "Same projected location",
  overlapLine: (ids) => ids.length > 1 ? `\nSame projected location: ${ids.join(", ")}` : "",
  fullStatus: (dominated) => dominated ? "3D: dominated" : "3D: non-dominated",
};

export function text(lang = "zh") {
  const pack = lang === "en" ? EN : ZH;
  return {
    ...pack,
    status(value) {
      if (value === undefined) return pack.notComputed;
      return value ? pack.nonDominated : pack.dominated;
    },
    displayName(label, fallback) {
      if (lang !== "en") return label || fallback;
      return HAND_PLACED[label] || label || fallback;
    },
  };
}
