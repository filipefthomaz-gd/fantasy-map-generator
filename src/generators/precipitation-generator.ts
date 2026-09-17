// The simplest precipitation model: winds enter the map from each side and drop humidity as they pass the cells
import Alea from "alea";
import { mean, range } from "d3";
import { minmax, rand, SEA_LEVEL } from "@/utils";

declare global {
  var Precipitation: PrecipitationModule;
}

type WindBand = [number, number, number]; // [firstCellId, latitudeModifier, windTier]
type Winds = { westerly: WindBand[]; easterly: WindBand[]; northerly: number; southerly: number };

// precipitation modifier per 5° latitude band
// x4 = 0-5 latitude: wet through the year (rising zone)
// x2 = 5-20 latitude: wet summer (rising zone), dry winter (sinking zone)
// x1 = 20-30 latitude: dry all year (sinking zone)
// x2 = 30-50 latitude: wet winter (rising zone), dry summer (sinking zone)
// x3 = 50-60 latitude: wet all year (rising zone)
// x2 = 60-70 latitude: wet summer (rising zone), dry winter (sinking zone)
// x1 = 70-85 latitude: dry all year (sinking zone)
// x0.5 = 85-90 latitude: dry all year (sinking zone)
const LATITUDE_MODIFIER = [4, 2, 2, 2, 1, 1, 2, 2, 2, 2, 3, 3, 2, 2, 1, 1, 1, 0.5];

const MAX_PASSABLE_ELEVATION = 85;
const TIER_BLEND_DEGREES = 7; // blend zone width (degrees) on each side of a wind tier boundary
const VERTICAL_BLUR_PASSES = 3; // north-south smoothing of the tier-boundary precipitation bands

class PrecipitationModule {
  /** pass every wind over the cells it reaches, filling `grid.cells.prec` on the way */
  generate(): void {
    grid.cells.prec = this.compute(grid.cells.h, grid.cells.temp);
  }

  /** precipitation of every grid cell for the given heights and temperatures, the grid itself stays untouched */
  compute(h: ArrayLike<number>, temp: ArrayLike<number>): Uint8Array {
    Math.random = Alea(options.map.seed); // the same winds for the same map, whoever rolled before
    const { cells, cellsX, cellsY } = grid;
    let prec = new Uint8Array(cells.i.length);

    const cellsNumberModifier = (Grid.getCellsDesired() / 10000) ** 0.25;
    const modifier = cellsNumberModifier * (options.map.climate.precipitation / 100);

    const getPrecipitation = (humidity: number, i: number, n: number) => {
      const normalLoss = Math.max(humidity / (12 * modifier), 1); // precipitation in normal conditions
      const diff = Math.max(h[i + n] - h[i], 0); // difference in height
      const mod = (h[i + n] / 70) ** 2; // 50 stands for hills, 70 for mountains
      return minmax(normalLoss + diff * mod, 1, humidity);
    };

    const passWind = (sources: (number | WindBand)[], initialMaxPrec: number, next: number, steps: number) => {
      let maxPrec = initialMaxPrec;

      for (const source of sources) {
        let first: number;
        if (Array.isArray(source)) {
          if (!source[0]) continue; // legacy quirk: a band starting at cell 0 is skipped, fixing it changes every map
          maxPrec = Math.min(initialMaxPrec * source[1], 255);
          first = source[0];
        } else first = source;

        let humidity = maxPrec - h[first]; // initial water amount
        if (humidity <= 0) continue; // if first cell in row is too elevated consider wind dry

        for (let s = 0, current = first; s < steps; s++, current += next) {
          if (temp[current] < -5) continue; // no flux in permafrost

          if (h[current] < SEA_LEVEL) {
            if (h[current + next] >= SEA_LEVEL) {
              prec[current + next] += Math.max(humidity / rand(15, 25), 1); // coastal precipitation
            } else {
              humidity = Math.min(humidity + 5 * modifier, maxPrec); // wind gets more humidity passing water cell
              prec[current] += 5 * modifier; // water cells precipitation (need to correctly pour water through lakes)
            }
            continue;
          }

          // land cell
          const isPassable = h[current + next] <= MAX_PASSABLE_ELEVATION;
          const precipitation = isPassable ? getPrecipitation(humidity, current, next) : humidity;
          prec[current] += precipitation;
          const evaporation = precipitation > 1.5 ? 1 : 0; // some humidity evaporates back to the atmosphere
          humidity = isPassable ? minmax(humidity - precipitation + evaporation, 0, maxPrec) : 0;
        }
      }
    };

    const { westerly, easterly, northerly, southerly } = this.getWinds({ blendTiers: true });

    // horizontal passes
    if (westerly.length) passWind(westerly, 120 * modifier, 1, cellsX);
    if (easterly.length) passWind(easterly, 120 * modifier, -1, cellsX);
    const precH = prec;

    // vertical passes into a separate accumulator
    prec = new Uint8Array(cells.i.length);
    const vertT = southerly + northerly;
    if (northerly) {
      const bandN = ((Math.abs(options.map.geography.coordinates.latN) - 1) / 5) | 0;
      const latModN =
        options.map.geography.coordinates.latT > 60 ? (mean(LATITUDE_MODIFIER) as number) : LATITUDE_MODIFIER[bandN];
      const maxPrecN = (northerly / vertT) * 60 * modifier * latModN;
      passWind(range(0, cellsX, 1), maxPrecN, cellsX, cellsY);
    }

    if (southerly) {
      const bandS = ((Math.abs(options.map.geography.coordinates.latS) - 1) / 5) | 0;
      const latModS =
        options.map.geography.coordinates.latT > 60 ? (mean(LATITUDE_MODIFIER) as number) : LATITUDE_MODIFIER[bandS];
      const maxPrecS = (southerly / vertT) * 60 * modifier * latModS;
      passWind(range(cells.i.length - cellsX, cells.i.length, 1), maxPrecS, -cellsX, cellsY);
    }

    prec = this.combinePasses(precH, prec);
    this.blurVertically(prec, cellsX, cellsY);
    return prec;
  }

