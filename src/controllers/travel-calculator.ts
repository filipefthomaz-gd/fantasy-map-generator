// Travel Calculator: distance between two burgs and the travel time by every transport at once.
// A query tool next to the Journeys editor: nothing is persisted, but a row can be turned into a
// one-segment journey. Speeds come from the Transport Types catalogue (fork-only feature)
import { select } from "d3";
import { closeDialogs, destroyDialog } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { tip } from "@/components/tooltips";
import { Controllers } from "@/controllers";
import type { Burg } from "@/generators/burgs-generator";
import type { Transport, TransportDomain } from "@/generators/transports-generator";
import type { JourneyPoint } from "@/types/Journey";
import { convertSpeed, escapeHtml, getDistanceUnit } from "@/utils";
import { ensureEl, rn } from "../utils";

const dialogId = "travelCalculator" as const;

// how much slower a land transport moves off the roads
const TRAIL_SPEED_FACTOR = 0.6;
const OPEN_COUNTRY_SPEED_FACTOR = 0.4;

// a land transport with this in its name rides the railway network
const RAIL_TRANSPORT_PATTERN = /train|rail/i;

// pathfinding cost multiplier of a cell, by the best route group crossing it
const GROUP_COST: Record<string, number> = { railways: 0.2, roads: 0.3, trails: 0.6 };
const PREFERRED_GROUP_COST = 0.1;
const STEEP_PENALTY = 1.5; // when the height difference between cells is above STEEP_HEIGHT_DIFF
const STEEP_HEIGHT_DIFF = 25;

type Surface = "open" | "road" | "trail" | "preferred";
interface LandPath {
  cells: number[];
  pixelLength: number;
  roadShare: number;
  trailShare: number;
}

interface ModeRow {
  icon: string;
  name: string;
  speed: number | null; // in the user distance unit per hour; null when the mode is not available
  hours: number | null;
  note?: string; // shown instead of the time when the mode is not available
  build?: () => { transport: Transport; from: number; to: number; points: JourneyPoint[]; distance: number };
}

const DOMAIN_ICONS: Record<TransportDomain, string> = { land: "🚶", water: "⛵", air: "✈", stay: "⏳" };

let hubAirwaysForced = false; // the airways group was shown by the hub view and is hidden again on close

function open(): void {
  if (customization) return;
  closeDialogs(".stable");
  renderDialog();
  populateBurgSelects();

  $(`#${dialogId}`).dialog({
    title: "Travel Calculator",
    resizable: true,
    width: "auto",
    height: "auto",
    position: { my: "left top", at: "left+10 top+10", of: "svg", collision: "fit" },
    close: () => {
      restoreAirways();
      destroyDialog(dialogId);
    }
  });
}

