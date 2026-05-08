"use strict";

function openTimeline() {
  renderTimelineList();

  $("#timelineEditor").dialog({
    title: "World Timeline",
    width: 520,
    resizable: false,
    position: {my: "center", at: "center", of: "svg"},
    close: () => {}
  });

  if (modules.openTimeline) return;
  modules.openTimeline = true;

  document.getElementById("timelineSave").addEventListener("click", saveTimelineSnapshot);
  document.getElementById("timelineList").addEventListener("click", handleTimelineListClick);
}

function saveTimelineSnapshot() {
  if (!pack.cells?.i?.length) {
    tip("Generate or load a map first", true, "warn");
    return;
  }

  const year = +document.getElementById("timelineYear").value;
  const label = document.getElementById("timelineLabel").value.trim() || `Year ${year}`;
  const note = document.getElementById("timelineNote").value.trim();

  const pop = Array.from(pack.cells.pop).map(p => rn(p, 4));

  const snapshot = {
    year,
    label,
    note,
    states: JSON.stringify(pack.states),
    burgs: JSON.stringify(pack.burgs),
    cultures: JSON.stringify(pack.cultures),
    religions: JSON.stringify(pack.religions),
    provinces: JSON.stringify(pack.provinces),
    cellState: Array.from(pack.cells.state).join(","),
    cellCulture: Array.from(pack.cells.culture).join(","),
    cellReligion: Array.from(pack.cells.religion).join(","),
    cellProvince: Array.from(pack.cells.province).join(","),
    cellBurg: Array.from(pack.cells.burg).join(","),
    cellPop: pop.join(",")
  };

  const existingIndex = mapTimeline.findIndex(s => s.year === year);
  if (existingIndex !== -1) {
    if (!confirm(`Overwrite snapshot for Year ${year} ("${mapTimeline[existingIndex].label}")?`)) return;
    mapTimeline[existingIndex] = snapshot;
  } else {
    mapTimeline.push(snapshot);
    mapTimeline.sort((a, b) => a.year - b.year);
  }

  document.getElementById("timelineLabel").value = "";
  document.getElementById("timelineNote").value = "";
  renderTimelineList();
  tip(`Snapshot saved: ${label} (Year ${year})`, true, "success");
}

function loadTimelineSnapshot(index) {
  const snap = mapTimeline[index];
  if (!snap) return;

  pack.states = JSON.parse(snap.states);
  pack.burgs = JSON.parse(snap.burgs);
  pack.cultures = JSON.parse(snap.cultures);
  pack.religions = JSON.parse(snap.religions);
  pack.provinces = JSON.parse(snap.provinces);

  pack.cells.state = Uint16Array.from(snap.cellState.split(","));
  pack.cells.culture = Uint16Array.from(snap.cellCulture.split(","));
  pack.cells.religion = Uint16Array.from(snap.cellReligion.split(","));
  pack.cells.province = Uint16Array.from(snap.cellProvince.split(","));
  pack.cells.burg = Uint16Array.from(snap.cellBurg.split(","));
  pack.cells.pop = Float32Array.from(snap.cellPop.split(","));

  // Invalidate zoom caches — DOM structure unchanged but data changed
  _cachedLabelGroups = null;
  _cachedEmblemGroups = null;
  _cachedMarkerElsMap = null;

  drawLayers();
  tip(`Loaded: ${snap.label} (Year ${snap.year})`, true, "success");
}

function deleteTimelineSnapshot(index) {
  const snap = mapTimeline[index];
  if (!snap) return;
  if (!confirm(`Delete snapshot "${snap.label}" (Year ${snap.year})?`)) return;
  mapTimeline.splice(index, 1);
  renderTimelineList();
}

function editSnapshotNote(index) {
  const snap = mapTimeline[index];
  if (!snap) return;
  const note = prompt(`Note for "${snap.label}" (Year ${snap.year}):`, snap.note || "");
  if (note === null) return;
  snap.note = note.trim();
  renderTimelineList();
}

function handleTimelineListClick(e) {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const index = +btn.dataset.index;
  const action = btn.dataset.action;
  if (action === "load") loadTimelineSnapshot(index);
  else if (action === "delete") deleteTimelineSnapshot(index);
  else if (action === "note") editSnapshotNote(index);
}

function renderTimelineList() {
  const list = document.getElementById("timelineList");
  if (!mapTimeline.length) {
    list.innerHTML = `<div style="color:#999;padding:1em;text-align:center">No snapshots yet.<br>Fill in a year and label above, then click Save Snapshot.</div>`;
    return;
  }

  list.innerHTML = mapTimeline
    .map(
      (snap, i) => `
    <div style="display:flex;align-items:center;gap:0.4em;padding:0.35em 0.2em;border-bottom:1px solid #3a3a3a">
      <div style="min-width:4.5em;font-weight:bold;color:#c9a227;flex-shrink:0">Yr ${snap.year}</div>
      <div style="flex:1;min-width:0;overflow:hidden">
        <div style="font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${snap.label}</div>
        ${snap.note ? `<div style="font-size:0.8em;color:#999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${snap.note}</div>` : ""}
      </div>
      <button data-action="note" data-index="${i}" title="Edit note" style="padding:0.1em 0.3em;flex-shrink:0">📝</button>
      <button data-action="load" data-index="${i}" title="Restore this snapshot" style="flex-shrink:0">Load</button>
      <button data-action="delete" data-index="${i}" title="Delete this snapshot" style="flex-shrink:0;color:#c44;font-weight:bold">✕</button>
    </div>`
    )
    .join("");
}
