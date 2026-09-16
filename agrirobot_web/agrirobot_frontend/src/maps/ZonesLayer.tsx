import React, { useEffect } from 'react';
import { Polygon, Polyline, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useZones } from '../context/ZonesContext';

/** Pastille de sommet (glissable). */
const vertexIcon = (color: string) =>
  L.divIcon({
    className: 'zone-vertex',
    html:
      '<div style="width:14px;height:14px;border-radius:50%;background:' + color +
      ';border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.5)"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

/** Clic sur la carte : ajoute un sommet à la zone sélectionnée (mode dessin). */
const MapClickHandler: React.FC = () => {
  const { drawMode, selectedZoneId, appendPoint } = useZones();

  useMapEvents({
    click(e) {
      if (drawMode && selectedZoneId) {
        appendPoint([e.latlng.lat, e.latlng.lng]);
      }
    },
  });

  return null;
};

/**
 * Couche Leaflet des zones (polygones) :
 * - polygones colorés, cliquables pour sélection
 * - sommets éditables sur la zone sélectionnée : glisser pour déplacer,
 *   clic droit pour supprimer
 * - curseur croix en mode dessin
 */
export const ZonesLayer: React.FC = () => {
  const { zones, selectedZoneId, selectZone, drawMode, updateVertex, removeVertex } = useZones();
  const map = useMap();

  // Curseur croix en mode dessin
  useEffect(() => {
    const container = map.getContainer();
    container.style.cursor = drawMode && selectedZoneId ? 'crosshair' : '';
    return () => {
      container.style.cursor = '';
    };
  }, [drawMode, selectedZoneId, map]);

  return (
    <>
      <MapClickHandler />

      {zones.map(zone => {
        const selected = zone.id === selectedZoneId;

        return (
          <React.Fragment key={zone.id}>
            {zone.points.length >= 3 && (
              <Polygon
                positions={zone.points}
                pathOptions={{
                  color: zone.color,
                  fillOpacity: selected ? 0.3 : 0.15,
                  weight: selected ? 3 : 2,
                  dashArray: selected ? undefined : '4 6',
                }}
                eventHandlers={{ click: () => selectZone(zone.id) }}
              >
                <Tooltip sticky>{zone.name}</Tooltip>
              </Polygon>
            )}

            {/* Aperçu pendant le dessin (moins de 3 sommets) */}
            {zone.points.length === 2 && (
              <Polyline
                positions={zone.points}
                pathOptions={{ color: zone.color, weight: 2, dashArray: '4 6' }}
              />
            )}

            {/* Sommets éditables de la zone sélectionnée */}
            {selected &&
              zone.points.map((pt, i) => (
                <Marker
                  key={zone.id + '-' + i}
                  position={pt}
                  icon={vertexIcon(zone.color)}
                  draggable
                  eventHandlers={{
                    dragend: e => {
                      const { lat, lng } = (e.target as L.Marker).getLatLng();
                      updateVertex(i, [lat, lng]);
                    },
                    contextmenu: () => removeVertex(i),
                  }}
                />
              ))}
          </React.Fragment>
        );
      })}
    </>
  );
};
