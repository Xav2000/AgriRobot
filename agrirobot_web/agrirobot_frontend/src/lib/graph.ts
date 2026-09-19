/**
 * Graphe de circulation (étape 6.7) — lib pure, sans React/Leaflet.
 *
 * Les chemins de liaison forment un réseau navigable : c'est le seul
 * passage autorisé pour sortir d'un polygone. Les JONCTIONS sont
 * AUTOMATIQUES (choix utilisateur) :
 * - deux segments de chemins différents qui se croisent créent un
 *   nœud à l'intersection ;
 * - deux points de chemins à moins de JUNCTION_M (1 m) l'un de
 *   l'autre sont fusionnés en un seul nœud (choix utilisateur :
 *   tolérance 1 m) ;
 * - l'extrémité d'un chemin à moins de JUNCTION_M d'un segment d'un
 *   AUTRE chemin s'y raccorde (jonction en T).
 * Les PORTAILS ne sont PAS raccordés automatiquement : le point doit
 * être posé manuellement dessus (clic direct / aimantation) — choix
 * utilisateur.
 *
 * Navigation par plus court chemin (Dijkstra) entre deux points
 * quelconques, raccrochés au nœud le plus proche. Servira pour la
 * station (6.8) et les retours d'urgence (6.10).
 */

export type Pt = [number, number];

/** Tolérance de jonction (m) : en dessous, deux points sont considérés
 *  comme un croisement (choix utilisateur : 1 m). */
export const JUNCTION_M = 1;

/** Mètres par degré de latitude (approximation locale suffisante pour
 *  un réseau de parcelles : quelques centaines de mètres). */
const M_PER_DEG = 111320;

export interface GraphEdge {
  a: number;
  b: number;
  /** longueur métrique */
  w: number;
}

export interface CorridorGraph {
  /** Nœuds [lat, lng] */
  nodes: Pt[];
  edges: GraphEdge[];
  /** Nombre d'arêtes incidentes par nœud (>= 3 = jonction) */
  degree: number[];
}

interface Cand {
  x: number;
  y: number;
  /** segments auquel le point est raccroché */
  onSeg: Set<number>;
}

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const project = (p: Pt, ref: Pt): [number, number] => [
  (p[1] - ref[1]) * Math.cos((ref[0] * Math.PI) / 180) * M_PER_DEG,
  (p[0] - ref[0]) * M_PER_DEG,
];

const unproject = (x: number, y: number, ref: Pt): Pt => [
  ref[0] + y / M_PER_DEG,
  ref[1] + x / (M_PER_DEG * Math.cos((ref[0] * Math.PI) / 180)),
];

/** Intersection stricte de deux segments (null si parallèles ou si le
 *  croisement est hors segments — le toucher d'extrémités est couvert
 *  par la fusion de proximité). */
const segIntersect = (s1: Seg, s2: Seg): [number, number] | null => {
  const d1x = s1.bx - s1.ax, d1y = s1.by - s1.ay;
  const d2x = s2.bx - s2.ax, d2y = s2.by - s2.ay;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null;
  const ox = s2.ax - s1.ax, oy = s2.ay - s1.ay;
  const t = (ox * d2y - oy * d2x) / denom;
  const u = (ox * d1y - oy * d1x) / denom;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return [s1.ax + t * d1x, s1.ay + t * d1y];
};

