import { Task } from '../hooks/useTasks';
import { Corridor, Zone } from '../context/ZonesContext';
import { Station } from '../context/StationContext';
import { Pt, buildCorridorGraph, shortestPath } from './graph';

/**
 * Construction de la mission complète (refonte : trajets réels).
 *
 * Le frontend est la source de vérité : il pré-calcule TOUT le
 * déplacement du robot sur les chemins de liaison — sortie de station,
 * transit vers chaque zone, travail, retour station — via le plus court
 * chemin (Dijkstra) dans le graphe des corridors. Le robot ne fait que
 * suivre des waypoints.
 *
 * Le GRAPHE et la STATION sont joints au message : en cas
 * d'interruption runtime (batterie faible), c'est le nœud ROS qui
 * recalcule lui-même son itinéraire de retour (décision actée : le
 * retour d'urgence est une décision d'exécution, impossible à
 * pré-planifier) puis reprend la mission après recharge.
 */
export interface MissionPayload {
  /** Tâches actives, chacune avec son trajet d'approche (transit) */
  tasks: Array<Task & {
    transit?: [number, number][];
    /** Géométrie de la zone (contour + obstacles), pour l'évacuation
     *  d'urgence côté ROS (graphe de visibilité). */
    geometry?: { boundary: [number, number][]; obstacles: [number, number][][] };
  }>;
  /** Graphe des corridors (pour les retours d'urgence côté ROS) */
  graph: { nodes: Pt[]; edges: Array<[number, number]> };
  /** Position de la station [lat, lng] */
  station: Pt;
  /** Trajet de retour station après la dernière tâche */
  returnRoute: [number, number][];
}

/** Supprime les points quasi confondus (< 1 cm) consécutifs. */
const dedupe = (pts: Pt[]): Pt[] =>
  pts.filter((p, i) =>
    i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-5);

/** Point strictement à l'intérieur d'un polygone [lat, lng] ? */
const pointInPolygon = (p: Pt, poly: Pt[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) &&
        p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

/**
 * Géométrie d'évacuation d'une tâche : la zone de tonte contenant le
 * point donné (contour) et les exclusions qu'elle renferme
 * (obstacles). Jointe à la mission pour que le robot puisse calculer
 * un chemin sûr vers le portail lors d'une coupure batterie.
 */
const zoneGeometryFor = (p: Pt, zones: Zone[]) => {
  const zone = zones.find(
    z => z.type === 'mow' && z.points.length >= 3 && pointInPolygon(p, z.points));
  if (!zone) return undefined;
  const obstacles = zones
    .filter(z => z.type === 'exclusion' && z.points.length >= 3 &&
      pointInPolygon(z.points[0], zone.points))
    .map(z => z.points);
  return { boundary: zone.points, obstacles };
};

/**
 * Assemble la mission complète. Lève une Error (message utilisateur)
 * si une zone n'est pas reliée au réseau depuis le point précédent.
 */
export function buildMissionPayload(
  tasks: Task[],
  corridors: Corridor[],
  station: Station,
  zones: Zone[] = []
): MissionPayload {
  const graph = buildCorridorGraph(corridors, [station.position]);
  if (graph.nodes.length === 0) {
    throw new Error('le réseau de chemins de liaison est vide');
  }

  const out: MissionPayload['tasks'] = [];
  let from: Pt = station.position;

  for (const t of tasks) {
    if (t.waypoints && t.waypoints.length > 0) {
      const to = t.waypoints[0];
      const res = shortestPath(graph, from, to);
      if (!res) {
        throw new Error(
          '« ' + t.name + ' » n’est pas reliée au reste du réseau par les chemins de liaison');
      }
      const geometry = zoneGeometryFor(to, zones);
      out.push({
        ...t,
        transit: dedupe([from, ...res.path, to]),
        ...(geometry ? { geometry } : {}),
      });
      from = t.waypoints[t.waypoints.length - 1];
    } else {
      // Tâche manuelle sans parcours : pas de transit calculé.
      out.push({ ...t });
    }
  }

  const rr = shortestPath(graph, from, station.position);
  if (!rr) {
    throw new Error('la station n’est pas reliée au réseau par les chemins de liaison');
  }
  const returnRoute = dedupe([from, ...rr.path, station.position]);

  return {
    tasks: out,
    graph: {
      nodes: graph.nodes,
      edges: graph.edges.map(e => [e.a, e.b] as [number, number]),
    },
    station: station.position,
    returnRoute,
  };
}
