const $body = insertEditorHtml();
addListeners();
let continentsManualHistory = [];

export function open() {
  closeDialogs("#continentsEditor, .stable");
  if (!layerIsOn("toggleContinents")) toggleContinents();

  refreshContinentsEditor();

  $("#continentsEditor").dialog({
    title: "Continents Editor",
    resizable: false,
    close: closeContinentsEditor,
    position: {my: "right top", at: "right-10 top+10", of: "svg"}
  });
  $body.focus();
}

function closeContinentsEditor() {
  if (customization === 13) exitContinentsManualAssignment();
}

function insertEditorHtml() {
  const editorHtml = /* html */ `<div id="continentsEditor" class="dialog stable">
    <div id="continentsHeader" class="header" style="grid-template-columns: 10em 4em 6em 7em">
      <div data-tip="Click to sort by continent name" class="sortable alphabetically" data-sortby="name">Continent&nbsp;</div>
      <div data-tip="Click to sort by cell count" class="sortable" data-sortby="cells">Cells&nbsp;</div>
      <div data-tip="Click to sort by area" class="sortable" data-sortby="area">Area&nbsp;</div>
      <div data-tip="Click to sort by population" class="sortable icon-sort-number-down" data-sortby="population">Population&nbsp;</div>
    </div>
    <div id="continentsBody" class="table" data-type="absolute"></div>

    <div id="continentsFooter" class="totalLine">
      <div data-tip="Number of continents" style="margin-left: 12px">Continents:&nbsp;<span id="continentsFooterCount">0</span></div>
      <div data-tip="Total land area" style="margin-left: 12px">Area:&nbsp;<span id="continentsFooterArea">0</span></div>
      <div data-tip="Total population" style="margin-left: 12px">Population:&nbsp;<span id="continentsFooterPopulation">0</span></div>
    </div>

    <div id="continentsBottom">
      <button id="continentsEditorRefresh" data-tip="Refresh the Editor" class="icon-cw"></button>
      <button id="continentsEditStyle" data-tip="Edit continents style in Style Editor" class="icon-adjust"></button>
      <button id="continentsLegend" data-tip="Toggle Legend box" class="icon-list-bullet"></button>
      <button id="continentsPercentage" data-tip="Toggle percentage / absolute values display mode" class="icon-percent"></button>
      <button id="continentsManually" data-tip="Manually re-assign cells to continents" class="icon-brush"></button>
      <div id="continentsManuallyButtons" style="display: none">
        <div data-tip="Change brush size. Shortcuts: + / ] to increase; - / [ to decrease" style="margin-block: 0.3em;">
          <slider-input id="continentsBrush" min="1" max="100" value="15">Brush size:</slider-input>
        </div>
        <button id="continentsManuallyUndo" data-tip="Undo last brush stroke" class="icon-ccw"></button>
        <button id="continentsManuallyApply" data-tip="Apply assignment" class="icon-check"></button>
        <button id="continentsManuallyCancel" data-tip="Cancel assignment" class="icon-cancel"></button>
      </div>
      <button id="continentsExport" data-tip="Download continents data as CSV" class="icon-download"></button>
    </div>
  </div>`;

  ensureEl("dialogs").insertAdjacentHTML("beforeend", editorHtml);
  return ensureEl("continentsBody");
}

function addListeners() {
  applySortingByHeader("continentsHeader");
  ensureEl("continentsEditorRefresh").on("click", refreshContinentsEditor);
  ensureEl("continentsEditStyle").on("click", () => editStyle("conts"));
  ensureEl("continentsLegend").on("click", toggleLegend);
  ensureEl("continentsPercentage").on("click", togglePercentageMode);
  ensureEl("continentsManually").on("click", enterContinentsManualAssignment);
  ensureEl("continentsManuallyUndo").on("click", undoContinentsManualAssignment);
  ensureEl("continentsManuallyApply").on("click", applyContinentsManualAssignment);
  ensureEl("continentsManuallyCancel").on("click", () => exitContinentsManualAssignment());
  ensureEl("continentsExport").on("click", downloadContinentsCsv);
}

function refreshContinentsEditor() {
  collectStatistics();
  addLines();
}

function collectStatistics() {
  const {cells, continents} = pack;
  if (!continents) return;

  continents.forEach(c => { c.cells = 0; c.area = 0; c.rural = 0; c.urban = 0; });

  for (const i of cells.i) {
    if (cells.h[i] < 20) continue;
    const cId = cells.continent?.[i];
    if (!cId) continue;
    continents[cId].cells = (continents[cId].cells || 0) + 1;
    continents[cId].area = (continents[cId].area || 0) + cellArea(i);
    continents[cId].rural = (continents[cId].rural || 0) + cells.pop[i];
    const burgId = cells.burg[i];
    if (burgId) continents[cId].urban = (continents[cId].urban || 0) + pack.burgs[burgId].population;
  }
}

