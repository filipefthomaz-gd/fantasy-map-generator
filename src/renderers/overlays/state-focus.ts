// State focus: the pinned (fogged) states keep their color while the rest of the states layer is
// desaturated and dimmed by styles.states.options (fork-only feature)
import { ensureEl } from "@/utils";

/** ids of the states pinned through the fog mask */
function getFocusedStates(): number[] {
  return Array.from(document.querySelectorAll<SVGPathElement>("#fog path[id^='focusState']"))
    .map(path => +path.id.replace("focusState", ""))
    .filter(Number.isFinite);
}

/** re-apply the filters: on pin toggles, slider changes and every states redraw */
export function applyStateFocusFilters(): void {
  const statesBody = ensureEl("statesBody");
  const highlight = ensureEl("statesFocusHighlight");
  highlight.replaceChildren();

  const focused = getFocusedStates();
  if (!focused.length) {
    statesBody.style.removeProperty("filter");
    return;
  }

  const { focusGrayscale, focusDim } = styles.states.options;
  statesBody.style.filter = `grayscale(${focusGrayscale * 100}%) brightness(${focusDim})`;

  // the focused states are drawn again above the filtered layer, in their own colors
  for (const stateId of focused) {
    for (const id of [`state${stateId}`, `state-gap${stateId}`]) {
      const source = statesBody.querySelector<SVGElement>(`#${id}`);
      if (!source) continue;
      const clone = source.cloneNode(false) as SVGElement;
      clone.id = `stateHighlight-${id}`;
      highlight.appendChild(clone);
    }
  }
}
