// Seasonal overlay: a quarter of the year shifts biome colors, ice opacity, river widths and
// displayed temperatures. Presentation only: the generated data is never changed
import { Layers } from "@/components/layers";
import { ensureEl } from "@/utils";

export type Quarter = "q1" | "q2" | "q3" | "q4";
export const QUARTERS: Quarter[] = ["q1", "q2", "q3", "q4"];

// Biome colors from a NORTHERN hemisphere perspective per quarter.
// Southern hemisphere biomes will be visually inverted (limitation of per-biome-index rendering).
// 13 biomes (indices 0-12):
// 0:Marine  1:Hot desert  2:Cold desert  3:Savanna  4:Grassland
// 5:Tropical seasonal forest  6:Temperate deciduous forest  7:Tropical rainforest
// 8:Temperate rainforest  9:Taiga  10:Tundra  11:Glacier  12:Wetland
const SEASON_BIOME_COLORS: Record<Quarter, string[]> = {
  q2: [
    // N.spring / S.autumn — greening north, warming up
    "#466eab", // Marine: unchanged
    "#fbe79f", // Hot desert: unchanged
    "#c8ca9a", // Cold desert: hints of green
    "#aace72", // Savanna: lush green (wet/rainy season)
    "#88d45a", // Grassland: bright spring green
    "#7dcf4a", // Tropical seasonal forest: verdant
    "#2ec85e", // Temperate deciduous forest: fresh spring green
    "#7dcb35", // Tropical rainforest: unchanged (evergreen)
    "#409c43", // Temperate rainforest: unchanged (evergreen)
    "#4b6b32", // Taiga: unchanged (evergreen)
    "#7a8a50", // Tundra: mossy awakening
    "#d5e7eb", // Glacier: unchanged
    "#0ba838" // Wetland: vibrant green
  ],
  q3: [
    // N.summer / S.winter — peak warmth north, dry/dormant south
    "#466eab", // Marine: unchanged
    "#fcd46a", // Hot desert: intense golden heat
    "#c0bf88", // Cold desert: unchanged
    "#c4a835", // Savanna: golden dry season
    "#a0c060", // Grassland: mid-season green
    "#6bcc30", // Tropical seasonal forest: deep green
    "#1fa845", // Temperate deciduous forest: peak summer green
    "#7dcb35", // Tropical rainforest: unchanged (evergreen)
    "#3a9040", // Temperate rainforest: slightly deeper
    "#4b6b32", // Taiga: unchanged (evergreen)
    "#8a7040", // Tundra: sun-dried brown
    "#d5e7eb", // Glacier: unchanged
    "#0a9432" // Wetland: dense green
  ],
  q4: [
    // N.autumn / S.spring — fall colors north, greening south
    "#466eab", // Marine: unchanged
    "#fbe79f", // Hot desert: unchanged
    "#c0bf88", // Cold desert: unchanged
    "#c8a840", // Savanna: golden
    "#c4b050", // Grassland: amber gold
    "#a89430", // Tropical seasonal forest: drying out
    "#c86820", // Temperate deciduous forest: vivid autumn orange-red
    "#7dcb35", // Tropical rainforest: unchanged (evergreen)
    "#387838", // Temperate rainforest: unchanged
    "#4b6b32", // Taiga: unchanged (evergreen)
    "#8c6840", // Tundra: rusty brown
    "#d5e7eb", // Glacier: unchanged
    "#5a8830" // Wetland: darkening
  ],
  q1: [
    // N.winter / S.summer — dormant/bare north, warm south
    "#466eab", // Marine: unchanged
    "#fbe79f", // Hot desert: unchanged (warm deserts don't freeze)
    "#d0d0c0", // Cold desert: snow-dusted pale
    "#b0a870", // Savanna: pale dry season
    "#9aac82", // Grassland: dormant grey-green
    "#9ca870", // Tropical seasonal forest: subdued
    "#707860", // Temperate deciduous forest: bare grey-brown
    "#7dcb35", // Tropical rainforest: unchanged (equatorial, no winter)
    "#3a8840", // Temperate rainforest: unchanged (maritime climate)
    "#8090a0", // Taiga: snow-heavy blue-grey
    "#c0cad0", // Tundra: snow-covered white
    "#d5e7eb", // Glacier: unchanged
    "#608060" // Wetland: frozen grey-green
  ]
};

// Ice opacity — Q1 = full ice in north, Q3 = minimal northern ice
// (southern polar ice behaves opposite but ice layer is global; this is a simplification)
const SEASON_ICE_OPACITY: Record<Quarter, number> = { q1: 1.0, q2: 0.7, q3: 0.35, q4: 0.8 };

// River width multiplier per quarter, from a northern hemisphere perspective.
// Q2 (N.spring): snowmelt flood. Q3: low summer flow. Q1: frozen/reduced.
const SEASON_RIVER_WIDTH: Record<Quarter, number> = { q1: 0.55, q2: 1.5, q3: 0.75, q4: 1.0 };

// How much each biome amplifies or dampens seasonal temperature swings.
// Oceans and humid tropics buffer heat; continental deserts and taiga amplify it.
const BIOME_TEMP_MODIFIER: number[] = [
  0.5, // 0  Marine: ocean heavily buffers temperature
  1.2, // 1  Hot desert: continental, extreme swings
  1.15, // 2  Cold desert: continental
  1.0, // 3  Savanna
  1.0, // 4  Grassland
  0.85, // 5  Tropical seasonal forest: humid, buffered
  1.0, // 6  Temperate deciduous forest
  0.7, // 7  Tropical rainforest: equatorial, very stable year-round
  0.8, // 8  Temperate rainforest: maritime climate
  1.2, // 9  Taiga: strongly continental
  1.1, // 10 Tundra
  1.1, // 11 Glacier
  0.85 // 12 Wetland: water buffers temperature
];

