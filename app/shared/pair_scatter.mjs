/** Reusable pairwise SVG renderer. The owning view supplies records, labels and state callbacks. */
const W = 600, H = 390, LEFT = 68, RIGHT = 25, TOP = 26, BOTTOM = 58;
const xml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function marker(index, x, y, color, stroke) {
  const common = `fill="${color}" stroke="${stroke}" stroke-width="3"`;
  switch (index % 7) {
    case 0: return `<circle cx="${x}" cy="${y}" r="8" ${common}/>`;
    case 1: return `<rect x="${x-8}" y="${y-8}" width="16" height="16" ${common}/>`;
    case 2: return `<path d="M${x} ${y-11} L${x+11} ${y} L${x} ${y+11} L${x-11} ${y}Z" ${common}/>`;
    case 3: return `<path d="M${x} ${y-11} L${x+11} ${y+9} L${x-11} ${y+9}Z" ${common}/>`;
    case 4: return `<path d="M${x} ${y-11} L${x+10} ${y-3} L${x+6} ${y+10} L${x-6} ${y+10} L${x-10} ${y-3}Z" ${common}/>`;
    case 5: return `<path d="M${x-3} ${y-10} H${x+3} V${y-3} H${x+10} V${y+3} H${x+3} V${y+10} H${x-3} V${y+3} H${x-10} V${y-3} H${x-3}Z" ${common}/>`;
    default: return `<path d="M${x-8} ${y-11} L${x} ${y-3} L${x+8} ${y-11} L${x+11} ${y-8} L${x+3} ${y} L${x+11} ${y+8} L${x+8} ${y+11} L${x} ${y+3} L${x-8} ${y+11} L${x-11} ${y+8} L${x-3} ${y} L${x-11} ${y-8}Z" ${common}/>`;
  }
}

