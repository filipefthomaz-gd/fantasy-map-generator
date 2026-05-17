import { curveCatmullRom, line } from "d3";
import Delaunator from "delaunator";
import {
  distanceSquared,
  findClosestCell,
  findPath,
  getAdjective,
  isLand,
  ra,
  rn,
  round,
  rw,
} from "../utils";
import type { Burg } from "./burgs-generator";
import type { Point } from "./voronoi";

const ROUTES_SHARP_ANGLE = 135;
const ROUTES_VERY_SHARP_ANGLE = 115;

const MIN_PASSABLE_SEA_TEMP = -4;
// Height scale is 20 (sea level) to 100 (highest peaks). Cells above this threshold
// are impassable for railways — pathfinding must find a mountain pass or won't connect.
const RAILWAY_MAX_HEIGHT = 70;
const ROUTE_TYPE_MODIFIERS: Record<string, number> = {
  "-1": 1, // coastline
  "-2": 1.8, // sea
  "-3": 4, // open sea
  "-4": 6, // ocean
  default: 8, // far ocean
};

// name generator data
const models: Record<string, Record<string, number>> = {
  roads: {
    burg_suffix: 3,
    prefix_suffix: 6,
    the_descriptor_prefix_suffix: 2,
    the_descriptor_burg_suffix: 1,
  },
  trails: { burg_suffix: 8, prefix_suffix: 1, the_descriptor_burg_suffix: 1 },
  searoutes: {
    burg_suffix: 4,
    prefix_suffix: 2,
    the_descriptor_prefix_suffix: 1,
  },
  railways: { burg_suffix: 2, prefix_suffix: 4, the_descriptor_prefix_suffix: 2 },
  airways: { burg_suffix: 1, prefix_suffix: 3, the_descriptor_prefix_suffix: 4 },
};

const prefixes: string[] = [
  "King",
  "Queen",
  "Military",
  "Old",
  "New",
  "Ancient",
  "Royal",
  "Imperial",
  "Great",
  "Grand",
  "High",
  "Silver",
  "Dragon",
  "Shadow",
  "Star",
  "Mystic",
  "Whisper",
  "Eagle",
  "Golden",
  "Crystal",
  "Enchanted",
  "Frost",
  "Moon",
  "Sun",
  "Thunder",
  "Phoenix",
  "Sapphire",
  "Celestial",
  "Wandering",
  "Echo",
  "Twilight",
  "Crimson",
  "Serpent",
  "Iron",
  "Forest",
  "Flower",
  "Whispering",
  "Eternal",
  "Frozen",
  "Rain",
  "Luminous",
  "Stardust",
  "Arcane",
  "Glimmering",
  "Jade",
  "Ember",
  "Azure",
  "Gilded",
  "Divine",
  "Shadowed",
  "Cursed",
  "Moonlit",
  "Sable",
  "Everlasting",
  "Amber",
  "Nightshade",
  "Wraith",
  "Scarlet",
  "Platinum",
  "Whirlwind",
  "Obsidian",
  "Ethereal",
  "Ghost",
  "Spike",
  "Dusk",
  "Raven",
  "Spectral",
  "Burning",
  "Verdant",
  "Copper",
  "Velvet",
  "Falcon",
  "Enigma",
  "Glowing",
  "Silvered",
  "Molten",
  "Radiant",
  "Astral",
  "Wild",
  "Flame",
  "Amethyst",
  "Aurora",
  "Shadowy",
  "Solar",
  "Lunar",
  "Whisperwind",
  "Fading",
  "Titan",
  "Dawn",
  "Crystalline",
  "Jeweled",
  "Sylvan",
  "Twisted",
  "Ebon",
  "Thorn",
  "Cerulean",
  "Halcyon",
  "Infernal",
  "Storm",
  "Eldritch",
  "Sapphire",
  "Crimson",
  "Tranquil",
  "Paved",
];

const descriptors = [
  "Great",
  "Shrouded",
  "Sacred",
  "Fabled",
  "Frosty",
  "Winding",
  "Echoing",
  "Serpentine",
  "Breezy",
  "Misty",
  "Rustic",
  "Silent",
  "Cobbled",
  "Cracked",
  "Shaky",
  "Obscure",
];

const suffixes: Record<string, Record<string, number>> = {
  roads: { road: 7, route: 3, way: 2, highway: 1 },
  trails: { trail: 4, path: 1, track: 1, pass: 1 },
  searoutes: { "sea route": 5, lane: 2, passage: 1, seaway: 1 },
  railways: { railway: 5, railroad: 3, "rail line": 2, "iron road": 1 },
  airways: { airway: 4, "air route": 3, "flight path": 2, skyway: 1 },
};

export interface Route {
  i: number;
  group: "roads" | "trails" | "searoutes" | "railways" | "airways";
  feature: number;
  points: number[][];
  cells?: number[];
  merged?: boolean;
  name?: string;
  lock?: boolean;
  airport?: number;
}

