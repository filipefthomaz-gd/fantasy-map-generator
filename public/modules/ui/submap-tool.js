"use strict";

function recalculateMapSize(x0, y0) {
  const mapSize = +ensureEl("mapSizeOutput").value;
  ensureEl("mapSizeOutput").value = ensureEl("mapSizeInput").value = rn(mapSize / scale, 2);

  const latT = mapCoordinates.latT / scale;
  const latN = getLatitude(y0);
  const latShift = (90 - latN) / (180 - latT);
  ensureEl("latitudeOutput").value = ensureEl("latitudeInput").value = rn(latShift * 100, 2);

  const lotT = mapCoordinates.lonT / scale;
  const lonE = getLongitude(x0 + graphWidth / scale);
  const lonShift = (180 - lonE) / (360 - lotT);
  ensureEl("longitudeOutput").value = ensureEl("longitudeInput").value = rn(lonShift * 100, 2);

  distanceScale = distanceScaleInput.value = rn(distanceScale / scale, 2);
  populationRate = populationRateInput.value = rn(populationRate / scale, 2);
}

function rescaleBurgStyles(submapScale) {
  const burgIcons = [...ensureEl("burgIcons").querySelectorAll("g")];
  for (const group of burgIcons) {
    const newSize = rn(minmax(group.getAttribute("size") * submapScale, 0.2, 10), 2);
    group.setAttribute("font-size", newSize);

    const newStroke = rn(group.getAttribute("stroke-width") * submapScale, 2);
    group.setAttribute("stroke-width", newStroke);
  }

  const burgLabels = [...ensureEl("burgLabels").querySelectorAll("g")];
  for (const group of burgLabels) {
    const size = +group.dataset.size;
    group.dataset.size = Math.max(rn((size + size / submapScale) / 2, 2), 1) * submapScale;
  }
}

function openSubmapTool() {
  resetInputs();

  $("#submapTool").dialog({
    title: "Create a submap",
    resizable: false,
    width: "32em",
    position: {my: "center", at: "center", of: "svg"},
    buttons: {
      Submap: function () {
        closeDialogs();
        generateSubmap();
      },
      Cancel: function () {
        $(this).dialog("close");
      }
    }
  });

  if (modules.openSubmapTool) return;
  modules.openSubmapTool = true;

  function resetInputs() {
    updateCellsNumber(ensureEl("pointsInput").value);
    ensureEl("submapPointsInput").oninput = e => updateCellsNumber(e.target.value);

    function updateCellsNumber(value) {
      ensureEl("submapPointsInput").value = value;
      const cells = cellsDensityMap[value];
      ensureEl("submapPointsInput").dataset.cells = cells;
      const output = ensureEl("submapPointsFormatted");
      output.value = cells / 1000 + "K";
      output.style.color = getCellsDensityColor(cells);
    }
  }

  function generateSubmap() {
    INFO && console.group("generateSubmap");

    const [x0, y0] = [Math.abs(viewX / scale), Math.abs(viewY / scale)]; // top-left corner
    recalculateMapSize(x0, y0);

    const submapPointsValue = ensureEl("submapPointsInput").value;
    const globalPointsValue = ensureEl("pointsInput").value;
    if (submapPointsValue !== globalPointsValue) changeCellsDensity(submapPointsValue);

    const projection = (x, y) => [(x - x0) * scale, (y - y0) * scale];
    const inverse = (x, y) => [x / scale + x0, y / scale + y0];

    applyGraphSize();
    fitMapToScreen();
    resetZoom(0);
    undraw();
    Resample.process({projection, inverse, scale});

    if (ensureEl("submapRescaleBurgStyles").checked) rescaleBurgStyles(scale);
    drawLayers();

    INFO && console.groupEnd("generateSubmap");
  }
}

function openStateSubmapDialog() {
  const select = ensureEl("stateSubmapSelect");
  const pointsInput = ensureEl("stateSubmapPointsInput");
  const pointsOutput = ensureEl("stateSubmapPointsFormatted");

  // populate state dropdown
  select.innerHTML = pack.states
    .filter(s => s.i && !s.removed)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(s => `<option value="${s.i}">${s.name}</option>`)
    .join("");

  const updatePoints = value => {
    pointsInput.value = value;
    const cells = cellsDensityMap[value];
    pointsOutput.value = cells / 1000 + "K";
    pointsOutput.style.color = getCellsDensityColor(cells);
  };
  updatePoints(ensureEl("pointsInput").value);
  pointsInput.oninput = e => updatePoints(e.target.value);

  $("#stateSubmapTool").dialog({
    title: "State Submap",
    resizable: false,
    width: "32em",
    position: {my: "center", at: "center", of: "svg"},
    buttons: {
      Generate: function () {
        $(this).dialog("close");
        const stateId = +select.value;
        ensureEl("submapPointsInput").value = pointsInput.value;
        openStateSubmapTool(stateId);
      },
      Cancel: function () {
        $(this).dialog("close");
      }
    }
  });
}

function openStateSubmapTool(stateId) {
  INFO && console.group("openStateSubmapTool", stateId);

  const stateCells = pack.cells.i.filter(i => pack.cells.state[i] === stateId);
  if (!stateCells.length) {
    WARN && console.warn("No cells found for state", stateId);
    return;
  }

  // compute bbox using reduce to safely handle large arrays
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const i of stateCells) {
    const [x, y] = pack.cells.p[i];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const bboxW = maxX - minX;
  const bboxH = maxY - minY;

  // scale so the state's largest dimension fills the map, with 15% padding
  const bboxScale = Math.min(graphWidth / bboxW, graphHeight / bboxH) / 1.15;

  // center the view on the state, clamped so the window never exceeds map bounds
  const viewW = graphWidth / bboxScale;
  const viewH = graphHeight / bboxScale;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const vx0 = Math.max(0, Math.min(centerX - viewW / 2, graphWidth - viewW));
  const vy0 = Math.max(0, Math.min(centerY - viewH / 2, graphHeight - viewH));

  // set global scale so recalculateMapSize uses the right ratio
  scale = bboxScale;
  viewX = -vx0 * bboxScale;
  viewY = -vy0 * bboxScale;

  recalculateMapSize(vx0, vy0);

  const submapPointsValue = ensureEl("submapPointsInput").value;
  const globalPointsValue = ensureEl("pointsInput").value;
  if (submapPointsValue !== globalPointsValue) changeCellsDensity(submapPointsValue);

  const projection = (x, y) => [(x - vx0) * bboxScale, (y - vy0) * bboxScale];
  const inverse = (x, y) => [x / bboxScale + vx0, y / bboxScale + vy0];

  applyGraphSize();
  fitMapToScreen();
  resetZoom(0);
  undraw();
  Resample.process({projection, inverse, scale: bboxScale});

  const rwf = ensureEl("riverWidthFactor");
  if (rwf) rwf.value = Math.min(2, Math.max(1, rwf.value / bboxScale));

  rescaleBurgStyles(bboxScale);
  drawLayers();

  INFO && console.groupEnd("openStateSubmapTool");
}