/** Construit le graphe à partir des chemins (points [lat, lng]). */
export const buildCorridorGraph = (
  corridors: { points: Pt[] }[],
  /**
   * Points additionnels raccordés au réseau s'ils sont à moins de
   * JUNCTION_M d'un segment (la station de recharge, étape 6.8).
   */
  extraPoints: Pt[] = []
): CorridorGraph => {
  const all = corridors.flatMap(c => c.points);
  if (all.length < 2) return { nodes: [], edges: [], degree: [] };
  const ref = all[0];

  // Segments en mètres + index de départ des segments par chemin
  const segs: Seg[] = [];
  const segStart: number[] = [];
  corridors.forEach(c => {
    segStart.push(segs.length);
    for (let i = 0; i + 1 < c.points.length; i++) {
      const [ax, ay] = project(c.points[i], ref);
      const [bx, by] = project(c.points[i + 1], ref);
      segs.push({ ax, ay, bx, by });
    }
  });
  const segCorridor: number[] = [];
  corridors.forEach((c, ci) => {
    for (let s = 0; s < Math.max(0, c.points.length - 1); s++) segCorridor.push(ci);
  });

  // Candidats nœuds : chaque point de chemin, raccordé à ses segments
  // adjacents (les coudes doivent exister comme nœuds, sinon le graphe
  // est coupé aux angles des tracés).
  const cand: Cand[] = [];
  const candIndexOf: number[][] = [];
  corridors.forEach((c, ci) => {
    candIndexOf[ci] = [];
    c.points.forEach((p, pi) => {
      const [x, y] = project(p, ref);
      const onSeg = new Set<number>();
      if (pi > 0) onSeg.add(segStart[ci] + pi - 1);
      if (pi < c.points.length - 1) onSeg.add(segStart[ci] + pi);
      candIndexOf[ci][pi] = cand.length;
      cand.push({ x, y, onSeg });
    });
  });

  // …plus les intersections de segments de chemins différents.
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segCorridor[i] === segCorridor[j]) continue;
      const inter = segIntersect(segs[i], segs[j]);
      if (inter) cand.push({ x: inter[0], y: inter[1], onSeg: new Set([i, j]) });
    }
  }

  // Extrémités de chemins : raccrochées aux segments d'AUTRES chemins à
  // moins de JUNCTION_M (jonction en T). Jamais aux segments de leur
  // propre chemin (contiguïté naturelle), et les points intérieurs ne
  // s'y raccrochent pas (deux chemins parallèles ne fusionnent pas).
  const hookUp = (ni: number, ownCi: number) => {
    const e = cand[ni];
    segs.forEach((s, si) => {
      if (segCorridor[si] === ownCi) return;
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return;
      const t = ((e.x - s.ax) * dx + (e.y - s.ay) * dy) / len2;
      if (t < 0 || t > 1) return;
      const px = s.ax + t * dx, py = s.ay + t * dy;
      if (Math.hypot(e.x - px, e.y - py) < JUNCTION_M) {
        cand[ni].onSeg.add(si);
      }
    });
  };
  corridors.forEach((c, ci) => {
    if (c.points.length < 2) return;
    hookUp(candIndexOf[ci][0], ci);
    hookUp(candIndexOf[ci][c.points.length - 1], ci);
  });
  // Points additionnels (station) : raccordés à TOUS les segments à
  // moins de JUNCTION_M — pas de chemin propriétaire.
  extraPoints.forEach(p => {
    const [x, y] = project(p, ref);
    cand.push({ x, y, onSeg: new Set<number>() });
    hookUp(cand.length - 1, -1);
  });

  // Fusion par proximité (< JUNCTION_M) — union-find, single linkage :
  // le nœud fusionné prend la position moyenne du groupe.
  const parent = cand.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let i = 0; i < cand.length; i++) {
    for (let j = i + 1; j < cand.length; j++) {
      if (Math.hypot(cand[i].x - cand[j].x, cand[i].y - cand[j].y) < JUNCTION_M) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, number[]>();
  cand.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  });
  const merged: Cand[] = [];
  groups.forEach(members => {
    const x = members.reduce((s, i) => s + cand[i].x, 0) / members.length;
    const y = members.reduce((s, i) => s + cand[i].y, 0) / members.length;
    const onSeg = new Set<number>();
    members.forEach(i => cand[i].onSeg.forEach(s => onSeg.add(s)));
    merged.push({ x, y, onSeg });
  });

  // Arêtes : chaque segment enchaîne ses nœuds raccrochés, triés le
  // long du segment (poids = distance métrique réelle entre nœuds).
  const nodes: Pt[] = merged.map(m => unproject(m.x, m.y, ref));
  const degree = merged.map(() => 0);
  const edges: GraphEdge[] = [];
  segs.forEach((s, si) => {
    const attached: { node: number; t: number }[] = [];
    merged.forEach((m, ni) => {
      if (!m.onSeg.has(si)) return;
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return;
      const t = ((m.x - s.ax) * dx + (m.y - s.ay) * dy) / len2;
      attached.push({ node: ni, t: Math.min(1, Math.max(0, t)) });
    });
    attached.sort((p, q) => p.t - q.t);
    for (let k = 0; k + 1 < attached.length; k++) {
      const a = attached[k].node, b = attached[k + 1].node;
      if (a === b) continue;
      const w = Math.hypot(merged[a].x - merged[b].x, merged[a].y - merged[b].y);
      if (w <= 0) continue;
      edges.push({ a, b, w });
      degree[a]++;
      degree[b]++;
    }
  });

  return { nodes, edges, degree };
};

