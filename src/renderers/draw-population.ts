import { color, curveBasisClosed, interpolateYlOrRd, line } from "d3";
import { connectVertices, ensureEl, getIsolines, round, si } from "../utils";

declare global {
  var drawPopulation: () => void;
}

const LEVELS = 12;
const SWATCH_SIZE = 10;
const SWATCH_GAP = 3;
const LEGEND_PADDING = 8;
const LEGEND_TEXT_OFFSET = 14;
const LEGEND_W = 110;

type PopulationMode = "isoline" | "province" | "cell";

// Persisted across redraws so toggling doesn't reset the mode
let populationMode: PopulationMode = "province";

const populationRenderer = (): void => {
  TIME && console.time("drawPopulation");

  population.selectAll("*").remove();

  const { cells, vertices, burgs } = pack;
  const n = cells.i.length;

  const urbanizationRate = +(ensureEl("urbanizationInput") as HTMLInputElement).value;
  const popRate = +(ensureEl("populationRateInput") as HTMLInputElement).value;
  const distUnit = (ensureEl("distanceUnitInput") as HTMLInputElement).value;

  // Mean land-cell area in real-world units
  const landCellIds = cells.i.filter((i: number) => cells.h[i] >= 20);
  const meanCellAreaPx = landCellIds.reduce((s: number, i: number) => s + cells.area[i], 0) / (landCellIds.length || 1);
  const meanCellAreaReal = meanCellAreaPx * distanceScale * distanceScale;

  if (populationMode === "province") {
    const provDensity = buildProvinceDensities(cells, burgs, urbanizationRate, popRate, distanceScale);
    // Per-cell density (people/km²) derived from province — used only for thresholds/legend
    const density = new Float32Array(n);
    for (const i of cells.i) {
      const pId = cells.province[i];
      if (pId) density[i] = provDensity[pId];
    }
    const thresholds = buildThresholds(density);
    drawProvinceLayers(provDensity, thresholds);
    drawLegend(thresholds, distUnit);
  } else if (populationMode === "isoline") {
    // Convert to people/km² (using mean cell area) so both modes share the same scale
    const rawDensity = buildCellDensity(cells, burgs, urbanizationRate, n);
    const density = new Float32Array(n);
    for (const i of cells.i) density[i] = (rawDensity[i] * popRate) / meanCellAreaReal;
    const thresholds = buildThresholds(density);
    drawDensityLayers(density, thresholds, cells, vertices, n);
    drawLegend(thresholds, distUnit);
  } else {
    // Cell mode: per-cell choropleth — sharp Voronoi boundaries, no smoothing
    const rawDensity = buildCellDensity(cells, burgs, urbanizationRate, n, 0);
    const density = new Float32Array(n);
    for (const i of cells.i) density[i] = (rawDensity[i] * popRate) / meanCellAreaReal;
    const thresholds = buildThresholds(density);
    drawCellLayer(density, thresholds);
    drawLegend(thresholds, distUnit);
  }

  TIME && console.timeEnd("drawPopulation");
};

// ─── Cell mode ───────────────────────────────────────────────────────────────