  /** sum both passes, reduced where they contribute alike: corners exposed to both would double up */
  private combinePasses(precH: Uint8Array, precV: Uint8Array): Uint8Array<ArrayBuffer> {
    const combined = new Uint8Array(precH.length);
    for (let i = 0; i < precH.length; i++) {
      const h = precH[i];
      const v = precV[i];
      const total = h + v;
      if (!total) continue;
      const balance = (2 * Math.min(h, v)) / total; // 0 = one-sided, 1 = equally from both
      const factor = 1 - 0.2 * balance * balance; // soft curve, max ~20% reduction at perfect balance
      combined[i] = minmax(Math.round(total * factor), 0, 255);
    }
    return combined;
  }

  /** blur north-south only, so the east-west rain-shadow structure is preserved */
  private blurVertically(prec: Uint8Array, cellsX: number, cellsY: number): void {
    const precF = new Float32Array(prec);
    for (let pass = 0; pass < VERTICAL_BLUR_PASSES; pass++) {
      const src = precF.slice();
      for (let r = 1; r < cellsY - 1; r++) {
        for (let c = 0; c < cellsX; c++) {
          const i = r * cellsX + c;
          precF[i] = (src[i - cellsX] + src[i] * 2 + src[i + cellsX]) / 4;
        }
      }
    }
    for (let i = 0; i < prec.length; i++) prec[i] = minmax(Math.round(precF[i]), 0, 255);
  }

  /**
   * rows and columns the prevailing winds enter the map through, derived from the map position and
   * the wind angles. Free of randomness, so the renderer can ask for them at any time
   */
  getWinds({ blendTiers = false } = {}): Winds {
    const { cells, cellsX, cellsY } = grid;
    const westerly: WindBand[] = [];
    const easterly: WindBand[] = [];
    let northerly = 0;
    let southerly = 0;

    const getDirections = (tier: number) => {
      const angle = options.map.climate.winds[tier];
      return {
        isWest: angle > 40 && angle < 140,
        isEast: angle > 220 && angle < 320,
        isNorth: angle > 100 && angle < 260,
        isSouth: angle > 280 || angle < 80
      };
    };

    range(0, cells.i.length, cellsX).forEach((cellId, rowId) => {
      const lat = options.map.geography.coordinates.latN - (rowId / cellsY) * options.map.geography.coordinates.latT;

      // interpolate the latitude modifier between bands, so humidity doesn't jump at band edges
      const bandExact = Math.max(0, (Math.abs(lat) - 1) / 5);
      const bandLow = Math.min(Math.floor(bandExact), LATITUDE_MODIFIER.length - 1);
      const bandHigh = Math.min(bandLow + 1, LATITUDE_MODIFIER.length - 1);
      const t = bandExact - bandLow;
      const latMod = LATITUDE_MODIFIER[bandLow] * (1 - t) + LATITUDE_MODIFIER[bandHigh] * t;

      const tier = (Math.abs(lat - 89) / 30) | 0; // 30° tiers from 0 to 5, north to south
      const { isWest, isEast, isNorth, isSouth } = getDirections(tier);

      if (isWest) westerly.push([cellId, latMod, tier]);
      if (isEast) easterly.push([cellId + cellsX - 1, latMod, tier]);
      if (isNorth) northerly++;
      if (isSouth) southerly++;
      if (!blendTiers) return;

      // blend into the adjacent tier near the boundary to soften hard precipitation transitions. Only
      // the directions the adjacent tier has and this one lacks are added: only a west↔east flip bands
      const posInTier = Math.abs(lat - 89) % 30; // degrees from the tier start
      let adjTier = -1;
      let weight = 0;
      if (posInTier > 30 - TIER_BLEND_DEGREES && tier < 5) {
        adjTier = tier + 1;
        weight = (posInTier - (30 - TIER_BLEND_DEGREES)) / TIER_BLEND_DEGREES;
      } else if (posInTier < TIER_BLEND_DEGREES && tier > 0) {
        adjTier = tier - 1;
        weight = (TIER_BLEND_DEGREES - posInTier) / TIER_BLEND_DEGREES;
      }
      if (adjTier < 0) return;

      const adj = getDirections(adjTier);
      if (adj.isWest && !isWest) westerly.push([cellId, latMod * weight, adjTier]);
      if (adj.isEast && !isEast) easterly.push([cellId + cellsX - 1, latMod * weight, adjTier]);
    });

    return { westerly, easterly, northerly, southerly };
  }
}

window.Precipitation = new PrecipitationModule();
