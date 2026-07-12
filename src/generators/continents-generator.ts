import { getColors, getRandomColor } from "../utils";
import type { PackedGraphFeature } from "./features";

declare global {
  var Continents: ContinentsModule;
}

export interface Continent {
  i: number;
  name: string;
  color: string;
  feature: number;
}

// Groups that count as a continent landmass (not tiny islets or lake islands)
const CONTINENT_GROUPS = new Set(["continent", "island"]);

class ContinentsModule {
  generate() {
    const continentFeatures = pack.features.filter(
      (f): f is PackedGraphFeature => !!f && CONTINENT_GROUPS.has(f.group)
    );

    const colors = getColors(continentFeatures.length);

    const continents: Continent[] = [{ i: 0, name: "Ocean", color: "", feature: 0 }];

    continentFeatures.forEach((feature, idx) => {
      const dominantCulture = this.getDominantCulture(feature);
      const name = Names.getCulture(dominantCulture, 5, 10);
      continents.push({
        i: idx + 1,
        name,
        color: colors[idx] || getRandomColor(),
        feature: feature.i
      });
    });

    pack.continents = continents;
    this.deriveCells();
  }

  deriveCells() {
    const continentIds = new Uint8Array(pack.cells.i.length);
    const featureToContinent = new Map<number, number>();
    for (const c of pack.continents) {
      if (c.i) featureToContinent.set(c.feature, c.i);
    }
    for (const cellId of pack.cells.i) {
      const featureId = pack.cells.f[cellId];
      continentIds[cellId] = featureToContinent.get(featureId) ?? 0;
    }
    pack.cells.continent = continentIds;
  }

  private getDominantCulture(feature: PackedGraphFeature): number {
    const counts = new Map<number, number>();
    for (const cellId of pack.cells.i) {
      if (pack.cells.f[cellId] !== feature.i) continue;
      if (pack.cells.h[cellId] < 20) continue;
      const c = pack.cells.culture[cellId];
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let maxCount = 0;
    let dominant = 1;
    for (const [culture, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        dominant = culture;
      }
    }
    return dominant;
  }
}

window.Continents = new ContinentsModule();