function buildCellDensity(
  cells: any,
  burgs: any[],
  urbanizationRate: number,
  n: number,
  smoothPasses = 2
): Float32Array {
  const density = new Float32Array(n);

  for (const i of cells.i) {
    if (cells.h[i] < 20) continue;
    if (!biomesData.habitability[cells.biome[i]]) continue;
    density[i] = cells.pop[i];
  }

  for (const burg of burgs) {
    if (!burg.i || burg.removed || !burg.population) continue;
    const burgPop = burg.population * urbanizationRate;
    const ci = burg.cell;

    density[ci] += burgPop * 0.6;

    const ring1 = cells.c[ci].filter((nb: number) => cells.h[nb] >= 20);
    if (ring1.length) {
      const share1 = (burgPop * 0.3) / ring1.length;
      for (const nb of ring1) density[nb] += share1;

      const ring1Set = new Set(ring1);
      ring1Set.add(ci);
      for (const nb1 of ring1) {
        const ring2 = cells.c[nb1].filter((nb2: number) => cells.h[nb2] >= 20 && !ring1Set.has(nb2));
        if (ring2.length) {
          const share2 = (burgPop * 0.1) / (ring1.length * ring2.length);
          for (const nb2 of ring2) density[nb2] += share2;
        }
      }
    }
  }

  // 2-pass smoothing — stronger centre weight to limit city bleed
  const smoothed = new Float32Array(n);
  for (let pass = 0; pass < smoothPasses; pass++) {
    for (const i of cells.i) {
      if (cells.h[i] < 20) continue;
      const landNb = cells.c[i].filter((nb: number) => cells.h[nb] >= 20);
      if (!landNb.length) {
        smoothed[i] = density[i];
        continue;
      }
      const nbSum = landNb.reduce((s: number, nb: number) => s + density[nb], 0);
      smoothed[i] = (density[i] * 4 + nbSum) / (4 + landNb.length);
    }
    for (const i of cells.i) {
      if (cells.h[i] >= 20) density[i] = smoothed[i];
    }
  }

  return density;
}

// ─── Province mode ───────────────────────────────────────────────────────────

// Returns people/km² indexed by province ID.
function buildProvinceDensities(
  cells: any,
  burgs: any[],
  urbanizationRate: number,
  popRate: number,
  dScale: number
): Float64Array {
  const { provinces } = pack;
  const provPop = new Float64Array(provinces.length);
  const provArea = new Float64Array(provinces.length);

  for (const i of cells.i) {
    const pId = cells.province[i];
    if (!pId) continue;
    const areaPx = cells.latCosine ? cells.area[i] * cells.latCosine[i] : cells.area[i];
    provArea[pId] += areaPx * dScale * dScale;
    provPop[pId] += cells.pop[i] * popRate;
  }

  for (const burg of burgs) {
    if (!burg.i || burg.removed || !burg.population) continue;
    const pId = cells.province[burg.cell];
    if (!pId) continue;
    provPop[pId] += burg.population * urbanizationRate * popRate;
  }

  const density = new Float64Array(provinces.length);
  for (let pId = 1; pId < provinces.length; pId++) {
    if (provArea[pId]) density[pId] = provPop[pId] / provArea[pId];
  }
  return density;
}

function drawProvinceLayers(provDensity: Float64Array, thresholds: number[]): void {
  const levels = thresholds.length;
  if (!levels) return;

  // One path per province, colored by its density bucket — no smoothing, exact borders
  const isolines = getIsolines(pack, (cellId: number) => pack.cells.province[cellId], { fill: true });

  for (const [provIdStr, isoline] of Object.entries(isolines) as [string, any][]) {
    const pId = +provIdStr;
    const pDensity = provDensity[pId];
    if (!pDensity || !isoline.fill) continue;

    // Highest threshold the province density meets
    let ti = 0;
    for (let j = levels - 1; j >= 0; j--) {
      if (pDensity >= thresholds[j]) {
        ti = j;
        break;
      }
    }
    const tFraction = ti / (levels - 1);
    const fillColor = interpolateYlOrRd(0.08 + tFraction * 0.92);

    population
      .append("path")
      .attr("d", isoline.fill)
      .attr("fill", fillColor)
      .attr("fill-opacity", 0.28 + tFraction * 0.37)
      .attr("stroke", color(fillColor)!.darker(0.3).toString())
      .attr("stroke-width", 0.5)
      .attr("stroke-opacity", 0.8);
  }
}

// ─── Cell mode ───────────────────────────────────────────────────────────────

