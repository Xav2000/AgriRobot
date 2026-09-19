import React, { useEffect, useRef } from 'react';
import { Polyline, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useMission, MissionTask } from '../hooks/useMission';

const STATUS_COLORS: Record<MissionTask['status'], string> = {
  pending: '#9E9E9E',
  running: '#2196F3',
  completed: '#4CAF50',
  failed: '#f44336',
};

/** Marqueur circulaire numéroté (ordre de la tâche dans la mission). */
const numberIcon = (n: number, color: string) =>
  L.divIcon({
    className: 'mission-marker',
    html:
      '<div style="background:' + color + ';color:#fff;width:26px;height:26px;' +
      'border-radius:50%;display:flex;align-items:center;justify-content:center;' +
      'font-weight:700;font-size:13px;border:2px solid #fff;' +
      'box-shadow:0 1px 4px rgba(0,0,0,0.4)">' + n + '</div>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

/**
 * Couche Leaflet du parcours de la mission :
 * - tronçon effectué : trait plein coloré selon le statut
 * - tronçon restant : pointillés
 * - marqueurs numérotés au départ de chaque tâche
 * - PAS de liaison inter-tâches : les zones sont indépendantes, le
 *   transit entre elles sera calculé par le planificateur via les
 *   chemins de liaison (graphe 6.7) et apparaîtra dans les waypoints
 *   de la mission — jamais une ligne droite arbitraire
 * - recadrage automatique quand la composition de la mission change
 */
export const MissionLayer: React.FC = () => {
  const { mission } = useMission();
  const map = useMap();
  const fittedRef = useRef('');

  // Recentre la carte sur la mission (une seule fois par composition)
  useEffect(() => {
    if (!mission || mission.tasks.length === 0) return;
    const key = mission.tasks.map(t => t.id).join(',');
    if (fittedRef.current === key) return;
    fittedRef.current = key;
    const bounds = L.latLngBounds(
      mission.tasks.flatMap(t => t.waypoints as L.LatLngExpression[])
    );
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [mission, map]);

  if (!mission || mission.tasks.length === 0) return null;

  return (
    <>
      {mission.tasks.map((task, i) => {
        const color = STATUS_COLORS[task.status];
        const total = task.waypoints.length;
        const done = Math.min(task.completedWaypoints, total);

        // Tronçon effectué (au moins 2 points atteints)
        const donePts = task.waypoints.slice(0, done);
        // Tronçon restant (repart du dernier point atteint)
        const remainingPts = task.waypoints.slice(Math.max(done - 1, 0));

        // Pas de liaison visuelle avec la tâche précédente : une ligne
        // droite entre les zones serait trompeuse (le robot empruntera
        // les chemins de liaison, calculés par le planificateur).

        return (
          <React.Fragment key={task.id}>
            {donePts.length >= 2 && (
              <Polyline
                positions={donePts}
                pathOptions={{ color, weight: 5, opacity: 0.9 }}
              >
                <Tooltip sticky>{i + 1}. {task.name} — effectué</Tooltip>
              </Polyline>
            )}

            {remainingPts.length >= 2 && (
              <Polyline
                positions={remainingPts}
                pathOptions={{ color, weight: 3, dashArray: '6 8', opacity: 0.8 }}
              >
                <Tooltip sticky>{i + 1}. {task.name} — reste à faire</Tooltip>
              </Polyline>
            )}

            {total > 0 && (
              <Marker position={task.waypoints[0]} icon={numberIcon(i + 1, color)}>
                <Tooltip>{i + 1}. {task.name}</Tooltip>
              </Marker>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
};
