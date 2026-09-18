import React, { useEffect } from 'react';
import { Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useStation } from '../context/StationContext';

/** Longueur de la flèche de sortie (m) et du chevron de pointe. */
const ARROW_M = 3;
const CHEVRON_M = 1;
const M_PER_DEG = 111320;

/** Pilule de la station : verte (recharge), liseré blanc, éclair. */
const stationIcon = L.divIcon({
  className: 'zone-vertex',
  html:
    '<div style="width:18px;height:18px;border-radius:50%;background:#4CAF50' +
    ';border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.6);display:flex;' +
    'align-items:center;justify-content:center;font-size:11px">⚡</div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

/** Point [lat,lng] à distance d (m) dans le cap donné (0 = nord). */
const movePoint = (p: [number, number], headingDeg: number, d: number): [number, number] => {
  const rad = (headingDeg * Math.PI) / 180;
  return [
    p[0] + (d * Math.cos(rad)) / M_PER_DEG,
    p[1] + (d * Math.sin(rad)) / (M_PER_DEG * Math.cos((p[0] * Math.PI) / 180)),
  ];
};

/**
 * Couche de la station de recharge (étape 6.8) :
 * - pilule verte glissante (éclair)
 * - flèche de sortie CLIQUABLE : chaque clic tourne le cap de 45°
 *   (choix utilisateur : flèche cliquable/rotative)
 * - placement au clic sur la carte quand « placer » est actif (bouton
 *   de la sidebar des chemins de liaison)
 * - visible dans TOUS les modes une fois posée : infrastructure
 *   globale, comme les zones
 * - manœuvres d'entrée/sortie simulées (pas de cinématique réelle)
 */
export const StationLayer: React.FC = () => {
  const { station, setStation, moveStation, rotateStation, placing } = useStation();
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    container.style.cursor = placing ? 'crosshair' : '';
    return () => { container.style.cursor = ''; };
  }, [placing, map]);

  useMapEvents({
    click(e) {
      if (placing) setStation([e.latlng.lat, e.latlng.lng]);
    },
  });

  if (!station) return null;

  const tip = movePoint(station.position, station.headingDeg, ARROW_M);
  const c1 = movePoint(tip, station.headingDeg + 180 - 25, CHEVRON_M);
  const c2 = movePoint(tip, station.headingDeg + 180 + 25, CHEVRON_M);
  const arrowOpts: L.PolylineOptions = { color: '#4CAF50', weight: 6, opacity: 0.95 };

  return (
    <>
      <Polyline
        positions={[station.position, tip]}
        pathOptions={arrowOpts}
        eventHandlers={{ click: () => rotateStation(45) }}
      />
      {/* Chevron de pointe — cliquable comme la flèche */}
      <Polyline positions={[c1, tip]} pathOptions={arrowOpts} eventHandlers={{ click: () => rotateStation(45) }} />
      <Polyline positions={[c2, tip]} pathOptions={arrowOpts} eventHandlers={{ click: () => rotateStation(45) }} />
      <Marker
        position={station.position}
        icon={stationIcon}
        draggable
        zIndexOffset={800}
        eventHandlers={{
          dragend: e => {
            const { lat, lng } = (e.target as L.Marker).getLatLng();
            moveStation([lat, lng]);
          },
        }}
      />
    </>
  );
};
