import { RESOURCES } from "@/generators/resources-generator";
import { ensureEl, getIsolines } from "@/utils";
import { buildFillPaths } from "./isoline-fills";

const TARGET_ICONS = 600; // emoji icons are sampled so the layer stays readable on dense maps
const EMOJI_FONTS = "'Apple Color Emoji','Noto Color Emoji','Segoe UI Emoji','Segoe UI Symbol',sans-serif";

/** Colored fills per resource, masked to land, with sampled emoji icons labelling the regions */
export function drawResources(): void {
  TIME && console.time("drawResources");
  const { cells } = pack;
  if (!cells.resource) Resources.generate();
  const resource = cells.resource!;

  const isolines = getIsolines(pack, cellId => resource[cellId], { fill: true, waterGap: true });
  delete isolines[0]; // index 0 = no resource
  const fills = buildFillPaths("resource", isolines, index => RESOURCES[index]?.color ?? "none");

  const resourceCells = Array.from(cells.i as ArrayLike<number>).filter(i => resource[i] > 0);
  const skip = Math.max(1, Math.ceil(resourceCells.length / TARGET_ICONS));
  const icons = resourceCells
    .filter((_, idx) => idx % skip === 0)
    .map(i => {
      const [x, y] = cells.p[i];
      return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="12px">${RESOURCES[resource[i]]?.icon ?? ""}</text>`;
    })
    .join("");

  // fills are masked to land; icons sit outside the mask so they always render
  ensureEl("resources").innerHTML =
    `<g mask="url(#land)">${fills}</g>` +
    `<g id="resourceIcons" font-family="${EMOJI_FONTS}" pointer-events="none">${icons}</g>`;
  TIME && console.timeEnd("drawResources");
}
