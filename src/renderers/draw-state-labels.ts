import { curveNatural, line, max, select } from "d3";
import type { TypedArray } from "../types/PackedGraph";
import { drawPath, drawPoint, findClosestCell, minmax, rn, round, splitInTwo } from "../utils";

declare global {
  var drawStateLabels: (list?: number[]) => void;
}

interface Ray {
  angle: number;
  length: number;
  x: number;
  y: number;
}

interface AngleData {
  angle: number;
  dx: number;
  dy: number;
}

type PathPoints = [number, number][];

// list - an optional array of stateIds to regenerate
const stateLabelsRenderer = (list?: number[]): void => {
  TIME && console.time("drawStateLabels");

  // temporary make the labels visible
  const layerDisplay = labels.style("display");
  labels.style("display", null);

  const { cells, states, features } = pack;
  const stateIds = cells.state;

  // increase step to 15 or 30 to make it faster and more horyzontal
  // decrease step to 5 to improve accuracy
  const ANGLE_STEP = 9;
  const angles = precalculateAngles(ANGLE_STEP);

  const LENGTH_START = 5;
  const LENGTH_STEP = 5;
  const LENGTH_MAX = 300;
  // scale max raycast length by state size to skip wasted iterations on small states
  const getStateLengthMax = (cells: number) => Math.max(50, Math.min(LENGTH_MAX, Math.ceil(Math.sqrt(cells) * 20)));

  const labelPaths = getLabelPaths();
  const letterLength = checkExampleLetterLength();
  drawLabelPath(letterLength);

  // restore labels visibility
  labels.style("display", layerDisplay);

  function getLabelPaths(): [number, PathPoints][] {
    const labelPaths: [number, PathPoints][] = [];

    for (const state of states) {
      if (!state.i || state.removed) continue;
      if (list && !list.includes(state.i)) continue;

      const offset = getOffsetWidth(state.cells!);
      const maxLakeSize = state.cells! / 20;
      const lengthMax = getStateLengthMax(state.cells!);
      const [x0, y0] = state.pole!;

      // cache isInnerLake results per feature to avoid re-iterating shoreline on every raycast step
      const lakeCache = new Map<number, boolean>();

      console.time(`state ${state.i} (${state.name}, cells=${state.cells})`);

      const rays: Ray[] = angles.map(({ angle, dx, dy }) => {
        const { length, x, y } = raycast({
          stateId: state.i,
          x0,
          y0,
          dx,
          dy,
          maxLakeSize,
          offset,
          lengthMax,
          lakeCache
        });
        return { angle, length, x, y };
      });
      const [ray1, ray2] = findBestRayPair(rays);

      const pathPoints: PathPoints = [[ray1.x, ray1.y], state.pole!, [ray2.x, ray2.y]];
      if (ray1.x > ray2.x) pathPoints.reverse();

      if (DEBUG.stateLabels) {
        drawPoint(state.pole!, { color: "black", radius: 1 });
        drawPath(pathPoints, { color: "black", width: 0.2 });
      }

      labelPaths.push([state.i, pathPoints]);
      console.timeEnd(`state ${state.i} (${state.name}, cells=${state.cells})`);
    }

    return labelPaths;
  }

  function checkExampleLetterLength(): number {
    const textGroup = select<SVGGElement, unknown>("g#labels > g#states");
    const testLabel = textGroup.append("text").attr("x", 0).attr("y", 0).text("Example");
    const letterLength = (testLabel.node() as SVGTextElement).getComputedTextLength() / 7; // approximate length of 1 letter
    testLabel.remove();

    return letterLength;
  }

  function drawLabelPath(letterLength: number): void {
    const mode = options.stateLabelsMode || "auto";
    const lineGen = line<[number, number]>().curve(curveNatural);

    const textGroup = select<SVGGElement, unknown>("g#labels > g#states");
    const pathGroup = select<SVGGElement, unknown>("defs > g#deftemp > g#textPaths");

    // Phase 1: remove stale elements and create all SVG path elements (DOM writes only)
    type PathEntry = { stateId: number; pathPoints: PathPoints; pathEl: SVGPathElement };
    const pathEntries: PathEntry[] = [];

    for (const [stateId, pathPoints] of labelPaths) {
      const state = states[stateId];
      if (!state.i || state.removed) throw new Error("State must not be neutral or removed");
      if (pathPoints.length < 2) throw new Error("Label path must have at least 2 points");

      textGroup.select(`#stateLabel${stateId}`).remove();
      pathGroup.select(`#textPath_stateLabel${stateId}`).remove();

      const pathEl = pathGroup
        .append("path")
        .attr("d", round(lineGen(pathPoints) || ""))
        .attr("id", `textPath_stateLabel${stateId}`)
        .node() as SVGPathElement;

      pathEntries.push({ stateId, pathPoints, pathEl });
    }

    // Phase 2: read all path lengths in one pass (single layout flush)
    type TextEntry = PathEntry & { pathLength: number; lines: string[]; ratio: number };
    const textEntries: TextEntry[] = pathEntries.map(({ stateId, pathPoints, pathEl }) => {
      const state = states[stateId];
      const pathLength = pathEl.getTotalLength() / letterLength;
      const [lines, ratio] = getLinesAndRatio(mode, state.name!, state.fullName!, pathLength);
      return { stateId, pathPoints, pathEl, pathLength, lines, ratio };
    });

    // Phase 3: prolongate paths if needed and create all text elements (DOM writes only)
    type LabelEntry = {
      stateId: number;
      pathPoints: PathPoints;
      pathLength: number;
      textEl: SVGTextPathElement;
      needsFitCheck: boolean;
    };
    const labelEntries: LabelEntry[] = [];

    for (const { stateId, pathPoints, pathEl, pathLength, lines, ratio } of textEntries) {
      const longestLineLength = max(lines.map(l => l.length)) || 0;
      if (pathLength && pathLength < longestLineLength) {
        const [x1, y1] = pathPoints.at(0)!;
        const [x2, y2] = pathPoints.at(-1)!;
        const [dx, dy] = [(x2 - x1) / 2, (y2 - y1) / 2];
        const mod = longestLineLength / pathLength;
        pathPoints[0] = [x1 + dx - dx * mod, y1 + dy - dy * mod];
        pathPoints[pathPoints.length - 1] = [x2 - dx + dx * mod, y2 - dy + dy * mod];
        select(pathEl).attr("d", round(lineGen(pathPoints) || ""));
      }

      const textEl = textGroup
        .append("text")
        .attr("text-rendering", "optimizeSpeed")
        .attr("id", `stateLabel${stateId}`)
        .append("textPath")
        .attr("startOffset", "50%")
        .attr("font-size", `${ratio}%`)
        .attr("href", `#textPath_stateLabel${stateId}`)
        .node() as SVGTextPathElement;

      const top = (lines.length - 1) / -2;
      const spans = lines.map((lineText, index) => `<tspan x="0" dy="${index ? 1 : top}em">${lineText}</tspan>`);
      textEl.insertAdjacentHTML("afterbegin", spans.join(""));

      labelEntries.push({
        stateId,
        pathPoints,
        pathLength,
        textEl,
        needsFitCheck: mode !== "full" && lines.length > 1
      });
    }

    // Phase 4: read bboxes and fix labels that spill outside their state (reads then targeted writes)
    for (const { stateId, pathPoints, pathLength, textEl, needsFitCheck } of labelEntries) {
      if (!needsFitCheck) continue;

      const bbox = textEl.getBBox();
      const [[x1, y1], [x2, y2]] = [pathPoints.at(0)!, pathPoints.at(-1)!];
      const angleRad = Math.atan2(y2 - y1, x2 - x1);

      const fits = checkIfInsideState(bbox, angleRad, stateIds, stateId);
      if (fits) continue;

      const state = states[stateId];
      const text = pathLength > state.fullName!.length * 1.8 ? state.fullName! : state.name!;
      textEl.innerHTML = `<tspan x="0">${text}</tspan>`;
      textEl.setAttribute("font-size", `${minmax(rn((pathLength / text.length) * 50), 50, 130)}%`);
    }
  }

  function getOffsetWidth(cellsNumber: number): number {
    if (cellsNumber < 40) return 0;
    if (cellsNumber < 200) return 5;
    return 10;
  }

  function precalculateAngles(step: number): AngleData[] {
    const angles: AngleData[] = [];
    const RAD = Math.PI / 180;

    for (let angle = 0; angle < 360; angle += step) {
      const dx = Math.cos(angle * RAD);
      const dy = Math.sin(angle * RAD);
      angles.push({ angle, dx, dy });
    }

    return angles;
  }

  function raycast({
    stateId,
    x0,
    y0,
    dx,
    dy,
    maxLakeSize,
    offset,
    lengthMax,
    lakeCache
  }: {
    stateId: number;
    x0: number;
    y0: number;
    dx: number;
    dy: number;
    maxLakeSize: number;
    offset: number;
    lengthMax: number;
    lakeCache: Map<number, boolean>;
  }): { length: number; x: number; y: number } {
    let ray = { length: 0, x: x0, y: y0 };

    for (let length = LENGTH_START; length < lengthMax; length += LENGTH_STEP) {
      const [x, y] = [x0 + length * dx, y0 + length * dy];

      if (!isInsideState(x, y)) break;

      // offset points are perpendicular to the ray — skip when offset=0 (small states)
      if (offset > 0) {
        const offset1: [number, number] = [x + -dy * offset, y + dx * offset];
        const offset2: [number, number] = [x + dy * offset, y + -dx * offset];

        if (DEBUG.stateLabels) {
          drawPoint(offset1, {
            color: isInsideState(...offset1) ? "blue" : "red",
            radius: 0.4
          });
          drawPoint(offset2, {
            color: isInsideState(...offset2) ? "blue" : "red",
            radius: 0.4
          });
        }

        if (!isInsideState(...offset1) || !isInsideState(...offset2)) break;
      }

      if (DEBUG.stateLabels) {
        drawPoint([x, y], { color: "blue", radius: 0.8 });
      }

      ray = { length, x, y };
    }

    return ray;

    function isInsideState(x: number, y: number): boolean {
      if (x < 0 || x > graphWidth || y < 0 || y > graphHeight) return false;
      const cellId = findClosestCell(x, y, undefined, pack) as number;

      const featureId = cells.f[cellId];
      const feature = features[featureId];
      if (feature.type === "lake") return isInnerLake(featureId, feature) || isSmallLake(feature);

      return stateIds[cellId] === stateId;
    }

    function isInnerLake(featureId: number, feature: { shoreline: number[] }): boolean {
      const cached = lakeCache.get(featureId);
      if (cached !== undefined) return cached;
      const result = feature.shoreline.every(cellId => stateIds[cellId] === stateId);
      lakeCache.set(featureId, result);
      return result;
    }

    function isSmallLake(feature: { cells: number }): boolean {
      return feature.cells <= maxLakeSize;
    }
  }

  function findBestRayPair(rays: Ray[]): [Ray, Ray] {
    let bestPair: [Ray, Ray] | null = null;
    let bestScore = -Infinity;

    for (let i = 0; i < rays.length; i++) {
      const score1 = rays[i].length * scoreRayAngle(rays[i].angle);

      for (let j = i + 1; j < rays.length; j++) {
        const score2 = rays[j].length * scoreRayAngle(rays[j].angle);
        const pairScore = (score1 + score2) * scoreCurvature(rays[i].angle, rays[j].angle);

        if (pairScore > bestScore) {
          bestScore = pairScore;
          bestPair = [rays[i], rays[j]];
        }
      }
    }

    return bestPair!;
  }

  function scoreRayAngle(angle: number): number {
    const normalizedAngle = Math.abs(angle % 180); // [0, 180]
    const horizontality = Math.abs(normalizedAngle - 90) / 90; // [0, 1]

    if (horizontality === 1) return 1; // Best: horizontal
    if (horizontality >= 0.75) return 0.9; // Very good: slightly slanted
    if (horizontality >= 0.5) return 0.6; // Good: moderate slant
    if (horizontality >= 0.25) return 0.5; // Acceptable: more slanted
    if (horizontality >= 0.15) return 0.2; // Poor: almost vertical
    return 0.1; // Very poor: almost vertical
  }

  function scoreCurvature(angle1: number, angle2: number): number {
    const delta = getAngleDelta(angle1, angle2);
    const similarity = evaluateArc(angle1, angle2);

    if (delta === 180) return 1; // straight line: best
    if (delta < 90) return 0; // acute: not allowed
    if (delta < 120) return 0.6 * similarity;
    if (delta < 140) return 0.7 * similarity;
    if (delta < 160) return 0.8 * similarity;

    return similarity;
  }

  function getAngleDelta(angle1: number, angle2: number): number {
    let delta = Math.abs(angle1 - angle2) % 360;
    if (delta > 180) delta = 360 - delta; // [0, 180]
    return delta;
  }

  // compute arc similarity towards x-axis
  function evaluateArc(angle1: number, angle2: number): number {
    const proximity1 = Math.abs((angle1 % 180) - 90);
    const proximity2 = Math.abs((angle2 % 180) - 90);
    return 1 - Math.abs(proximity1 - proximity2) / 90;
  }

  function getLinesAndRatio(mode: string, name: string, fullName: string, pathLength: number): [string[], number] {
    if (mode === "short") return getShortOneLine();
    if (pathLength > fullName.length * 2) return getFullOneLine();
    return getFullTwoLines();

    function getShortOneLine(): [string[], number] {
      const ratio = pathLength / name.length;
      return [[name], minmax(rn(ratio * 60), 50, 150)];
    }

    function getFullOneLine(): [string[], number] {
      const ratio = pathLength / fullName.length;
      return [[fullName], minmax(rn(ratio * 70), 70, 170)];
    }

    function getFullTwoLines(): [string[], number] {
      const lines = splitInTwo(fullName);
      const longestLineLength = max(lines.map(line => line.length)) || 0;
      const ratio = pathLength / longestLineLength;
      return [lines, minmax(rn(ratio * 60), 70, 150)];
    }
  }

  // check whether multi-lined label is mostly inside the state. If no, replace it with short name label
  function checkIfInsideState(bbox: DOMRect, angleRad: number, stateIds: TypedArray, stateId: number): boolean {
    const [cx, cy] = [bbox.x + bbox.width / 2, bbox.y + bbox.height / 2];
    const halfwidth = bbox.width / 2;
    const halfheight = bbox.height / 2;

    const points: [number, number][] = [
      [-halfwidth, -halfheight],
      [+halfwidth, -halfheight],
      [+halfwidth, halfheight],
      [-halfwidth, halfheight],
      [0, halfheight],
      [0, -halfheight]
    ];

    const sin = Math.sin(angleRad);
    const cos = Math.cos(angleRad);
    const rotatedPoints = points.map(([x, y]): [number, number] => [cx + x * cos - y * sin, cy + x * sin + y * cos]);

    let pointsInside = 0;
    for (const [x, y] of rotatedPoints) {
      const isInside = stateIds[findClosestCell(x, y, undefined, pack) as number] === stateId;
      if (isInside) pointsInside++;
      if (pointsInside > 4) return true;
    }

    return false;
  }

  TIME && console.timeEnd("drawStateLabels");
};

window.drawStateLabels = stateLabelsRenderer;