class RoutesModule {
  buildLinks(routes: Route[]): Record<number, Record<number, number>> {
    const links: Record<number, Record<number, number>> = {};

    for (const { points, i: routeId } of routes) {
      const cells = points.map((p) => p[2]);

      for (let i = 0; i < cells.length - 1; i++) {
        const cellId = cells[i];
        const nextCellId = cells[i + 1];

        if (cellId !== nextCellId) {
          if (!links[cellId]) links[cellId] = {};
          links[cellId][nextCellId] = routeId;

          if (!links[nextCellId]) links[nextCellId] = {};
          links[nextCellId][cellId] = routeId;
        }
      }
    }

    return links;
  }

  private sortBurgsByFeature(burgs: Burg[]) {
    const burgsByFeature: Record<number, Burg[]> = {};
    const capitalsByFeature: Record<number, Burg[]> = {};
    const portsByFeature: Record<number, Burg[]> = {};

    const addBurg = (
      collection: Record<number, Burg[]>,
      feature: number,
      burg: Burg,
    ) => {
      if (!collection[feature]) collection[feature] = [];
      collection[feature].push(burg);
    };

    for (const burg of burgs) {
      if (burg.i && !burg.removed) {
        const { feature, capital, port } = burg;
        addBurg(burgsByFeature, feature as number, burg);
        if (capital) addBurg(capitalsByFeature, feature as number, burg);
        if (port) addBurg(portsByFeature, port as number, burg);
      }
    }

    return { burgsByFeature, capitalsByFeature, portsByFeature };
  }

  // Urquhart graph is obtained by removing the longest edge from each triangle in the Delaunay triangulation
  // this gives us an aproximation of a desired road network, i.e. connections between burgs
  // code from https://observablehq.com/@mbostock/urquhart-graph
  private calculateUrquhartEdges(points: Point[]) {
    const score = (p0: number, p1: number) =>
      distanceSquared(points[p0], points[p1]);

    const { halfedges, triangles } = Delaunator.from(points);
    const n = triangles.length;

    const removed = new Uint8Array(n);
    const edges = [];

    for (let e = 0; e < n; e += 3) {
      const p0 = triangles[e],
        p1 = triangles[e + 1],
        p2 = triangles[e + 2];

      const p01 = score(p0, p1),
        p12 = score(p1, p2),
        p20 = score(p2, p0);

      removed[
        p20 > p01 && p20 > p12
          ? Math.max(e + 2, halfedges[e + 2])
          : p12 > p01 && p12 > p20
            ? Math.max(e + 1, halfedges[e + 1])
            : Math.max(e, halfedges[e])
      ] = 1;
    }

    for (let e = 0; e < n; ++e) {
      if (e > halfedges[e] && !removed[e]) {
        const t0 = triangles[e];
        const t1 = triangles[e % 3 === 2 ? e - 2 : e + 1];
        edges.push([t0, t1]);
      }
    }

    return edges;
  }

  private createCostEvaluator({
    isWater,
    connections,
    hostileStates = new Set<number>(),
    mountainPenalty = 3,
    airway = false,
    maxHeight = Infinity,
    hostilePenalty = 8,
  }: {
    isWater: boolean;
    connections: Map<string, boolean>;
    hostileStates?: Set<number>;
    mountainPenalty?: number;
    airway?: boolean;
    maxHeight?: number;
    hostilePenalty?: number;
  }) {
    function getLandPathCost(current: number, next: number) {
      if (pack.cells.h[next] < 20) return Infinity; // ignore water cells
      if (pack.cells.h[next] > maxHeight) return Infinity; // terrain too steep

      const habitability = biomesData.habitability[pack.cells.biome[next]];
      if (!habitability) return Infinity; // inhabitable cells are not passable (e.g. glacier)

      const distanceCost = distanceSquared(
        pack.cells.p[current],
        pack.cells.p[next],
      );
      const habitabilityModifier = airway
        ? 1
        : 1 + Math.max(100 - habitability, 0) / 1000; // [1, 1.1]
      const heightModifier = airway
        ? 1 + Math.max(pack.cells.h[next] - 25, 0) / 2000 // nearly flat for air
        : 1 + (Math.max(pack.cells.h[next] - 25, 25) / 25) * (mountainPenalty / 3); // [2, mP*4/3]
      const connectionModifier = connections.has(`${current}-${next}`)
        ? 0.5
        : 1;
      const burgModifier = pack.cells.burg[next] ? 1 : 3;
      const hostileMod = hostileStates.has(pack.cells.state[next]) ? hostilePenalty : 1;

      const pathCost =
        distanceCost *
        habitabilityModifier *
        heightModifier *
        connectionModifier *
        burgModifier *
        hostileMod;
      return pathCost;
    }

    function getWaterPathCost(current: number, next: number) {
      if (pack.cells.h[next] >= 20) return Infinity; // ignore land cells
      if (grid.cells.temp[pack.cells.g[next]] < MIN_PASSABLE_SEA_TEMP)
        return Infinity; // ignore too cold cells

      const distanceCost = distanceSquared(
        pack.cells.p[current],
        pack.cells.p[next],
      );
      const typeModifier =
        ROUTE_TYPE_MODIFIERS[pack.cells.t[next]] ||
        ROUTE_TYPE_MODIFIERS.default;
      const connectionModifier = connections.has(`${current}-${next}`)
        ? 0.5
        : 1;

      const pathCost = distanceCost * typeModifier * connectionModifier;
      return pathCost;
    }
    return isWater ? getWaterPathCost : getLandPathCost;
  }