function renderDialog(): void {
  destroyDialog(dialogId);
  const html = /* html */ `<div id="${dialogId}" class="dialog">
    <div style="display:flex; gap:1em; padding:0.4em 0">
      <div>
        <div style="margin-bottom:0.2em">From</div>
        <input id="travelFromSearch" type="search" placeholder="Filter burgs…" style="width:12em; display:block; margin-bottom:0.2em" />
        <select id="travelFrom" size="14" style="width:12em; display:block; height:18em"></select>
      </div>
      <div>
        <div style="margin-bottom:0.2em">To</div>
        <input id="travelToSearch" type="search" placeholder="Filter burgs…" style="width:12em; display:block; margin-bottom:0.2em" />
        <select id="travelTo" size="14" style="width:12em; display:block; height:18em"></select>
      </div>
    </div>
    <div style="margin:0.4em 0; display:flex; gap:0.5em; align-items:center">
      <button id="travelCalcBtn">Calculate</button>
      <button id="travelTransportsBtn" data-tip="Edit the Transport Types the speeds come from" class="icon-cog"></button>
    </div>
    <div id="travelResults" style="display:none; margin-top:0.6em">
      <div id="travelDistances" style="margin-bottom:0.5em"></div>
      <table style="width:100%; border-collapse:collapse">
        <thead>
          <tr style="opacity:0.6; font-size:0.9em">
            <th style="text-align:left; font-weight:normal">Mode</th>
            <th style="text-align:right; font-weight:normal; padding-left:1.5em">Speed</th>
            <th style="text-align:right; font-weight:normal; padding-left:1.5em">Est. time</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="travelTableBody"></tbody>
      </table>
      <div id="travelNote" style="font-size:0.85em; margin-top:0.5em; opacity:0.6"></div>
    </div>

    <div style="margin-top:0.8em; border-top:1px solid rgba(128,128,128,0.3); padding-top:0.6em">
      <button id="toggleHubViewBtn" style="font-size:0.9em">✈ Flight Hub</button>
    </div>
    <div id="hubViewSection" style="display:none; margin-top:0.6em">
      <div style="margin-bottom:0.3em; font-size:0.9em; opacity:0.7">Airport</div>
      <select id="hubAirportSelect" style="width:100%; display:block; margin-bottom:0.5em"></select>
      <div id="hubResults"></div>
    </div>
  </div>`;
  ensureEl("dialogs").insertAdjacentHTML("beforeend", html);

  ensureEl<HTMLInputElement>("travelFromSearch").addEventListener("input", function () {
    filterBurgSelect("travelFrom", this.value);
  });
  ensureEl<HTMLInputElement>("travelToSearch").addEventListener("input", function () {
    filterBurgSelect("travelTo", this.value);
  });
  ensureEl("travelCalcBtn").addEventListener("click", runCalculation);
  ensureEl("travelTransportsBtn").addEventListener("click", () => void Controllers.TransportEditor.open());
  ensureEl("travelTableBody").addEventListener("click", onTableClick);

  ensureEl("toggleHubViewBtn").addEventListener("click", () => {
    const section = ensureEl("hubViewSection");
    const isOpen = section.style.display !== "none";
    section.style.display = isOpen ? "none" : "";
    if (isOpen) {
      clearHubHighlight();
      restoreAirways();
    } else {
      forceAirways();
      populateHubAirportSelect();
    }
  });
  ensureEl("hubAirportSelect").addEventListener("change", updateHubRoutes);
}

function getBurgs(): Burg[] {
  return pack.burgs.filter(b => b?.i && !b.removed).sort((a, b) => a.name!.localeCompare(b.name!));
}

function burgOption(b: Burg): string {
  const stateName = pack.states[b.state!]?.name || "Neutral";
  return `<option value="${b.i}">${escapeHtml(b.name!)} (${escapeHtml(stateName)})</option>`;
}

function populateBurgSelects(): void {
  const opts = getBurgs().map(burgOption).join("");
  ensureEl("travelFrom").innerHTML = opts;
  ensureEl("travelTo").innerHTML = opts;
}

function filterBurgSelect(selectId: string, query: string): void {
  const q = query.toLowerCase();
  for (const opt of Array.from(ensureEl<HTMLSelectElement>(selectId).options)) {
    opt.style.display = !q || opt.text.toLowerCase().includes(q) ? "" : "none";
  }
}

// ── Distances ────────────────────────────────────────────────────────────────

const toUnits = (pixels: number) => rn(pixels * options.map.units.distance.scale, 1);

/** Segment length in map pixels, latitude-corrected when the spherical area mode is on */
function segmentPixels([x1, y1]: [number, number], [x2, y2]: [number, number]): number {
  if (options.map.units.area.mode !== "spherical") return Math.hypot(x1 - x2, y1 - y2);
  const { latN, latT, lonT } = options.map.geography.coordinates;
  const { width, height } = options.map.graph;
  const latMid = latN - ((y1 + y2) / 2 / height) * latT;
  const cosLat = Math.cos(latMid * (Math.PI / 180));
  const dxDeg = ((x2 - x1) / width) * lonT;
  const dyDeg = ((y2 - y1) / height) * latT;
  return (Math.hypot(dxDeg * cosLat, dyDeg) / latT) * height;
}

function pathPixels(points: ArrayLike<[number, number]> | JourneyPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    length += segmentPixels([x1, y1], [x2, y2]);
  }
  return length;
}

