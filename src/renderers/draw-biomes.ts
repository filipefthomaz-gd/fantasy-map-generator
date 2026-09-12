import { Seasons } from "@/components/seasons";
import { ensureEl, getIsolines } from "@/utils";
import { buildFillPaths } from "./isoline-fills";

export function drawBiomes(): void {
  TIME && console.time("drawBiomes");

  const isolines = getIsolines(pack, cellId => pack.cells.biome[cellId], { fill: true, waterGap: true });
  ensureEl("biomes").innerHTML = buildFillPaths(
    "biome",
    isolines,
    index => Seasons.getBiomeColor(index) ?? pack.biomes[index].color
  );

  TIME && console.timeEnd("drawBiomes");
}
