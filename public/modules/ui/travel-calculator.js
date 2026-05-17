"use strict";

function openTravelCalculator() {
  if (customization) return;
  closeDialogs(".stable");

  populateBurgSelects();

  $("#travelCalculator").dialog({
    title: "Travel Calculator",
    resizable: false,
    width: fitContent(),
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

  // Land path via Dijkstra
  const landResult = dijkstraLand(b1.cell, b2.cell);

  let distHtml = `<div>Straight line: <b>${straightDist} ${unit}</b></div>`;
  let landDist = null;
  let roadShare = 0;

  if (landResult) {
    landDist = rn(landResult.pixelLength * distanceScale, 1);
    roadShare = landResult.roadShare;
    distHtml += `<div>Land path: <b>${landDist} ${unit}</b> <span style="opacity:0.6">(${Math.round(roadShare * 100)}% on roads)</span></div>`;
  } else {
    distHtml += `<div>Land path: <b>No route found</b> <span style="opacity:0.6">(separate landmasses?)</span></div>`;
  }

  document.getElementById("travelDistances").innerHTML = distHtml;

  // Travel modes
  // road/trail/offroad speeds in distance-units per hour
  const MODES = [
    {name: "On foot",      icon: "&#x1F6B6;", road:   5, trail:   3, offroad:   2},
    {name: "On horseback", icon: "&#x1F40E;", road:  12, trail:   7, offroad:   4},
    {name: "By car",       icon: "&#x1F697;", road: 100, trail:  25, offroad:   8}
  ];

  let rows = "";
  if (landResult) {
    for (const mode of MODES) {
      const speed = travelLerp(mode.offroad, mode.road, roadShare);
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
    const railResult = dijkstraLand(b1.cell, b2.cell, "railways");
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
  if (isPort1 || isPort2) {
    const shipDist = rn(straightPixels * distanceScale, 1);
    const shipTime = formatTravelTime(shipDist / 20);
    rows += `<tr>
      <td>&#x26F5;&ensp;By ship</td>
      <td style="text-align:right;padding-left:1.5em">20 ${unit}/h</td>
      <td style="text-align:right;padding-left:1.5em"><b>${shipTime}</b></td>
    </tr>`;
    notes.push("Sea distance is straight-line (approximate)");
    if (!isPort1) notes.push(`${b1.name} has no port`);
    if (!isPort2) notes.push(`${b2.name} has no port`);
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

function travelLerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
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

// Dijkstra on land cells. Returns { pixelLength, roadShare } or null if unreachable.
// preferGroup: if set, edges on that route group get a strong cost bonus.
function dijkstraLand(startCell, endCell, preferGroup) {
  if (startCell === endCell) return {pixelLength: 0, roadShare: 1};

  const neighbors = pack.cells.c;
  const points = pack.cells.p;
  const heights = pack.cells.h;
  const cellRoutes = pack.cells.routes || {};
  const routeList = pack.routes;
  const n = pack.cells.i.length;

  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const edgeIsRoad = new Uint8Array(n); // 1 = preferred/road, 0 = not

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

      let mult = 1;
      let isRoad = 0;
      const routeId = cellRoutes[cell]?.[nb];
      if (routeId !== undefined) {
        const group = routeList[routeId]?.group;
        if (preferGroup && group === preferGroup) {
          mult = 0.1;
          isRoad = 1;
        } else if (group === "roads") {
          mult = 0.3;
          isRoad = 1;
        } else if (group === "railways") {
          mult = 0.2;
        } else if (group === "trails") {
          mult = 0.6;
        }
      }

      const hDiff = Math.abs(heights[cell] - heights[nb]);
      if (hDiff > 25) mult *= 1.5;

      const newCost = dist[cell] + base * mult;
      if (newCost < dist[nb]) {
        dist[nb] = newCost;
        prev[nb] = cell;
        edgeIsRoad[nb] = isRoad;
        heap.push(newCost, nb);
      }
    }
  }

  if (!isFinite(dist[endCell])) return null;

  let pixelLength = 0;
  let roadPixels = 0;
  let cur = endCell;
  while (cur !== startCell && prev[cur] !== -1) {
    const p = prev[cur];
    const [x1, y1] = points[p];
    const [x2, y2] = points[cur];
    const d = Math.hypot(x1 - x2, y1 - y2);
    pixelLength += d;
    if (edgeIsRoad[cur]) roadPixels += d;
    cur = p;
  }

  return {
    pixelLength,
    roadShare: pixelLength > 0 ? roadPixels / pixelLength : 0
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