/** cell → cheapest route group crossing it. Routes skip cells, so membership is by route points */
function buildCellGroupMap(): Map<number, string> {
  const cellGroup = new Map<number, string>();
  for (const route of pack.routes) {
    const cost = GROUP_COST[route.group];
    if (cost === undefined) continue;
    for (const point of route.points) {
      const cellId = point[2];
      const existing = cellGroup.get(cellId);
      if (!existing || GROUP_COST[existing] > cost) cellGroup.set(cellId, route.group);
    }
  }
  return cellGroup;
}

/** Dijkstra over land cells, routes cheap to follow. `preferGroup` makes one group nearly free */
function findLandPath(startCell: number, endCell: number, cellGroup: Map<number, string>, preferGroup?: string) {
  if (startCell === endCell) return { cells: [startCell], pixelLength: 0, roadShare: 1, trailShare: 0 } as LandPath;

  const { c: neighbors, p: points, h: heights } = pack.cells;
  const n = pack.cells.i.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const surface: Surface[] = new Array(n);
  const queue = new FlatQueue();

  dist[startCell] = 0;
  queue.push(startCell, 0);

  while (queue.length) {
    const cost = queue.peekValue();
    const cell = queue.pop();
    if (cost > dist[cell]) continue;
    if (cell === endCell) break;

    for (const next of neighbors[cell]) {
      if (heights[next] < 20) continue;

      const group = cellGroup.get(next) || cellGroup.get(cell);
      let mult = 1;
      let nextSurface: Surface = "open";
      if (preferGroup && group === preferGroup) {
        mult = PREFERRED_GROUP_COST;
        nextSurface = "preferred";
      } else if (group && GROUP_COST[group] !== undefined) {
        mult = GROUP_COST[group];
        nextSurface = group === "trails" ? "trail" : "road";
      }
      if (Math.abs(heights[cell] - heights[next]) > STEEP_HEIGHT_DIFF) mult *= STEEP_PENALTY;

      const newCost =
        dist[cell] + Math.hypot(points[cell][0] - points[next][0], points[cell][1] - points[next][1]) * mult;
      if (newCost < dist[next]) {
        dist[next] = newCost;
        prev[next] = cell;
        surface[next] = nextSurface;
        queue.push(next, newCost);
      }
    }
  }

  if (!Number.isFinite(dist[endCell])) return null;

  const cells: number[] = [];
  let pixelLength = 0;
  let roadPixels = 0;
  let trailPixels = 0;
  for (let cur = endCell; cur !== -1; cur = prev[cur]) {
    cells.unshift(cur);
    const p = prev[cur];
    if (p === -1) break;
    const d = segmentPixels(points[p], points[cur]);
    pixelLength += d;
    if (surface[cur] === "road" || surface[cur] === "preferred") roadPixels += d;
    else if (surface[cur] === "trail") trailPixels += d;
  }

  return {
    cells,
    pixelLength,
    roadShare: pixelLength > 0 ? roadPixels / pixelLength : 0,
    trailShare: pixelLength > 0 ? trailPixels / pixelLength : 0
  } as LandPath;
}

// ── Calculation ──────────────────────────────────────────────────────────────

function formatTime(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours) || hours < 0) return "—";
  if (hours < 1) return "< 1h";
  return Journeys.formatTravelTime(hours);
}

let lastRows: ModeRow[] = [];

