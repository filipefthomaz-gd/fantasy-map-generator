// Continents Editor: names, colors and cell assignment of the continents (fork-only feature)
import { closeDialogs, destroyDialog, updateDialog } from "@/components/dialog/dialog-helpers";
import { applyLineHighlighting } from "@/components/dialog/highlighting";
import { bindColumnSorting, sortDataByColumns } from "@/components/dialog/sorting";
import {
  type EditorColumn,
  initColumnVisibility,
  initEditorTable,
  renderEditorHeader,
  renderEditorPagination,
  type TableView
} from "@/components/dialog/table";
import { Layers } from "@/components/layers";
import type { FillBoxElement } from "@/components/shared/fill-box";
import { tip } from "@/components/tooltips";
import { Controllers } from "@/controllers";
import type { Continent } from "@/generators/continents-generator";
import { clearLegend, drawLegend, hasLegend } from "@/renderers/draw-legend";
import { cellArea, downloadFile, getArea, getAreaUnit } from "@/utils";
import { ensureEl, isLand, rn, si } from "../utils";

type ContinentStats = Continent & { cells?: number; area?: number; rural?: number; urban?: number };

const dialogId = "continentsEditor" as const;
const LEGEND_NAME = "Continents";
const position = { my: "right top", at: "right-10 top+10", of: "svg", collision: "fit" };

const getPopulation = (c: ContinentStats) => {
  const { scale, urbanization } = options.map.units.population;
  return rn((c.rural ?? 0) * scale + (c.urban ?? 0) * scale * urbanization.rate);
};

const columns: EditorColumn<ContinentStats>[] = [
  { key: "color", width: "1.2em", permanent: true },
  { key: "name", label: "Continent", width: "10em", permanent: true, sortBy: c => c.name || "", sortType: "alpha" },
  { key: "cells", label: "Cells", width: "5em", sortBy: c => c.cells || 0 },
  { key: "area", label: "Area", width: "7em", sortBy: c => c.area || 0 },
  { key: "population", label: "Population", width: "6em", defaultSort: "desc", sortBy: getPopulation }
];

const continentsTable = initEditorTable<ContinentStats>({
  getData: () =>
    sortDataByColumns(
      dialogId,
      (pack.continents as ContinentStats[]).filter(c => c.i),
      columns
    ),
  onUpdate: addLines
});

function open(): void {
  if (customization) return;
  closeDialogs(`#${dialogId}, .stable`);
  if (!pack.continents?.length) Continents.generate();
  Layers.show("continents");

  renderDialog();
  collectStatistics();
  continentsTable.reset();

  $(`#${dialogId}`).dialog({
    title: "Continents Editor",
    resizable: false,
    width: "fit-content",
    close: closeEditor,
    position
  });
}

function renderDialog(): void {
  destroyDialog(dialogId);
  const editorHtml = /* html */ `<div id="${dialogId}" class="dialog stable editorDialog">
    <div id="continentsBody" class="table" data-type="absolute">${renderEditorHeader({ dialogId, columns })}</div>

    <div id="continentsFooter" class="totalLine">
      <div data-tip="Number of continents" style="margin-left: 12px">Continents:&nbsp;<span id="continentsFooterCount">0</span></div>
      <div data-tip="Total land cells number" style="margin-left: 12px" data-col="cells">Cells:&nbsp;<span id="continentsFooterCells">0</span></div>
      <div data-tip="Total land area" style="margin-left: 12px" data-col="area">Area:&nbsp;<span id="continentsFooterArea">0</span></div>
      <div data-tip="Total population" style="margin-left: 12px" data-col="population">Population:&nbsp;<span id="continentsFooterPopulation">0</span></div>
    </div>

    <div id="continentsBottom" class="editorToolbar">
      <button id="continentsEditorRefresh" data-tip="Refresh the Editor" class="icon-cw"></button>
      <button id="continentsEditStyle" data-tip="Edit continents style in Style Editor" class="icon-adjust"></button>
      <button id="continentsLegend" data-tip="Toggle Legend box" class="icon-list-bullet"></button>
      <button id="continentsPercentage" data-tip="Toggle percentage / absolute values display mode" class="icon-percent"></button>
      <button id="continentsManually" data-tip="Manually re-assign cells to continents" class="icon-brush"></button>
      <button id="continentsRegenerate" data-tip="Regenerate continents from the current landmasses" class="icon-retweet"></button>
      <button id="continentsExport" data-tip="Download continents data as CSV" class="icon-download"></button>
    </div>
  </div>`;

  ensureEl("dialogs").insertAdjacentHTML("beforeend", editorHtml);
  bindColumnSorting(dialogId, continentsTable.reset);
  applyLineHighlighting(dialogId, ({ cellId }) => pack.cells.continent?.[cellId] ?? 0);
  initColumnVisibility({
    dialogId,
    columns,
    onUpdate: () => updateDialog(dialogId, { width: "fit-content", position })
  });

  ensureEl("continentsEditorRefresh").addEventListener("click", refreshEditor);
  ensureEl("continentsEditStyle").addEventListener("click", () => editStyle("conts"));
  ensureEl("continentsLegend").addEventListener("click", toggleLegend);
  ensureEl("continentsPercentage").addEventListener("click", togglePercentageMode);
  ensureEl("continentsManually").addEventListener("click", openPaintEditor);
  ensureEl("continentsRegenerate").addEventListener("click", regenerate);
  ensureEl("continentsExport").addEventListener("click", downloadCsv);
}

