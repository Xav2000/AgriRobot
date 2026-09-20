import { WorklinesResult } from './worklines';

/**
 * Aplatit le résultat des lignes de guidage en waypoints [lat, lng]
 * dans l'ordre exact du parcours du robot (étape 6.4), AVEC le type de
 * segment de chaque waypoint (étape outils) :
 * headland / sweep / transition / obstacle.
 *
 * Les points de jonction consécutifs sont dédoublonnés ; un point de
 * jonction partagé par deux segments porte le type du PREMIER segment
 * (celui qui s'y termine). Le tableau `kinds` est parallèle à
 * `waypoints` : kinds[i] = type du segment contenant waypoints[i].
 *
 * Le node indexe ces types par waypoint pour savoir quand l'outil
 * travaille (headland/sweep/obstacle) ou est en transit (transition).
 */
export const flattenWorklines = (
  result: WorklinesResult,
): { waypoints: [number, number][]; kinds: string[] } => {
  const waypoints: [number, number][] = [];
  const kinds: string[] = [];
  for (const line of result.lines) {
    for (const p of line.points) {
      const last = waypoints[waypoints.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) {
        waypoints.push([p[0], p[1]]);
        kinds.push(line.kind);
      }
    }
  }
  return { waypoints, kinds };
};
