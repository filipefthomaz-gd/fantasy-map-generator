"use strict";

function openTravelCalculator() {
  if (customization) return;
  closeDialogs(".stable");

  populateBurgSelects();

  $("#travelCalculator").dialog({
    title: "Travel Calculator",
    resizable: true,
    width: fitContent(),
    height: "auto",
    position: {my: "left top", at: "left+10 top+10", of: "svg", collision: "fit"},
    close: () => {
      document.getElementById("travelResults").style.display = "none";
    }
  });

  if (modules.travelCalculator) return;
  modules.travelCalculator = true;

  document.getElementById("travelFromSearch").addEventListener("input", function () {
    filterBurgSelect("travelFrom", this.value);
  });
  document.getElementById("travelToSearch").addEventListener("input", function () {
    filterBurgSelect("travelTo", this.value);
  });
  document.getElementById("travelCalcBtn").addEventListener("click", runTravelCalculation);

  document.getElementById("toggleHubViewBtn").addEventListener("click", function () {
    const section = document.getElementById("hubViewSection");
    const isOpen = section.style.display !== "none";
    section.style.display = isOpen ? "none" : "";
    if (isOpen) {
      clearHubHighlight();
    } else {
      populateHubAirportSelect();
    }
  });

  document.getElementById("hubAirportSelect").addEventListener("change", updateHubRoutes);
}

function populateBurgSelects() {
  const burgs = pack.burgs
    .filter(b => b && b.i && !b.removed)
    .sort((a, b) => a.name.localeCompare(b.name));

  const opts = burgs
    .map(b => {
      const stateName = pack.states[b.state]?.name || "Neutral";
      return `<option value="${b.i}">${b.name} (${stateName})</option>`;
    })
    .join("");

  document.getElementById("travelFrom").innerHTML = opts;
  document.getElementById("travelTo").innerHTML = opts;
}

function filterBurgSelect(selectId, query) {
  const q = query.toLowerCase();
  Array.from(document.getElementById(selectId).options).forEach(opt => {
    opt.style.display = !q || opt.text.toLowerCase().includes(q) ? "" : "none";
  });
}