function refreshEditor(): void {
  collectStatistics();
  continentsTable.refresh();
}

function collectStatistics(): void {
  const { cells, continents, burgs } = pack;
  for (const c of continents as ContinentStats[]) {
    c.cells = c.area = c.rural = c.urban = 0;
  }

  for (const i of cells.i) {
    if (cells.h[i] < 20) continue;
    const continent = (continents as ContinentStats[])[cells.continent?.[i] ?? 0];
    if (!continent?.i) continue;
    continent.cells! += 1;
    continent.area! += cellArea(i);
    continent.rural! += cells.pop[i];
    const burgId = cells.burg[i];
    if (burgId) continent.urban! += burgs[burgId].population!;
  }
}

function addLines(view: TableView<ContinentStats>): void {
  const unit = getAreaUnit();
  let lines = "";
  let totalArea = 0;
  let totalPopulation = 0;

  for (const c of view.all) {
    totalArea += getArea(c.area ?? 0);
    totalPopulation += getPopulation(c);
  }

  for (const c of view.rows) {
    const area = getArea(c.area ?? 0);
    const population = getPopulation(c);
    const { scale, urbanization } = options.map.units.population;
    const populationTip = `Total: ${si(population)}. Rural: ${si((c.rural ?? 0) * scale)}. Urban: ${si(
      (c.urban ?? 0) * scale * urbanization.rate
    )}`;

    lines += /* html */ `<div
        class="states"
        data-id="${c.i}"
        data-name="${c.name}"
        data-color="${c.color}"
        data-cells="${c.cells ?? 0}"
        data-area="${area}"
        data-population="${population}"
      >
        <fill-box fill="${c.color}" data-col="color"></fill-box>
        <div data-col="name">
          <input data-tip="Continent name. Click and type to change" class="continentName"
            value="${c.name}" autocorrect="off" spellcheck="false" />
        </div>
        <div data-col="cells">
          <span data-tip="Cells count" class="icon-check-empty"></span>
          <div data-tip="Cells count" class="continentCells">${c.cells ?? 0}</div>
        </div>
        <div data-col="area">
          <span data-tip="Continent area" class="icon-map-o"></span>
          <div data-tip="Continent area" class="continentArea">${si(area)} ${unit}</div>
        </div>
        <div data-col="population">
          <span data-tip="${populationTip}" class="icon-male"></span>
          <div data-tip="${populationTip}" class="continentPopulation">${si(population)}</div>
        </div>
      </div>`;
  }

  const body = ensureEl("continentsBody");
  for (const row of Array.from(body.querySelectorAll(":scope > .states"))) row.remove();
  body.insertAdjacentHTML("beforeend", lines);

  ensureEl("continentsFooterCount").innerHTML = String(view.all.length);
  ensureEl("continentsFooterCells").innerHTML = String(
    (pack.cells.h as unknown as number[]).filter(h => h >= 20).length
  );
  ensureEl("continentsFooterArea").innerHTML = `${si(totalArea)} ${unit}`;
  ensureEl("continentsFooterPopulation").innerHTML = si(totalPopulation);
  ensureEl("continentsFooterArea").dataset.area = String(totalArea);
  ensureEl("continentsFooterPopulation").dataset.population = String(totalPopulation);

  renderEditorPagination(ensureEl("continentsFooter"), view, continentsTable.goto);

  body.querySelectorAll<HTMLElement>(":scope > div.states").forEach($line => {
    $line.addEventListener("mouseenter", () => tip(`Continent: ${$line.dataset.name}`, true, "success"));
    $line.addEventListener("mouseleave", () => tip(""));
  });
  for (const $el of Array.from(body.querySelectorAll("fill-box"))) $el.addEventListener("click", changeColor);
  for (const $el of Array.from(body.querySelectorAll("input.continentName"))) $el.addEventListener("input", changeName);

  if (body.dataset.type === "percentage") {
    body.dataset.type = "absolute";
    togglePercentageMode();
  }
  updateDialog(dialogId, { width: "fit-content", position });
}