  private getRouteSegments(
    pathCells: number[],
    connections: Map<string, boolean>,
  ) {
    const segments = [];
    let segment = [];

    for (let i = 0; i < pathCells.length; i++) {
      const cellId = pathCells[i];
      const nextCellId = pathCells[i + 1];
      const isConnected =
        connections.has(`${cellId}-${nextCellId}`) ||
        connections.has(`${nextCellId}-${cellId}`);

      if (isConnected) {
        if (segment.length) {
          // segment stepped into existing segment
          segment.push(pathCells[i]);
          segments.push(segment);
          segment = [];
        }
        continue;
      }

      segment.push(pathCells[i]);
    }

    if (segment.length > 1) segments.push(segment);

    return segments;
  }

  private findPathSegments({
    isWater,
    connections,
    start,
    exit,
    hostileStates,
    mountainPenalty,
    airway,
    maxHeight,
    hostilePenalty,
  }: {
    isWater: boolean;
    connections: Map<string, boolean>;
    start: number;
    exit: number;
    hostileStates?: Set<number>;
    mountainPenalty?: number;
    airway?: boolean;
    maxHeight?: number;
    hostilePenalty?: number;
  }) {
    const getCost = this.createCostEvaluator({ isWater, connections, hostileStates, mountainPenalty, airway, maxHeight, hostilePenalty });
    const pathCells = findPath(
      start,
      (current) => current === exit,
      getCost,
      pack,
    );
    if (!pathCells) return [];
    const segments = this.getRouteSegments(pathCells, connections);
    return segments;
  }

  private getHostileStates(stateId: number): Set<number> {
    const state = pack.states[stateId];
    if (!state?.diplomacy) return new Set();
    const hostile = new Set<number>();
    (state.diplomacy as string[]).forEach((rel, otherId) => {
      if (rel === "Enemy" || rel === "Rival") hostile.add(otherId);
    });
    return hostile;
  }

  private generateMainRoads(connections: Map<string, boolean>) {
    TIME && console.time("generateMainRoads");
    const { capitalsByFeature } = this.sortBurgsByFeature(pack.burgs);
    const mainRoads: Route[] = [];

    for (const [key, featureCapitals] of Object.entries(capitalsByFeature)) {
      const points = featureCapitals.map((burg) => [burg.x, burg.y] as Point);
      const urquhartEdges = this.calculateUrquhartEdges(points);
      urquhartEdges.forEach(([fromId, toId]) => {
        const burgA = featureCapitals[fromId];
        const burgB = featureCapitals[toId];
        const stateA = burgA.state ?? 0;
        const stateB = burgB.state ?? 0;

        if (stateA && stateB && stateA !== stateB) {
          const rel = (pack.states[stateA]?.diplomacy as string[] | undefined)?.[stateB] ?? "Neutral";
          const allowed = ["Ally", "Friendly", "Vassal", "Suzerain"];
          if (!allowed.includes(rel)) return;
        }

        const hostileStates = stateA ? this.getHostileStates(stateA) : new Set<number>();
        const segments = this.findPathSegments({
          isWater: false,
          connections,
          start: burgA.cell!,
          exit: burgB.cell!,
          hostileStates,
        });
        for (const segment of segments) {
          this.addConnections(segment, connections);
          mainRoads.push({ feature: Number(key), cells: segment } as Route);
        }
      });
    }

    TIME && console.timeEnd("generateMainRoads");
    return mainRoads;
  }

  private addConnections(segment: number[], connections: Map<string, boolean>) {
    for (let i = 0; i < segment.length; i++) {
      const cellId = segment[i];
      const nextCellId = segment[i + 1];
      if (nextCellId) {
        connections.set(`${cellId}-${nextCellId}`, true);
        connections.set(`${nextCellId}-${cellId}`, true);
      }
    }
  }

  private generateTrails(connections: Map<string, boolean>) {
    TIME && console.time("generateTrails");
    const { burgsByFeature } = this.sortBurgsByFeature(pack.burgs);
    const trails: Route[] = [];

    for (const [key, featureBurgs] of Object.entries(burgsByFeature)) {
      const points = featureBurgs.map((burg) => [burg.x, burg.y] as Point);
      const urquhartEdges = this.calculateUrquhartEdges(points);
      urquhartEdges.forEach(([fromId, toId]) => {
        const start = featureBurgs[fromId].cell;
        const exit = featureBurgs[toId].cell;

        const segments = this.findPathSegments({
          isWater: false,
          connections,
          start,
          exit,
        });
        for (const segment of segments) {
          this.addConnections(segment, connections);
          trails.push({ feature: Number(key), cells: segment } as Route);
        }
      });
    }

    TIME && console.timeEnd("generateTrails");
    return trails;
  }

