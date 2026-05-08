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

function assignResources() {
  TIME && console.time("assignResources");
  const {cells} = pack;
  cells.resource = new Uint8Array(cells.i.length);

  const gPrec = grid.cells.prec;
  const gTemp = grid.cells.temp;

  // Deterministic per-cell hash: produces a uniform value in [0,1) for any
  // cell index, independent of call order — no stripes from i % N patterns.
  const cellRand = i => {
    let x = Math.imul(i + 1, 2654435761) >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 2246822519) >>> 0;
    x ^= x >>> 13;
    return (x >>> 0) / 4294967296;
  };

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

    // ── High peaks: gems, gold, minerals ───────────────────────────────────
    if (h > 75) {
      if (r < 0.04)  { cells.resource[i] = 17; continue; } // Gold (very rare)
      if (r < 0.14)  { cells.resource[i] = 16; continue; } // Gems
      cells.resource[i] = 14; continue;                     // Minerals
    }

    // ── Mid-highland: iron in forested zones, minerals elsewhere ───────────
    if (h > 55) {
      const forested = biome === 6 || biome === 8 || biome === 9;
      cells.resource[i] = (forested && r < 0.45) ? 15 : 14;
      continue;
    }

    // ── Coastal overrides ──────────────────────────────────────────────────
    if (isCoast) {
      if ((biome === 1 || biome === 2) && prec < 20) {
        cells.resource[i] = 13; continue; // Salt (arid desert coast)
      }
      if (temp > 18 && r < 0.45) {
        cells.resource[i] = 7; continue;  // Pearls (warm tropical coast)
      }
      cells.resource[i] = 6; continue;    // Fish (default coast)
    }

    // ── Rivers: freshwater fishing at low-elevation mouths ─────────────────
    // Skip in agricultural biomes — large rivers there boost crops, not fishing.
    const isAgriBiome = biome === 3 || biome === 4 || biome === 6;
    if (hasRiver && h <= 26 && flux > 80 && !(isAgriBiome && suit >= 5)) {
      cells.resource[i] = 6; continue;
    }

    // ── Deserts: salt flats, dried riverbeds, exposed mineral seams ────────
    if (biome === 1 || biome === 2) {
      if (r < 0.12)      cells.resource[i] = 13; // Salt (salt flats, dry lake beds)
      else if (r < 0.20) cells.resource[i] = 14; // Minerals (exposed rock seams)
      continue;
    }

    // ── Biome-driven inland rules ──────────────────────────────────────────

    if (biome === 3) {
      // Savanna — also low-precip by definition; use suit like grassland
      if (r < 0.07) { cells.resource[i] = 12; continue; } // Ivory (rare, any savanna)
      if (suit >= 8 || hasRiver) {
        // Fertile savanna / river margins: sorghum, millet, yam
        cells.resource[i] = r < 0.38 ? 1 : (r < 0.68 ? 9 : 10); // Crops, Cattle, Horses
      } else if (suit >= 3) {
        // Typical savanna: mostly pastoral, some crops
        cells.resource[i] = r < 0.18 ? 1 : (r < 0.55 ? 9 : 10); // Crops, Cattle, Horses
      } else {
        // Harsh dry savanna: pastoral only
        cells.resource[i] = r < 0.55 ? 10 : 9; // Horses or Cattle
      }
      continue;
    }

    if (biome === 4) {
      // Grassland/Steppe — historically among the world's most productive grain regions.
      // Grassland is a LOW-precip biome by definition, so prec is a poor proxy for
      // agricultural potential here. Use suit (habitability score) instead.
      if (suit >= 10 || hasRiver) {
        // Well-watered plains / river valleys: grain farming dominates
        if (r < 0.52)      cells.resource[i] = 1;  // Crops
        else if (r < 0.78) cells.resource[i] = 9;  // Cattle
        else               cells.resource[i] = 8;  // Game
      } else if (suit >= 3) {
        // Typical steppe: mixed pastoral with some crops
        if (r < 0.30)      cells.resource[i] = 1;  // Crops
        else if (r < 0.55) cells.resource[i] = 9;  // Cattle
        else if (r < 0.78) cells.resource[i] = 11; // Wool
        else               cells.resource[i] = 10; // Horses
      } else {
        // Harsh/arid steppe: pastoral only
        if (r < 0.40)      cells.resource[i] = 9;  // Cattle
        else if (r < 0.72) cells.resource[i] = 10; // Horses
        else               cells.resource[i] = 11; // Wool
      }
      continue;
    }

    if (biome === 5) {
      // Tropical seasonal forest — rice, cassava, yam grow at lower elevations
      if (r < 0.06) { cells.resource[i] = 12; continue; } // Ivory
      if (h <= 32 && suit >= 5) {
        // Lowland clearings: tropical crops alongside spices and orchards
        cells.resource[i] = r < 0.35 ? 1 : (r < 0.60 ? 18 : 2); // Crops, Spices, Orchards
      } else {
        if (r < 0.28)  { cells.resource[i] = 18; continue; } // Spices
        if (r < 0.50)  { cells.resource[i] = 2;  continue; } // Orchards
        if (r < 0.72)  { cells.resource[i] = 20; continue; } // Herbs
        cells.resource[i] = 5;                                // Timber
      }
      continue;
    }

    if (biome === 6) {
      // Temperate deciduous forest
      if (h <= 35) {
        // Lowland temperate forest: partially cleared for farming
        const pick = r * 10 | 0;
        if (pick < 4)      cells.resource[i] = 1;  // Crops (40%)
        else if (pick < 6) cells.resource[i] = 5;  // Timber (20%)
        else if (pick < 8) cells.resource[i] = 9;  // Cattle (20%)
        else if (pick < 9) cells.resource[i] = 19; // Honey (10%)
        else               cells.resource[i] = 2;  // Orchards (10%)
      } else if (h > 42 && temp > 11 && prec < 65) {
        // Warm hillsides: vineyards, timber, wool
        cells.resource[i] = r < 0.28 ? 3 : (r < 0.65 ? 5 : 11);
      } else {
        // Forest interior: timber, game, honey
        const pick = r * 10 | 0;
        if (pick < 5)      cells.resource[i] = 5;  // Timber (50%)
        else if (pick < 7) cells.resource[i] = 8;  // Game (20%)
        else               cells.resource[i] = 19; // Honey (30%) — merged herbs into honey
      }
      continue;
    }

    if (biome === 7) {
      // Tropical rainforest
      const pick = r * 10 | 0;
      if (pick < 4)      cells.resource[i] = 18; // Spices (40%)
      else if (pick < 7) cells.resource[i] = 20; // Herbs (30%)
      else               cells.resource[i] = 5;  // Timber (30%)
      continue;
    }

    if (biome === 8) {
      // Temperate rainforest
      if (h <= 30 && temp > 10) {
        cells.resource[i] = r < 0.45 ? 2 : 5; // Orchards or Timber
      } else {
        cells.resource[i] = r < 0.88 ? 5 : 8; // Timber or Game
      }
      continue;
    }

    if (biome === 9) {
      // Taiga/Boreal forest
      if (h > 50) {
        cells.resource[i] = r < 0.55 ? 8 : 4; // Game or Berries
      } else {
        const pick = r * 10 | 0;
        if (pick < 5)      cells.resource[i] = 5;  // Timber (50%)
        else if (pick < 7) cells.resource[i] = 8;  // Game (20%)
        else if (pick < 9) cells.resource[i] = 4;  // Berries (20%)
        else               cells.resource[i] = 19; // Honey (10%)
      }
      continue;
    }

    if (biome === 10) {
      // Tundra
      cells.resource[i] = r < 0.55 ? 8 : (r < 0.85 ? 4 : 11); // Game, Berries, Wool
      continue;
    }

    if (biome === 12) {
      // Wetland
      const pick = r * 10 | 0;
      if (pick < 5)      cells.resource[i] = 6;  // Fish (50%)
      else if (pick < 7) cells.resource[i] = 20; // Herbs (20%)
      else if (pick < 9) cells.resource[i] = 19; // Honey (20%)
      else               cells.resource[i] = 4;  // Berries (10%)
      continue;
    }
  }

  // ── Smoothing pass: 2 rounds of majority-neighbor clustering ─────────────
  // Turns the salt-and-pepper per-cell assignments into contiguous patches.
  // Coasts and high peaks are excluded — their resources are geography-driven.
  for (let round = 0; round < 2; round++) {
    const next = new Uint8Array(cells.resource);
    for (const i of cells.i) {
      if (cells.h[i] < 20) continue;
      if (cells.h[i] > 65) continue;  // preserve mineral peaks
      if (cells.t[i] === 1) continue; // preserve coastal fish/pearls/salt

      const neighbors = cells.c[i];
      const counts = new Uint8Array(22); // index = resource id
      let landNeighbors = 0;
      for (const n of neighbors) {
        if (cells.h[n] < 20) continue;
        landNeighbors++;
        const res = cells.resource[n];
        if (res > 0) counts[res]++;
      }
      if (landNeighbors === 0) continue;

      let best = 0, bestCount = 0;
      for (let res = 1; res < 22; res++) {
        if (counts[res] > bestCount) { best = res; bestCount = counts[res]; }
      }

      const current = cells.resource[i];
      const hasWaterAccess = cells.t[i] === 1 || cells.r[i] > 0;

      // Never spread Fish to cells without water access
      if (best === 6 && !hasWaterAccess) {
        // Pick the next best non-fish resource instead
        let nextBest = 0, nextCount = 0;
        for (let res = 1; res < 22; res++) {
          if (res === 6) continue;
          if (counts[res] > nextCount) { nextBest = res; nextCount = counts[res]; }
        }
        best = nextBest; bestCount = nextCount;
      }

      if (current === 0) {
        if (bestCount >= Math.min(4, landNeighbors)) next[i] = best;
      } else if (best !== current && best !== 0) {
        if (bestCount >= Math.ceil(landNeighbors * 0.6)) next[i] = best;
      }
    }
    cells.resource = next;
  }

  TIME && console.timeEnd("assignResources");
}