// Q3 = northern summer: north gets +amplitude, south gets -amplitude.
// Q1 = northern winter: north gets -amplitude, south gets +amplitude.
// Multiplied by sign(lat) so hemispheres oppose each other correctly.
const QUARTER_TEMP_SIGN: Record<Quarter, number> = { q1: -1.0, q2: 0.35, q3: 1.0, q4: -0.35 };

class SeasonsModule {
  private current: Quarter | null = null; // null = no quarter active
  private temps: Int8Array | null = null; // grid temperatures adjusted to the active quarter
  private tempsSource: Int8Array | null = null; // the grid temperatures the adjusted ones were derived from

  get active(): Quarter | null {
    return this.current;
  }

  /** toggle a quarter on, or off when it is the active one */
  set(quarter: Quarter | null): void {
    this.current = quarter === this.current ? null : quarter;
    this.computeTemps();
    this.syncButtons();
    this.applyLayers();
  }

  /** grid cell temperatures adjusted to the active quarter, null when no quarter is active */
  getTemps(): Int8Array | null {
    // a new or regenerated map replaces grid.cells.temp: derive the seasonal temperatures again
    if (this.current && this.tempsSource !== grid.cells.temp) this.computeTemps();
    return this.temps;
  }

  /** the display temperature of a grid cell, respecting the active quarter */
  getDisplayTemp(gridCellId: number): number {
    return this.getTemps()?.[gridCellId] ?? grid.cells.temp[gridCellId];
  }

  /** biome color for the active quarter, undefined when no quarter is active */
  getBiomeColor(biomeId: number): string | undefined {
    return this.current ? SEASON_BIOME_COLORS[this.current][biomeId] : undefined;
  }

  /** river width factor scaled to the active quarter */
  getRiverWidthFactor(baseWidthFactor: number): number {
    return this.current ? baseWidthFactor * SEASON_RIVER_WIDTH[this.current] : baseWidthFactor;
  }

  private computeTemps(): void {
    if (!this.current || !grid.cells?.temp) {
      this.temps = null;
      this.tempsSource = null;
      return;
    }

    const { cells, points } = grid;
    const { latN, latT } = options.map.geography.coordinates;
    const { height } = options.map.graph;
    const n = cells.i.length;
    const quarterSign = QUARTER_TEMP_SIGN[this.current];

    // grid cell → biome lookup via pack.cells.g (each pack cell stores its grid cell index)
    const gridToBiome = new Uint8Array(n);
    for (let i = 0; i < pack.cells.i.length; i++) {
      const gridIdx = pack.cells.g[i];
      if (gridIdx < n) gridToBiome[gridIdx] = pack.cells.biome[i];
    }

    const seasonal = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      const lat = latN - (points[i][1] / height) * latT; // positive = N, negative = S
      const latSign = lat > 0 ? 1 : lat < 0 ? -1 : 0;

      // amplitude scales with absolute latitude; 0.2 gives ~16°C swing at 80° which matches real Arctic data
      const amplitude = Math.abs(lat) * 0.2;
      const biomeModifier = BIOME_TEMP_MODIFIER[gridToBiome[i]] ?? 1.0;

      // quarterSign × latSign: Q3 makes north warm AND south cold simultaneously
      const delta = Math.round(quarterSign * latSign * amplitude * biomeModifier);
      seasonal[i] = Math.max(-128, Math.min(127, cells.temp[i] + delta));
    }

    this.temps = seasonal;
    this.tempsSource = cells.temp;
  }

  private applyLayers(): void {
    ensureEl("ice").setAttribute("opacity", String(this.current ? SEASON_ICE_OPACITY[this.current] : 1));
    Layers.draw("biomes", "rivers", "temperature");
  }

  private syncButtons(): void {
    for (const btn of Array.from(document.querySelectorAll<HTMLElement>(".season-btn"))) {
      btn.classList.toggle("active", btn.dataset.season === this.current);
    }
  }
}

export const Seasons = new SeasonsModule();

export const SEASON_BUTTONS_HTML = /* html */ `
  <p>Season overlay:</p>
  <div id="seasonButtons">
    <button class="season-btn" data-season="q1" data-tip="Q1 (Jan–Mar): N. winter / S. summer — cold north, warm south, swollen southern rivers">Q1</button>
    <button class="season-btn" data-season="q2" data-tip="Q2 (Apr–Jun): N. spring / S. autumn — northern thaw, southern cooling">Q2</button>
    <button class="season-btn" data-season="q3" data-tip="Q3 (Jul–Sep): N. summer / S. winter — warm north, cold south, swollen northern rivers">Q3</button>
    <button class="season-btn" data-season="q4" data-tip="Q4 (Oct–Dec): N. autumn / S. spring — northern cooling, southern thaw">Q4</button>
  </div>`;

/** wire the season buttons rendered from SEASON_BUTTONS_HTML */
export function bindSeasonButtons(): void {
  ensureEl("seasonButtons").addEventListener("click", event => {
    const quarter = (event.target as HTMLElement).closest<HTMLElement>(".season-btn")?.dataset.season;
    if (quarter) Seasons.set(quarter as Quarter);
  });
}