  private generateSeaRoutes(connections: Map<string, boolean>) {
    TIME && console.time("generateSeaRoutes");
    const { portsByFeature } = this.sortBurgsByFeature(pack.burgs);
    const seaRoutes: Route[] = [];

    for (const [featureId, featurePorts] of Object.entries(portsByFeature)) {
      const points = featurePorts.map((burg) => [burg.x, burg.y] as Point);
      const urquhartEdges = this.calculateUrquhartEdges(points);

      urquhartEdges.forEach(([fromId, toId]) => {
        const start = featurePorts[fromId].cell;
        const exit = featurePorts[toId].cell;
        const segments = this.findPathSegments({
          isWater: true,
          connections,
          start,
          exit,
        });
        for (const segment of segments) {
          this.addConnections(segment, connections);
          seaRoutes.push({
            feature: Number(featureId),
            cells: segment,
          } as Route);
        }
      });
    }

    TIME && console.timeEnd("generateSeaRoutes");
    return seaRoutes;
  }

  private getAdvancementContext() {
    const valid = pack.states.filter((s: any) => s && s.i && !s.removed && s.burgs > 0);

    const sorted = (arr: number[]) => [...arr].sort((a, b) => a - b);
    const median = (arr: number[]) => arr[Math.floor(arr.length / 2)] ?? 0;

    // Average burg size: urban population points per burg (size-neutral)
    const avgBurgSizes = sorted(valid.map((s: any) => (s.urban ?? 0) / s.burgs));
    // Total population (not density — large countries shouldn't be penalized for area)
    const totalPops = sorted(valid.map((s: any) =>
      (s.rural ?? 0) * (populationRate as number) + (s.urban ?? 0) * (populationRate as number) * (urbanization as number)
    ));

    return {
      medianAvgBurgSize: Math.max(median(avgBurgSizes), 1e-6),
      medianTotalPop: Math.max(median(totalPops), 1e-6),
    };
  }

  private formScore(form: string): number {
    const scores: Record<string, number> = {
      Union: 25, Republic: 22, Democracy: 22, Federation: 23,
      Oligarchy: 16, Constitutional: 18, Parliamentary: 18,
      Monarchy: 12, Kingdom: 12, Empire: 10, Duchy: 10, Sultanate: 10, Caliphate: 10, Shogunate: 11,
      Theocracy: 8, Papacy: 8, Imamate: 8,
      Despotism: 5, Dictatorship: 5,
      Tribal: 4, Horde: 3, Chiefdom: 5, Clan: 4,
      Anarchy: 0,
    };
    return scores[form] ?? 8;
  }

  getAdvancementDetails(state: any, ctx?: ReturnType<RoutesModule["getAdvancementContext"]>) {
    const context = ctx ?? this.getAdvancementContext();

    const rural = (state.rural ?? 0) * (populationRate as number);
    const urban = (state.urban ?? 0) * (populationRate as number) * (urbanization as number);
    const totalPop = rural + urban;

    const urbRate = totalPop > 0 ? urban / totalPop : 0;
    const urbScore = Math.round(urbRate * 35);

    const avgBurgSize = (state.burgs ?? 0) > 0 ? (state.urban ?? 0) / state.burgs : 0;
    const burgScore = Math.min(Math.round((avgBurgSize / context.medianAvgBurgSize) * 10), 20);

    const popScore = Math.min(Math.round((totalPop / context.medianTotalPop) * 10), 20);

    const formPts = this.formScore(state.form);

    const score = Math.min(urbScore + burgScore + popScore + formPts, 100);
    const tier = score >= 70 ? "Advanced" : score >= 40 ? "Industrial" : "Pre-industrial";

    return { score, urbScore, burgScore, popScore, formPts, tier };
  }

  private computeAdvancement(state: any, ctx: ReturnType<RoutesModule["getAdvancementContext"]>): number {
    return this.getAdvancementDetails(state, ctx).score;
  }

