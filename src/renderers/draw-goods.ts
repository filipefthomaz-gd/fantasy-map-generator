import type { Good } from "../generators/goods-generator";
import { normalize, rn } from "../utils";

const SUBGROUPS = ["goodsCells", "goodsIcons", "goodsBurgs"] as const;

const SIZE = 6;
const HALF = SIZE / 2;

const PLATE_ICON = 3;
const PLATE_FONT = 3.5;
const PLATE_GAP = 0.2;
const PLATE_ENTRY_GAP = 0.8;
const PLATE_DY = 0;
const PLATE_PAD_X = 1;
const PLATE_PAD_Y = 0.6;
const PLATE_RX = 1;
const PLATE_FILL = "#f5f5f5";

export function toggleGoods(event?: MouseEvent) {
  if (!layerIsOn("toggleGoods")) {
    turnButtonOn("toggleGoods");
    drawGoods(GoodsEditor.getDisplayedGoods());
    if (event && isCtrlClick(event)) editStyle("goodsIcons");
  } else {
    if (event && isCtrlClick(event)) return editStyle("goodsIcons");
    SUBGROUPS.forEach(id => void goods.select(`#${id}`).html(""));
    turnButtonOff("toggleGoods");
  }
}

export function drawGoods(displayedGoods: Set<number>) {
  TIME && console.time("drawGoods");
  ensureSubgroups();

  goods.select("#goodsCells").html(buildGoodsCellsContent(displayedGoods));
  goods.select("#goodsIcons").html(buildGoodsIconsContent(displayedGoods));
  goods.select("#goodsBurgs").html(buildGoodsBurgsContent(displayedGoods));

  goods.style("display", null);
  TIME && console.timeEnd("drawGoods");
}

function ensureSubgroups() {
  for (const id of SUBGROUPS) {
    if (goods.select(`#${id}`).empty()) goods.append("g").attr("id", id);
  }
}

