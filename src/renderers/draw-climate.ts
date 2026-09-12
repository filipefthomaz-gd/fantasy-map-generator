import { ensureEl } from "@/utils";

/** Climate overlay: ITCZ and wind-zone boundaries, prevailing wind arrows and Ekman-deflected ocean currents */
export function drawClimate(): void {
  const { latN, latT, latS } = options.map.geography.coordinates;
  const { winds } = options.map.climate;
  const { width: graphWidth, height: graphHeight } = options.map.graph;
  if (!latT) return;
  TIME && console.time("drawClimate");

  const WIND_SPACING = 80;
  const ZONE_NAMES = ["N. Polar", "Westerlies", "NE Trades", "SE Trades", "Westerlies", "S. Polar"];

  const WIND_COLOR = { polar: "#8ab8d8", westerlies: "#5a9ab5", trades: "#e8a040" };

  function bandInfo(lat: number) {
    const absLat = Math.abs(lat);
    const tier = Math.min((Math.abs(lat - 89) / 30) | 0, 5);
    const angle = winds[tier];
    const color = absLat > 60 ? WIND_COLOR.polar : absLat > 30 ? WIND_COLOR.westerlies : WIND_COLOR.trades;
    return { tier, angle, color };
  }

  const parts: string[] = [];

  // ── ITCZ line at equator ───────────────────────────────────────────────────
  if (latS < 0 && latN > 0) {
    const iy = (latN / latT) * graphHeight;
    parts.push(
      `<line x1="0" y1="${iy.toFixed(1)}" x2="${graphWidth}" y2="${iy.toFixed(1)}"` +
        ` stroke="#c05020" stroke-width="1.5" stroke-dasharray="10 5" opacity="0.65" pointer-events="none"/>`,
      `<text x="5" y="${(iy - 5).toFixed(1)}" font-size="9" fill="#c05020" opacity="0.9" pointer-events="none">ITCZ</text>`
    );
  }

  // ── Zone boundary lines at ±30° and ±60° ──────────────────────────────────
  for (const lat of [60, 30, -30, -60]) {
    if (lat > latN || lat < latS) continue;
    const y = ((latN - lat) / latT) * graphHeight;
    parts.push(
      `<line x1="0" y1="${y.toFixed(1)}" x2="${graphWidth}" y2="${y.toFixed(1)}"` +
        ` stroke="#aaa" stroke-width="0.6" stroke-dasharray="6 4" opacity="0.4" pointer-events="none"/>`
    );
  }

  // ── Wind arrows on a regular pixel grid + zone labels ─────────────────────
  const labeledTiers = new Set<number>();
  for (let y = WIND_SPACING / 2; y < graphHeight; y += WIND_SPACING) {
    const lat = latN - (y / graphHeight) * latT;
    const { angle, color, tier } = bandInfo(lat);
    const svgAngle = angle - 90;

    for (let x = WIND_SPACING / 2; x < graphWidth; x += WIND_SPACING) {
      parts.push(
        `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${svgAngle})" pointer-events="none">` +
          `<line x1="-16" y1="0" x2="11" y2="0" stroke="${color}" stroke-width="1.5" opacity="0.6"/>` +
          `<polygon points="17,0 8,-3.5 8,3.5" fill="${color}" opacity="0.6"/>` +
          `</g>`
      );
    }

    if (!labeledTiers.has(tier)) {
      labeledTiers.add(tier);
      parts.push(
        `<text x="5" y="${y.toFixed(1)}" font-size="9" fill="${color}" opacity="0.85"` +
          ` dominant-baseline="central" pointer-events="none">${ZONE_NAMES[tier]}</text>`
      );
    }
  }

  // ── Ocean current arrows on sea cells ─────────────────────────────────────
  // Surface currents follow Ekman transport: deflected 90° from wind.
  // Poleward flow = warm (red-orange), equatorward flow = cold (blue).
  const seaCells = Array.from(pack.cells.i as ArrayLike<number>).filter(i => pack.cells.h[i] < 20);
  const skip = Math.max(1, Math.ceil(seaCells.length / 350));

  seaCells
    .filter((_, idx) => idx % skip === 0)
    .forEach(i => {
      const [x, y] = pack.cells.p[i];
      const lat = latN - (y / graphHeight) * latT;
      const { angle } = bandInfo(lat);

      const deflection = lat >= 0 ? 90 : -90; // Coriolis: right in N, left in S
      const ca = (angle + deflection + 360) % 360;
      const svgAngle = ca - 90;

      const goingNorth = ca < 90 || ca > 270;
      const isWarm = lat >= 0 ? goingNorth : !goingNorth;
      const color = isWarm ? "#d04020" : "#2060b0";

      parts.push(
        `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${svgAngle})" pointer-events="none">` +
          `<line x1="-10" y1="0" x2="7" y2="0" stroke="${color}" stroke-width="1.2" opacity="0.5"/>` +
          `<polygon points="11,0 5,-2.5 5,2.5" fill="${color}" opacity="0.5"/>` +
          `</g>`
      );
    });

  ensureEl("climate").innerHTML = parts.join("");

  TIME && console.timeEnd("drawClimate");
}