  private generateRailwayRoutes(connections: Map<string, boolean>): Route[] {
    TIME && console.time("generateRailwayRoutes");
    const railways: Route[] = [];
    const ctx = this.getAdvancementContext();
    const RAILWAY_THRESHOLD = 40;

    const qualifyingStates = pack.states.filter(
      (s: any) => s && s.i && !s.removed && this.computeAdvancement(s, ctx) >= RAILWAY_THRESHOLD,
    );

    for (const state of qualifyingStates) {
      const advScore = this.computeAdvancement(state, ctx);
      const maxBurgs = Math.min(Math.ceil(advScore / 20), 6);

      const stateBurgs = pack.burgs
        .filter((b: any) => b && b.i && !b.removed && b.state === state.i && (b.capital || b.station === 1 || (b.population ?? 0) > 2))
        .sort((a: any, b: any) => (b.population ?? 0) - (a.population ?? 0))
        .slice(0, maxBurgs);

      // Also include manually-set station burgs not yet in the list
      const stationBurgs = pack.burgs.filter(
        (b: any) => b && b.i && !b.removed && b.state === state.i && b.station === 1 &&
          !stateBurgs.some((sb: any) => sb.i === b.i),
      );
      stateBurgs.push(...stationBurgs);

      if (stateBurgs.length < 2) continue;

      const hostileStates = this.getHostileStates(state.i);
      const points = stateBurgs.map((b: any) => [b.x, b.y] as Point);
      const edges: [number, number][] =
        stateBurgs.length === 2
          ? [[0, 1]]
          : (this.calculateUrquhartEdges(points) as [number, number][]);

      edges.forEach(([fromId, toId]) => {
        const segments = this.findPathSegments({
          isWater: false,
          connections,
          start: stateBurgs[fromId].cell!,
          exit: stateBurgs[toId].cell!,
          mountainPenalty: 8,
          maxHeight: RAILWAY_MAX_HEIGHT,
          hostileStates,
          hostilePenalty: 60,
        });
        for (const seg of segments) {
          this.addConnections(seg, connections);
          railways.push({ feature: state.center, cells: seg } as Route);
        }
      });
    }

    // Connect all manually-set station burgs grouped by land feature (not state).
    // This ensures stations in different states on the same continent are linked.
    const qualifyingStateIds = new Set(qualifyingStates.map((s: any) => s.i));
    const manualStationsByFeature = new Map<number, any[]>();
    pack.burgs.forEach((b: any) => {
      if (!b || !b.i || b.removed || b.station !== 1) return;
      if (qualifyingStateIds.has(b.state)) return; // already handled per-state above
      const feature = pack.cells.f[b.cell] as number;
      if (!manualStationsByFeature.has(feature)) manualStationsByFeature.set(feature, []);
      manualStationsByFeature.get(feature)!.push(b);
    });
    for (const [feature, stations] of manualStationsByFeature) {
      if (stations.length < 2) continue;
      const points = stations.map((b: any) => [b.x, b.y] as Point);
      const edges: [number, number][] =
        stations.length === 2
          ? [[0, 1]]
          : (this.calculateUrquhartEdges(points) as [number, number][]);
      edges.forEach(([fromId, toId]) => {
        const segments = this.findPathSegments({
          isWater: false, connections,
          start: stations[fromId].cell!, exit: stations[toId].cell!,
          mountainPenalty: 8, maxHeight: RAILWAY_MAX_HEIGHT,
        });
        for (const seg of segments) {
          this.addConnections(seg, connections);
          railways.push({ feature, cells: seg } as Route);
        }
      });
    }

    // Cross-border railways between qualifying states
    for (let ai = 0; ai < qualifyingStates.length; ai++) {
      const stateA = qualifyingStates[ai];
      for (let bi = ai + 1; bi < qualifyingStates.length; bi++) {
        const stateB = qualifyingStates[bi];
        const rel = (stateA.diplomacy as string[] | undefined)?.[stateB.i] ?? "Neutral";

        if (rel === "Enemy" || rel === "Rival") {
          // Rare contested line — roughly 10% chance, capitals only
          if (Math.random() > 0.1) continue;
        } else if (rel !== "Ally") {
          continue;
        }

        const capA = pack.burgs[stateA.capital];
        const capB = pack.burgs[stateB.capital];
        if (!capA || !capB || capA.removed || capB.removed) continue;

        const segments = this.findPathSegments({
          isWater: false,
          connections,
          start: capA.cell!,
          exit: capB.cell!,
          mountainPenalty: 8,
          maxHeight: RAILWAY_MAX_HEIGHT,
        });
        for (const seg of segments) {
          this.addConnections(seg, connections);
          railways.push({ feature: capA.feature as number, cells: seg } as Route);
        }
      }
    }

    TIME && console.timeEnd("generateRailwayRoutes");
    return railways;
  }

  generateRailways() {
    const locked = pack.routes.filter((r: Route) => r.lock && r.group === "railways");
    const connections = new Map<string, boolean>();
    locked.forEach((r: Route) => this.addConnections(r.points.map((p) => p[2]), connections));

    pack.routes = pack.routes.filter((r: Route) => r.group !== "railways" || r.lock);
    const pointsArray = this.preparePointsArray();

    for (const { feature, cells, merged } of this.mergeRoutes(this.generateRailwayRoutes(connections))) {
      if (merged) continue;
      const points = this.getPoints("railways", cells!, pointsArray);
      pack.routes.push({ i: pack.routes.length, group: "railways", feature, points } as Route);
    }
    pack.cells.routes = this.buildLinks(pack.routes);
  }

