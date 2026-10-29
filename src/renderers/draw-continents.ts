import { log } from "@/utils/logger";
import { ensureEl } from "@/utils/node-utils";
import { getIsolines } from "@/utils/path-utils";
import { buildFillPaths } from "./isoline-fills";

export function drawContinents(): void {
  log.time("drawContinents");
  const { cells, continents } = pack;
  if (!continents?.length || !cells.continent) return;

  const isolines = getIsolines(pack, cellId => cells.continent![cellId], { fill: true, waterGap: true });
  ensureEl("conts").innerHTML = buildFillPaths("continent", isolines, index => continents[index]?.color ?? "none");
  log.timeEnd("drawContinents");
}