function runTravelCalculation() {
  const fromId = +document.getElementById("travelFrom").value;
  const toId = +document.getElementById("travelTo").value;

  if (!fromId || !toId) return tip("Please select two burgs", false, "error");
  if (fromId === toId) return tip("Origin and destination are the same burg", false, "error");

  const b1 = pack.burgs[fromId];
  const b2 = pack.burgs[toId];
  if (!b1 || !b2) return;

  const unit = distanceUnitInput.value;

  // Straight-line distance
  const straightPixels = Math.hypot(b1.x - b2.x, b1.y - b2.y);
  const straightDist = rn(straightPixels * distanceScale, 1);

  // Land path via Dijkstra — build cell→group map once, reuse for all mode calls
  const cellGroupCache = buildCellGroupMap();
  const landResult = dijkstraLand(b1.cell, b2.cell, null, cellGroupCache);

  let distHtml = `<div>Straight line: <b>${straightDist} ${unit}</b></div>`;
  let landDist = null;
  let roadShare = 0;

  if (landResult) {
    landDist = rn(landResult.pixelLength * distanceScale, 1);
    roadShare = landResult.roadShare;
    const trailShare = landResult.trailShare;
    const surfaceNote = roadShare > 0.01 || trailShare > 0.01
      ? `${Math.round(roadShare * 100)}% road, ${Math.round(trailShare * 100)}% trail`
      : "no roads";
    distHtml += `<div>Land path: <b>${landDist} ${unit}</b> <span style="opacity:0.6">(${surfaceNote})</span></div>`;
  } else {
    distHtml += `<div>Land path: <b>No route found</b> <span style="opacity:0.6">(separate landmasses?)</span></div>`;
  }

  document.getElementById("travelDistances").innerHTML = distHtml;

  // Travel modes: speeds in distance-units per hour for each surface type
  const MODES = [
    {name: "On foot",      icon: "&#x1F6B6;", road:   5, trail:   3, land:   2},
    {name: "On horseback", icon: "&#x1F40E;", road:  12, trail:   7, land:   4},
    {name: "By car",       icon: "&#x1F697;", road: 100, trail:  25, land:   8}
  ];

  let rows = "";
  if (landResult) {
    const {roadShare, trailShare} = landResult;
    const landShare = Math.max(0, 1 - roadShare - trailShare);
    for (const mode of MODES) {
      const speed = mode.land * landShare + mode.trail * trailShare + mode.road * roadShare;
      const time = formatTravelTime(landDist / speed);
      rows += `<tr>
        <td>${mode.icon}&ensp;${mode.name}</td>
        <td style="text-align:right;padding-left:1.5em">${rn(speed)} ${unit}/h</td>
        <td style="text-align:right;padding-left:1.5em"><b>${time}</b></td>
      </tr>`;
    }
  } else {
    rows += `<tr><td colspan="3" style="opacity:0.6;padding-top:0.3em">No land path — land travel times unavailable.</td></tr>`;
  }

  // Railway (~160 km/h)
  const hasRailways = pack.routes.some(r => r.group === "railways");
  if (hasRailways) {
    const railResult = dijkstraLand(b1.cell, b2.cell, "railways", cellGroupCache);
    if (railResult) {
      const railDist = rn(railResult.pixelLength * distanceScale, 1);
      const railTime = formatTravelTime(railDist / 160);
      rows += `<tr>
        <td>&#x1F682;&ensp;By railway</td>
        <td style="text-align:right;padding-left:1.5em">160 ${unit}/h</td>
        <td style="text-align:right;padding-left:1.5em"><b>${railTime}</b></td>
      </tr>`;
    } else {
      rows += `<tr>
        <td>&#x1F682;&ensp;By railway</td>
        <td style="text-align:right;padding-left:1.5em">—</td>
        <td style="text-align:right;padding-left:1.5em;opacity:0.5">No rail connection</td>
      </tr>`;
    }
  }

  // Ship (~20 km/h sailing)
  const notes = [];
  const isPort1 = b1.port > 0;
  const isPort2 = b2.port > 0;
  if (isPort1 && isPort2) {
    const shipDist = rn(straightPixels * distanceScale, 1);
    const shipTime = formatTravelTime(shipDist / 20);
    rows += `<tr>
      <td>&#x26F5;&ensp;By ship</td>
      <td style="text-align:right;padding-left:1.5em">20 ${unit}/h</td>
      <td style="text-align:right;padding-left:1.5em"><b>${shipTime}</b></td>
    </tr>`;
    notes.push("Sea distance is straight-line (approximate)");
  } else {
    rows += `<tr>
      <td>&#x26F5;&ensp;By ship</td>
      <td style="text-align:right;padding-left:1.5em">—</td>
      <td style="text-align:right;padding-left:1.5em;opacity:0.5">No sea access</td>
    </tr>`;
  }

  // Airways (~800 km/h)
  const isAirport1 = b1.airport === 1;
  const isAirport2 = b2.airport === 1;
  if (isAirport1 && isAirport2) {
    const airDist = rn(straightPixels * distanceScale, 1);
    const airTime = formatTravelTime(airDist / 800);
    rows += `<tr>
      <td>&#x2708;&ensp;By air</td>
      <td style="text-align:right;padding-left:1.5em">800 ${unit}/h</td>
      <td style="text-align:right;padding-left:1.5em"><b>${airTime}</b></td>
    </tr>`;
    notes.push("Air distance is straight-line");
  } else if (pack.routes.some(r => r.group === "airways")) {
    rows += `<tr>
      <td>&#x2708;&ensp;By air</td>
      <td style="text-align:right;padding-left:1.5em">—</td>
      <td style="text-align:right;padding-left:1.5em;opacity:0.5">${isAirport1 || isAirport2 ? "Only one airport" : "No airports"}</td>
    </tr>`;
  }

  document.getElementById("travelTableBody").innerHTML = rows;
  document.getElementById("travelNote").innerHTML = notes.join(" &middot; ");
  document.getElementById("travelResults").style.display = "";
}

function formatTravelTime(hours) {
  if (!isFinite(hours) || hours < 0) return "—";
  if (hours < 1) return "< 1h";
  if (hours < 24) {
    const h = Math.round(hours);
    return `${h}h`;
  }
  const d = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  const dayStr = `${d} day${d !== 1 ? "s" : ""}`;
  return h > 0 ? `${dayStr} ${h}h` : dayStr;
}