function runCalculation(): void {
  const fromId = +ensureEl<HTMLSelectElement>("travelFrom").value;
  const toId = +ensureEl<HTMLSelectElement>("travelTo").value;

  if (!fromId || !toId) return void tip("Please select two burgs", false, "error");
  if (fromId === toId) return void tip("Origin and destination are the same burg", false, "error");

  const b1 = pack.burgs[fromId];
  const b2 = pack.burgs[toId];
  if (!b1 || !b2) return;

  const unit = getDistanceUnit();
  const from = b1.cell!;
  const to = b2.cell!;
  const cellPoints = (cells: number[]): JourneyPoint[] =>
    cells.map(cell => [...pack.cells.p[cell], cell] as JourneyPoint);

  const straightPixels = segmentPixels([b1.x!, b1.y!], [b2.x!, b2.y!]);
  const straightDist = toUnits(straightPixels);

  const cellGroup = buildCellGroupMap();
  const land = findLandPath(from, to, cellGroup);
  const rail = pack.routes.some(r => r.group === "railways") ? findLandPath(from, to, cellGroup, "railways") : null;
  const waterCells = Routes.findWaterPath(from, to);
  const waterPoints = waterCells ? (Routes.getWaterPoints(waterCells) as JourneyPoint[]) : null;
  const waterPixels = waterPoints ? pathPixels(waterPoints) : null;

  let distHtml = `<div>Straight line: <b>${straightDist} ${unit}</b></div>`;
  if (land) {
    const surfaceNote =
      land.roadShare > 0.01 || land.trailShare > 0.01
        ? `${Math.round(land.roadShare * 100)}% road, ${Math.round(land.trailShare * 100)}% trail`
        : "no roads";
    distHtml += `<div>Land path: <b>${toUnits(land.pixelLength)} ${unit}</b> <span style="opacity:0.6">(${surfaceNote})</span></div>`;
  } else {
    distHtml += `<div>Land path: <b>No route found</b> <span style="opacity:0.6">(separate landmasses?)</span></div>`;
  }
  if (waterPixels !== null) {
    distHtml += `<div>Sea path: <b>${toUnits(waterPixels)} ${unit}</b></div>`;
  }
  ensureEl("travelDistances").innerHTML = distHtml;

  const rows: ModeRow[] = [];
  const notes: string[] = [];
  const hasAirways = pack.routes.some(r => r.group === "airways");
  const bothAirports = b1.airport === 1 && b2.airport === 1;

  for (const transport of Transports.all) {
    const speed = convertSpeed(transport.speed); // user units per hour, as shown in the Transport Types
    const icon = transport.icon || DOMAIN_ICONS[transport.domain];
    const isRail = transport.domain === "land" && RAIL_TRANSPORT_PATTERN.test(transport.name);

    if (transport.domain === "stay" || speed <= 0) continue;

    if (isRail) {
      if (!rail) {
        rows.push({ icon, name: transport.name, speed, hours: null, note: "No rail connection" });
        continue;
      }
      const distance = toUnits(rail.pixelLength);
      rows.push({
        icon,
        name: transport.name,
        speed,
        hours: distance / speed,
        build: () => ({ transport, from, to, points: cellPoints(rail.cells), distance: rail.pixelLength })
      });
      continue;
    }

    if (transport.domain === "land") {
      if (!land) {
        rows.push({ icon, name: transport.name, speed, hours: null, note: "No land path" });
        continue;
      }
      const openShare = Math.max(0, 1 - land.roadShare - land.trailShare);
      const blended =
        speed * land.roadShare +
        speed * TRAIL_SPEED_FACTOR * land.trailShare +
        speed * OPEN_COUNTRY_SPEED_FACTOR * openShare;
      const distance = toUnits(land.pixelLength);
      rows.push({
        icon,
        name: transport.name,
        speed: rn(blended, 1),
        hours: distance / blended,
        build: () => ({ transport, from, to, points: cellPoints(land.cells), distance: land.pixelLength })
      });
      continue;
    }

    if (transport.domain === "water") {
      if (waterPixels === null || !waterPoints) {
        rows.push({ icon, name: transport.name, speed, hours: null, note: "No sea route" });
        continue;
      }
      rows.push({
        icon,
        name: transport.name,
        speed,
        hours: toUnits(waterPixels) / speed,
        build: () => ({ transport, from, to, points: waterPoints, distance: waterPixels })
      });
      continue;
    }

    // air: straight line between airports; only shown as unavailable when the map has airways at all
    if (bothAirports || !hasAirways) {
      rows.push({
        icon,
        name: transport.name,
        speed,
        hours: straightDist / speed,
        build: () => ({
          transport,
          from,
          to,
          points: [
            [b1.x!, b1.y!, from],
            [b2.x!, b2.y!, to]
          ],
          distance: straightPixels
        })
      });
    } else {
      const note = b1.airport === 1 || b2.airport === 1 ? "Only one airport" : "No airports";
      rows.push({ icon, name: transport.name, speed, hours: null, note });
    }
  }

  if (rows.some(row => row.hours !== null && DOMAIN_ICONS.air === row.icon))
    notes.push("Air distance is straight-line");
  if (options.map.units.area.mode === "spherical") notes.push("Distances are latitude-corrected (spherical mode)");

  lastRows = rows;
  ensureEl("travelTableBody").innerHTML = rows
    .map(
      (row, index) => /* html */ `<tr>
        <td>${row.icon}&ensp;${escapeHtml(row.name)}</td>
        <td style="text-align:right;padding-left:1.5em">${row.hours === null ? "—" : `${row.speed} ${unit}/h`}</td>
        <td style="text-align:right;padding-left:1.5em;${row.hours === null ? "opacity:0.5" : ""}">${
          row.hours === null ? row.note : `<b>${formatTime(row.hours)}</b>`
        }</td>
        <td style="padding-left:0.6em">${
          row.build
            ? `<span class="icon-map-pin pointer" data-row="${index}" data-tip="Create a journey with this leg"></span>`
            : ""
        }</td>
      </tr>`
    )
    .join("");
  ensureEl("travelNote").innerHTML = notes.join(" &middot; ");
  ensureEl("travelResults").style.display = "";
}