function addLines() {
  const {continents} = pack;
  if (!continents) return;

  const unit = getAreaUnit();
  let lines = "";
  let totalArea = 0;
  let totalPopulation = 0;

  for (const c of continents) {
    if (!c.i) continue;
    const area = getArea(c.area || 0);
    const rural = (c.rural || 0) * populationRate;
    const urban = (c.urban || 0) * populationRate * urbanization;
    const population = rn(rural + urban);
    const populationTip = `Total: ${si(population)}. Rural: ${si(rural)}. Urban: ${si(urban)}`;
    totalArea += area;
    totalPopulation += population;

    lines += /* html */ `<div
        class="states"
        data-id="${c.i}"
        data-name="${c.name}"
        data-color="${c.color}"
        data-cells="${c.cells || 0}"
        data-area="${area}"
        data-population="${population}"
      >
        <fill-box fill="${c.color}"></fill-box>
        <input data-tip="Continent name. Click and type to change" class="continentName" style="width: 7em"
          value="${c.name}" autocorrect="off" spellcheck="false" />
        <div data-tip="Cells count" class="continentCells" style="width: 4em">${c.cells || 0}</div>
        <div data-tip="Continent area" class="continentArea" style="width: 6em">${si(area)} ${unit}</div>
        <div data-tip="${populationTip}" class="continentPopulation" style="width: 5em">${si(population)}</div>
      </div>`;
  }

  $body.innerHTML = lines;

  ensureEl("continentsFooterCount").innerHTML = continents.filter(c => c.i).length;
  ensureEl("continentsFooterArea").innerHTML = `${si(totalArea)} ${unit}`;
  ensureEl("continentsFooterPopulation").innerHTML = si(totalPopulation);

  $body.querySelectorAll(":scope > div").forEach($line => {
    $line.on("mouseenter", highlightOn);
    $line.on("mouseleave", highlightOff);
    $line.on("click", selectContinentOnLineClick);
  });
  $body.querySelectorAll("fill-box").forEach($el => $el.on("click", changeColor));
  $body.querySelectorAll("input.continentName").forEach($el => $el.on("input", changeName));
}

function highlightOn() {
  const continentId = +this.dataset.id;
  const continent = pack.continents?.[continentId];
  if (!continent) return;
  tip("Continent: " + continent.name, true, "success");
}

function highlightOff() {
  tip("");
}

function selectContinentOnLineClick() {
  if (customization !== 13) return;
  $body.querySelector("div.selected")?.classList.remove("selected");
  this.classList.add("selected");
}

function changeColor() {
  const $el = this;
  const currentFill = $el.getAttribute("fill");
  const continentId = +$el.parentNode.dataset.id;
  const callback = newFill => {
    $el.fill = newFill;
    pack.continents[continentId].color = newFill;
    $el.parentNode.dataset.color = newFill;
    if (layerIsOn("toggleContinents")) drawContinents();
  };
  openPicker(currentFill, callback);
}

function changeName() {
  const continentId = +this.parentNode.dataset.id;
  pack.continents[continentId].name = this.value;
  this.parentNode.dataset.name = this.value;
}

// ── Manual paint mode ────────────────────────────────────────────────────────

function enterContinentsManualAssignment() {
  if (!layerIsOn("toggleContinents")) toggleContinents();
  customization = 13;
  conts.append("g").attr("id", "continentsTemp");

  document.querySelectorAll("#continentsBottom > *").forEach(el => (el.style.display = "none"));
  ensureEl("continentsManuallyButtons").style.display = "inline-block";

  continentsEditor.querySelectorAll(".hide").forEach(el => el.classList.add("hidden"));
  continentsFooter.style.display = "none";
  $body.querySelectorAll("div > input, span, svg").forEach(e => (e.style.pointerEvents = "none"));

  $("#continentsEditor").dialog({position: {my: "right top", at: "right-10 top+10", of: "svg"}});
  tip("Select a continent in the list, then drag on the map to paint cells", true);

  viewbox
    .style("cursor", "crosshair")
    .on("click", selectContinentOnMapClick)
    .call(d3.drag().on("start", dragContinentsBrush))
    .on("touchmove mousemove", moveContinentsBrush);

  // select first continent row
  $body.querySelector("div")?.classList.add("selected");
  continentsManualHistory = [];
}

function selectContinentOnMapClick() {
  const point = d3.mouse(this);
  const i = findCell(point[0], point[1]);
  if (pack.cells.h[i] < 20) return;

  const assigned = conts.select("#continentsTemp").select("polygon[data-cell='" + i + "']");
  const continentId = assigned.size() ? +assigned.attr("data-continent") : (pack.cells.continent?.[i] || 0);

  $body.querySelector("div.selected")?.classList.remove("selected");
  const row = $body.querySelector("div[data-id='" + continentId + "']");
  if (row) row.classList.add("selected");
}

