import { ensureEl, getIsolines } from "@/utils";
import { buildFillPaths } from "./isoline-fills";

export function drawContinents(): void {
  TIME && console.time("drawContinents");
  const { cells, continents } = pack;
  if (!continents?.length || !cells.continent) return;

  const isolines = getIsolines(pack, cellId => cells.continent![cellId], { fill: true, waterGap: true });
  ensureEl("conts").innerHTML = buildFillPaths("continent", isolines, index => continents[index]?.color ?? "none");
  TIME && console.timeEnd("drawContinents");
}
