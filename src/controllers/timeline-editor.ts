// World Timeline: in-session snapshots of the political map (states, burgs, cultures, religions,
// provinces and population) that can be restored later. Not persisted in the .map file (fork-only)
import { destroyDialog } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { tip } from "@/components/tooltips";
import { ensureEl, escapeHtml, rn } from "@/utils";

interface Snapshot {
  year: number;
  label: string;
  note: string;
  states: string;
  burgs: string;
  cultures: string;
  religions: string;
  provinces: string;
  cellState: string;
  cellCulture: string;
  cellReligion: string;
  cellProvince: string;
  cellBurg: string;
  cellPop: string;
}

const dialogId = "timelineEditor" as const;

let snapshots: Snapshot[] = [];
let snapshotsSeed = ""; // snapshots belong to one map: a new one starts an empty timeline

function open(): void {
  if (snapshotsSeed !== options.map.seed) {
    snapshots = [];
    snapshotsSeed = options.map.seed;
  }

  renderDialog();
  renderList();

  $(`#${dialogId}`).dialog({
    title: "World Timeline",
    width: 520,
    resizable: false,
    position: { my: "center", at: "center", of: "svg" },
    close: () => destroyDialog(dialogId)
  });
}

function renderDialog(): void {
  destroyDialog(dialogId);
  const html = /* html */ `<div id="${dialogId}" class="dialog stable">
    <div style="display:flex;gap:0.4em;align-items:center;padding-bottom:0.5em;border-bottom:1px solid #555;margin-bottom:0.4em;flex-wrap:wrap">
      <label style="white-space:nowrap;flex-shrink:0">
        Year&nbsp;<input id="timelineYear" type="number" value="${options.map.lore.calendar.year}" style="width:5em" />
      </label>
      <label style="flex:1;min-width:8em;white-space:nowrap">
        Label&nbsp;<input id="timelineLabel" type="text" placeholder="e.g. Founding Age" style="width:calc(100% - 3.5em)" />
      </label>
      <button id="timelineSave" data-tip="Save current map state as a timeline snapshot">Save Snapshot</button>
    </div>
    <div style="display:flex;gap:0.4em;align-items:center;padding-bottom:0.5em;border-bottom:1px solid #555;margin-bottom:0.4em">
      <label style="flex:1;white-space:nowrap">
        Note&nbsp;<input id="timelineNote" type="text" placeholder="Optional description of this era..." style="width:calc(100% - 3.5em)" />
      </label>
    </div>
    <div id="timelineList" style="max-height:22em;overflow-y:auto;min-width:26em"></div>
  </div>`;
  ensureEl("dialogs").insertAdjacentHTML("beforeend", html);

  ensureEl("timelineSave").addEventListener("click", saveSnapshot);
  ensureEl("timelineList").addEventListener("click", onListClick);
}

function saveSnapshot(): void {
  if (!pack.cells?.i?.length) return void tip("Generate or load a map first", true, "warn");

  const year = +ensureEl<HTMLInputElement>("timelineYear").value;
  const label = ensureEl<HTMLInputElement>("timelineLabel").value.trim() || `Year ${year}`;
  const note = ensureEl<HTMLInputElement>("timelineNote").value.trim();

  const snapshot: Snapshot = {
    year,
    label,
    note,
    states: JSON.stringify(pack.states),
    burgs: JSON.stringify(pack.burgs),
    cultures: JSON.stringify(pack.cultures),
    religions: JSON.stringify(pack.religions),
    provinces: JSON.stringify(pack.provinces),
    cellState: pack.cells.state.join(","),
    cellCulture: pack.cells.culture.join(","),
    cellReligion: pack.cells.religion.join(","),
    cellProvince: pack.cells.province.join(","),
    cellBurg: pack.cells.burg.join(","),
    cellPop: Array.from(pack.cells.pop, p => rn(p, 4)).join(",")
  };

  const existingIndex = snapshots.findIndex(s => s.year === year);
  if (existingIndex !== -1) {
    if (!confirm(`Overwrite snapshot for Year ${year} ("${snapshots[existingIndex].label}")?`)) return;
    snapshots[existingIndex] = snapshot;
  } else {
    snapshots.push(snapshot);
    snapshots.sort((a, b) => a.year - b.year);
  }

  ensureEl<HTMLInputElement>("timelineLabel").value = "";
  ensureEl<HTMLInputElement>("timelineNote").value = "";
  renderList();
  tip(`Snapshot saved: ${label} (Year ${year})`, true, "success");
}