function drawCellLayer(density: Float32Array, thresholds: number[]): void {
  const levels = thresholds.length;
  if (!levels) return;

  const { cells: packCells, vertices } = pack;
  const n = density.length;

  // Assign each cell to a bucket (1-based so 0 = invisible)
  const cellBucket = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!density[i]) continue;
    cellBucket[i] = 1;
    for (let j = levels - 1; j >= 0; j--) {
      if (density[i] >= thresholds[j]) {
        cellBucket[i] = j + 1;
        break;
      }
    }
  }

  // Build one SVG path string per bucket by concatenating cell polygons.
  // Each "M...Z" sub-path is independent — no winding / topology issues.
  const bucketPaths: string[] = new Array(levels + 1).fill("");
  for (let i = 0; i < n; i++) {
    const bucket = cellBucket[i];
    if (!bucket) continue;
    const polygon = (packCells.v[i] as number[]).map((v: number) => vertices.p[v] as [number, number]);
    bucketPaths[bucket] +=
      `M${polygon.map(([x, y]) => `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`).join("L")}Z`;
  }

  for (let bucket = 1; bucket <= levels; bucket++) {
    if (!bucketPaths[bucket]) continue;
    const tFraction = (bucket - 1) / (levels - 1);
    const fillColor = interpolateYlOrRd(0.08 + tFraction * 0.92);
    population
      .append("path")
      .attr("d", bucketPaths[bucket])
      .attr("fill", fillColor)
      .attr("fill-opacity", 0.28 + tFraction * 0.37)
      .attr("stroke", "none");
  }
}

// ─── Shared drawing ──────────────────────────────────────────────────────────

function buildThresholds(density: Float32Array): number[] {
  const nonZero = Array.from(density)
    .filter(d => d > 0)
    .sort((a, b) => a - b);
  if (!nonZero.length) return [];

  const logSorted = nonZero.map(d => Math.log(d)).sort((a, b) => a - b);
  const logMin = logSorted[Math.floor(0.05 * logSorted.length)];
  const logMax = logSorted[logSorted.length - 1];

  return Array.from({ length: LEVELS }, (_, i) => {
    const t = i / (LEVELS - 1);
    const logPercentile = logSorted[Math.min(Math.floor((0.05 + t * 0.95) * logSorted.length), logSorted.length - 1)];
    const logLinear = logMin + t * (logMax - logMin);
    return Math.exp((1 - t) * logPercentile + t * logLinear);
  }).filter((t, i, arr) => i === 0 || t > arr[i - 1] * 1.05);
}

function drawDensityLayers(density: Float32Array, thresholds: number[], cells: any, vertices: any, n: number): void {
  const lineGen = line<[number, number]>().curve(curveBasisClosed);
  const levels = thresholds.length;
  if (!levels) return;

  // All paths drawn opaque inside a single semi-transparent group.
  // Drawing lowest → highest means each band naturally covers the one below —
  // no evenodd subtraction, no stacking artifacts.
  const g = population.append("g").attr("opacity", 0.72);

  for (let ti = 0; ti < levels; ti++) {
    const t = thresholds[ti];
    const tFraction = ti / (levels - 1);
    const fillColor = interpolateYlOrRd(0.08 + tFraction * 0.92);

    const checkedCells = new Uint8Array(n);
    const addToChecked = (cellId: number) => {
      checkedCells[cellId] = 1;
    };
    const ofSameType = (cellId: number) => density[cellId] >= t;
    let path = "";

    for (const cellId of cells.i) {
      if (checkedCells[cellId] || !ofSameType(cellId)) continue;
      const startVertex = findStart(cellId, ofSameType, cells, vertices, n);
      if (startVertex === undefined) continue;
      checkedCells[cellId] = 1;
      const chain = connectVertices({ vertices, startingVertex: startVertex, ofSameType, addToChecked });
      const relaxed = chain.filter(
        (v: number, idx: number) => idx % 3 === 0 || vertices.c[v].some((c: number) => c >= n)
      );
      if (relaxed.length < 4) continue;
      path += round(lineGen(relaxed.map((v: number) => vertices.p[v] as [number, number])) || "");
    }

    if (!path) continue;
    g.append("path").attr("d", path).attr("fill", fillColor).attr("stroke", "none");
  }
}

function findStart(
  cellId: number,
  ofSameType: (c: number) => boolean,
  cells: any,
  vertices: any,
  n: number
): number | undefined {
  if (cells.b[cellId]) {
    return cells.v[cellId].find((v: number) => vertices.c[v].some((c: number) => c >= n));
  }
  const idx = cells.c[cellId].findIndex((c: number) => !ofSameType(c));
  if (idx === -1) return undefined;
  return cells.v[cellId][idx];
}