function buildGoodsCellsContent(displayedGoods: Set<number>): string {
  if (!displayedGoods.size) return "";

  // Pre-filter biomeProduction to only the displayed goods so getCellProduction
  // skips irrelevant goods without having to look them up per cell.
  const rawBiomeProduction = Goods.getBiomesProduction();
  const biomeProduction: typeof rawBiomeProduction = {};
  for (const biomeIdStr in rawBiomeProduction) {
    const filtered = rawBiomeProduction[+biomeIdStr].filter(e => displayedGoods.has(e.goodId));
    if (filtered.length) biomeProduction[+biomeIdStr] = filtered;
  }

  // First pass: accumulate total production and dominant good per cell
  const cellTotals = new Map<number, { dominantGoodId: number; total: number }>();
  let maxTotal = 0;

  for (const cellId of pack.cells.i) {
    // Skip zero-pop land cells without paying for getCellProduction
    const isWater = pack.cells.h[cellId] < 20;
    if (!isWater && !pack.cells.pop[cellId]) continue;

    const produced = Production.getCellProduction(cellId, biomeProduction);

    let total = 0;
    let dominantGoodId = 0;
    let dominantAmount = 0;
    for (const goodIdStr in produced) {
      const goodId = +goodIdStr;
      if (!displayedGoods.has(goodId)) continue;
      const amount = produced[goodId];
      if (amount <= 0) continue;
      total += amount;
      if (amount > dominantAmount) {
        dominantAmount = amount;
        dominantGoodId = goodId;
      }
    }
    if (!total || !dominantGoodId) continue;

    cellTotals.set(cellId, { dominantGoodId, total });
    if (total > maxTotal) maxTotal = total;
  }
  if (maxTotal === 0) return "";

  // Second pass: bucket cells by (goodId × opacity level) and build one <path>
  // per bucket — reduces potentially 20 000 <polygon> elements to at most
  // goods × OPACITY_BUCKETS elements (e.g. 20 goods × 10 = 200 paths).
  const OPACITY_BUCKETS = 10;
  const { cells: packCells, vertices } = pack;

  // key: `${goodId}|${bucket}` → accumulated path d string
  const bucketPaths = new Map<string, string>();

  for (const [cellId, { dominantGoodId, total }] of cellTotals) {
    const good = Goods.get(dominantGoodId);
    if (!good) continue;

    const t = normalize(total, 0, maxTotal);
    const bucket = Math.min(OPACITY_BUCKETS - 1, Math.floor(t * OPACITY_BUCKETS));
    const key = `${dominantGoodId}|${bucket}`;

    // Build the cell's path sub-string directly from vertex data (no intermediate array)
    const verts = packCells.v[cellId] as number[];
    let sub = "M";
    for (let vi = 0; vi < verts.length; vi++) {
      const [x, y] = vertices.p[verts[vi]] as [number, number];
      if (vi) sub += "L";
      sub += `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    }
    sub += "Z";

    const existing = bucketPaths.get(key);
    bucketPaths.set(key, existing ? existing + sub : sub);
  }

  // Emit one <path> per bucket — sorted so lighter bands render first
  const sorted = [...bucketPaths.entries()].sort((a, b) => {
    const ba = +a[0].split("|")[1];
    const bb = +b[0].split("|")[1];
    return ba - bb;
  });

  let html = "";
  for (const [key, d] of sorted) {
    const [goodIdStr, bucketStr] = key.split("|");
    const good = Goods.get(+goodIdStr);
    if (!good) continue;
    const t = (+bucketStr + 0.5) / OPACITY_BUCKETS;
    const opacity = rn(0.1 + 0.9 * t, 2);
    html += `<path d="${d}" fill="${good.color}" fill-opacity="${opacity}" stroke="none"/>`;
  }
  return html;
}

function buildGoodsIconsContent(displayedGoods: Set<number>): string {
  if (!displayedGoods.size || !pack.cells.good) return "";

  const drawCircle = +goods.select("#goodsIcons").attr("data-circle");
  let html = "";
  for (const cellId of pack.cells.i) {
    const goodId = pack.cells.good[cellId];
    if (!goodId || !displayedGoods.has(goodId)) continue;
    const good = Goods.get(goodId);
    if (!good) continue;

    const [x, y] = pack.cells.p[cellId];
    const stroke = Goods.getStroke(good.color);
    html += `<g data-i="${good.i}">${
      drawCircle ? `<circle cx="${x}" cy="${y}" r="${HALF}" fill="${good.color}" stroke="${stroke}" />` : ""
    }<use href="#${good.icon}" x="${x - HALF}" y="${y - HALF}" width="${SIZE}" height="${SIZE}"/></g>`;
  }
  return html;
}

function buildGoodsBurgsContent(displayedGoods: Set<number>): string {
  if (!displayedGoods.size) return "";

  let html = "";
  for (const burg of pack.burgs) {
    if (!burg.i || burg.removed || !burg.production) continue;

    const produced = Production.getBurgProduction(burg);
    const entries: { good: Good; value: number; width: number }[] = [];

    for (const good of pack.goods) {
      if (!displayedGoods.has(good.i)) continue;
      const raw = produced[good.i];
      if (!raw || raw <= 0) continue;

      const value = rn(raw, 1);
      if (entries.length === 3 && value <= entries[2].value) continue;

      const width = PLATE_ICON + PLATE_GAP + String(value).length * 1.2 + 0.4 * PLATE_FONT * 0.62;

      let i = entries.length;
      while (i > 0 && entries[i - 1].value < value) i--;
      entries.splice(i, 0, { good, value, width });
      if (entries.length > 3) entries.pop();
    }
    if (!entries.length) continue;

    const contentWidth = entries.reduce((sum, e) => sum + e.width, 0) + PLATE_ENTRY_GAP * (entries.length - 1);
    const plateWidth = contentWidth + PLATE_PAD_X * 2;
    const plateHeight = PLATE_ICON + PLATE_PAD_Y * 2;
    const plateX = burg.x - plateWidth / 2;
    const plateY = burg.y + PLATE_DY;
    const iconY = plateY + PLATE_PAD_Y;
    const mid = iconY + PLATE_ICON / 2;

    let content = `<rect x="${rn(plateX, 1)}" y="${rn(plateY, 1)}" width="${rn(plateWidth, 1)}" height="${rn(plateHeight, 1)}" rx="${PLATE_RX}" fill="${PLATE_FILL}"/>`;
    let offset = plateX + PLATE_PAD_X;
    for (const { good, value, width } of entries) {
      const stroke = Goods.getStroke(good.color);
      content += `<circle cx="${rn(offset + PLATE_ICON / 2, 1)}" cy="${rn(mid, 1)}" r="${PLATE_ICON / 2}" fill="${good.color}" stroke="${stroke}"/>`;
      content += `<use href="#${good.icon}" x="${rn(offset, 1)}" y="${rn(iconY, 1)}" width="${PLATE_ICON}" height="${PLATE_ICON}"/>`;
      content += `<text x="${rn(offset + PLATE_ICON + PLATE_GAP, 1)}" y="${rn(mid, 1)}" dominant-baseline="central" font-size="${PLATE_FONT}px" fill="#28282f" stroke="none">${value}</text>`;
      offset += width + PLATE_ENTRY_GAP;
    }

    html += `<g data-id="${burg.i}">${content}</g>`;
  }
  return html;
}

declare global {
  interface Window {
    toggleGoods: typeof toggleGoods;
    drawGoods: typeof drawGoods;
  }
}

window.toggleGoods = toggleGoods;
window.drawGoods = drawGoods;
