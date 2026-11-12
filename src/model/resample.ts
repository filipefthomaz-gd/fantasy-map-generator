import { mean, quadtree } from "d3";
import { getPointsNumber } from "@/data/graph-density";
import { Measurers } from "@/model/annotations/measurers-generator";
import { Grid } from "@/model/graph/grid-generator";
import { Pack } from "@/model/graph/pack-generator";
import { MapRestoration } from "@/model/map-restoration";
import { Continents } from "@/model/physical/continents-generator";
import { Coordinates } from "@/model/physical/coordinates";
import { Features } from "@/model/physical/features-generator";
import { Ice } from "@/model/physical/ice-generator";
import { Temperature } from "@/model/physical/temperature-generator";
import type { GridGraph } from "@/types/grid-graph";
import type { PackedGraph } from "@/types/packed-graph";
import { isWater } from "@/utils/height-utils";

interface ResamplerProcessOptions {
  projection: (x: number, y: number) => [number, number];
  inverse: (x: number, y: number) => [number, number];
  scale: number;
}

class Resampler {
  private smoothHeightmap() {
    grid.cells.h.forEach((height: number, newGridCell: number) => {
      const heights = [height, ...grid.cells.c[newGridCell].map((c: number) => grid.cells.h[c])];
      const meanHeight = mean(heights) as number;
      grid.cells.h[newGridCell] = isWater(newGridCell, grid) ? Math.min(meanHeight, 19) : Math.max(meanHeight, 20);
    });
  }

  private resamplePrimaryGridData(
    parentGrid: GridGraph,
    parentPack: PackedGraph,
    inverse: (x: number, y: number) => [number, number],
    scale: number
  ) {
    grid.cells.h = new Uint8Array(grid.points.length);
    grid.cells.temp = new Int8Array(grid.points.length);
    grid.cells.prec = new Uint8Array(grid.points.length);

    const parentPackQ = quadtree(parentPack.cells.p.map(([x, y], i) => [x, y, i]));
    grid.points.forEach(([x, y]: [number, number], newGridCell: number) => {
      const [parentX, parentY] = inverse(x, y);
      const parentPackCell = parentPackQ.find(parentX, parentY, Infinity)?.[2];
      if (parentPackCell === undefined) return;
      const parentGridCell = parentPack.cells.g[parentPackCell];

      grid.cells.h[newGridCell] = parentGrid.cells.h[parentGridCell];
      grid.cells.temp[newGridCell] = parentGrid.cells.temp[parentGridCell];
      grid.cells.prec[newGridCell] = parentGrid.cells.prec[parentGridCell];
    });

    if (scale >= 2) {
      this.addHeightVariation(scale);
      this.smoothHeightmap();
    }
  }

  /** submaps copy parent heights, so add noise scaled with the zoom and elevation to avoid flat plateaus */
  private addHeightVariation(scale: number) {
    const maxAmplitude = Math.min(12, Math.round(4 * Math.log2(scale) + 1));
    grid.cells.h.forEach((_: number, cell: number) => {
      const current = grid.cells.h[cell];
      if (isWater(cell, grid)) {
        // water stays essentially flat — just enough to vary depth slightly
        const noise = Math.round(Math.random() * 2 - 1);
        grid.cells.h[cell] = Math.max(0, Math.min(19, current + noise));
        return;
      }
      // land: amplitude scales with elevation so lowlands stay flat, mountains get rough
      const heightFactor = 0.1 + 0.9 * ((current - 20) / 80);
      const amplitude = Math.round(maxAmplitude * heightFactor);
      const noise = Math.round((Math.random() * 2 - 1) * amplitude);
      grid.cells.h[cell] = Math.max(20, Math.min(100, current + noise));
    });
  }

  process(config: ResamplerProcessOptions): void {
    const { projection, inverse, scale } = config;
    const parentGrid = structuredClone(grid);
    const snapshot = MapRestoration.snapshot();

    options.map.graph.points = getPointsNumber(options.generation.graph.density);
    grid = Grid.generate(options.map.seed);
    pack = {} as PackedGraph;

    this.resamplePrimaryGridData(parentGrid, snapshot.pack, inverse, scale);

    Features.markupGrid();
    Grid.addDeepDepressionLakes();
    Grid.openNearSeaLakes();

    Coordinates.calculate();
    Temperature.generate();

    Pack.generate();
    if (!pack.cells.i.length) throw new Error("The area holds no land");
    Features.markupPack();
    Ice.generate();
    Measurers.createDefaultRuler();

    // relief is placed anew for the new scale on the first draw
    MapRestoration.restore(snapshot, { projection, inverse, scale, rivers: "restore", relief: false });
    Continents.generate();
  }
}

export const Resample = new Resampler();