  private generateAirwayRoutes(): Route[] {
    TIME && console.time("generateAirwayRoutes");
    const airways: Route[] = [];
    const ctx = this.getAdvancementContext();
    const AIRWAY_THRESHOLD = 70;

    const qualifyingStates = pack.states.filter(
      (s: any) => s && s.i && !s.removed && this.computeAdvancement(s, ctx) >= AIRWAY_THRESHOLD,
    );

    const qualifyingStateIds = new Set(qualifyingStates.map((s: any) => s.i));

    const airportsByState: Record<number, any[]> = {};

    // Collect airports for qualifying states (manual flag or high-population/capital burgs)
    for (const state of qualifyingStates) {
      const airports = pack.burgs.filter(
        (b: any) =>
          b && b.i && !b.removed && b.state === state.i &&
          (b.airport === 1 || b.capital === 1 || (b.population ?? 0) > 5),
      );
      if (airports.length >= 1) airportsByState[state.i] = airports;
    }

    // Within-state airways for qualifying states
    for (const stateId of Object.keys(airportsByState).map(Number)) {
      const airports = airportsByState[stateId];
      if (!airports || airports.length < 2) continue;

      const state = pack.states[stateId];
      const points = airports.map((b: any) => [b.x, b.y] as Point);
      const edges: [number, number][] =
        airports.length === 2
          ? [[0, 1]]
          : (this.calculateUrquhartEdges(points) as [number, number][]);

      edges.forEach(([fromId, toId]) => {
        airways.push({
          feature: state?.center ?? airports[fromId].feature,
          cells: [airports[fromId].cell!, airports[toId].cell!],
        } as Route);
      });
    }

    // Connect manually-set airports from non-qualifying states globally (air routes cross borders).
    const manualAirports = pack.burgs.filter(
      (b: any) => b && b.i && !b.removed && b.airport === 1 && !qualifyingStateIds.has(b.state),
    );
    if (manualAirports.length >= 2) {
      const points = manualAirports.map((b: any) => [b.x, b.y] as Point);
      const edges: [number, number][] =
        manualAirports.length === 2
          ? [[0, 1]]
          : (this.calculateUrquhartEdges(points) as [number, number][]);
      edges.forEach(([fromId, toId]) => {
        airways.push({
          feature: manualAirports[fromId].feature as number,
          cells: [manualAirports[fromId].cell!, manualAirports[toId].cell!],
        } as Route);
      });
    }

    // Cross-border airways: Allied or Friendly qualifying states
    for (let ai = 0; ai < qualifyingStates.length; ai++) {
      const stateA = qualifyingStates[ai];
      if (!airportsByState[stateA.i]) continue;
      for (let bi = ai + 1; bi < qualifyingStates.length; bi++) {
        const stateB = qualifyingStates[bi];
        if (!airportsByState[stateB.i]) continue;
        const rel = (stateA.diplomacy as string[] | undefined)?.[stateB.i] ?? "Neutral";
        if (rel !== "Ally" && rel !== "Friendly") continue;

        const capA = pack.burgs[stateA.capital];
        const capB = pack.burgs[stateB.capital];
        if (!capA || !capB || capA.removed || capB.removed) continue;

        airways.push({
          feature: capA.feature as number,
          cells: [capA.cell!, capB.cell!],
        } as Route);
      }
    }

    TIME && console.timeEnd("generateAirwayRoutes");
    return airways;
  }

  generateAirways() {
    pack.routes = pack.routes.filter((r: Route) => r.group !== "airways" || r.lock);
    const pointsArray = this.preparePointsArray();

    for (const { feature, cells, merged } of this.generateAirwayRoutes()) {
      if (merged) continue;
      const points = this.getPoints("airways", cells!, pointsArray);
      pack.routes.push({ i: pack.routes.length, group: "airways", feature, points } as Route);
    }
    pack.cells.routes = this.buildLinks(pack.routes);
  }

  private preparePointsArray(): Point[] {
    const { cells, burgs } = pack;
    return cells.p.map(([x, y], cellId) => {
      const burgId = cells.burg[cellId];
      if (burgId) return [burgs[burgId].x, burgs[burgId].y];
      return [x, y];
    });
  }

