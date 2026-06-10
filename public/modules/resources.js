"use strict";

const RESOURCES = [
  null,
  {id: 1,  name: "Crops",     icon: "🌾", color: "#d4c44a"},
  {id: 2,  name: "Orchards",  icon: "🍎", color: "#e07b3a"},
  {id: 3,  name: "Vineyards", icon: "🍇", color: "#8b4789"},
  {id: 4,  name: "Berries",   icon: "🫐", color: "#7b5ea7"},
  {id: 5,  name: "Timber",    icon: "🪵", color: "#6b8f4e"},
  {id: 6,  name: "Fish",      icon: "🐟", color: "#4a90d9"},
  {id: 7,  name: "Pearls",    icon: "🦪", color: "#d4a8c4"},
  {id: 8,  name: "Game",      icon: "🦌", color: "#8b6914"},
  {id: 9,  name: "Cattle",    icon: "🐄", color: "#c9a064"},
  {id: 10, name: "Horses",    icon: "🐎", color: "#c9a84c"},
  {id: 11, name: "Wool",      icon: "🐑", color: "#a8a898"},
  {id: 12, name: "Ivory",     icon: "🦣", color: "#e8dfc8"},
  {id: 13, name: "Salt",      icon: "🧂", color: "#d4cfa8"},
  {id: 14, name: "Minerals",  icon: "⛏️", color: "#8c8c8c"},
  {id: 15, name: "Iron",      icon: "⚙️", color: "#5a5a6a"},
  {id: 16, name: "Gems",      icon: "💎", color: "#5bc8f5"},
  {id: 17, name: "Gold",      icon: "🪙", color: "#ffd700"},
  {id: 18, name: "Spices",    icon: "🌶️", color: "#c94040"},
  {id: 19, name: "Honey",     icon: "🍯", color: "#e8a020"},
  {id: 20, name: "Herbs",     icon: "🌿", color: "#3a8a3a"},
  {id: 21, name: "Trade",     icon: "⚖️", color: "#f0c060"},
];

// Biome boundary groups for smoothing: resources should not spread across group lines.
// Index = biome id.  Same group number = allowed to spread.
const BIOME_GROUP = [
  0, // 0  ocean / undefined
  1, // 1  hot desert
  1, // 2  cold desert
  2, // 3  savanna
  2, // 4  grassland / steppe
  3, // 5  tropical seasonal forest
  4, // 6  temperate deciduous forest
  3, // 7  tropical rainforest
  4, // 8  temperate rainforest
  5, // 9  taiga / boreal
  6, // 10 tundra
  6, // 11 glacier
  7, // 12 wetland
];

// What secondary resource can accompany each primary, as [{r: id, p: probability}].
// Only the first candidate whose cumulative probability exceeds rand2 is chosen.
const SECONDARY_TABLE = {
  1:  [{r: 19, p: 0.25}, {r: 20, p: 0.45}, {r: 9,  p: 0.70}], // Crops   → Honey, Herbs, Cattle
  2:  [{r: 3,  p: 0.20}, {r: 20, p: 0.50}, {r: 19, p: 0.75}], // Orchards→ Vineyards, Herbs, Honey
  3:  [{r: 2,  p: 0.30}, {r: 20, p: 0.65}],                    // Vineyards→ Orchards, Herbs
  4:  [{r: 20, p: 0.35}, {r: 8,  p: 0.60}],                    // Berries  → Herbs, Game
  5:  [{r: 8,  p: 0.40}, {r: 19, p: 0.65}],                    // Timber   → Game, Honey
  6:  [{r: 5,  p: 0.25}, {r: 13, p: 0.45}],                    // Fish     → Timber, Salt
  7:  [{r: 6,  p: 0.45}, {r: 13, p: 0.75}],                    // Pearls   → Fish, Salt
  8:  [{r: 5,  p: 0.35}, {r: 4,  p: 0.60}],                    // Game     → Timber, Berries
  9:  [{r: 1,  p: 0.35}, {r: 11, p: 0.60}],                    // Cattle   → Crops, Wool
  10: [{r: 9,  p: 0.40}, {r: 11, p: 0.65}],                    // Horses   → Cattle, Wool
  11: [{r: 9,  p: 0.45}, {r: 10, p: 0.70}],                    // Wool     → Cattle, Horses
  12: [{r: 16, p: 0.12}, {r: 14, p: 0.55}],                    // Ivory    → Gems, Minerals
  13: [{r: 14, p: 0.40}, {r: 6,  p: 0.55}],                    // Salt     → Minerals, Fish
  14: [{r: 15, p: 0.25}, {r: 16, p: 0.33}],                    // Minerals → Iron, Gems
  15: [{r: 14, p: 0.50}, {r: 16, p: 0.60}],                    // Iron     → Minerals, Gems
  16: [{r: 14, p: 0.55}, {r: 17, p: 0.67}],                    // Gems     → Minerals, Gold
  17: [{r: 16, p: 0.35}, {r: 14, p: 0.70}],                    // Gold     → Gems, Minerals
  18: [{r: 20, p: 0.50}, {r: 2,  p: 0.75}],                    // Spices   → Herbs, Orchards
  19: [{r: 1,  p: 0.30}, {r: 20, p: 0.55}],                    // Honey    → Crops, Herbs
  20: [{r: 19, p: 0.40}, {r: 18, p: 0.55}],                    // Herbs    → Honey, Spices
  21: [{r: 1,  p: 0.25}, {r: 5,  p: 0.50}],                    // Trade    → Crops, Timber
};

