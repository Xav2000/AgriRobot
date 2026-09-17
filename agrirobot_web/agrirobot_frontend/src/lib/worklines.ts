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
 * - S0 — une zone d'exclusion est un DANGER ABSOLU (mare, trou) : aucune
 *   ligne ne la franchit jamais, même d'un millimètre ; les transitions
 *   la contournent par son bord gonflé de la marge.
 * - S1 — marge de sécurité autour des exclusions (paramétrable, défaut
 *   w/2) : distance minimale entre le robot et la zone interdite.
 * - La grille des passes est ancrée sur la bordure de référence :
 *   première ligne à w/2 du bord sans contour (couvre [0, w]), à N·w
 *   avec contours (une demi-largeur à l'intérieur du contour
 *   intérieur) ; passe de rattrapage si une bande reste découverte.
 * - passes prolongées dans les pointes le long de leur axe (couverture
 *   totale, chevauchement accepté) ;
 * - bordure de référence lue dans le polygone original ; grille ancrée
 *   sur le côté de départ (espacement régulier) ; démarrage du côté le
 *   plus proche de la position courante.
 *
 * 6.3b : contour des obstacles (boucle à la marge de sécurité au premier
 * franchissement), parcours par côtés (le côté atteignable est terminé
 * avant de changer), transitions contournantes. Avec contours d'obstacle
 * activés, les allers-retours s'arrêtent sur le contour d'obstacle le
 * plus EXTÉRIEUR (miroir de R3) — jamais entre deux contours rouges.
 * Chaque ligne porte une PHASE : 0 = flux normal, incrémentée à chaque
 * changement de côté (transition franchissant un obstacle) — le rendu
 * colore les passes selon cette phase (contrôle visuel opérateur).
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
  /**
   * Phase de la passe : 0 = couleur de base (passes entières) ; 1 = 1er
   * côté d'un obstacle (bleu), 2 = 2e côté (violet). Seules les passes
   * RACCOURCIES par un obstacle portent une couleur.
   * Utilisée par le rendu pour colorer les passes (contrôle visuel).
   */
  phase: number;
}

