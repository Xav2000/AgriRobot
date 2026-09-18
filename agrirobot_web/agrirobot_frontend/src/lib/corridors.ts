/**
 * Validation des corridors de circulation (etape 6.6).
 *
 * Un corridor est une polyline ouverte dessinee par l'operateur :
 * c'est le SEUL chemin autorise pour sortir d'un polygone. Regles :
 * - il doit ENTRER dans le polygone d'au moins une zone de tonte
 *   (au moins un de ses points a l'interieur) ;
 * - il ne doit JAMAIS traverser une zone d'exclusion (S0).
 * Les problemes sont des AVERTISSEMENTS : le corridor reste dessine et
 * corrigeable, mais sera signale comme invalide.
 */
import type { Corridor, Zone } from '../context/ZonesContext';

type Pt = [number, number];

const pointInPolygon = (p: Pt, poly: Pt[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > p[1]) !== (yj > p[1]) &&
        p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

const segmentsIntersect = (
  a: Pt, b: Pt, c: Pt, d: Pt
): boolean => {
  const o = (p: Pt, q: Pt, r: Pt): number =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
};

const pointInRingStrict = (p: Pt, ring: Pt[]): boolean =>
  ring.some(q => q[0] === p[0] && q[1] === p[1]);

/**
 * Verifie un corridor : retourne la liste des problemes (vide = valide).
 * - moins de 2 points : incomplete ;
 * - aucun point dans une zone de tonte : ne dessert aucune zone ;
 * - traverse (ou passe dans) une exclusion : interdit.
 */
export const corridorWarnings = (
  corridor: Corridor,
  zones: Zone[]
): string[] => {
  const warnings: string[] = [];
  const pts = corridor.points;
  if (pts.length < 2) {
    warnings.push('incomplet (moins de 2 points)');
    return warnings;
  }
  const mowZones = zones.filter(z => z.type === 'mow' && z.points.length >= 3);
  const exclusions = zones.filter(z => z.type === 'exclusion' && z.points.length >= 3);
  const entersMow = mowZones.some(z => pts.some(p => pointInPolygon(p, z.points)));
  if (!entersMow) {
    warnings.push('ne rentre dans aucune zone de tonte');
  }
  for (const x of exclusions) {
    let crosses = pts.some(p => pointInPolygon(p, x.points) || pointInRingStrict(p, x.points));
    outer: for (let i = 0; i < pts.length - 1; i++) {
      for (let j = 0; j < x.points.length; j++) {
        if (segmentsIntersect(pts[i], pts[i + 1], x.points[j], x.points[(j + 1) % x.points.length])) {
          crosses = true;
          break outer;
        }
      }
    }
    if (crosses) {
      warnings.push('traverse l\u2019exclusion \u00ab ' + x.name + ' \u00bb');
      break;
    }
  }
  return warnings;
};
