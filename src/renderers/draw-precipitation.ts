import { color, interpolateBlues } from "d3";
import { si } from "../utils";

declare global {
  var drawPrecipitation: () => void;
}

const LEVELS = 8;
const SWATCH_SIZE = 10;
const SWATCH_GAP = 3;
const LEGEND_PADDING = 8;
const LEGEND_TEXT_OFFSET = 14;
const LEGEND_W = 100;

type PrecipitationMode = "cells" | "symbols" | "province";

let precipitationMode: PrecipitationMode = "cells";

const precipitationRenderer = (): void => {
  TIME && console.time("drawPrecipitation");

  // Remove data elements but keep wind direction arrows (#wind group)
  prec.selectAll("circle, path").remove();
  prec.selectAll("#precipLegend").remove();

  // Fade in wind text elements
  prec.selectAll("text").attr("opacity", 0).transition().duration(600).attr("opacity", 1);

  if (precipitationMode === "cells") {
    drawCellsChoropleth();
  } else if (precipitationMode === "province") {
    drawProvinceChoropleth();
  } else {
    drawSymbols();
  }

  drawLegend();
  prec.style("display", "block");

  TIME && console.timeEnd("drawPrecipitation");
};

function getPrecValues(): Float32Array {
  const { cells: packCells } = pack;
  const gridPrec = grid.cells.prec;
  const gridG = packCells.g;
  const n = packCells.i.length;
  const values = new Float32Array(n);
  for (const i of packCells.i) {
    if (packCells.h[i] < 20) continue;
    values[i] = gridPrec[gridG[i]];
  }
  return values;
}

function buildThresholds(values: Float32Array): number[] {
  const nonZero = Array.from(values).filter(v => v > 0).sort((a, b) => a - b);
  if (!nonZero.length) return [];

  return Array.from({ length: LEVELS }, (_, i) => {
    return nonZero[Math.floor((i / LEVELS) * nonZero.length)];
  }).filter((t, i, arr) => i === 0 || t > arr[i - 1]);
}

function drawCellsChoropleth(): void {
  const { cells: packCells, vertices } = pack;
  const values = getPrecValues();
  const thresholds = buildThresholds(values);
  if (!thresholds.length) return;

  const levels = thresholds.length;
  const bucketPaths: string[] = new Array(levels + 1).fill("");

  for (const i of packCells.i) {
    if (!values[i]) continue;

    let bucket = 1;
    for (let j = levels - 1; j >= 0; j--) {
      if (values[i] >= thresholds[j]) { bucket = j + 1; break; }
    }

    const polygon = (packCells.v[i] as number[]).map((v: number) => vertices.p[v] as [number, number]);
    bucketPaths[bucket] += "M" + polygon.map(([x, y]) => `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`).join("L") + "Z";
  }

  for (let bucket = 1; bucket <= levels; bucket++) {
    if (!bucketPaths[bucket]) continue;
    const tFraction = (bucket - 1) / (levels - 1);
    const fillColor = interpolateBlues(0.15 + tFraction * 0.85);
    prec
      .append("path")
      .attr("d", bucketPaths[bucket])
      .attr("fill", fillColor)
      .attr("fill-opacity", 0.4 + tFraction * 0.45)
      .attr("stroke", color(fillColor)!.darker(0.2).toString())
      .attr("stroke-width", 0.3)
      .attr("stroke-opacity", 0.5);
  }
}

function getProvincePrecValues(): Float32Array {
  const { cells: packCells } = pack;
  const gridPrec = grid.cells.prec;
  const gridG = packCells.g;
  const n = packCells.i.length;

  const provSum = new Float64Array(pack.provinces.length);
  const provCount = new Uint32Array(pack.provinces.length);
  for (const i of packCells.i) {
    if (packCells.h[i] < 20) continue;
    const p = packCells.province[i];
    if (!p) continue;
    provSum[p] += gridPrec[gridG[i]];
    provCount[p]++;
  }

  const values = new Float32Array(n);
  for (const i of packCells.i) {
    if (packCells.h[i] < 20) continue;
    const p = packCells.province[i];
    if (!p || !provCount[p]) continue;
    values[i] = provSum[p] / provCount[p];
  }
  return values;
}

function drawProvinceChoropleth(): void {
  const { cells: packCells, vertices } = pack;
  const values = getProvincePrecValues();
  const thresholds = buildThresholds(values);
  if (!thresholds.length) return;

  const levels = thresholds.length;
  const bucketPaths: string[] = new Array(levels + 1).fill("");

  for (const i of packCells.i) {
    if (!values[i]) continue;
    let bucket = 1;
    for (let j = levels - 1; j >= 0; j--) {
      if (values[i] >= thresholds[j]) { bucket = j + 1; break; }
    }
    const polygon = (packCells.v[i] as number[]).map((v: number) => vertices.p[v] as [number, number]);
    bucketPaths[bucket] += "M" + polygon.map(([x, y]) => `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`).join("L") + "Z";
  }

  for (let bucket = 1; bucket <= levels; bucket++) {
    if (!bucketPaths[bucket]) continue;
    const tFraction = (bucket - 1) / (levels - 1);
    const fillColor = interpolateBlues(0.15 + tFraction * 0.85);
    prec
      .append("path")
      .attr("d", bucketPaths[bucket])
      .attr("fill", fillColor)
      .attr("fill-opacity", 0.4 + tFraction * 0.45)
      .attr("stroke", color(fillColor)!.darker(0.2).toString())
      .attr("stroke-width", 0.3)
      .attr("stroke-opacity", 0.5);
  }
}