function dragContinentsBrush() {
  const radius = +continentsBrush.value;
  saveContinentsSnapshot();

  d3.event.on("drag", () => {
    if (!d3.event.dx && !d3.event.dy) return;
    const p = d3.mouse(this);
    moveCircle(p[0], p[1], radius);

    const found = radius > 5 ? findAll(p[0], p[1], radius) : [findCell(p[0], p[1])];
    const selection = found.filter(isLand);
    if (selection.length) paintContinentSelection(selection);
  });
}

function paintContinentSelection(selection) {
  const temp = conts.select("#continentsTemp");
  const selected = $body.querySelector("div.selected");
  if (!selected) return;

  const continentNew = +selected.dataset.id;
  const color = pack.continents[continentNew]?.color || "#ffffff";

  selection.forEach(i => {
    const exists = temp.select("polygon[data-cell='" + i + "']");
    const continentOld = exists.size() ? +exists.attr("data-continent") : (pack.cells.continent?.[i] || 0);
    if (continentNew === continentOld) return;

    if (exists.size()) {
      exists.attr("data-continent", continentNew).attr("fill", color).attr("stroke", color);
    } else {
      temp
        .append("polygon")
        .attr("data-cell", i)
        .attr("data-continent", continentNew)
        .attr("points", getPackPolygon(i))
        .attr("fill", color)
        .attr("stroke", color);
    }
  });
}

function moveContinentsBrush() {
  showMainTip();
  const point = d3.mouse(this);
  const radius = +continentsBrush.value;
  moveCircle(point[0], point[1], radius);
}

function saveContinentsSnapshot() {
  const snap = new Uint8Array(pack.cells.continent || new Uint8Array(pack.cells.i.length));
  continentsManualHistory.push(snap);
  if (continentsManualHistory.length > 10) continentsManualHistory.shift();
}

function undoContinentsManualAssignment() {
  if (!continentsManualHistory.length) return;
  pack.cells.continent = continentsManualHistory.pop();
  conts.select("#continentsTemp").selectAll("polygon").remove();
  drawContinents();
}

function applyContinentsManualAssignment() {
  const changed = conts.select("#continentsTemp").selectAll("polygon");
  changed.each(function () {
    const i = +this.dataset.cell;
    const c = +this.dataset.continent;
    if (pack.cells.continent) pack.cells.continent[i] = c;
  });

  if (changed.size()) {
    drawContinents();
    refreshContinentsEditor();
  }
  exitContinentsManualAssignment();
}

function exitContinentsManualAssignment() {
  customization = 0;
  continentsManualHistory = [];
  conts.select("#continentsTemp").remove();
  removeCircle();

  document.querySelectorAll("#continentsBottom > *").forEach(el => (el.style.display = "inline-block"));
  ensureEl("continentsManuallyButtons").style.display = "none";

  continentsEditor.querySelectorAll(".hide").forEach(el => el.classList.remove("hidden"));
  continentsFooter.style.display = "block";
  $body.querySelectorAll("div > input, span, svg").forEach(e => (e.style.pointerEvents = ""));

  viewbox.style("cursor", "default").on("click", null).on("touchmove mousemove", null);
  viewbox.call(d3.drag().on("start", null));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function downloadContinentsCsv() {
  const {continents} = pack;
  if (!continents?.length) return;

  const unit = getAreaUnit();
  const headers = ["Id", "Continent", "Color", "Cells", `Area (${unit})`, "Population"];
  const rows = continents
    .filter(c => c.i)
    .map(c => {
      const area = rn(getArea(c.area || 0));
      const rural = rn((c.rural || 0) * populationRate);
      const urban = rn((c.urban || 0) * populationRate * urbanization);
      return [c.i, c.name, c.color, c.cells || 0, area, rural + urban];
    });

  const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
  downloadFile(csv, "continents.csv");
}

function togglePercentageMode() {
  const isPercentage = $body.dataset.type === "percentage";
  $body.dataset.type = isPercentage ? "absolute" : "percentage";
  const $button = ensureEl("continentsPercentage");
  $button.classList.toggle("icon-percent", !isPercentage);
  $button.classList.toggle("icon-check-empty", isPercentage);
}

function toggleLegend() {
  if (legend.selectAll("*").size()) {
    clearLegend();
    return;
  }
  const {continents} = pack;
  if (!continents) return;
  const data = continents.filter(c => c.i).map(c => [c.i, c.color, c.name]);
  drawLegend("Continents", data);
}