/** Turn a result row into a one-segment journey and open it in the Journey Editor */
function onTableClick(event: Event): void {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-row]");
  if (!target) return;
  const row = lastRows[+target.dataset.row!];
  if (!row?.build) return;

  const { transport, from, to, points, distance } = row.build();
  const journey = Journeys.addEmpty();
  const fromBurg = pack.burgs[pack.cells.burg[from]];
  const toBurg = pack.burgs[pack.cells.burg[to]];
  journey.name = `${fromBurg?.name ?? "?"} to ${toBurg?.name ?? "?"}`;
  const segment = Journeys.addSegment(journey);
  Object.assign(segment, {
    name: `By ${transport.name}`,
    from,
    to,
    transport: transport.name,
    speed: transport.speed,
    points,
    distance
  });

  Layers.show("journeys");
  Layers.draw("journeys");
  $(`#${dialogId}`).dialog("close");
  void Controllers.JourneyEditor.open(journey.i);
}

// ── Flight hub view ──────────────────────────────────────────────────────────

function buildBurgByCell(): Map<number, Burg> {
  const map = new Map<number, Burg>();
  for (const b of pack.burgs) if (b?.i && !b.removed) map.set(b.cell!, b);
  return map;
}

/** airway endpoints, resolved to the burgs on them */
function getAirwayEnds(burgByCell: Map<number, Burg>): { route: (typeof pack.routes)[number]; a?: Burg; b?: Burg }[] {
  return pack.routes
    .filter(route => route.group === "airways" && route.points?.length >= 2)
    .map(route => ({
      route,
      a: burgByCell.get(route.points[0][2]),
      b: burgByCell.get(route.points[route.points.length - 1][2])
    }));
}

function forceAirways(): void {
  if (Layers.isOn("routes")) return;
  Layers.show("routes");
  hubAirwaysForced = true;
}

function restoreAirways(): void {
  if (!hubAirwaysForced) return;
  Layers.hide("routes");
  hubAirwaysForced = false;
}

function populateHubAirportSelect(): void {
  const burgByCell = buildBurgByCell();
  const airportIds = new Set<number>();
  for (const { a, b } of getAirwayEnds(burgByCell)) {
    if (a) airportIds.add(a.i);
    if (b) airportIds.add(b.i);
  }
  for (const b of pack.burgs) if (b?.i && !b.removed && b.airport === 1) airportIds.add(b.i);

  const airports = Array.from(airportIds, id => pack.burgs[id]).sort((a, b) => a.name!.localeCompare(b.name!));
  const select = ensureEl<HTMLSelectElement>("hubAirportSelect");
  select.innerHTML = airports.length
    ? airports.map(burgOption).join("")
    : `<option value="">No airports on the map</option>`;
  updateHubRoutes();
}