function drawSymbols(): void {
  const { cells, points } = grid;
  const cellsNumberModifier = ((window as any).pointsInput.dataset.cells / 10000) ** 0.25;
  const data = cells.i.filter((i: number) => cells.h[i] >= 20 && cells.prec[i]);
  const getRadius = (p: number) => Math.round(Math.sqrt(p / 4) / cellsNumberModifier * 100) / 100;

  prec
    .selectAll("circle")
    .data(data as number[])
    .enter()
    .append("circle")
    .attr("cx", (d: number) => points[d][0])
    .attr("cy", (d: number) => points[d][1])
    .attr("r", (d: number) => getRadius(cells.prec[d]));
}

function drawLegend(): void {
  const values = precipitationMode === "province" ? getProvincePrecValues() : getPrecValues();
  const thresholds = buildThresholds(values);
  const levels = thresholds.length;
  if (!levels) return;

  const rowH = SWATCH_SIZE + SWATCH_GAP;
  const legendH = levels * rowH + LEGEND_PADDING * 2 + 14 + 18;
  const x0 = 16;
  const y0 = graphHeight - legendH - 16;

  const g = prec.append("g").attr("id", "precipLegend").attr("stroke", "none").style("text-shadow", "none");

  g.append("rect")
    .attr("x", x0).attr("y", y0)
    .attr("width", LEGEND_W).attr("height", legendH)
    .attr("fill", "white").attr("fill-opacity", 0.65).attr("rx", 3);

  // Mode toggle buttons
  const toggleY = y0 + LEGEND_PADDING;
  const btnW = (LEGEND_W - LEGEND_PADDING * 2) / 3;

  const modes: { mode: PrecipitationMode; label: string }[] = [
    { mode: "cells", label: "Cells" },
    { mode: "symbols", label: "Symbols" },
    { mode: "province", label: "Province" },
  ];

  modes.forEach(({ mode, label }, idx) => {
    drawToggleButton(g, x0 + LEGEND_PADDING + idx * btnW, toggleY, btnW, label, precipitationMode === mode, () => {
      precipitationMode = mode;
      drawPrecipitation();
    });
  });

  // Title
  g.append("text")
    .attr("x", x0 + LEGEND_PADDING)
    .attr("y", y0 + LEGEND_PADDING + 18 + 8)
    .style("font-size", "7px").attr("font-weight", "bold").attr("fill", "#333")
    .text("Precipitation (mm/yr)");

  // Color rows (highest first)
  for (let i = levels - 1; i >= 0; i--) {
    const row = levels - 1 - i;
    const tFraction = i / (levels - 1);
    const fillColor = interpolateBlues(0.15 + tFraction * 0.85);
    const swatchY = y0 + LEGEND_PADDING + 18 + 14 + row * rowH;

    g.append("rect")
      .attr("x", x0 + LEGEND_PADDING).attr("y", swatchY)
      .attr("width", SWATCH_SIZE).attr("height", SWATCH_SIZE)
      .attr("fill", fillColor).attr("fill-opacity", 0.72)
      .attr("stroke", color(fillColor)!.darker(0.3).toString())
      .attr("stroke-width", 0.5);

    const mmVal = thresholds[i] * 100;
    g.append("text")
      .attr("x", x0 + LEGEND_PADDING + LEGEND_TEXT_OFFSET)
      .attr("y", swatchY + SWATCH_SIZE - 2)
      .style("font-size", "6px").attr("fill", "#333")
      .text(`≥ ${si(mmVal)} mm`);
  }
}

function drawToggleButton(
  g: any,
  x: number,
  y: number,
  w: number,
  label: string,
  active: boolean,
  onClick: () => void,
): void {
  const h = 14;
  g.append("rect")
    .attr("x", x).attr("y", y).attr("width", w).attr("height", h)
    .attr("fill", active ? "#2166ac" : "#eee")
    .attr("rx", 2)
    .style("cursor", "pointer")
    .on("click", onClick);

  g.append("text")
    .attr("x", x + w / 2).attr("y", y + h - 4)
    .attr("text-anchor", "middle")
    .style("font-size", "6px").attr("font-weight", active ? "bold" : "normal")
    .attr("fill", active ? "white" : "#555")
    .style("cursor", "pointer")
    .on("click", onClick)
    .text(label);
}

window.drawPrecipitation = precipitationRenderer;