  private getPoints(group: string, cells: number[], points: Point[]) {
    const data = cells.map((cellId) => [...points[cellId], cellId]);

    // resolve sharp angles
    if (group !== "searoutes") {
      for (let i = 1; i < cells.length - 1; i++) {
        const cellId = cells[i];
        if (pack.cells.burg[cellId]) continue;

        const [prevX, prevY] = data[i - 1];
        const [currX, currY] = data[i];
        const [nextX, nextY] = data[i + 1];

        const dAx = prevX - currX;
        const dAy = prevY - currY;
        const dBx = nextX - currX;
        const dBy = nextY - currY;
        const angle = Math.abs(
          (Math.atan2(dAx * dBy - dAy * dBx, dAx * dBx + dAy * dBy) * 180) /
            Math.PI,
        );

        if (angle < ROUTES_SHARP_ANGLE) {
          const middleX = (prevX + nextX) / 2;
          const middleY = (prevY + nextY) / 2;
          let newX: number, newY: number;

          if (angle < ROUTES_VERY_SHARP_ANGLE) {
            newX = rn((currX + middleX * 2) / 3, 2);
            newY = rn((currY + middleY * 2) / 3, 2);
          } else {
            newX = rn((currX + middleX) / 2, 2);
            newY = rn((currY + middleY) / 2, 2);
          }

          if (findClosestCell(newX, newY, undefined, pack) === cellId) {
            data[i] = [newX, newY, cellId];
            points[cellId] = [data[i][0], data[i][1]]; // change cell coordinate for all routes
          }
        }
      }
    }

    return data; // [[x, y, cell], [x, y, cell]];
  }

  // merge routes so that the last cell of one route is the first cell of the next route
  private mergeRoutes(routes: Route[]): Route[] {
    let routesMerged = 0;

    for (let i = 0; i < routes.length; i++) {
      const thisRoute = routes[i];
      if (thisRoute.merged) continue;

      for (let j = i + 1; j < routes.length; j++) {
        const nextRoute = routes[j];
        if (nextRoute.merged) continue;

        if (nextRoute.cells!.at(0) === thisRoute.cells!.at(-1)) {
          routesMerged++;
          thisRoute.cells = thisRoute.cells!.concat(nextRoute.cells!.slice(1));
          nextRoute.merged = true;
        }
      }
    }

    return routesMerged > 1 ? this.mergeRoutes(routes) : routes;
  }
  private createRoutesData(routes: Route[], connections: Map<string, boolean>) {
    const mainRoads = this.generateMainRoads(connections);
    const trails = this.generateTrails(connections);
    const seaRoutes = this.generateSeaRoutes(connections);
    const pointsArray = this.preparePointsArray();

    for (const { feature, cells, merged } of this.mergeRoutes(mainRoads)) {
      if (merged) continue;
      const points = this.getPoints("roads", cells!, pointsArray);
      routes.push({ i: routes.length, group: "roads", feature, points });
    }

    for (const { feature, cells, merged } of this.mergeRoutes(trails)) {
      if (merged) continue;
      const points = this.getPoints("trails", cells!, pointsArray);
      routes.push({ i: routes.length, group: "trails", feature, points });
    }

    for (const { feature, cells, merged } of this.mergeRoutes(seaRoutes)) {
      if (merged) continue;
      const points = this.getPoints("searoutes", cells!, pointsArray);
      routes.push({ i: routes.length, group: "searoutes", feature, points });
    }

    return routes;
  }

  generate(lockedRoutes: Route[] = []) {
    const connections = new Map<string, boolean>();
    lockedRoutes.forEach((route: Route) => {
      this.addConnections(route.points.map((p) => p[2]), connections);
    });

    pack.routes = this.createRoutesData(lockedRoutes, connections);

    // Railways
    const lockedRailways = lockedRoutes.filter((r) => r.group === "railways");
    const railConnections = new Map<string, boolean>();
    lockedRailways.forEach((r) => this.addConnections(r.points.map((p) => p[2]), railConnections));
    const railPointsArray = this.preparePointsArray();
    for (const { feature, cells, merged } of this.mergeRoutes(this.generateRailwayRoutes(railConnections))) {
      if (merged) continue;
      const points = this.getPoints("railways", cells!, railPointsArray);
      pack.routes.push({ i: pack.routes.length, group: "railways", feature, points } as Route);
    }

    // Airways
    const airPointsArray = this.preparePointsArray();
    for (const { feature, cells, merged } of this.generateAirwayRoutes()) {
      if (merged) continue;
      const points = this.getPoints("airways", cells!, airPointsArray);
      pack.routes.push({ i: pack.routes.length, group: "airways", feature, points } as Route);
    }

    pack.cells.routes = this.buildLinks(pack.routes);
  }

  // utility functions
  isConnected(cellId: number): boolean {
    const routes = pack.cells.routes;
    return routes[cellId] && Object.keys(routes[cellId]).length > 0;
  }

  getNextId() {
    return pack.routes.length
      ? Math.max(...pack.routes.map((r) => r.i)) + 1
      : 0;
  }

