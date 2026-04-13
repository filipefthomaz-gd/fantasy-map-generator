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
    const hasBurg  = cells.burg[i] > 0;
    const r        = cellRand(i);

    // ── Urbanization: burg cells become Trade centers ──────────────────────
    if (hasBurg) {
      cells.resource[i] = 21; // Trade
      continue;
    }

    // ── High peaks: gems, gold, minerals ───────────────────────────────────
    if (h > 75) {
      if (r < 0.04)  { cells.resource[i] = 17; continue; } // Gold (very rare)
      if (r < 0.14)  { cells.resource[i] = 16; continue; } // Gems
      cells.resource[i] = 14; continue;                     // Minerals
    }

    // ── Mid-highland: iron in forested zones, minerals elsewhere ───────────
    if (h > 55) {
      const forested = biome === 6 || biome === 8 || biome === 9;
      cells.resource[i] = (forested && r < 0.45) ? 15 : 14; // Iron or Minerals
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
    if (hasRiver && h <= 26 && flux > 80) {
      cells.resource[i] = 6; continue; // Fish
    }

    // ── Deserts: nothing further inland ───────────────────────────────────
    if (biome === 1 || biome === 2) {
      // Occasional salt deposits in dried lakebeds
      if (r < 0.06) cells.resource[i] = 13;
      continue;
    }

    // ── Biome-driven inland rules ──────────────────────────────────────────

    if (biome === 3) {
      // Savanna — hot grassland/scrubland
      if (temp > 22) {
        // Hot savanna: elephants, horses, sparse crops where moisture allows
        if (r < 0.07)  { cells.resource[i] = 12; continue; } // Ivory (rare)
        if (prec >= 28 && r < 0.4) { cells.resource[i] = 1; continue; } // Crops
        cells.resource[i] = r < 0.6 ? 10 : 9; // Horses or Cattle
      } else {
        // Cooler savanna: cattle & crops where rain suffices; horses in dry corners
        if (prec >= 30 || flux > 40) {
          cells.resource[i] = r < 0.35 ? 1 : (r < 0.65 ? 9 : 10); // Crops, Cattle, Horses
        } else {
          cells.resource[i] = r < 0.65 ? 10 : 9; // Horses or Cattle (arid)
        }
      }
      continue;
    }

    if (biome === 4) {
      // Grassland/Steppe
      if (suit > 40 || prec >= 40) {
        // Fertile plains: crops dominate, cattle secondary
        cells.resource[i] = r < 0.22 ? 9 : 1; // 22% Cattle, 78% Crops
      } else if (prec >= 22) {
        if (h > 40) {
          // Upland meadow: wool and horses
          cells.resource[i] = r < 0.55 ? 11 : 10; // Wool or Horses
        } else {
          // Mixed productive steppe
          cells.resource[i] = r < 0.40 ? 1 : (r < 0.65 ? 9 : 10); // Crops, Cattle, Horses
        }
      } else {
        // Arid steppe: horses dominant, some wool
        cells.resource[i] = r < 0.78 ? 10 : 11; // Horses or Wool
      }
      continue;
    }

    if (biome === 5) {
      // Tropical seasonal forest — warm, seasonally dry
      if (r < 0.06)  { cells.resource[i] = 12; continue; } // Ivory (rare)
      if (r < 0.32)  { cells.resource[i] = 18; continue; } // Spices
      if (r < 0.55)  { cells.resource[i] = 2;  continue; } // Orchards
      if (r < 0.75)  { cells.resource[i] = 20; continue; } // Herbs
      cells.resource[i] = 5; // Timber
      continue;
    }

    if (biome === 6) {
      // Temperate deciduous forest
      if (h <= 35 && (hasRiver || prec >= 40)) {
        // River valleys: cultivated and pastoral
        const pick = r * 10 | 0;
        if (pick < 6)      cells.resource[i] = 1;  // Crops (60%)
        else if (pick < 8) cells.resource[i] = 9;  // Cattle (20%)
        else if (pick < 9) cells.resource[i] = 19; // Honey (10%)
        else               cells.resource[i] = 2;  // Orchards (10%) — warm valley
      } else if (h > 42 && temp > 11 && prec < 65) {
        // Warm hillsides: vineyards, otherwise timber or wool
        cells.resource[i] = r < 0.28 ? 3 : (r < 0.65 ? 5 : 11); // Vineyards, Timber, Wool
      } else {
        // Mixed forest interior: timber, game, honey, herbs
        const pick = r * 10 | 0;
        if (pick < 5)      cells.resource[i] = 5;  // Timber (50%)
        else if (pick < 7) cells.resource[i] = 8;  // Game (20%)
        else if (pick < 9) cells.resource[i] = 19; // Honey (20%)
        else               cells.resource[i] = 20; // Herbs (10%)
      }
      continue;
    }

    if (biome === 7) {
      // Tropical rainforest — dense, wet
      const pick = r * 10 | 0;
      if (pick < 4)      cells.resource[i] = 18; // Spices (40%)
      else if (pick < 7) cells.resource[i] = 20; // Herbs (30%)
      else               cells.resource[i] = 5;  // Timber (30%)
      continue;
    }

    if (biome === 8) {
      // Temperate rainforest
      if (h <= 30 && temp > 10) {
        // Warm coastal lowlands: orchards, some timber
        cells.resource[i] = r < 0.45 ? 2 : 5; // Orchards or Timber
      } else {
        // Dense upland rainforest: timber and game
        cells.resource[i] = r < 0.88 ? 5 : 8; // Timber or Game
      }
      continue;
    }

    if (biome === 9) {
      // Taiga/Boreal forest
      if (h > 50) {
        // High taiga: game and berries
        cells.resource[i] = r < 0.55 ? 8 : 4; // Game or Berries
      } else {
        // Low taiga: timber backbone with scattered wildlife resources
        const pick = r * 10 | 0;
        if (pick < 5)      cells.resource[i] = 5;  // Timber (50%)
        else if (pick < 7) cells.resource[i] = 8;  // Game (20%)
        else if (pick < 9) cells.resource[i] = 4;  // Berries (20%)
        else               cells.resource[i] = 19; // Honey (10%)
      }
      continue;
    }

    if (biome === 10) {
      // Tundra — harsh, sparse resources
      cells.resource[i] = r < 0.55 ? 8 : (r < 0.85 ? 4 : 11); // Game, Berries, Wool
      continue;
    }

    if (biome === 12) {
      // Wetland — rich in fish, herbs, and honey
      const pick = r * 10 | 0;
      if (pick < 5)      cells.resource[i] = 6;  // Fish (50%)
      else if (pick < 7) cells.resource[i] = 20; // Herbs (20%)
      else if (pick < 9) cells.resource[i] = 19; // Honey (20%)
      else               cells.resource[i] = 4;  // Berries (10%)
      continue;
    }
  }

  TIME && console.timeEnd("assignResources");
}
