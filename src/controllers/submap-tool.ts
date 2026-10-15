import { applyGraphSize, fitMapToScreen } from "@/components/canvas";
import { destroyDialog } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { registerMap } from "@/components/lifecycle";
import { cellsDensityColor, changeCellsDensity } from "@/components/options/tabs/options-tab";
import { undraw } from "@/components/undraw";
import { viewport } from "@/components/viewport";
import { POINTS_BY_DENSITY } from "@/data/graph-density";
import { Resample } from "@/generators/resample";
import { logStats } from "@/services/logging";
import { getLatitude, getLongitude } from "@/utils";
import { ensureEl, minmax, rn } from "../utils";

function open(): void {
  renderDialog();
  addListeners();

  $("#submapTool").dialog({
    title: "Create a submap",
    resizable: false,
    width: "32em",
    position: { my: "center", at: "center", of: "svg" },
    close: cleanup,
    buttons: {
      Submap: function (this: HTMLElement) {
        generateSubmap();
        $(this).dialog("close");
      },
      Cancel: function (this: HTMLElement) {
        $(this).dialog("close");
      }
    }
  });
}

function renderDialog(): void {
  destroyDialog("submapTool");

  const pointsValue = String(options.generation.graph.density);
  const cells = POINTS_BY_DENSITY[+pointsValue];

  const html = /* html */ `<div id="submapTool" class="dialog">
    <p style="font-weight: bold">
      This operation is destructive and irreversible. It will create a completely new map based on the current one.
      Don't forget to save the .map file to your machine first!
    </p>
    <div style="display: flex; flex-direction: column; gap: 0.5em">
      <div data-tip="Set points (cells) number of the submap" style="display: flex; gap: 1em">
        <div>Points number</div>
        <div>
          <input id="submapPointsInput" type="range" min="1" max="13" value="${pointsValue}" />
          <output id="submapPointsFormatted" style="color: ${cellsDensityColor(cells)}">${cells / 1000}K</output>
        </div>
      </div>
      <div data-tip="Check to fit burg styles (icon and label size) to the submap scale">
        <input type="checkbox" class="checkbox" id="submapRescaleBurgStyles" checked />
        <label for="submapRescaleBurgStyles" class="checkbox-label">Rescale burg styles</label>
      </div>
    </div>
  </div>`;
  ensureEl("dialogs").insertAdjacentHTML("beforeend", html);
}

function addListeners(): void {
  ensureEl<HTMLInputElement>("submapPointsInput").oninput = handlePointsInput;
}

function cleanup(): void {
  destroyDialog("submapTool");
}

function handlePointsInput(e: Event): void {
  const cells = POINTS_BY_DENSITY[+(e.target as HTMLInputElement).value];
  const output = ensureEl<HTMLOutputElement>("submapPointsFormatted");
  output.value = `${cells / 1000}K`;
  output.style.color = cellsDensityColor(cells);
}

function generateSubmap(): void {
  const { x0, y0, scale } = getSubmapRegion();
  const points = +ensureEl<HTMLInputElement>("submapPointsInput").value;
  const rescaleBurgs = ensureEl<HTMLInputElement>("submapRescaleBurgStyles").checked;
  resample({ x0, y0, scale, points, rescaleBurgs });
}

/** Submap of a single state: the window is fitted around the state's cells with a 15% padding */
function openForState(stateId: number): void {
  const { cells } = pack;
  const { width, height } = options.map.graph;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const i of cells.i) {
    if (cells.state[i] !== stateId) continue;
    const [x, y] = cells.p[i];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) {
    WARN && console.warn("No cells found for state", stateId);
    return;
  }

  const scale = Math.min(width / (maxX - minX), height / (maxY - minY)) / 1.15;
  // center the view on the state, clamped so the window never exceeds the map bounds
  const viewW = width / scale;
  const viewH = height / scale;
  const x0 = minmax((minX + maxX) / 2 - viewW / 2, 0, width - viewW);
  const y0 = minmax((minY + maxY) / 2 - viewH / 2, 0, height - viewH);

  resample({ x0, y0, scale, points: options.generation.graph.density, rescaleBurgs: true });
}