const distM = (a: Pt, b: Pt): number => {
  const latMid = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const dx = (b[1] - a[1]) * Math.cos(latMid) * M_PER_DEG;
  const dy = (b[0] - a[0]) * M_PER_DEG;
  return Math.hypot(dx, dy);
};

/** Nœud du graphe le plus proche d'un point (en mètres). */
export const nearestNode = (g: CorridorGraph, p: Pt): number => {
  let best = -1, bestD = Infinity;
  g.nodes.forEach((n, i) => {
    const d = distM(n, p);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
};

export interface PathResult {
  /** index des nœuds traversés (départ et arrivée inclus) */
  nodeIndices: number[];
  /** points [lat, lng] du chemin */
  path: Pt[];
  /** longueur métrique totale */
  length: number;
}

/** Plus court chemin (Dijkstra) entre deux points quelconques,
 *  raccrochés au nœud le plus proche de chacun. Null si aucun chemin
 *  du réseau ne les relie. */
export const shortestPath = (g: CorridorGraph, from: Pt, to: Pt): PathResult | null => {
  if (g.nodes.length === 0) return null;
  const start = nearestNode(g, from);
  const goal = nearestNode(g, to);
  if (start < 0 || goal < 0) return null;
  const n = g.nodes.length;
  const adj: { to: number; w: number }[][] = Array.from({ length: n }, () => []);
  g.edges.forEach(e => {
    adj[e.a].push({ to: e.b, w: e.w });
    adj[e.b].push({ to: e.a, w: e.w });
  });
  const dist = Array(n).fill(Infinity);
  const prev = Array(n).fill(-1);
  const done = Array(n).fill(false);
  dist[start] = 0;
  for (;;) {
    let u = -1, ud = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < ud) { ud = dist[i]; u = i; }
    if (u < 0 || u === goal) break;
    done[u] = true;
    adj[u].forEach(({ to, w }) => {
      const nd = dist[u] + w;
      if (nd < dist[to]) { dist[to] = nd; prev[to] = u; }
    });
  }
  if (!isFinite(dist[goal])) return null;
  const nodeIndices: number[] = [];
  for (let v = goal; v >= 0; v = prev[v]) nodeIndices.unshift(v);
  return { nodeIndices, path: nodeIndices.map(i => g.nodes[i]), length: dist[goal] };
};

/** Distance métrique d'un point au réseau de chemins (projection sur
 *  les segments). Infinity si le réseau est vide. Sert à vérifier que
 *  la station est bien raccordée (<= JUNCTION_M). */
export const distanceToNetwork = (corridors: { points: Pt[] }[], p: Pt): number => {
  const all = corridors.flatMap(c => c.points);
  if (all.length < 2) return Infinity;
  const ref = all[0];
  const [x, y] = project(p, ref);
  let best = Infinity;
  corridors.forEach(c => {
    for (let i = 0; i + 1 < c.points.length; i++) {
      const [ax, ay] = project(c.points[i], ref);
      const [bx, by] = project(c.points[i + 1], ref);
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let d: number;
      if (len2 === 0) d = Math.hypot(x - ax, y - ay);
      else {
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2));
        d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      }
      if (d < best) best = d;
    }
  });
  return best;
};