export interface WorklinesResult {
  /** Tracés dans l'ordre de parcours du robot */
  lines: Workline[];
  stats: {
    totalLengthM: number;
    headlandLoops: number;
    sweepPasses: number;
    transitions: number;
    obstacleContours: number;
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
  // ArcTolerance 2 mm : approximation fine des arrondis (jtRound). Une
  // tolérance grossière (25 cm auparavant) déformait les contours gonflés —
  // cordes larges coupant les coins, distance à l'obstacle variable selon
  // la direction autour des exclusions.
  const co = new ClipperLib.ClipperOffset(2, 0.002 * SCALE);
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

interface Elem { kind: WorklineKind; pts: Pt[]; closed: boolean; phase: number; }

/* ------------------------------------------------------------------ */
/* Géométrie des obstacles (règle S0 : jamais traverser)               */
/* ------------------------------------------------------------------ */

const segSegIntersect = (p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean => {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
};

/** Le segment [a,b] touche-t-il l'anneau (franchit son bord ou sa zone) ? */
const segHitsRing = (a: Pt, b: Pt, ring: Pt[]): boolean => {
  for (let i = 0; i < ring.length; i++) {
    if (segSegIntersect(a, b, ring[i], ring[(i + 1) % ring.length])) return true;
  }
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return pointInRing(mid, ring);
};

/** Le segment [a,b] est-il libre de tout obstacle ? */
const segClearOf = (a: Pt, b: Pt, rings: Pt[][]): boolean =>
  rings.every(r => !segHitsRing(a, b, r));

/** Point de l'anneau le plus proche de p (et index de l'arête porteuse). */
const nearestOnRing = (p: Pt, ring: Pt[]): { pt: Pt; idx: number } => {
  let best = { pt: ring[0], idx: 0 };
  let bestD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const abx = b.x - a.x, aby = b.y - a.y;
    const len2 = abx * abx + aby * aby || 1e-12;
    let u = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
    u = Math.max(0, Math.min(1, u));
    const q = { x: a.x + u * abx, y: a.y + u * aby };
    const d = dist(p, q);
    if (d < bestD) { bestD = d; best = { pt: q, idx: i }; }
  }
  return best;
};

/** Arc de l'anneau entre fromPt (arête fromIdx) et toPt, par le plus court. */
const ringArc = (ring: Pt[], fromIdx: number, fromPt: Pt, toPt: Pt): Pt[] => {
  const n = ring.length;
  const to = nearestOnRing(toPt, ring);
  const build = (step: number): Pt[] => {
    const pts: Pt[] = [fromPt];
    for (let k = 1; k <= n; k++) {
      const idx = ((fromIdx + step * k) % n + n) % n;
      pts.push(ring[idx]);
      if (idx === to.idx) { pts.push(to.pt); return pts; }
    }
    pts.push(to.pt);
    return pts;
  };
  const plen = (pts: Pt[]) => pts.reduce((s, q, i) => (i ? s + dist(pts[i - 1], q) : 0), 0);
  const f = build(1);
  const b = build(-1);
  return plen(f) <= plen(b) ? f : b;
};

export function generateWorklines(
  params: WorklinesParams,
  zones: Zone[]
): WorklinesResult {
  const warnings: string[] = [];
  const empty: WorklinesResult = {
    lines: [],
    stats: { totalLengthM: 0, headlandLoops: 0, sweepPasses: 0, transitions: 0, obstacleContours: 0 },
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
  /* --- Exclusions : zones STRICTEMENT interdites (règles S0 / S1) ---
   * Une exclusion est un danger absolu (mare, trou d'eau) : le robot ne
   * la traverse ni ne s'en approche plus près que la marge de sécurité.
   */
  const margin = Math.max(0.05, params.obstacleMarginM ?? w / 2);
  const exclusions = zones
    .filter(z => z.type === 'exclusion' && z.points.length >= 3)
    .map(z => ccw(z.points.map(p => toLocal(p, origin))));
  // Obstacles gonflés de la marge : AUCUNE ligne ne doit les franchir.
  const obstacles: Pt[][] = [];
  exclusions.forEach(r =>
    offsetRings([r], margin).forEach(b => { if (b.length >= 3) obstacles.push(b); })
  );

  const headlandLoops: Pt[][] = [];
  const obstacleLoops: Pt[][] = [];
  let ringSet: Pt[][] = [outer];
  /** Oriente les anneaux pour l'offset : extérieurs en sens trigo, trous
   * (contours d'obstacle) en sens horaire — l'offset -w rétrécit ainsi
   * les uns et dilate les autres quand la zone de tonte se réduit. */
  const orientRings = (rings: Pt[][]): Pt[][] =>
    rings.map(r => {
      const isHole = rings.some(o => o !== r && pointInRing(r[0], o));
      const a = signedArea(r);
      return isHole !== (a < 0) ? r : [...r].reverse();
    });
  if (N > 0) {
    // Soustraction des obstacles : la boucle de contour résultante longe
    // naturellement chaque obstacle à la marge de sécurité (le bord du
    // trou fait partie du trajet de contour).
    ringSet = orientRings(difference(offsetRings(ringSet, -w / 2), obstacles));
    if (ringSet.length === 0) {
      warnings.push('Zone trop petite pour un contour intérieur.');
    } else {
      const emit = (rings: Pt[][]): void => {
        rings.forEach(r => {
          const isHole = rings.some(o => o !== r && pointInRing(r[0], o));
          (isHole ? obstacleLoops : headlandLoops).push(r);
        });
      };
      emit(ringSet);
      for (let k = 2; k <= N; k++) {
        ringSet = orientRings(difference(offsetRings(ringSet, -w), obstacles));
        if (ringSet.length === 0) {
          warnings.push('Zone épuisée avant le contour n°' + k + ' (trop petite pour ' + N + ' contours).');
          break;
        }
        emit(ringSet);
      }
    }
  }

  /* --- 2. Zone de coupe des passes --------------------------------------
   * R1 : la tondeuse ne sort jamais du polygone → coupe TOUJOURS en
   * retrait : w/2 du bord sans contour (demi-tour intérieur), sur le
   * contour intérieur ((N-0,5)·w) avec contours (R3).
   * La grille démarre sur la première ligne COUVRANTE depuis cette limite.
   * Les exclusions restent TOUJOURS soustraites (marge d'une demi-largeur).
   */
  const shrink = N === 0 ? w / 2 : (N - 0.5) * w;
  let sweepRings = offsetRings([outer], -shrink);
  if (obstacles.length > 0 && sweepRings.length > 0) {
    // Coupe des passes autour des obstacles — miroir de R3 : quand les
    // contours d'obstacle sont activés, les allers-retours s'arrêtent SUR
    // le PREMIER contour rencontré (le plus EXTÉRIEUR, à marge+(N-1)·w),
    // sans passer entre les contours rouges. Sinon : coupe à la marge
    // (le robot reste lui-même à la distance de sécurité S1).
    let sweepObstacles = obstacles;
    if (params.outlineObstacles && N > 0) {
      const cut = margin + (N - 1) * w;
      sweepObstacles = [];
      exclusions.forEach(r =>
        offsetRings([r], cut).forEach(b => { if (b.length >= 3) sweepObstacles.push(b); })
      );
      if (sweepObstacles.length === 0) sweepObstacles = obstacles;
    }
    sweepRings = difference(sweepRings, sweepObstacles);
  }

  /* --- 3. Assemblage ordonné du parcours --- */
  const elems: Elem[] = [];
  let lastEnd: Pt | null = params.entryPoint ? toLocal(params.entryPoint, origin) : null;

  /** Transition évitant les obstacles (S0) : ligne droite si elle n'en
   * touche aucun, sinon contournement par l'arc du bord gonflé de
   * l'obstacle le plus proche — jamais de traversée. */
  const routeTransition = (from: Pt, to: Pt): Pt[] => {
    if (obstacles.length === 0 || segClearOf(from, to, obstacles)) return [from, to];
    let best: Pt[] | null = null;
    let bestLen = Infinity;
    for (const o of obstacles) {
      if (!segHitsRing(from, to, o)) continue;
      const a = nearestOnRing(from, o);
      const b = nearestOnRing(to, o);
      const arc = ringArc(o, a.idx, a.pt, b.pt);
      const path = [from, a.pt, ...arc, b.pt, to];
      const len = path.reduce((s, q, i) => (i ? s + dist(path[i - 1], q) : 0), 0);
      if (len < bestLen) { bestLen = len; best = path; }
    }
    if (!best) {
      warnings.push("Transition sans contournement trouvé : trajet à contrôler (obstacle imbriqué).");
      return [from, to];
    }
    return best;
  };

  // Phase d'un élément : 0 par défaut (transitions, contours, headlands) ;
  // les passes de balayage raccourcies par un obstacle portent leur CÔTÉ
  // (1er côté = bleu, 2e côté = violet).
  const addElem = (kind: WorklineKind, pts: Pt[], closed: boolean, phase = 0) => {
    if (pts.length < 2) return;
    const full = closed ? [...pts, pts[0]] : pts;
    if (lastEnd && dist(lastEnd, full[0]) > 1e-6) {
      elems.push({ kind: 'transition', pts: routeTransition(lastEnd, full[0]), closed: false, phase });
    }
    elems.push({ kind, pts: full, closed, phase });
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

  // (Les contours d'obstacles ne sont plus émis ici en bloc : ils le sont
  // au moment où le parcours bascule d'un côté à l'autre d'un obstacle —
  // voir la boucle des allers-retours ci-dessous. Miroir des headlands :
  // anneau le plus extérieur d'abord.)

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
    // Croisements d'une ligne t avec tous les anneaux (zone + trous).
    // Cas particulier : arête PARALLÈLE confondue avec la ligne — ses deux
    // extrémités comptent comme croisements.
    const crossingsAt = (t: number): number[] => {
      const crossings: number[] = [];
      for (const r of sweepRings) {
        for (let i = 0; i < r.length; i++) {
          const pa = r[i];
          const pb = r[(i + 1) % r.length];
          const ta = tOf(pa);
          const tb = tOf(pb);
          if (ta === tb) {

            if (ta === t) crossings.push(sOf(pa), sOf(pb));
            continue;
          }
          if ((ta < t && tb > t) || (ta > t && tb < t)) {
            const u = (t - ta) / (tb - ta);
            crossings.push(sOf(pa) + u * (sOf(pb) - sOf(pa)));
          }
        }
      }
      crossings.sort((x, y) => x - y);
      // Dédoublonnage : extrémités partagées entre arêtes adjacentes
      return crossings.filter((s, i) => i === 0 || Math.abs(s - crossings[i - 1]) > 1e-6);
    };

    /** La ligne t porte-t-elle un vrai segment exploitable ? */
    const hasSegment = (t: number): boolean => {
      const cs = crossingsAt(t);
      if (cs.length % 2 !== 0) cs.pop();
      for (let i = 0; i + 1 < cs.length; i += 2) {
        if (cs[i + 1] - cs[i] >= w / 8) return true;
      }
      return false;
    };

    // Première ligne COUVRANTE : depuis la limite de coupe, on avance par
    // petits pas (w/10, au plus une demi-largeur) jusqu'à trouver une ligne
    // avec un vrai segment — la limite exacte est souvent tangente (un seul
    // sommet touché) et serait sinon ignorée, laissant la première ligne
    // réelle à une pleine largeur du bord (manque en bord de parcelle).
    const firstCoveringFrom = (tEdge: number, dir: 1 | -1): number => {
      for (let k = 0; k <= 10; k++) {
        const t = tEdge + (dir * k * w) / 20;
        if (hasSegment(t)) return t;
      }
      return tEdge + dir * (w / 2);
    };

    // Grille ancrée sur la BORDURE DE RÉFÉRENCE (règle R2) : la bordure
    // est parallèle aux passes, tous ses points partagent la même
    // coordonnée tRef. Première ligne à w/2 de la bordure sans contour
    // (bande [0, w] couverte par elle seule), à N·w avec contours (une
    // demi-largeur à l'intérieur du contour le plus proche). Espacement
    // ensuite strictement régulier ; le reliquat éventuel se retrouve
    // sur le côté opposé, JAMAIS en bord de bordure de référence.
    const tRef = tOf({ x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 });
    let cx = 0, cy = 0;
    raw.forEach(p => { cx += p.x; cy += p.y; });
    const tCentroid = tOf({ x: cx / raw.length, y: cy / raw.length });
    const sigma: 1 | -1 = tCentroid >= tRef ? 1 : -1; // sens bordure → intérieur
    const tFirst = tRef + sigma * (N === 0 ? w / 2 : N * w);
    const gridValues: number[] = [];
    for (let t = tFirst; sigma > 0 ? t <= tMax + 1e-9 : t >= tMin - 1e-9; t += sigma * w) {
      gridValues.push(t);
    }

    // Passes de rattrapage : si une bande de plus d'une demi-largeur
    // reste découverte d'un côté (forme non convexe, parcelle plus large
    // que la grille), on ancre une ligne supplémentaire depuis la limite
    // de coupe de ce côté — mieux vaut un léger croisement qu'un manque.
    const nearLimit = sigma > 0 ? tMin : tMax;
    if (gridValues.length === 0 || Math.abs(tFirst - nearLimit) > w / 2 + 1e-9) {
      const extra = firstCoveringFrom(nearLimit, sigma);
      if (gridValues.length === 0 || Math.abs(extra - gridValues[0]) > 1e-6) {
        gridValues.unshift(extra);
      }
    }
    const farLimit = sigma > 0 ? tMax : tMin;
    const lastGrid = gridValues.length > 0 ? gridValues[gridValues.length - 1] : null;
    if (lastGrid !== null && Math.abs(farLimit - lastGrid) > w / 2 + 1e-9) {
      gridValues.push(firstCoveringFrom(farLimit, sigma > 0 ? -1 : 1));
    }

    // Ordre de parcours : depuis le côté le plus proche de la position
    // courante (la grille, elle, reste ancrée côté bordure de référence).
    let startFromMax = false;
    if (lastEnd) {
      startFromMax = tOf(lastEnd) > (tMin + tMax) / 2;
    }
    // gridValues est construite DEPUIS la bordure de référence : son sens
    // dépend du côté de la bordure (croissante si bordure côté tMin,
    // décroissante si côté tMax). On ne l'inverse que si l'extrémité où
    // elle commence n'est PAS le côté de départ voulu — sinon le parcours
    // démarrait à l'opposé du point d'entrée (bordure du côté tMax).
    const gridStartsAtMax = gridValues[gridValues.length - 1] < gridValues[0];
    const tValues: number[] = (startFromMax !== gridStartsAtMax) ? [...gridValues].reverse() : gridValues;

    // Tous les segments de passe (les obstacles découpent les lignes en
    // morceaux de côté), puis parcours par CÔTÉS (règle utilisateur) :
    // on avance de segment en segment tant que la transition directe ne
    // franchit aucun obstacle — le côté où l'on se trouve est donc
    // terminé jusqu'au bout avant de changer. Au premier franchissement
    // d'un obstacle : boucle de contour complète (à la marge), puis
    // transition contournante vers le segment suivant.
    interface Seg { t: number; a: number; b: number; done: boolean; }
    const allSegs: Seg[] = [];
    for (const t of tValues) {
      const uniq = crossingsAt(t);
      if (uniq.length % 2 !== 0) uniq.pop(); // tangence : on ignore
      for (let i = 0; i + 1 < uniq.length; i += 2) {
        allSegs.push({ t, a: uniq[i], b: uniq[i + 1], done: false });
      }
    }

    const contoured = new Set<Pt[]>();
    // Côté d'une passe par rapport à chaque obstacle, le long du sens de
    // la passe (coordonnée s) : 0 = avant l'obstacle, 1 = après, null =
    // non séparé (la passe passe par une extrémité de l'obstacle).
    const ringExtents = obstacles.map(o => {
      let sMin = Infinity;
      let sMax = -Infinity;
      for (const p of o) {
        const sv = sOf(p);
        if (sv < sMin) sMin = sv;
        if (sv > sMax) sMax = sv;
      }
      return { sMin, sMax };
    });
    // Étendue t (transversale) de chaque obstacle : une pièce n'est
    // coupée par l'obstacle que si sa RANGÉE traverse cette étendue —
    // les lignes pleines qui passent À CÔTÉ de l'obstacle (leur
    // extrémité touche pourtant l'évidement de la zone de balayage
    // autour de l'obstacle) ne doivent être ni colorées ni prises pour
    // déclencheur du contour.
    const ringTExtents = obstacles.map(o => {
      let tMin = Infinity;
      let tMax = -Infinity;
      for (const p of o) {
        const tv = tOf(p);
        if (tv < tMin) tMin = tv;
        if (tv > tMax) tMax = tv;
      }
      return { tMin, tMax };
    });
    const rowCrosses = (seg: Seg, i: number): boolean => {
      const te = ringTExtents[i];
      return seg.t >= te.tMin - 1e-6 && seg.t <= te.tMax + 1e-6;
    };
    const sideOfSeg = (seg: Seg, i: number): number | null => {
      const ex = ringExtents[i];
      if (seg.b <= ex.sMin) return 0;
      if (seg.a >= ex.sMax) return 1;
      return null;
    };
    // Dernier côté visité par obstacle (propagé à travers les passes non
    // séparées) : détecte la bascule d'un côté à l'autre, même quand le
    // robot contourne par une extrémité sans jamais traverser l'anneau.
    const effSide: Array<number | null> = obstacles.map(() => null);
    // Anneaux de contour d'un obstacle (miroir des headlands : le plus
    // extérieur en premier), rattachés à leur obstacle par centroïde.
    const centroid = (r: Pt[]): Pt => ({
      x: r.reduce((s, p) => s + p.x, 0) / r.length,
      y: r.reduce((s, p) => s + p.y, 0) / r.length,
    });
    const loopsOf = (i: number): Pt[][] =>
      obstacleLoops
        .filter(L => {
          let bestJ = 0;
          let bestD = Infinity;
          obstacles.forEach((o, j) => {
            const dd = dist(centroid(o), centroid(L));
            if (dd < bestD) { bestD = dd; bestJ = j; }
          });
          return bestJ === i;
        })
        .reverse();
    const emitObstacleContours = (i: number): void => {
      // Point d'attaque du contour choisi intelligemment : la boucle
      // étant fermée, elle REVIENT à son point d'entrée — on minimise
      // donc le trajet TOTAL : distance(position courante → sommet) +
      // distance(sommet → extrémité la plus proche des pièces
      // raccourcies restantes de cet obstacle). Le contour est ainsi
      // attaqué au plus près de la première ligne colorée à travailler
      // (et terminé au même endroit), au lieu du seul sommet le plus
      // proche de la position courante.
      const targets: Pt[] = [];
      for (const s of allSegs) {
        if (s.done || !rowCrosses(s, i)) continue;
        targets.push(at(s.t, s.a), at(s.t, s.b));
      }
      const score = (v: Pt): number => {
        const dIn = lastEnd ? dist(lastEnd, v) : 0;
        let dOut = 0;
        if (targets.length > 0) {
          dOut = Infinity;
          for (const e of targets) {
            const dd = dist(v, e);
            if (dd < dOut) dOut = dd;
          }
        }
        return dIn + dOut;
      };
      for (const L of loopsOf(i)) {
        let best = 0;
        let bestScore = Infinity;
        L.forEach((p, k) => {
          const sc = score(p);
          if (sc < bestScore) { bestScore = sc; best = k; }
        });
        addElem('obstacle', L.slice(best).concat(L.slice(0, best)), true);
      }
    };
    // Pièce raccourcie par un obstacle : une de ses extrémités S'ARRÊTE
    // sur un contour d'obstacle (anneau gonflé ou contour de tête le plus
    // extérieur). Ce sont ces pièces, et elles seules, qui portent une
    // couleur de phase ; les passes entières (y compris pointes de
    // parcelle) restent à la couleur de base.
    const onAnyRing = (p: Pt, rings: Pt[][]): boolean =>
      rings.some(L => dist(p, nearestOnRing(p, L).pt) < 10);
    const shorteningSide = (seg: Seg): number | null => {
      const pa = at(seg.t, seg.a);
      const pb = at(seg.t, seg.b);
      for (let i = 0; i < obstacles.length; i++) {
        const rings = [obstacles[i], ...loopsOf(i)];
        if (!rowCrosses(seg, i)) continue;
        if (onAnyRing(pa, rings) || onAnyRing(pb, rings)) {
          const side = sideOfSeg(seg, i);
          if (side !== null) return side;
          // Pièce à cheval sur l'étendue s (rangée proche d'une pointe) :
          // le côté est donné par l'EXTRÉMITÉ qui touche l'anneau —
          // coupée en fin de pièce (b) = 1er côté (bleu), coupée en
          // début (a) = 2e côté (violet) ; si les deux touchent, le
          // milieu de la pièce départage.
          const touchA = onAnyRing(pa, rings);
          const touchB = onAnyRing(pb, rings);
          if (touchA && !touchB) return 1;
          if (touchB && !touchA) return 0;
          const ex = ringExtents[i];
          return (seg.a + seg.b) / 2 >= (ex.sMin + ex.sMax) / 2 ? 1 : 0;
        }
      }
      return null;
    };
    let guard = 0;
    while (allSegs.some(s => !s.done) && guard++ < allSegs.length + 10) {
      let candidates = allSegs.filter(s => !s.done);
      const le = lastEnd;
      // Distance de parcours RÉEL jusqu'à chaque extrémité (ligne
      // droite si libre, arc contournant l'obstacle sinon) : la pièce
      // choisie est la plus proche PAR LE CHEMIN — une pièce de
      // l'autre côté de l'obstacle, proche par l'arc, n'est plus
      // écartée au profit de lignes blanches à l'autre bout de la
      // parcelle (fini les déplacements anarchiques).
      const routeLen = (from: Pt, to: Pt): number => {
        if (segClearOf(from, to, obstacles)) return dist(from, to);
        const path = routeTransition(from, to);
        return path.reduce((s, q, i) => (i ? s + dist(path[i - 1], q) : 0), 0);
      };
        // Lignes pleines d'abord : tant qu'une ligne NON coupée par un
        // obstacle pas encore contourné est disponible, on la privilégie
        // — le contour n'est déclenché que lorsque le parcours atteint
        // réellement la première ligne coupée (sinon la sélection du
        // segment le plus proche pouvait attaquer une pièce raccourcie
        // dès le début du balayage).
        const untouched = candidates.filter(s => {
          const qa = at(s.t, s.a);
          const qb = at(s.t, s.b);
          return obstacles.every((o, i) =>
            contoured.has(o) || !rowCrosses(s, i) ||
            (!onAnyRing(qa, [o, ...loopsOf(i)]) && !onAnyRing(qb, [o, ...loopsOf(i)])));
        });
        // ... mais UNIQUEMENT tant que la position courante est HORS
        // de la bande transversale d'un obstacle non contourné : dès
        // que le parcours ATTEINT la zone de l'obstacle, on cesse de
        // différer les pièces raccourcies — contour de l'obstacle,
        // puis le côté le plus proche PAR LE CHEMIN, puis l'autre
        // côté, avant de revenir aux lignes pleines restantes (plus de
        // traversée de la zone pour finir les blancs au bout de la
        // parcelle).
        const inBand = le != null && obstacles.some((o, i) =>
          !contoured.has(o) &&
          tOf(le) >= ringTExtents[i].tMin - 1e-6 &&
          tOf(le) <= ringTExtents[i].tMax + 1e-6);
        // ... et de même si la pièce la plus proche PAR LE CHEMIN est
        // déjà une pièce raccourcie : le parcours est arrivé à
        // l'obstacle par contiguïté de rangées, même si la position
        // courante est encore sur la ligne blanche juste avant la
        // bande (le test inBand seul ratait ce cas : le robot sautait
        // par-dessus la bande pour finir les blancs au-delà).
        let nearestIsColored = false;
        if (le) {
          let dNear = Infinity;
          let sNear: Seg | null = null;
          for (const s of candidates) {
            const ds = Math.min(routeLen(le, at(s.t, s.a)), routeLen(le, at(s.t, s.b)));
            if (ds < dNear) { dNear = ds; sNear = s; }
          }
          nearestIsColored = sNear != null && !untouched.includes(sNear);
        }
        // ... ni tant qu'un obstacle EN COURS (déjà contourné) a
        // encore des pièces colorées à faire : après le 1er côté, le
        // robot suit le tour de l'obstacle pour attaquer le 2e côté
        // immédiatement, au lieu de repartir sur les lignes blanches
        // et de revenir plus tard.
        const coloredLeft = candidates.some(s =>
          !untouched.includes(s) &&
          obstacles.some((o, i) => contoured.has(o) && rowCrosses(s, i)));
        if (!inBand && !nearestIsColored && !coloredLeft && untouched.length > 0) {
          candidates = untouched;
        }
      // Segment dont l'extrémité la plus proche de la position courante
      // est minimale (boustrophédon naturel, U-turn au plus près).
      let bestSeg: Seg | null = null;
      let bestD = Infinity;
      let bestRev = false;
      for (const s of candidates) {
        const pa = at(s.t, s.a);
        const pb = at(s.t, s.b);
        const da = le ? routeLen(le, pa) : 0;
        const db = le ? routeLen(le, pb) : 0;
        const d = Math.min(da, db);
        if (d < bestD) { bestD = d; bestSeg = s; bestRev = db < da; }
      }
      if (!bestSeg) break;
      const startPt = bestRev ? at(bestSeg.t, bestSeg.b) : at(bestSeg.t, bestSeg.a);
      // Première ligne COUPÉE par un obstacle : contours de l'obstacle
      // tracés AVANT de travailler les côtés (le robot nettoie le
      // pourtour pour demi-tourer dans une zone propre), puis il
      // travaille un côté puis l'autre avant de revenir aux lignes
      // pleines.
      for (let i = 0; i < obstacles.length; i++) {
        const side = sideOfSeg(bestSeg, i);
        if (side !== null) effSide[i] = side;
      }
      if (le && params.outlineObstacles) {
        const pa = at(bestSeg.t, bestSeg.a);
        const pb = at(bestSeg.t, bestSeg.b);
        for (let i = 0; i < obstacles.length; i++) {
          if (contoured.has(obstacles[i])) continue;
          const rings = [obstacles[i], ...loopsOf(i)];
          if (!rowCrosses(bestSeg, i)) continue;
          if (onAnyRing(pa, rings) || onAnyRing(pb, rings)) {
            contoured.add(obstacles[i]);
            emitObstacleContours(i);
          }
        }
      }
      const pa = at(bestSeg.t, bestSeg.a);
      const pb = at(bestSeg.t, bestSeg.b);
      const sd = shorteningSide(bestSeg);
      addElem('sweep', bestRev ? [pb, pa] : [pa, pb], false, sd === null ? 0 : 1 + sd);
      bestSeg.done = true;
    }
    // Obstacles jamais basculés (un seul côté accessible, obstacle en
    // bordure de parcelle…) : contours tracés en fin de parcours.
    if (params.outlineObstacles) {
      obstacles.forEach((o, i) => {
        if (!contoured.has(o)) {
          contoured.add(o);
          emitObstacleContours(i);
        }
      });
    }
    if (allSegs.some(s => !s.done)) {
      warnings.push("Segments de passe inatteignables (obstacles trop imbriqués) — à contrôler.");
    }
  }

  /* --- 4. Sortie : conversion lat/lng + statistiques --- */
  const lines: Workline[] = elems.map(el => ({
    kind: el.kind,
    points: el.pts.map(p => toLatLng(p, origin)),
    closed: el.closed,
    phase: el.phase,
  }));

  let total = 0;
  let loops = 0;
  let sweeps = 0;
  let trans = 0;
  let obst = 0;
  elems.forEach(el => {
    if (el.kind === 'transition') trans++;
    else if (el.kind === 'sweep') sweeps++;
    else if (el.kind === 'headland') loops++;
    else if (el.kind === 'obstacle') obst++;
    for (let i = 1; i < el.pts.length; i++) total += dist(el.pts[i - 1], el.pts[i]);
  });

  return {
    lines,
    stats: {
      totalLengthM: Math.round(total),
      headlandLoops: loops,
      sweepPasses: sweeps,
      transitions: trans,
      obstacleContours: obst,
    },
    warnings,
  };
}
