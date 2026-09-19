import { Task } from '../hooks/useTasks';
import { Corridor } from '../context/ZonesContext';
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
  tasks: Array<Task & { transit?: [number, number][] }>;
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

/**
 * Assemble la mission complète. Lève une Error (message utilisateur)
 * si une zone n'est pas reliée au réseau depuis le point précédent.
 */
export function buildMissionPayload(
  tasks: Task[],
  corridors: Corridor[],
  station: Station
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
      out.push({ ...t, transit: dedupe([from, ...res.path, to]) });
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
