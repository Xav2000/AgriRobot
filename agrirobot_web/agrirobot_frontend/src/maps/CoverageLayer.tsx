import React from 'react';
import { CircleMarker, LayerGroup, Polyline } from 'react-leaflet';
import {
  DEG_PER_METER,
  ORIGIN_LAT,
  ORIGIN_LNG,
  useNav2Status,
} from '../hooks/useNav2Status';

/** Espacement mini entre waypoints affiches (m) - meme filtre que le
 * mission_supervisor_node, sinon les indices de progression ne
 * correspondent pas au plan brut (200 wp vs 90 filtres). */
const MIN_WP_SPACING = 0.5;

interface Segment {
  from: [number, number];  // [lat, lng]
  to: [number, number];
  kind: 'sweep' | 'transition';
  index: number;           // index du waypoint d arrivee (echelle filtree)
}

/** Filtre identique au superviseur : garde le 1er, le dernier et le
 * dernier point de chaque segment sweep/transition. */
function filterPlan(waypoints: [number, number][], kinds: string[]) {
  if (waypoints.length < 3) {
    return { wps: waypoints, kinds };
  }
  const toXY = (wp: [number, number]) => [
    (wp[1] - ORIGIN_LNG) / DEG_PER_METER,
    (wp[0] - ORIGIN_LAT) / DEG_PER_METER,
  ];
  const kept: number[] = [0];
  let ref = toXY(waypoints[0]);
  for (let i = 1; i < waypoints.length; i++) {
    const lastOfSegment =
      i + 1 >= waypoints.length || kinds[i + 1] !== kinds[i];
    const xy = toXY(waypoints[i]);
    const d = Math.hypot(xy[0] - ref[0], xy[1] - ref[1]);
    if (d >= MIN_WP_SPACING || lastOfSegment) {
      kept.push(i);
      ref = xy;
    }
  }
  return {
    wps: kept.map((i) => waypoints[i]),
    kinds: kept.map((i) => kinds[i]),
  };
}

function buildSegments(
  wps: [number, number][],
  kinds: string[],
): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i + 1 < wps.length; i++) {
    segs.push({
      from: wps[i],
      to: wps[i + 1],
      kind:
        kinds[i] === 'sweep' && kinds[i + 1] === 'sweep'
          ? 'sweep'
          : 'transition',
      index: i + 1,
    });
  }
  return segs;
}

const COLORS = {
  sweepDone: '#2E7D32',
  sweepTodo: '#4CAF50',
  transitionDone: '#FB8C00',
  transitionTodo: '#FFB74D',
  target: '#1976D2',
};

/**
 * Calque du plan de couverture F2C : passages (vert) et transitions
 * (orange, pointillees). La portion DEJA PARCOURUE (indice du superviseur)
 * est en teinte foncee pleine, le reste en teinte claire.
 * Le waypoint cible courant est marque en bleu.
 */
const CoverageLayer: React.FC = () => {
  const { plan, mission } = useNav2Status();

  if (!plan) return null;
  const { wps, kinds: filteredKinds } = filterPlan(
    plan.waypoints,
    plan.kinds,
  );
  const segments = buildSegments(wps, filteredKinds);
  const done =
    mission && mission.status !== 'idle'
      ? mission.completedWaypoints
      : 0;

  const target: [number, number] | undefined =
    mission && mission.status === 'running'
      ? wps[Math.min(mission.currentWaypoint, wps.length - 1)]
      : undefined;

  return (
    <LayerGroup>
      {segments.map((seg, i) => {
        const isDone = seg.index <= done;
        const color =
          seg.kind === 'sweep'
            ? (isDone ? COLORS.sweepDone : COLORS.sweepTodo)
            : (isDone ? COLORS.transitionDone : COLORS.transitionTodo);
        return (
          <Polyline
            key={i}
            positions={[seg.from, seg.to]}
            pathOptions={{
              color,
              weight: seg.kind === 'sweep' ? 4 : 3,
              opacity: isDone ? 1 : 0.65,
              dashArray: seg.kind === 'transition' ? '6 6' : undefined,
            }}
          />
        );
      })}
      {target && (
        <CircleMarker
          center={target}
          radius={6}
          pathOptions={{ color: COLORS.target, fillColor: COLORS.target, fillOpacity: 1 }}
        />
      )}
    </LayerGroup>
  );
};

export default CoverageLayer;