export function drawPairScatter(svg, options) {
  const { runs, xKey, yKey, xRange, yRange, selectedRunIds, projectedLabels, fullLabels, axisLabels, encodeRun, tooltip, onSelect, onBrush, formatValue } = options;
  if (!(xRange.min < xRange.max && yRange.min < yRange.max)) throw new Error("Invalid scatterplot axis range");
  const px = (v) => LEFT + (v-xRange.min)/(xRange.max-xRange.min)*(W-LEFT-RIGHT);
  const py = (v) => H-BOTTOM - (v-yRange.min)/(yRange.max-yRange.min)*(H-TOP-BOTTOM);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${axisLabels[xKey]} 与 ${axisLabels[yKey]} 成对散点图`);
  let html = `<rect x="${LEFT}" y="${TOP}" width="${W-LEFT-RIGHT}" height="${H-TOP-BOTTOM}" fill="#fbfdfb"/>`;
  for (let i=0;i<=4;i++) {
    const x=LEFT+i/4*(W-LEFT-RIGHT), y=H-BOTTOM-i/4*(H-TOP-BOTTOM);
    html += `<line class="grid" x1="${x}" y1="${TOP}" x2="${x}" y2="${H-BOTTOM}"/><line class="grid" x1="${LEFT}" y1="${y}" x2="${W-RIGHT}" y2="${y}"/>`;
    html += `<text class="tick" x="${x}" y="${H-BOTTOM+18}" text-anchor="middle">${xml(formatValue(xRange.min+i/4*(xRange.max-xRange.min)))}</text>`;
    html += `<text class="tick" x="${LEFT-7}" y="${y+4}" text-anchor="end">${xml(formatValue(yRange.min+i/4*(yRange.max-yRange.min)))}</text>`;
  }
  html += `<line class="axis" x1="${LEFT}" y1="${H-BOTTOM}" x2="${W-RIGHT}" y2="${H-BOTTOM}"/><line class="axis" x1="${LEFT}" y1="${TOP}" x2="${LEFT}" y2="${H-BOTTOM}"/>`;
  html += `<text class="axis-label" x="${(LEFT+W-RIGHT)/2}" y="${H-10}" text-anchor="middle">${xml(axisLabels[xKey])}</text>`;
  html += `<text class="axis-label" transform="translate(16 ${(TOP+H-BOTTOM)/2}) rotate(-90)" text-anchor="middle">${xml(axisLabels[yKey])}</text>`;
  const plotted = [];
  for (const run of runs) {
    const x=px(run[xKey]), y=py(run[yKey]);
    if (x<LEFT || x>W-RIGHT || y<TOP || y>H-BOTTOM) continue;
    plotted.push({ id: run.run_id, x, y });
    const projected=projectedLabels?.get(run.run_id)?.nonDominated;
    const full=fullLabels?.get(run.run_id)?.nonDominated;
    if (full) html += `<circle cx="${x}" cy="${y}" r="15" fill="none" stroke="#b8751a" stroke-width="2.5" stroke-dasharray="4 3"/>`;
    if (selectedRunIds.includes(run.run_id)) {
      html += `<circle cx="${x}" cy="${y}" r="19" fill="none" stroke="#d79a2a" stroke-width="3"/>`;
      html += `<text class="run-id-label" x="${x+13}" y="${y-12}">${xml(run.run_id)}</text>`;
    }
    const { index, color }=encodeRun(run);
    const tip=tooltip(run,projected,full);
    html += `<g class="run-point" data-run-id="${xml(run.run_id)}" tabindex="0" role="button" aria-label="${xml(tip.replaceAll("\n","; "))}">${marker(index,x,y,color,projected?"#153f39":"#ffffff")}<title>${xml(tip)}</title></g>`;
  }
  if (!plotted.length) html += `<text class="empty" x="${W/2}" y="${H/2}" text-anchor="middle">当前坐标范围或筛选下没有可见点</text>`;
  html += `<rect class="brush" visibility="hidden" x="0" y="0" width="0" height="0"/>`;
  svg.innerHTML=html;
  svg.querySelectorAll("[data-run-id]").forEach((element) => {
    element.addEventListener("click", (event) => onSelect(element.dataset.runId,event.shiftKey));
    element.addEventListener("keydown", (event) => {
      if (event.key==="Enter" || event.key===" ") { event.preventDefault(); onSelect(element.dataset.runId,event.shiftKey); }
    });
  });
  attachBrush(svg,plotted,onBrush);
}

function attachBrush(svg,plotted,onBrush) {
  let start=null;
  const brush=svg.querySelector(".brush");
  const point=(event) => { const rect=svg.getBoundingClientRect(); return { x:(event.clientX-rect.left)*W/rect.width, y:(event.clientY-rect.top)*H/rect.height }; };
  svg.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-run-id]")) return;
    start=point(event);
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener("pointermove", (event) => {
    if (!start) return;
    const end=point(event);
    brush.setAttribute("x",Math.min(start.x,end.x));
    brush.setAttribute("y",Math.min(start.y,end.y));
    brush.setAttribute("width",Math.abs(start.x-end.x));
    brush.setAttribute("height",Math.abs(start.y-end.y));
    brush.setAttribute("visibility","visible");
  });
  svg.addEventListener("pointerup", (event) => {
    if (!start) return;
    const end=point(event), x0=Math.min(start.x,end.x), x1=Math.max(start.x,end.x), y0=Math.min(start.y,end.y), y1=Math.max(start.y,end.y);
    const dragged=Math.abs(start.x-end.x)>5 || Math.abs(start.y-end.y)>5;
    start=null;
    brush.setAttribute("visibility","hidden");
    if (dragged) onBrush(plotted.filter((p)=>p.x>=x0&&p.x<=x1&&p.y>=y0&&p.y<=y1).map((p)=>p.id),event.shiftKey);
  });
  svg.addEventListener("pointercancel",()=>{start=null;brush.setAttribute("visibility","hidden");});
}
