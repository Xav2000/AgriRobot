import React, { useEffect } from 'react';
import { Polyline, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useZones } from '../context/ZonesContext';
import { useWorklines } from '../context/WorklinesContext';
import { useUiMode } from '../context/UiModeContext';

const PICK_COLOR = '#1976D2';
const ENTRY_COLOR = '#0D47A1';
const REFERENCE_COLOR = '#4CAF50';

/** Marqueur du point d'entrée (glissable). */
const entryIcon = L.divIcon({
  className: 'worklines-entry',
  html:
    '<div style="width:16px;height:16px;border-radius:50%;background:' + ENTRY_COLOR +
    ';border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.6)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

/**
 * Couche des lignes de guidage (mode worklines, étape 6.2) :
 * - point d'entrée : placé au clic sur la carte, glissable ensuite
 * - bordure de référence : pendant la sélection, les arêtes de la zone
 *   cible sont épaisses et cliquables ; l'arête choisie reste surlignée
 * Aucune ligne n'est générée ici (algorithme en 6.3).
 */
export const WorklinesLayer: React.FC = () => {
  const { mode } = useUiMode();
  const { zones } = useZones();
  const { params, pickMode, setPickMode, setParams } = useWorklines();
  const map = useMap();

  const targetZone = zones.find(z => z.id === params.targetZoneId) ?? null;

  // Curseur croix pendant une sélection
  useEffect(() => {
    const container = map.getContainer();
    const active = mode === 'worklines' && pickMode !== null;
    container.style.cursor = active ? 'crosshair' : '';
    return () => {
      container.style.cursor = '';
    };
  }, [mode, pickMode, map]);

  // Clic carte : placement du point d'entrée
  useMapEvents({
    click(e) {
      if (mode === 'worklines' && pickMode === 'entryPoint') {
        setParams({ entryPoint: [e.latlng.lat, e.latlng.lng] });
        setPickMode(null);
      }
    },
  });

  if (mode !== 'worklines') return null;

  // Arêtes de la zone cible : [sommet i, sommet i+1]
  const edges: [number, number][][] = [];
  if (targetZone && targetZone.points.length >= 3) {
    const n = targetZone.points.length;
    for (let i = 0; i < n; i++) {
      edges.push([targetZone.points[i], targetZone.points[(i + 1) % n]]);
    }
  }

  return (
    <>
      {/* Arêtes sélectionnables pendant le choix de la bordure de référence */}
      {pickMode === 'referenceBorder' &&
        edges.map((edge, i) => (
          <Polyline
            key={'worklines-pick-' + i}
            positions={edge}
            pathOptions={{ color: PICK_COLOR, weight: 7, opacity: 0.85 }}
            eventHandlers={{
              click: () => {
                setParams({ referenceBorderIndex: i });
                setPickMode(null);
              },
            }}
          >
            <Tooltip sticky>Bordure n°{i + 1}</Tooltip>
          </Polyline>
        ))}

      {/* Bordure de référence choisie */}
      {params.referenceBorderIndex != null &&
        edges[params.referenceBorderIndex] != null && (
          <Polyline
            positions={edges[params.referenceBorderIndex]}
            pathOptions={{ color: REFERENCE_COLOR, weight: 5 }}
          >
            <Tooltip sticky>Bordure de référence</Tooltip>
          </Polyline>
        )}

      {/* Point d'entrée */}
      {params.entryPoint && (
        <Marker
          position={params.entryPoint}
          icon={entryIcon}
          draggable
          zIndexOffset={1000}
          eventHandlers={{
            dragend: e => {
              const { lat, lng } = (e.target as L.Marker).getLatLng();
              setParams({ entryPoint: [lat, lng] });
            },
          }}
        >
          <Tooltip sticky>Point d'entrée</Tooltip>
        </Marker>
      )}
    </>
  );
};