type ResampleParams = { x0: number; y0: number; scale: number; points: number; rescaleBurgs: boolean };

function resample({ x0, y0, scale, points, rescaleBurgs }: ResampleParams): void {
  INFO && console.group("generateSubmap");

  recalculateMapSize(x0, y0, scale);
  if (points !== options.generation.graph.density) changeCellsDensity(points);

  const projection = (x: number, y: number): [number, number] => [(x - x0) * scale, (y - y0) * scale];
  const inverse = (x: number, y: number): [number, number] => [x / scale + x0, y / scale + y0];

  applyGraphSize();
  fitMapToScreen();
  resetZoom(0);
  undraw();
  Resample.process({ projection, inverse, scale });

  if (rescaleBurgs) rescaleBurgStyles(scale);
  Layers.drawAll();

  registerMap(); // a submap is a new map: it gets its own id and history entry
  logStats();

  INFO && console.groupEnd();
}

/**
 * The part of the map that becomes the submap: what is on screen, widened along one axis to the canvas
 * proportions and kept inside the map. `scale` is the parent-to-submap factor, as the canvas is kept
 */
function getSubmapRegion(): { x0: number; y0: number; scale: number } {
  const { width, height } = options.map.graph;
  const visibleWidth = viewport.width / viewport.scale;
  const visibleHeight = viewport.height / viewport.scale;
  const scale = Math.min(width / visibleWidth, height / visibleHeight);

  const regionWidth = width / scale;
  const regionHeight = height / scale;
  const x0 = minmax(-viewport.x / viewport.scale - (regionWidth - visibleWidth) / 2, 0, width - regionWidth);
  const y0 = minmax(-viewport.y / viewport.scale - (regionHeight - visibleHeight) / 2, 0, height - regionHeight);
  return { x0, y0, scale };
}

function recalculateMapSize(x0: number, y0: number, scale: number): void {
  const { geography, graph, units } = options.map;
  const { coordinates } = geography;
  geography.mapSize = rn(geography.mapSize / scale, 2);

  const latT = coordinates.latT / scale;
  const latN = getLatitude(y0, coordinates, graph.height);
  geography.latitude = rn(((90 - latN) / (180 - latT)) * 100, 2);

  const lotT = coordinates.lonT / scale;
  const lonE = getLongitude(x0 + graph.width / scale, coordinates, graph.width);
  geography.longitude = rn(((180 - lonE) / (360 - lotT)) * 100, 2);

  units.distance.scale = rn(units.distance.scale / scale, 2);
  units.population.scale = rn(units.population.scale / scale, 2);
  Options.save();
}

function rescaleBurgStyles(scale: number): void {
  window.Burgs.ensureBurgGroupStyles(); // a group without a store entry would silently skip the rescale
  for (const group of ensureEl("burgIcons").querySelectorAll<SVGGElement>(":scope > g")) {
    const iconStyle = styles.burgIcons.groups[group.id]?.groups.icons;
    if (iconStyle) iconStyle.options.size = rn(minmax(iconStyle.options.size * scale, 0.2, 10), 2);
    group.remove();
  }

  const burgLabelGroups = new Set(
    pack.burgs.filter(burg => burg.i && !burg.removed).map(burg => burg.label?.group || burg.group || "burg")
  );

  for (const groupName of burgLabelGroups) {
    const groupStyle = styles.labels.groups[groupName];
    if (!groupStyle) continue;

    const size = Number.parseFloat(groupStyle.attrs["font-size"]) || 0;
    const rescaledSize = Math.max(rn((size + size / scale) / 2, 2), 1) * scale;
    groupStyle.attrs["font-size"] = `${rn(rescaledSize, 2)}%`;
  }
}

export const SubmapTool = { open, openForState };