// Build a map from cellId -> best route group passing through that cell.
// Routes connect points that may skip non-adjacent cells, so we index by cell
// membership rather than by cell-to-cell edge.
function buildCellGroupMap() {
  const GROUP_COST = {roads: 0.3, railways: 0.2, trails: 0.6, searoutes: 1, airways: 1};
  const cellGroup = new Map();
  for (const route of pack.routes) {
    const cost = GROUP_COST[route.group];
    if (cost === undefined || cost >= 1) continue;
    for (const point of route.points) {
      const cellId = point[2];
      const existing = cellGroup.get(cellId);
      if (!existing || GROUP_COST[existing] > cost) cellGroup.set(cellId, route.group);
    }
  }
  return cellGroup;
}

// Dijkstra on land cells. Returns { pixelLength, roadShare, trailShare } or null if unreachable.
// preferGroup: if set, cells on that route group get a strong cost bonus.
// cellGroupCache: pre-built cell→group map; built internally if not supplied.
function dijkstraLand(startCell, endCell, preferGroup, cellGroupCache) {
  if (startCell === endCell) return {pixelLength: 0, roadShare: 1, trailShare: 0};

  const neighbors = pack.cells.c;
  const points = pack.cells.p;
  const heights = pack.cells.h;
  const cellGroup = cellGroupCache || buildCellGroupMap();
  const n = pack.cells.i.length;

  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const edgeSurface = new Uint8Array(n); // 0=land, 1=road, 2=trail, 3=preferred

  const heap = new TravelMinHeap();
  dist[startCell] = 0;
  heap.push(0, startCell);

  while (heap.size > 0) {
    const [cost, cell] = heap.pop();
    if (cost > dist[cell]) continue;
    if (cell === endCell) break;

    for (const nb of neighbors[cell]) {
      if (!nb) continue;
      if (heights[nb] < 20) continue;

      const [x1, y1] = points[cell];
      const [x2, y2] = points[nb];
      const base = Math.hypot(x1 - x2, y1 - y2);

      // Use the destination cell's route group (cell membership, not edge lookup)
      const group = cellGroup.get(nb) || cellGroup.get(cell);
      let mult = 1;
      let surface = 0;

      if (preferGroup && group === preferGroup) {
        mult = 0.1;
        surface = 3;
      } else if (group === "roads") {
        mult = 0.3;
        surface = 1;
      } else if (group === "railways") {
        mult = 0.2;
        surface = 1;
      } else if (group === "trails") {
        mult = 0.6;
        surface = 2;
      }

      const hDiff = Math.abs(heights[cell] - heights[nb]);
      if (hDiff > 25) mult *= 1.5;

      const newCost = dist[cell] + base * mult;
      if (newCost < dist[nb]) {
        dist[nb] = newCost;
        prev[nb] = cell;
        edgeSurface[nb] = surface;
        heap.push(newCost, nb);
      }
    }
  }

  if (!isFinite(dist[endCell])) return null;

  let pixelLength = 0;
  let roadPixels = 0;
  let trailPixels = 0;
  let cur = endCell;
  while (cur !== startCell && prev[cur] !== -1) {
    const p = prev[cur];
    const [x1, y1] = points[p];
    const [x2, y2] = points[cur];
    const d = Math.hypot(x1 - x2, y1 - y2);
    pixelLength += d;
    if (edgeSurface[cur] === 1 || edgeSurface[cur] === 3) roadPixels += d;
    else if (edgeSurface[cur] === 2) trailPixels += d;
    cur = p;
  }

  return {
    pixelLength,
    roadShare: pixelLength > 0 ? roadPixels / pixelLength : 0,
    trailShare: pixelLength > 0 ? trailPixels / pixelLength : 0
  };
}

class TravelMinHeap {
  constructor() {
    this.data = [];
    this.size = 0;
  }

  push(cost, cell) {
    this.data[this.size] = [cost, cell];
    this._up(this.size++);
  }

  pop() {
    const top = this.data[0];
    const last = this.data[--this.size];
    if (this.size > 0) {
      this.data[0] = last;
      this._down(0);
    }
    return top;
  }

  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p][0] <= this.data[i][0]) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }

  _down(i) {
    for (;;) {
      let min = i;
      const l = 2 * i + 1;
      const r = l + 1;
      if (l < this.size && this.data[l][0] < this.data[min][0]) min = l;
      if (r < this.size && this.data[r][0] < this.data[min][0]) min = r;
      if (min === i) break;
      [this.data[min], this.data[i]] = [this.data[i], this.data[min]];
      i = min;
    }
  }
}