function changeColor(this: FillBoxElement): void {
  const currentFill = this.getAttribute("fill") || "#ffffff";
  const row = this.parentNode as HTMLElement;
  const continentId = +row.dataset.id!;

  void Controllers.ColorPicker.open(currentFill, (newFill: string) => {
    this.fill = newFill;
    row.dataset.color = newFill;
    pack.continents[continentId].color = newFill;
    Layers.draw("continents");
  });
}

function changeName(this: HTMLInputElement): void {
  const row = this.closest(".states") as HTMLElement;
  row.dataset.name = this.value;
  pack.continents[+row.dataset.id!].name = this.value;
}

function openPaintEditor(): void {
  Layers.show("continents");

  void Controllers.PaintEditor.open({
    title: "Paint Continents",
    parentDialogId: dialogId,
    onClose: open,
    items: pack.continents.filter(c => c.i).map(c => ({ id: c.i, name: c.name, color: c.color || "#ffffff" })),
    dontOverrideControl: true,
    getValue: cell => pack.cells.continent?.[cell] ?? 0,
    filterCell: cell => isLand(cell, pack),
    onApply: applyPaint
  });
}

function applyPaint(changes: ReadonlyMap<number, number>): void {
  if (!pack.cells.continent) pack.cells.continent = new Uint8Array(pack.cells.i.length);
  for (const [cell, continent] of changes) pack.cells.continent[cell] = continent;
  if (changes.size) {
    Layers.draw("continents");
    if (document.getElementById(dialogId)) refreshEditor();
  }
}

function regenerate(): void {
  Continents.generate();
  Layers.draw("continents");
  refreshEditor();
}

function toggleLegend(): void {
  if (hasLegend(LEGEND_NAME)) {
    clearLegend(LEGEND_NAME);
    return;
  }
  const data = (pack.continents as ContinentStats[])
    .filter(c => c.i && c.cells)
    .sort((a, b) => (b.area ?? 0) - (a.area ?? 0))
    .map(c => [c.i, c.color, c.name]);
  drawLegend(LEGEND_NAME, data);
}

function togglePercentageMode(): void {
  const body = ensureEl("continentsBody");
  if (body.dataset.type === "absolute") {
    body.dataset.type = "percentage";
    const totalCells = +ensureEl("continentsFooterCells").innerText;
    const totalArea = +ensureEl("continentsFooterArea").dataset.area!;
    const totalPopulation = +ensureEl("continentsFooterPopulation").dataset.population!;

    body.querySelectorAll<HTMLElement>(":scope > div.states").forEach(el => {
      const { cells, area, population } = el.dataset;
      el.querySelector<HTMLElement>(".continentCells")!.innerText = `${rn((+cells! / totalCells) * 100)}%`;
      el.querySelector<HTMLElement>(".continentArea")!.innerText = `${rn((+area! / totalArea) * 100)}%`;
      el.querySelector<HTMLElement>(".continentPopulation")!.innerText =
        `${rn((+population! / totalPopulation) * 100)}%`;
    });
  } else {
    body.dataset.type = "absolute";
    continentsTable.refresh();
  }
}

function downloadCsv(): void {
  const unit = getAreaUnit("2");
  const headers = `Id,Name,Color,Cells,Area ${unit},Population`;
  const data = continentsTable
    .view()
    .all.map(c => [c.i, c.name, c.color, c.cells ?? 0, rn(getArea(c.area ?? 0)), getPopulation(c)].join(","));
  downloadFile([headers, ...data].join("\n"), "continents.csv");
}

function closeEditor(): void {
  $(`#${dialogId}`).dialog("destroy");
  ensureEl(dialogId).remove();
}

export const ContinentsEditor = { open };