function loadSnapshot(index: number): void {
  const snap = snapshots[index];
  if (!snap) return;

  pack.states = JSON.parse(snap.states);
  pack.burgs = JSON.parse(snap.burgs);
  pack.cultures = JSON.parse(snap.cultures);
  pack.religions = JSON.parse(snap.religions);
  pack.provinces = JSON.parse(snap.provinces);

  pack.cells.state = Uint16Array.from(snap.cellState.split(","), Number);
  pack.cells.culture = Uint16Array.from(snap.cellCulture.split(","), Number);
  pack.cells.religion = Uint16Array.from(snap.cellReligion.split(","), Number);
  pack.cells.province = Uint16Array.from(snap.cellProvince.split(","), Number);
  pack.cells.burg = Uint16Array.from(snap.cellBurg.split(","), Number);
  pack.cells.pop = Float32Array.from(snap.cellPop.split(","), Number);

  Layers.drawAll();
  tip(`Loaded: ${snap.label} (Year ${snap.year})`, true, "success");
}

function deleteSnapshot(index: number): void {
  const snap = snapshots[index];
  if (!snap) return;
  if (!confirm(`Delete snapshot "${snap.label}" (Year ${snap.year})?`)) return;
  snapshots.splice(index, 1);
  renderList();
}

function editNote(index: number): void {
  const snap = snapshots[index];
  if (!snap) return;
  const note = prompt(`Note for "${snap.label}" (Year ${snap.year}):`, snap.note || "");
  if (note === null) return;
  snap.note = note.trim();
  renderList();
}

function onListClick(event: Event): void {
  const btn = (event.target as HTMLElement).closest<HTMLElement>("button[data-action]");
  if (!btn) return;
  const index = +btn.dataset.index!;
  const action = btn.dataset.action;
  if (action === "load") loadSnapshot(index);
  else if (action === "delete") deleteSnapshot(index);
  else if (action === "note") editNote(index);
}

function renderList(): void {
  const list = ensureEl("timelineList");
  if (!snapshots.length) {
    list.innerHTML = /* html */ `<div style="color:#999;padding:1em;text-align:center">No snapshots yet.<br>Fill in a year and label above, then click Save Snapshot.</div>`;
    return;
  }

  list.innerHTML = snapshots
    .map(
      (snap, i) => /* html */ `
    <div style="display:flex;align-items:center;gap:0.4em;padding:0.35em 0.2em;border-bottom:1px solid #3a3a3a">
      <div style="min-width:4.5em;font-weight:bold;color:#c9a227;flex-shrink:0">Yr ${snap.year}</div>
      <div style="flex:1;min-width:0;overflow:hidden">
        <div style="font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(snap.label)}</div>
        ${snap.note ? `<div style="font-size:0.8em;color:#999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(snap.note)}</div>` : ""}
      </div>
      <button data-action="note" data-index="${i}" title="Edit note" style="padding:0.1em 0.3em;flex-shrink:0">📝</button>
      <button data-action="load" data-index="${i}" title="Restore this snapshot" style="flex-shrink:0">Load</button>
      <button data-action="delete" data-index="${i}" title="Delete this snapshot" style="flex-shrink:0;color:#c44;font-weight:bold">✕</button>
    </div>`
    )
    .join("");
}

export const TimelineEditor = { open };
