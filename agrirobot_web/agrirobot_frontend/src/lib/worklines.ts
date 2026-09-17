/**
 * Algorithme de génération des lignes de guidage (étape 6.3).
 *
 * Fonction PURE : aucun React, aucun Leaflet — consomme les paramètres du
 * WorklinesContext et les zones du ZonesContext, retourne des tracés
 * ordonnés en [lat, lng]. Testable isolément.
 *
 * Étape 6.3a :
 * 1. contours intérieurs (headlands) — boucles fermées, de l'extérieur
 *    vers l'intérieur ;
 * 2. allers-retours parallèles à la bordure de référence, espacés d'une
 *    largeur, découpés par les zones d'exclusion (marge d'une demi-largeur) ;
 * 3. transitions droites entre tracés consécutifs (orange pointillé).
 *
 * RÈGLES FIXÉES (retours de test) :
 * - R1 — la tondeuse ne sort JAMAIS du polygone : les extrémités des
 *   passes (demi-tours) sont toujours en retrait d'au moins une
 *   demi-largeur du bord. Règle de sécurité : servira plus tard à
 *   désactiver la lame / arrêter le robot en cas de sortie.
 * - R2 — la lame couvre w : premier contour à w/2 du bord (bande [0, w]
 *   couverte par lui seul), suivants espacés d'une largeur (w/2, 1,5w…).
 * - R3 — les allers-retours s'arrêtent SUR la première ligne de contour
 *   rencontrée (la plus intérieure, à (N-0,5)·w du bord), sans la
 *   dépasser. Sans contour : coupe à w/2 du bord (R1).
 * - La grille des passes démarre pile sur la limite de coupe : première
 *   ligne à w/2 du bord sans contour (couvre [0, w]), à N·w avec
 *   contours (une demi-largeur à l'intérieur du contour intérieur).
 * - passes prolongées dans les pointes le long de leur axe (couverture
 *   totale, chevauchement accepté) ;
 * - bordure de référence lue dans le polygone original ; grille ancrée
 *   sur le côté de départ (espacement régulier) ; démarrage du côté le
 *   plus proche de la position courante.
 *
 * À venir (6.3b) : contour des obstacles et réordonnancement
 * côté A / côté B autour de chaque obstacle.
 *
 * Repère : conversion locale en mètres avec DEG_PER_METER = 1e-5,
 * identique à MapView et au nœud ROS (agrirobot_node.py).
 */
import ClipperLib from 'clipper-lib';
import type { WorklinesParams } from '../context/WorklinesContext';
import type { Zone } from '../context/ZonesContext';

export type WorklineKind = 'headland' | 'sweep' | 'transition' | 'obstacle';

export interface Workline {
  kind: WorklineKind;
  /** Points [lat, lng] ; boucles fermées : premier point répété en fin */
  points: [number, number][];
  closed: boolean;
}

export interface WorklinesResult {
  /** Tracés dans l'ordre de parcours du robot */
  lines: Workline[];
  stats: {
    totalLengthM: number;
    headlandLoops: number;
    sweepPasses: number;
    transitions: number;
  };
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Repère métrique local                                               */
/* ------------------------------------------------------------------ */

const DEG_PER_METER = 1e-5; // synchronisé avec MapView et le backend ROS
const SCALE = 1000;         // Clipper travaille en entiers : précision mm

interface Pt { x: number; y: number; }

const toLocal = (p: [number, number], origin: [number, number]): Pt => ({
  x: (p[1] - origin[1]) / DEG_PER_METER,
  y: (p[0] - origin[0]) / DEG_PER_METER,
});

const toLatLng = (p: Pt, origin: [number, number]): [number, number] => [
  origin[0] + p.y * DEG_PER_METER,
  origin[1] + p.x * DEG_PER_METER,
];

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Aire signée (positive = sens trigonométrique, y vers le haut). */
const signedArea = (ring: Pt[]): number => {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
};

/** Oriente l'anneau dans le sens trigonométrique (convention ClipperOffset). */
const ccw = (ring: Pt[]): Pt[] => (signedArea(ring) < 0 ? [...ring].reverse() : ring);

/** Test point dans polygone (règle de parité). */
const pointInRing = (p: Pt, ring: Pt[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
};

/* ------------------------------------------------------------------ */
/* Primitives Clipper                                                  */
/* ------------------------------------------------------------------ */

const toClipper = (rings: Pt[][]): any =>
  rings.map(r => r.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })));

const fromClipper = (paths: any): Pt[][] =>
  paths.map((path: any) => path.map((p: any) => ({ x: p.X / SCALE, y: p.Y / SCALE })));

/**
 * Offset d'anneaux fermés. Convention : anneaux orientés dans le sens
 * trigonométrique → delta négatif rétrécit, delta positif dilate.
 * Renvoie zéro ou plusieurs anneaux (la zone peut se scinder).
 */