function clearHubHighlight(): void {
  for (const path of Array.from(document.querySelectorAll<SVGPathElement>("#airways path"))) {
    path.style.opacity = "";
    path.style.strokeWidth = "";
    path.style.stroke = "";
  }
}

function highlightHubRoutes(hubId: number, burgByCell: Map<number, Burg>): void {
  const matched = new Set<number>();
  for (const { route, a, b } of getAirwayEnds(burgByCell)) {
    if (a?.i === hubId || b?.i === hubId) matched.add(route.i);
  }
  select("#airways")
    .selectAll<SVGPathElement, unknown>("path")
    .each(function () {
      const isMatch = matched.has(+this.id.replace("route", ""));
      this.style.opacity = isMatch ? "1" : "0.08";
      this.style.strokeWidth = isMatch ? "1.2" : "";
      this.style.stroke = isMatch ? "#77aaff" : "";
    });
}

function updateHubRoutes(): void {
  const hubId = +ensureEl<HTMLSelectElement>("hubAirportSelect").value;
  const hub = pack.burgs[hubId];
  const el = ensureEl("hubResults");
  if (!hubId || !hub) {
    el.innerHTML = `<div style="opacity:0.6; font-size:0.9em">No airports on the map: regenerate airways once a state is advanced enough</div>`;
    return;
  }

  const unit = getDistanceUnit();
  const airTransport = Transports.all
    .filter(t => t.domain === "air" && t.speed > 0)
    .sort((a, b) => b.speed - a.speed)[0];
  const airSpeed = airTransport ? convertSpeed(airTransport.speed) : 800;
  const burgByCell = buildBurgByCell();

  const connections = getAirwayEnds(burgByCell)
    .map(({ a, b }) => (a?.i === hubId ? b : b?.i === hubId ? a : null))
    .filter((dest): dest is Burg => Boolean(dest))
    .map(dest => {
      const dist = toUnits(segmentPixels([hub.x!, hub.y!], [dest.x!, dest.y!]));
      return { burg: dest, dist, time: formatTime(dist / airSpeed) };
    })
    .sort((a, b) => a.dist - b.dist);

  if (!connections.length) {
    el.innerHTML = `<div style="opacity:0.6; font-size:0.9em">No air routes from ${escapeHtml(hub.name!)}</div>`;
    clearHubHighlight();
    return;
  }

  const rows = connections
    .map(({ burg, dist, time }) => {
      const state = pack.states[burg.state!]?.name || "Neutral";
      return /* html */ `<tr>
        <td>✈ ${escapeHtml(burg.name!)}</td>
        <td style="opacity:0.6; padding-left:0.8em; font-size:0.9em">${escapeHtml(state)}</td>
        <td style="text-align:right; padding-left:0.8em">${dist} ${unit}</td>
        <td style="text-align:right; padding-left:0.8em"><b>${time}</b></td>
      </tr>`;
    })
    .join("");

  el.innerHTML = /* html */ `
    <div style="margin-bottom:0.4em; font-size:0.9em; opacity:0.7">
      ${connections.length} route${connections.length !== 1 ? "s" : ""} from <b>${escapeHtml(hub.name!)}</b>${
        airTransport ? ` by ${escapeHtml(airTransport.name)}` : ""
      }
    </div>
    <table style="width:100%; border-collapse:collapse">
      <thead><tr style="opacity:0.6; font-size:0.85em">
        <th style="text-align:left; font-weight:normal">Destination</th>
        <th style="text-align:left; font-weight:normal; padding-left:0.8em">State</th>
        <th style="text-align:right; font-weight:normal; padding-left:0.8em">Distance</th>
        <th style="text-align:right; font-weight:normal; padding-left:0.8em">Flight time</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  highlightHubRoutes(hubId, burgByCell);
}

export const TravelCalculator = { open };
