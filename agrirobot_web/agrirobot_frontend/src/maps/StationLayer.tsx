import React, { useEffect, useRef, useState } from 'react';
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

/** Cap (degrés, 0 = nord, horaire) depuis un point vers un autre. */
const headingTo = (from: [number, number], to: [number, number]): number => {
  const latMid = ((from[0] + to[0]) / 2) * (Math.PI / 180);
  const dx = (to[1] - from[1]) * Math.cos(latMid);
  const dy = to[0] - from[0];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
};

/**
 * Couche de la station de recharge (étape 6.8) :
 * - pilule verte glissante (éclair)
 * - flèche de sortie ORIENTABLE AU GLISSER (choix utilisateur) :
 *   clic gauche maintenu sur la flèche → elle suit le curseur en
 *   temps réel (cap exact) ; relâcher fige l'orientation. Un clic
 *   simple SANS mouvement garde le pas de 45°
 * - placement au clic sur la carte quand « placer » est actif (bouton
 *   de la sidebar des chemins de liaison)
 * - visible dans TOUS les modes une fois posée : infrastructure
 *   globale, comme les zones
 * - manœuvres d'entrée/sortie simulées (pas de cinématique réelle)
 */
export const StationLayer: React.FC = () => {
  const { station, setStation, moveStation, rotateStation, setHeading, placing } = useStation();
  const map = useMap();
  const [rotating, setRotating] = useState(false);
  // True si le curseur a bougé pendant la rotation : distingue le
  // glisser (orientation exacte) du clic simple (pas de 45°).
  const movedRef = useRef(false);

  useEffect(() => {
    const container = map.getContainer();
    container.style.cursor = placing ? 'crosshair' : '';
    return () => { container.style.cursor = ''; };
  }, [placing, map]);

  const startRotate = () => {
    movedRef.current = false;
    setRotating(true);
    // Sans ça, la carte se déplace pendant qu'on tourne la flèche.
    if (map.dragging.enabled()) map.dragging.disable();
  };
  const stopRotate = () => {
    if (!rotating) return;
    setRotating(false);
    map.dragging.enable();
  };

  useMapEvents({
    click(e) {
      if (placing) setStation([e.latlng.lat, e.latlng.lng]);
    },
    mousemove(e) {
      if (rotating && station) {
        movedRef.current = true;
        setHeading(headingTo(station.position, [e.latlng.lat, e.latlng.lng]));
      }
    },
    mouseup() {
      stopRotate();
    },
  });

  if (!station) return null;

  const tip = movePoint(station.position, station.headingDeg, ARROW_M);
  const c1 = movePoint(tip, station.headingDeg + 180 - 25, CHEVRON_M);
  const c2 = movePoint(tip, station.headingDeg + 180 + 25, CHEVRON_M);
  const arrowOpts: L.PolylineOptions = { color: '#4CAF50', weight: 6, opacity: 0.95 };

  const arrowEvents = {
    mousedown: startRotate,
    // Clic simple sans mouvement : pas de 45° (glisser = orientation
    // exacte, déjà appliquée par le mousemove).
    click: () => {
      if (!movedRef.current) rotateStation(45);
    },
  };

  return (
    <>
      <Polyline
        positions={[station.position, tip]}
        pathOptions={arrowOpts}
        eventHandlers={arrowEvents}
      />
      {/* Chevron de pointe — orientable comme la flèche */}
      <Polyline positions={[c1, tip]} pathOptions={arrowOpts} eventHandlers={arrowEvents} />
      <Polyline positions={[c2, tip]} pathOptions={arrowOpts} eventHandlers={arrowEvents} />
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
