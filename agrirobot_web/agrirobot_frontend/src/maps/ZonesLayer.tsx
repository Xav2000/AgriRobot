import React, { useEffect } from 'react';
import { Polygon, Polyline, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useZones, CORRIDOR_COLOR } from '../context/ZonesContext';
import { corridorWarnings } from '../lib/corridors';
import { useUiMode } from '../context/UiModeContext';

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

/** Pastille médiane translucide entre deux sommets d'un chemin de
 *  liaison : un clic insère un nouveau sommet à cet endroit. */
const midpointIcon = () =>
  L.divIcon({
    className: 'zone-vertex',
    html:
      '<div style="width:10px;height:10px;border-radius:50%;background:' + CORRIDOR_COLOR +
      ';opacity:0.45;border:1px solid #fff"></div>',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });

/**
 * Clic sur la carte :
 * - chemin de liaison sélectionné (modes zones et planification,
 *   édition active) : prolonge le tracé ;
 * - zone sélectionnée (mode zones, édition active) : ajoute un sommet.
 * Pendant l'édition, les clics sur les polygones existants traversent
 * (aucune sélection détournée) — on peut ainsi dessiner une exclusion à
 * l'intérieur d'une zone de tonte.
 */
const MapClickHandler: React.FC = () => {
  const { mode } = useUiMode();
  const {
    editMode, selectedZoneId, appendPoint,
    selectedCorridorId, appendCorridorPoint,
  } = useZones();

  useMapEvents({
    click(e) {
      if (!editMode) return;
      if (selectedCorridorId && (mode === 'zones' || mode === 'planning')) {
        appendCorridorPoint([e.latlng.lat, e.latlng.lng]);
      } else if (selectedZoneId && mode === 'zones') {
        appendPoint([e.latlng.lat, e.latlng.lng]);
      }
    },
  });

  return null;
};

/**
 * Couche Leaflet des zones (polygones) :
 * - zones de tonte (palette) et zones d'exclusion (rouge, pointillées)
 * - clic sur un polygone (hors édition, mode zones) : sélection + édition
 *   activée (seul point d'entrée d'édition pour les exclusions, non
 *   listées)
 * - poignées de sommets sur la zone sélectionnée, uniquement en mode
 *   zones avec édition active : glisser pour déplacer, clic droit pour
 *   supprimer
 * - chemins de liaison : sélection/édition en modes zones et
 *   planification, pastilles médianes cliquables pour insérer un sommet
 * - curseur croix pendant l'édition
 */
export const ZonesLayer: React.FC = () => {
  const { mode } = useUiMode();
  const {
    zones, selectedZoneId, selectZone, editMode, setEditMode, updateVertex, removeVertex,
    corridors, selectedCorridorId, selectCorridor,
    updateCorridorVertex, removeCorridorVertex, insertCorridorVertex,
  } = useZones();
  const map = useMap();

  const corridorModes = mode === 'zones' || mode === 'planning';
  const editing = corridorModes && editMode && (selectedZoneId !== null || selectedCorridorId !== null);

  // Curseur croix pendant l'édition
  useEffect(() => {
    const container = map.getContainer();
    container.style.cursor = editing ? 'crosshair' : '';
    return () => {
      container.style.cursor = '';
    };
  }, [editing, map]);

  return (
    <>
      <MapClickHandler />

      {zones.map(zone => {
        const selected = zone.id === selectedZoneId;
        const isExclusion = zone.type === 'exclusion';

        return (
          <React.Fragment key={zone.id}>
            {zone.points.length >= 3 && (
              <Polygon
                positions={zone.points}
                pathOptions={{
                  color: zone.color,
                  fillOpacity: isExclusion ? 0.25 : selected ? 0.3 : 0.15,
                  weight: selected ? 3 : 2,
                  dashArray: selected ? undefined : '4 6',
                }}
                eventHandlers={
                  mode === 'zones' && !editMode
                    ? {
                        // Hors édition : le clic sélectionne la zone et
                        // démarre son édition. Pendant l'édition, aucun
                        // handler : le clic traverse vers la carte.
                        click: () => {
                          selectZone(zone.id);
                          setEditMode(true);
                        },
                      }
                    : undefined
                }
              >
                <Tooltip sticky>
                  {zone.name}
                  {isExclusion ? ' — exclusion' : ''}
                </Tooltip>
              </Polygon>
            )}

            {/* Aperçu pendant le dessin (moins de 3 sommets) */}
            {zone.points.length === 2 && (
              <Polyline
                positions={zone.points}
                pathOptions={{ color: zone.color, weight: 2, dashArray: '4 6' }}
              />
            )}

            {/* Poignées de sommets : zone sélectionnée, mode zones, édition active */}
            {selected && editing && mode === 'zones' &&
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

      {/* Chemins de liaison (étape 6.6) : polyline bleue, cliquable hors
          édition (sélection + édition) en modes zones et planification,
          poignées et pastilles médianes en édition.
          Invalide (n'entre dans aucune zone / traverse une exclusion) :
          tracé pointillé + warning dans le tooltip. */}
      {corridors.map(corridor => {
        const selected = corridor.id === selectedCorridorId;
        const warnings = corridorWarnings(corridor, zones);
        const invalid = warnings.length > 0;
        return (
          <React.Fragment key={corridor.id}>
            {corridor.points.length >= 2 && (
              <Polyline
                positions={corridor.points}
                pathOptions={{
                  color: CORRIDOR_COLOR,
                  weight: selected ? 5 : 4,
                  opacity: invalid ? 0.6 : 0.9,
                  dashArray: invalid ? '6 6' : undefined,
                }}
                eventHandlers={
                  corridorModes && !editMode
                    ? {
                        click: () => {
                          selectCorridor(corridor.id);
                          setEditMode(true);
                        },
                      }
                    : undefined
                }
              >
                <Tooltip sticky>
                  {corridor.name}
                  {invalid ? ' — invalide : ' + warnings.join(', ') : ' — chemin de liaison'}
                </Tooltip>
              </Polyline>
            )}

            {selected && editing &&
              corridor.points.map((pt, i) => (
                <Marker
                  key={corridor.id + '-' + i}
                  position={pt}
                  icon={vertexIcon(CORRIDOR_COLOR)}
                  draggable
                  eventHandlers={{
                    dragend: e => {
                      const { lat, lng } = (e.target as L.Marker).getLatLng();
                      updateCorridorVertex(i, [lat, lng]);
                    },
                    contextmenu: () => removeCorridorVertex(i),
                  }}
                />
              ))}

            {/* Pastilles médianes : un clic insère un sommet entre deux */}
            {selected && editing &&
              corridor.points.slice(0, -1).map((pt, i) => {
                const next = corridor.points[i + 1];
                const mid: [number, number] = [(pt[0] + next[0]) / 2, (pt[1] + next[1]) / 2];
                return (
                  <Marker
                    key={corridor.id + '-mid-' + i}
                    position={mid}
                    icon={midpointIcon()}
                    eventHandlers={{ click: () => insertCorridorVertex(i + 1, mid) }}
                  />
                );
              })}
          </React.Fragment>
        );
      })}
    </>
  );
};