const offsetRings = (rings: Pt[][], deltaM: number): Pt[][] => {
  const co = new ClipperLib.ClipperOffset(2, 0.25 * SCALE);
  co.AddPaths(toClipper(rings), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const solution = new ClipperLib.Paths();
  co.Execute(solution, deltaM * SCALE);
  return fromClipper(solution);
};

/** subject - clip. Remplissage pair-impair : insensible aux orientations. */
const difference = (subject: Pt[][], clip: Pt[][]): Pt[][] => {
  if (clip.length === 0) return subject;
  const cpr = new ClipperLib.Clipper();
  cpr.AddPaths(toClipper(subject), ClipperLib.PolyType.ptSubject, true);
  cpr.AddPaths(toClipper(clip), ClipperLib.PolyType.ptClip, true);
  const solution = new ClipperLib.Paths();
  cpr.Execute(
    ClipperLib.ClipType.ctDifference, solution,
    ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd
  );
  return fromClipper(solution);
};

/* ------------------------------------------------------------------ */
/* Algorithme principal                                                */
/* ------------------------------------------------------------------ */

interface Elem { kind: WorklineKind; pts: Pt[]; closed: boolean; }

export function generateWorklines(
  params: WorklinesParams,
  zones: Zone[]
): WorklinesResult {
  const warnings: string[] = [];
  const empty: WorklinesResult = {
    lines: [],
    stats: { totalLengthM: 0, headlandLoops: 0, sweepPasses: 0, transitions: 0 },
    warnings,
  };

  const target = zones.find(z => z.id === params.targetZoneId);
  if (!target || target.points.length < 3) {
    warnings.push('Zone cible introuvable ou incomplète (moins de 3 sommets).');
    return empty;
  }

  const w = Math.max(0.05, params.workingWidthM);
  const N = params.headlands;
  const origin: [number, number] = params.entryPoint ?? target.points[0];
  // Polygone ORIGINAL : la bordure de référence est indexée dedans,
  // exactement comme lors de la sélection sur la carte.
  const raw = target.points.map(p => toLocal(p, origin));
  const outer = ccw(raw);

  if (!params.entryPoint) {
    warnings.push("Point d'entrée non défini : le parcours démarre au premier sommet de la zone.");
  } else if (!pointInRing(toLocal(params.entryPoint, origin), raw)) {
    warnings.push("Le point d'entrée est en dehors de la zone cible.");
  }

  /* --- Direction des passes : parallèle à la bordure de référence --- */
  let refIndex = params.referenceBorderIndex;
  if (refIndex == null || refIndex < 0 || refIndex >= raw.length) {
    warnings.push('Bordure de référence non valide : arête n°1 utilisée par défaut.');
    refIndex = 0;
  }
  const a1 = raw[refIndex];
  const a2 = raw[(refIndex + 1) % raw.length];
  const edgeLen = Math.max(1e-6, dist(a1, a2));
  const d: Pt = { x: (a2.x - a1.x) / edgeLen, y: (a2.y - a1.y) / edgeLen }; // direction des passes
  const nv: Pt = { x: -d.y, y: d.x };                                      // progression

  /* --- 1. Contours intérieurs (headlands) ------------------------------
   * R2 : la lame couvre w → premier contour à w/2 du bord (bande [0, w]
   * couverte par lui seul), suivants espacés d'une largeur.
   */
  const headlandLoops: Pt[][] = [];
  let ringSet: Pt[][] = [outer];
  if (N > 0) {
    ringSet = offsetRings(ringSet, -w / 2);
    if (ringSet.length === 0) {
      warnings.push('Zone trop petite pour un contour intérieur.');
    } else {
      ringSet.forEach(r => headlandLoops.push(r));
      for (let k = 2; k <= N; k++) {
        ringSet = offsetRings(ringSet, -w);
        if (ringSet.length === 0) {
          warnings.push('Zone épuisée avant le contour n°' + k + ' (trop petite pour ' + N + ' contours).');
          break;
        }
        ringSet.forEach(r => headlandLoops.push(r));
      }
    }
  }

  /* --- 2. Zone de coupe des passes --------------------------------------
   * R1 : la tondeuse ne sort jamais du polygone → coupe TOUJOURS en
   * retrait : w/2 du bord sans contour (demi-tour intérieur), sur le
   * contour intérieur ((N-0,5)·w) avec contours (R3 : les zigzags
   * s'arrêtent SUR la première ligne de contour rencontrée).
   * La grille démarre pile sur cette limite (première ligne dessus).
   * Les exclusions restent TOUJOURS soustraites (marge d'une demi-largeur).
   */
  const shrink = N === 0 ? w / 2 : (N - 0.5) * w;
  let sweepRings = offsetRings([outer], -shrink);
  const exclusions = zones
    .filter(z => z.type === 'exclusion' && z.points.length >= 3)
    .map(z => ccw(z.points.map(p => toLocal(p, origin))));
  if (exclusions.length > 0 && sweepRings.length > 0) {
    // Marge d'une demi-largeur : le robot ne colle jamais à un obstacle
    const buffered: Pt[][] = [];
    exclusions.forEach(r => offsetRings([r], w / 2).forEach(b => buffered.push(b)));
    sweepRings = difference(sweepRings, buffered);
  }

  /* --- 3. Assemblage ordonné du parcours --- */
  const elems: Elem[] = [];
  let lastEnd: Pt | null = params.entryPoint ? toLocal(params.entryPoint, origin) : null;

  const addElem = (kind: WorklineKind, pts: Pt[], closed: boolean) => {
    if (pts.length < 2) return;
    const full = closed ? [...pts, pts[0]] : pts;
    if (lastEnd && dist(lastEnd, full[0]) > 1e-6) {
      elems.push({ kind: 'transition', pts: [lastEnd, full[0]], closed: false });
    }
    elems.push({ kind, pts: full, closed });
    lastEnd = full[full.length - 1];
  };

  // Headlands : chaque boucle démarre au sommet le plus proche de la position courante
  for (const loop of headlandLoops) {
    let best = 0;
    if (lastEnd) {
      let bestD = Infinity;
      loop.forEach((p, i) => {
        const dd = dist(lastEnd as Pt, p);
        if (dd < bestD) { bestD = dd; best = i; }
      });
    }
    addElem('headland', loop.slice(best).concat(loop.slice(0, best)), true);
  }

  // Allers-retours
  const tOf = (p: Pt): number => p.x * nv.x + p.y * nv.y;
  const sOf = (p: Pt): number => p.x * d.x + p.y * d.y;
  const at = (t: number, s: number): Pt => ({ x: nv.x * t + d.x * s, y: nv.y * t + d.y * s });

  let tMin = Infinity;
  let tMax = -Infinity;
  sweepRings.forEach(r => r.forEach(p => {
    const t = tOf(p);
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }));

  if (sweepRings.length === 0 || !isFinite(tMin)) {
    warnings.push('Zone de balayage vide : zone trop petite pour la largeur de travail (contours seuls).');
  } else {
    // Grille démarrant pile sur la limite de coupe (première ligne dessus),
    // ancrée sur le côté de départ (espacement strictement régulier).
    let startFromMax = false;
    if (lastEnd) {
      startFromMax = tOf(lastEnd) > (tMin + tMax) / 2;
    }
    const tValues: number[] = [];
    if (startFromMax) {
      for (let t = tMax; t >= tMin; t -= w) tValues.push(t);
    } else {
      for (let t = tMin; t <= tMax; t += w) tValues.push(t);
    }

    // Sens de parcours de la première ligne : depuis l'extrémité la plus
    // proche de la position courante, puis alternance (zigzag).
    let forward = true;
    if (lastEnd && tValues.length > 0) {
      let sMin = Infinity;
      let sMax = -Infinity;
      sweepRings.forEach(r => r.forEach(p => {
        const s = sOf(p);
        if (s < sMin) sMin = s;
        if (s > sMax) sMax = s;
      }));
      forward = sOf(lastEnd) <= (sMin + sMax) / 2;
    }

    for (const t of tValues) {
      // Croisements de la ligne t avec tous les anneaux (zone + trous)
      const crossings: number[] = [];
      for (const r of sweepRings) {
        for (let i = 0; i < r.length; i++) {
          const pa = r[i];
          const pb = r[(i + 1) % r.length];
          const ta = tOf(pa);
          const tb = tOf(pb);
          if (ta === tb) continue;
          if ((ta < t && tb > t) || (ta > t && tb < t)) {
            const u = (t - ta) / (tb - ta);
            crossings.push(sOf(pa) + u * (sOf(pb) - sOf(pa)));
          }
        }
      }
      crossings.sort((x, y) => x - y);
      if (crossings.length % 2 !== 0) crossings.pop(); // tangence : on ignore
      if (crossings.length < 2) continue;

      // Segments de la ligne, appariés par parité
      const segs: Array<[number, number]> = [];
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        segs.push([crossings[i], crossings[i + 1]]);
      }
      // Zigzag : on parcourt la ligne dans un sens, la suivante dans l'autre
      if (!forward) segs.reverse();
      for (const seg of segs) {
        const s0 = forward ? seg[0] : seg[1];
        const s1 = forward ? seg[1] : seg[0];
        addElem('sweep', [at(t, s0), at(t, s1)], false);
      }
      forward = !forward;
    }
  }

  /* --- 4. Sortie : conversion lat/lng + statistiques --- */
  const lines: Workline[] = elems.map(el => ({
    kind: el.kind,
    points: el.pts.map(p => toLatLng(p, origin)),
    closed: el.closed,
  }));

  let total = 0;
  let loops = 0;
  let sweeps = 0;
  let trans = 0;
  elems.forEach(el => {
    if (el.kind === 'transition') trans++;
    else if (el.kind === 'sweep') sweeps++;
    else if (el.kind === 'headland') loops++;
    for (let i = 1; i < el.pts.length; i++) total += dist(el.pts[i - 1], el.pts[i]);
  });

  return {
    lines,
    stats: {
      totalLengthM: Math.round(total),
      headlandLoops: loops,
      sweepPasses: sweeps,
      transitions: trans,
    },
    warnings,
  };
}