// ─── Legend ──────────────────────────────────────────────────────────────────

function drawLegend(thresholds: number[], distUnit: string): void {
  const levels = thresholds.length;
  if (!levels) return;

  const rowH = SWATCH_SIZE + SWATCH_GAP;
  const legendH = levels * rowH + LEGEND_PADDING * 2 + 14 + 18;
  const legendW = LEGEND_W;
  const x0 = 16;
  const y0 = graphHeight - legendH - 16;
  const areaUnit = `${distUnit}²`;
  // All modes store people/unit² directly — no conversion needed
  const toRealDensity = (t: number) => t;

  const g = population.append("g").attr("id", "populationLegend");

  // Background
  g.append("rect")
    .attr("x", x0)
    .attr("y", y0)
    .attr("width", legendW)
    .attr("height", legendH)
    .attr("fill", "white")
    .attr("fill-opacity", 0.65)
    .attr("rx", 3);

  // ── Toggle bar ──
  const toggleY = y0 + LEGEND_PADDING;
  const btnW = (legendW - LEGEND_PADDING * 2) / 3;

  const modes: { mode: PopulationMode; label: string }[] = [
    { mode: "province", label: "Province" },
    { mode: "isoline", label: "Isoline" },
    { mode: "cell", label: "Cell" }
  ];
  modes.forEach(({ mode, label }, idx) => {
    drawToggleButton(g, x0 + LEGEND_PADDING + idx * btnW, toggleY, btnW, label, populationMode === mode, () => {
      populationMode = mode;
      drawPopulation();
    });
  });

  // ── Title ──
  g.append("text")
    .attr("x", x0 + LEGEND_PADDING)
    .attr("y", y0 + LEGEND_PADDING + 18 + 8)
    .attr("font-size", 7)
    .attr("font-weight", "bold")
    .attr("fill", "#333")
    .text(`Pop. density (/${areaUnit})`);

  // ── Colour rows ──
  for (let i = levels - 1; i >= 0; i--) {
    const row = levels - 1 - i;
    const tFraction = i / (levels - 1);
    const fillColor = interpolateYlOrRd(0.08 + tFraction * 0.92);
    const swatchY = y0 + LEGEND_PADDING + 18 + 14 + row * rowH;

    g.append("rect")
      .attr("x", x0 + LEGEND_PADDING)
      .attr("y", swatchY)
      .attr("width", SWATCH_SIZE)
      .attr("height", SWATCH_SIZE)
      .attr("fill", fillColor)
      .attr("fill-opacity", 0.72)
      .attr("stroke", color(fillColor)!.darker(0.3).toString())
      .attr("stroke-width", 0.5);

    g.append("text")
      .attr("x", x0 + LEGEND_PADDING + LEGEND_TEXT_OFFSET)
      .attr("y", swatchY + SWATCH_SIZE - 2)
      .attr("font-size", 6)
      .attr("fill", "#333")
      .text(`≥ ${si(toRealDensity(thresholds[i]))}`);
  }
}

function drawToggleButton(
  g: any,
  x: number,
  y: number,
  w: number,
  label: string,
  active: boolean,
  onClick: () => void
): void {
  const h = 14;
  g.append("rect")
    .attr("x", x)
    .attr("y", y)
    .attr("width", w)
    .attr("height", h)
    .attr("fill", active ? "#d73027" : "#eee")
    .attr("rx", 2)
    .style("cursor", "pointer")
    .on("click", onClick);

  g.append("text")
    .attr("x", x + w / 2)
    .attr("y", y + h - 4)
    .attr("text-anchor", "middle")
    .attr("font-size", 6)
    .attr("font-weight", active ? "bold" : "normal")
    .attr("fill", active ? "white" : "#555")
    .style("cursor", "pointer")
    .on("click", onClick)
    .text(label);
}

window.drawPopulation = populationRenderer;