function buildBurgByCell() {
  const map = new Map();
  for (const b of pack.burgs) {
    if (b && b.i && !b.removed) map.set(b.cell, b);
  }
  return map;
}

function populateHubAirportSelect() {
  const burgByCell = buildBurgByCell();

  // Collect all burgs that appear as airway route endpoints
  const airportIds = new Set();
  for (const route of pack.routes) {
    if (route.group !== "airways" || !route.points || route.points.length < 2) continue;
    const a = burgByCell.get(route.points[0][2]);
    const b = burgByCell.get(route.points[route.points.length - 1][2]);
    if (a) airportIds.add(a.i);
    if (b) airportIds.add(b.i);
  }
  for (const b of pack.burgs) {
    if (b && b.i && !b.removed && b.airport === 1) airportIds.add(b.i);
  }

  const sorted = [...airportIds]
    .map(id => pack.burgs[id])
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  document.getElementById("hubAirportSelect").innerHTML = sorted
    .map(b => {
      const state = pack.states[b.state]?.name || "Neutral";
      return `<option value="${b.i}">${b.name} (${state})</option>`;
    })
    .join("");

  updateHubRoutes();
}

function clearHubHighlight() {
  d3.select("#airways").selectAll("path")
    .style("opacity", null)
    .style("stroke-width", null)
    .style("stroke", null);
}

function highlightHubRoutes(hubId, burgByCell) {
  const matched = new Set();
  for (const route of pack.routes) {
    if (route.group !== "airways" || !route.points || route.points.length < 2) continue;
    const a = burgByCell.get(route.points[0][2]);
    const b = burgByCell.get(route.points[route.points.length - 1][2]);
    if (a?.i === hubId || b?.i === hubId) matched.add(route.i);
  }

  d3.select("#airways").selectAll("path").each(function () {
    const routeId = +this.id.replace("route", "");
    const isMatch = matched.has(routeId);
    d3.select(this)
      .style("opacity", isMatch ? 1 : 0.08)
      .style("stroke-width", isMatch ? 1.2 : null)
      .style("stroke", isMatch ? "#77aaff" : null);
  });
}

function updateHubRoutes() {
  const hubId = +document.getElementById("hubAirportSelect").value;
  if (!hubId) return;
  const hub = pack.burgs[hubId];
  if (!hub) return;

  const unit = distanceUnitInput.value;
  const burgByCell = buildBurgByCell(); // built once, shared with highlight

  const connections = [];
  for (const route of pack.routes) {
    if (route.group !== "airways" || !route.points || route.points.length < 2) continue;
    const a = burgByCell.get(route.points[0][2]);
    const b = burgByCell.get(route.points[route.points.length - 1][2]);
    const dest = a?.i === hubId ? b : b?.i === hubId ? a : null;
    if (!dest) continue;

    const dist = rn(Math.hypot(hub.x - dest.x, hub.y - dest.y) * distanceScale, 1);
    connections.push({burg: dest, dist, time: formatTravelTime(dist / 800)});
  }

  connections.sort((a, b) => a.dist - b.dist);

  const el = document.getElementById("hubResults");
  if (!connections.length) {
    el.innerHTML = `<div style="opacity:0.6; font-size:0.9em">No air routes from ${hub.name}</div>`;
    return;
  }

  const rows = connections.map(({burg, dist, time}) => {
    const state = pack.states[burg.state]?.name || "Neutral";
    return `<tr>
      <td>&#x2708; ${burg.name}</td>
      <td style="opacity:0.6; padding-left:0.8em; font-size:0.9em">${state}</td>
      <td style="text-align:right; padding-left:0.8em">${dist} ${unit}</td>
      <td style="text-align:right; padding-left:0.8em"><b>${time}</b></td>
    </tr>`;
  }).join("");

  el.innerHTML = `
    <div style="margin-bottom:0.4em; font-size:0.9em; opacity:0.7">
      ${connections.length} route${connections.length !== 1 ? "s" : ""} from <b>${hub.name}</b>
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