  // connect cell with routes system by land
  connect(cellId: number): Route | undefined {
    const getCost = this.createCostEvaluator({
      isWater: false,
      connections: new Map(),
    });
    const isExit = (c: number) => isLand(c, pack) && this.isConnected(c);
    const pathCells = findPath(cellId, isExit, getCost, pack);
    if (!pathCells) return;

    const pointsArray = this.preparePointsArray();
    const points = this.getPoints("trails", pathCells, pointsArray);
    const feature = pack.cells.f[cellId];
    const routeId = this.getNextId();
    const newRoute = { i: routeId, group: "trails", feature, points };
    pack.routes.push(newRoute as Route);

    const addConnection = (from: number, to: number, routeId: number) => {
      const routes = pack.cells.routes;

      if (!routes[from]) routes[from] = {};
      routes[from][to] = routeId;

      if (!routes[to]) routes[to] = {};
      routes[to][from] = routeId;
    };

    for (let i = 0; i < pathCells.length; i++) {
      const currentCell = pathCells[i];
      const nextCellId = pathCells[i + 1];
      if (nextCellId) addConnection(currentCell, nextCellId, routeId);
    }

    return newRoute as Route;
  }

  areConnected(from: number, to: number): boolean {
    const routeId = pack.cells.routes[from]?.[to];
    return routeId !== undefined;
  }

  getRoute(from: number, to: number) {
    const routeId = pack.cells.routes[from]?.[to];
    if (routeId === undefined) return null;

    const route = pack.routes.find((route) => route.i === routeId);
    if (!route) return null;

    return route;
  }

  hasRoad(cellId: number): boolean {
    const connections = pack.cells.routes[cellId];
    if (!connections) return false;

    return Object.values(connections).some((routeId) => {
      const route = pack.routes.find((route) => route.i === routeId);
      if (!route) return false;
      return route.group === "roads";
    });
  }

  isCrossroad(cellId: number): boolean {
    const connections = pack.cells.routes[cellId];
    if (!connections) return false;
    if (Object.keys(connections).length > 3) return true;
    const roadConnections = Object.values(connections).filter((routeId) => {
      const route = pack.routes.find((route) => route.i === routeId);
      return route?.group === "roads";
    });
    return roadConnections.length > 2;
  }

  remove(route: Route) {
    const routes = pack.cells.routes;

    for (const point of route.points) {
      const from = point[2];
      if (!routes[from]) continue;

      for (const [to, routeId] of Object.entries(routes[from])) {
        if (routeId === route.i) {
          delete routes[from][parseInt(to, 10)];
          delete routes[parseInt(to, 10)][from];
        }
      }
    }

    pack.routes = pack.routes.filter((r) => r.i !== route.i);
    viewbox.select(`#route${route.i}`).remove();
  }

  getConnectivityRate(cellId: number): number {
    const connections = pack.cells.routes[cellId];
    if (!connections) return 0;

    const connectivityRateMap: Record<string, number> = {
      roads: 0.2,
      trails: 0.1,
      searoutes: 0.2,
      railways: 0.3,
      airways: 0.15,
      default: 0.1,
    };

    const connectivity = Object.values(connections).reduce((acc, routeId) => {
      const route = pack.routes.find((route) => route.i === routeId);
      if (!route) return acc;
      const rate =
        connectivityRateMap[route.group] ?? connectivityRateMap["default"];
      return acc + rate;
    }, 0.8);

    return connectivity;
  }

  generateName({
    group,
    points,
  }: {
    group: string;
    points: number[][];
  }): string {
    if (points.length < 4) return "Unnamed route segment";

    function getBurgName() {
      const priority = [
        points.at(-1),
        points.at(0),
        points.slice(1, -1).reverse(),
      ];
      for (const [_x, _y, cellId] of priority as [number, number, number][]) {
        const burgId = pack.cells.burg[cellId as number];
        if (burgId) return getAdjective(pack.burgs[burgId].name!);
      }
      return null;
    }

    const model = rw(models[group] || models["roads"]);
    const suffix = rw(suffixes[group] || suffixes["roads"]);

    const burgName = getBurgName();
    if (model === "burg_suffix" && burgName) return `${burgName} ${suffix}`;
    if (model === "prefix_suffix") return `${ra(prefixes)} ${suffix}`;
    if (model === "the_descriptor_prefix_suffix")
      return `The ${ra(descriptors)} ${ra(prefixes)} ${suffix}`;
    if (model === "the_descriptor_burg_suffix" && burgName)
      return `The ${ra(descriptors)} ${burgName} ${suffix}`;
    return "Unnamed route";
  }

  getPath({ group, points }: { group: string; points: number[][] }): string {
    const lineGen = line();
    const ROUTE_CURVES: Record<string, any> = {
      roads: curveCatmullRom.alpha(0.1),
      trails: curveCatmullRom.alpha(0.1),
      searoutes: curveCatmullRom.alpha(0.5),
      railways: curveCatmullRom.alpha(0.1),
      airways: curveCatmullRom.alpha(0.5),
      default: curveCatmullRom.alpha(0.1),
    };
    lineGen.curve(ROUTE_CURVES[group] || ROUTE_CURVES.default);
    const path = round(lineGen(points.map((p) => [p[0], p[1]])) as string, 1);
    return path;
  }

  getLength(routeId: number): number {
    const path = routes.select(`#route${routeId}`).node() as SVGPathElement;
    return path.getTotalLength();
  }
}

window.Routes = new RoutesModule();