function assignResources() {
  TIME && console.time("assignResources");
  const {cells} = pack;
  cells.resource          = new Uint8Array(cells.i.length);
  cells.resourceSecondary = new Uint8Array(cells.i.length);
  cells.resourceRichness  = new Uint8Array(cells.i.length);

  const gPrec = grid.cells.prec;
  const gTemp = grid.cells.temp;

  // Three independent hashes per cell, all mixed with the map seed so different
  // maps produce different resource layouts even at equal cell indices.
  const seedInt = (parseInt(seed) || 1) >>> 0;
  const makeHash = salt => i => {
    let x = Math.imul((i + 1) ^ (seedInt ^ salt), 2654435761) >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 2246822519) >>> 0;
    x ^= x >>> 13;
    return (x >>> 0) / 4294967296;
  };
  const cellRand  = makeHash(0x00000000); // primary assignment
  const cellRand2 = makeHash(0x9e3779b9); // secondary assignment
  const cellRandR = makeHash(0x517cc1b7); // richness

  // Returns a 0–255 richness value for a given cell + resource combination.
  const calcRichness = (i, res) => {
    const noise = cellRandR(i) * 100; // 0–99 noise component
    if (res === 17 || res === 16) return Math.min(255, 110 + noise | 0); // Gold/Gems: high when present
    if (res === 15 || res === 14) {   // Iron/Minerals: height-amplified
      const hBonus = Math.max(0, cells.h[i] - 55) * 1.8;
      return Math.min(255, 40 + noise + hBonus | 0);
    }
    if (res === 1 || res === 9 || res === 11) { // Crops/Cattle/Wool: suit-driven
      return Math.min(255, cells.s[i] * 13 + noise * 0.5 | 0);
    }
    if (res === 6) { // Fish: flux-amplified
      return Math.min(255, 70 + noise + Math.min(55, cells.fl[i] / 8) | 0);
    }
    return Math.min(255, 55 + noise | 0); // default moderate
  };

  // ── Primary assignment ─────────────────────────────────────────────────────
  for (const i of cells.i) {
    const h = cells.h[i];
    if (h < 20) continue; // water cell

    const biome    = cells.biome[i];
    const prec     = gPrec[cells.g[i]];
    const temp     = gTemp[cells.g[i]];
    const isCoast  = cells.t[i] === 1;
    const hasRiver = cells.r[i] > 0;
    const flux     = cells.fl[i];
    const suit     = cells.s[i];
    const r        = cellRand(i);

    let res = 0;

    // ── High peaks: gems, gold, minerals ──────────────────────────────────────
    if (h > 75) {
      if (r < 0.04)  res = 17; // Gold (very rare)
      else if (r < 0.14) res = 16; // Gems
      else res = 14;            // Minerals
    }

    // ── Mid-highland: iron in forested zones, minerals elsewhere ──────────────
    else if (h > 55) {
      const forested = biome === 6 || biome === 8 || biome === 9;
      res = (forested && r < 0.45) ? 15 : 14;
    }

    // ── Coastal overrides ────────────────────────────────────────────────────
    else if (isCoast) {
      if ((biome === 1 || biome === 2) && prec < 20) res = 13; // Salt (arid coast)
      else if (temp > 18 && r < 0.45)                res = 7;  // Pearls (warm tropical)
      else                                            res = 6;  // Fish (default)
    }

    // ── Rivers: freshwater fishing at low-elevation mouths ────────────────────
    else if (hasRiver && h <= 26 && flux > 80) {
      const isAgriBiome = biome === 3 || biome === 4 || biome === 6;
      if (!(isAgriBiome && suit >= 5)) res = 6;
    }

    // ── Deserts ───────────────────────────────────────────────────────────────
    if (!res && (biome === 1 || biome === 2)) {
      if (r < 0.12)      res = 13; // Salt
      else if (r < 0.20) res = 14; // Minerals
    }

    // ── Biome-driven inland rules ─────────────────────────────────────────────
    if (!res) switch (biome) {
      case 3: // Savanna
        if (r < 0.07) res = 12;
        else if (suit >= 8 || hasRiver) res = r < 0.38 ? 1 : r < 0.68 ? 9 : 10;
        else if (suit >= 3)             res = r < 0.18 ? 1 : r < 0.55 ? 9 : 10;
        else                            res = r < 0.55 ? 10 : 9;
        break;

      case 4: // Grassland/Steppe
        if (suit >= 10 || hasRiver) {
          if (r < 0.52)      res = 1;
          else if (r < 0.78) res = 9;
          else               res = 8;
        } else if (suit >= 3) {
          if (r < 0.30)      res = 1;
          else if (r < 0.55) res = 9;
          else if (r < 0.78) res = 11;
          else               res = 10;
        } else {
          if (r < 0.40)      res = 9;
          else if (r < 0.72) res = 10;
          else               res = 11;
        }
        break;

      case 5: // Tropical seasonal forest
        if (r < 0.06) res = 12;
        else if (h <= 32 && suit >= 5) res = r < 0.35 ? 1 : r < 0.60 ? 18 : 2;
        else {
          if (r < 0.28)      res = 18;
          else if (r < 0.50) res = 2;
          else if (r < 0.72) res = 20;
          else               res = 5;
        }
        break;

      case 6: // Temperate deciduous forest
        if (h <= 35) {
          const pick = r * 10 | 0;
          if (pick < 4)      res = 1;
          else if (pick < 6) res = 5;
          else if (pick < 8) res = 9;
          else if (pick < 9) res = 19;
          else               res = 2;
        } else if (h > 42 && temp > 11 && prec < 65) {
          res = r < 0.28 ? 3 : r < 0.65 ? 5 : 11;
        } else {
          const pick = r * 10 | 0;
          if (pick < 5)      res = 5;
          else if (pick < 7) res = 8;
          else               res = 19;
        }
        break;

      case 7: // Tropical rainforest
        if (r < 0.40)      res = 18;
        else if (r < 0.70) res = 20;
        else               res = 5;
        break;

      case 8: // Temperate rainforest
        res = (h <= 30 && temp > 10) ? (r < 0.45 ? 2 : 5) : (r < 0.88 ? 5 : 8);
        break;

      case 9: // Taiga/Boreal
        if (h > 50) res = r < 0.55 ? 8 : 4;
        else {
          const pick = r * 10 | 0;
          if (pick < 5)      res = 5;
          else if (pick < 7) res = 8;
          else if (pick < 9) res = 4;
          else               res = 19;
        }
        break;

      case 10: // Tundra
        res = r < 0.55 ? 8 : r < 0.85 ? 4 : 11;
        break;

      case 12: // Wetland
        const pick = r * 10 | 0;
        if (pick < 5)      res = 6;
        else if (pick < 7) res = 20;
        else if (pick < 9) res = 19;
        else               res = 4;
        break;
    }

    if (res) {
      cells.resource[i]         = res;
      cells.resourceRichness[i] = calcRichness(i, res);
    }
  }

  // ── Smoothing pass: 2 rounds of biome-aware majority-neighbor clustering ────
  // Coasts and high peaks are excluded — their resources are geography-driven.
  for (let round = 0; round < 2; round++) {
    const next = new Uint8Array(cells.resource);
    for (const i of cells.i) {
      if (cells.h[i] < 20) continue;
      if (cells.h[i] > 65) continue;
      if (cells.t[i] === 1) continue;

      const myGroup    = BIOME_GROUP[cells.biome[i]] || 0;
      const neighbors  = cells.c[i];
      const counts     = new Uint8Array(22);
      let landNeighbors = 0;

      for (const n of neighbors) {
        if (cells.h[n] < 20) continue;
        // Only spread within the same biome group
        if ((BIOME_GROUP[cells.biome[n]] || 0) !== myGroup) continue;
        landNeighbors++;
        const res = cells.resource[n];
        if (res > 0) counts[res]++;
      }
      if (landNeighbors === 0) continue;

      let best = 0, bestCount = 0;
      for (let res = 1; res < 22; res++) {
        if (counts[res] > bestCount) { best = res; bestCount = counts[res]; }
      }

      // Fish must not spread to cells without water access
      if (best === 6) {
        const hasWater = cells.t[i] === 1 || cells.r[i] > 0;
        if (!hasWater) {
          let nextBest = 0, nextCount = 0;
          for (let res = 1; res < 22; res++) {
            if (res === 6) continue;
            if (counts[res] > nextCount) { nextBest = res; nextCount = counts[res]; }
          }
          best = nextBest; bestCount = nextCount;
        }
      }

      const current = cells.resource[i];
      if (current === 0) {
        if (bestCount >= Math.min(4, landNeighbors)) next[i] = best;
      } else if (best !== current && best !== 0) {
        if (bestCount >= Math.ceil(landNeighbors * 0.6)) next[i] = best;
      }
    }
    cells.resource = next;
  }

  // ── Mineral vein propagation: extend deposits along ridges ──────────────────
  // Turns isolated mineral cells into coherent veins along high terrain.
  const MINERAL_IDS = new Set([14, 15, 16, 17]);
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(cells.resource);
    for (const i of cells.i) {
      if (cells.h[i] < 55) continue;
      const res = cells.resource[i];
      if (!MINERAL_IDS.has(res)) continue;

      for (const n of cells.c[i]) {
        if (cells.h[n] < 50) continue;
        const nRes = cells.resource[n];
        // Replace generic Minerals with a specific adjacent deposit type
        if (nRes === 14 && res > 14) {
          if (cellRand(n * 13 + pass + 1) < 0.55) next[n] = res;
        }
      }
    }
    cells.resource = next;
  }

  // ── Secondary resource assignment ────────────────────────────────────────────
  for (const i of cells.i) {
    const primary = cells.resource[i];
    if (!primary) continue;
    const candidates = SECONDARY_TABLE[primary];
    if (!candidates) continue;

    const r2 = cellRand2(i);
    for (const {r: id, p} of candidates) {
      if (r2 < p) { cells.resourceSecondary[i] = id; break; }
    }
  }

  // ── Trade hub assignment (post-pass) ─────────────────────────────────────────
  // Marks cells that sit at natural crossroad positions (high suitability AND
  // adjacent to 3+ different biome groups) as Trade — regardless of existing
  // primary resource, unless it's a rare mineral.
  const RARE = new Set([16, 17]); // Gems, Gold — never overwrite
  for (const i of cells.i) {
    if (cells.h[i] < 20) continue;
    if (RARE.has(cells.resource[i])) continue;
    if (cells.s[i] < 7) continue;

    const neighborGroups = new Set();
    for (const n of cells.c[i]) {
      if (cells.h[n] >= 20) neighborGroups.add(BIOME_GROUP[cells.biome[n]] || 0);
    }
    if (neighborGroups.size < 3) continue;

    if (cellRand(i + 999999) < 0.12) {
      cells.resource[i]         = 21; // Trade
      cells.resourceRichness[i] = calcRichness(i, 21);
    }
  }

  TIME && console.timeEnd("assignResources");
}
