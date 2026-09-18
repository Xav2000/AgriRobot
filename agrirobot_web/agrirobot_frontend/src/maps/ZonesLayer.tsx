import React, { useEffect, useState } from 'react';
import { Polygon, Polyline, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useZones, CORRIDOR_COLOR, Zone } from '../context/ZonesContext';
import { useWorklines } from '../context/WorklinesContext';
import { corridorWarnings } from '../lib/corridors';
import { useUiMode } from '../context/UiModeContext';

/** Distance d'aimantation (px écran) : en dessous, un point de chemin de
 *  liaison se colle au portail (point d'entrée) de la zone proche. */
const SNAP_PX = 20;

/** Modes dans lesquels les chemins de liaison sont dessinables/éditables. */
const CORRIDOR_MODES = ['zones', 'planning', 'corridors'];

/** Aimante le point sur le portail d'une zone s'il est assez proche. */
const snapToPortail = (
  map: L.Map,
  pt: [number, number],
  zones: Zone[],
  zoneEntryPoints: Record<string, [number, number]>
): [number, number] => {
  const c = map.latLngToContainerPoint(pt);
  let best: [number, number] | null = null;
  let bestPx = SNAP_PX;
  for (const z of zones) {
    if (z.type !== 'mow') continue;
    const ep = zoneEntryPoints[z.id];
    if (!ep) continue;
    const px = map.latLngToContainerPoint(ep).distanceTo(c);
    if (px < bestPx) { bestPx = px; best = ep; }
  }
  return best ?? pt;
};

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

/** Pastille médiane translucide entre deux sommets (chemin de liaison
 *  ou contour de zone) : un clic insère un nouveau sommet à cet endroit. */
const midpointIcon = (color: string = CORRIDOR_COLOR) =>
  L.divIcon({
    className: 'zone-vertex',
    html:
      '<div style="width:10px;height:10px;border-radius:50%;background:' + color +
      ';opacity:0.45;border:1px solid #fff"></div>',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });

/**
 * Clic sur la carte (seulement si le mode AJOUT est actif dans la
 * toolbar — désactivé à l'édition d'un objet existant, pour ne pas
 * créer des sommets parasites à côté de ceux qu'on déplace) :
 * - chemin de liaison sélectionné (modes zones, planification et
 *   chemins, édition active) : prolonge le tracé, avec aimantation sur
 *   le portail d'une zone si le clic est proche ;
 * - zone sélectionnée (mode zones, édition active) : ajoute un sommet.
 * Pendant l'édition, les clics sur les polygones existants traversent
 * (aucune sélection détournée) — on peut ainsi dessiner une exclusion à
 * l'intérieur d'une zone de tonte.
 */
const MapClickHandler: React.FC = () => {
  const { mode } = useUiMode();
  const {
    editMode, addMode, selectedZoneId, appendPoint, zones,
    selectedCorridorId, appendCorridorPoint,
  } = useZones();
  const { zoneEntryPoints } = useWorklines();
  const map = useMap();

  useMapEvents({
    click(e) {
      if (!editMode || !addMode) return;
      if (selectedCorridorId && CORRIDOR_MODES.includes(mode)) {
        appendCorridorPoint(
          snapToPortail(map, [e.latlng.lat, e.latlng.lng], zones, zoneEntryPoints));
      } else if (selectedZoneId && mode === 'zones') {
        appendPoint([e.latlng.lat, e.latlng.lng]);
      }
    },
  });

  return null;
};

/**
 * Élastique de tracé : pendant le dessin d'un chemin (sélectionné,
 * édition active, au moins un point posé), une ligne pointillée relie
 * le dernier sommet au curseur — le tracé se voit se construire dans
 * N'IMPORTE QUEL sens, premier point dedans ou dehors. L'aimantation
 * y est appliquée en temps réel : on voit le point se coller au
 * portail avant de cliquer.
 */
const CorridorRubberBand: React.FC = () => {
  const { mode } = useUiMode();
  const { zones, corridors, selectedCorridorId, editMode, addMode } = useZones();
  const { zoneEntryPoints } = useWorklines();
  const map = useMap();
  const [cursor, setCursor] = useState<[number, number] | null>(null);

  const corridor = corridors.find(c => c.id === selectedCorridorId) ?? null;
  const drawing = editMode && addMode && corridor !== null && corridor.points.length >= 1
    && CORRIDOR_MODES.includes(mode);

  useMapEvents({
    mousemove(e) {
      if (!drawing) return;
      setCursor(
        snapToPortail(map, [e.latlng.lat, e.latlng.lng], zones, zoneEntryPoints));
    },
    mouseout() {
      setCursor(null);
    },
  });

  if (!drawing || !cursor || !corridor) return null;
  const last = corridor.points[corridor.points.length - 1];
  return (
    <Polyline
      positions={[last, cursor]}
      pathOptions={{ color: CORRIDOR_COLOR, weight: 3, opacity: 0.7, dashArray: '8 6' }}
    />
  );
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
 * - chemins de liaison : sélection/édition en modes zones, planification
 *   et chemins, élastique de tracé, pastilles médianes cliquables pour
 *   insérer un sommet, aimantation des points sur les portails
 * - curseur croix pendant l'édition
 */
export const ZonesLayer: React.FC = () => {
  const { mode } = useUiMode();
  const {
    zones, selectedZoneId, selectZone, editMode, setEditMode, setAddMode, updateVertex, removeVertex,
    corridors, selectedCorridorId, selectCorridor,
    updateCorridorVertex, removeCorridorVertex, insertCorridorVertex,
    insertVertex,
  } = useZones();
  const { zoneEntryPoints } = useWorklines();
  const map = useMap();

  const corridorModes = CORRIDOR_MODES.includes(mode);
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
      <CorridorRubberBand />

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
                          setAddMode(false);
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

            {/* Pastilles médianes : un clic insère un sommet entre deux
                sommets du contour (y compris entre le dernier et le
                premier : le polygone est fermé) */}
            {selected && editing && mode === 'zones' && zone.points.length >= 3 &&
              zone.points.map((pt, i) => {
                const next = zone.points[(i + 1) % zone.points.length];
                const mid: [number, number] = [(pt[0] + next[0]) / 2, (pt[1] + next[1]) / 2];
                return (
                  <Marker
                    key={zone.id + '-mid-' + i}
                    position={mid}
                    icon={midpointIcon(zone.color)}
                    eventHandlers={{ click: () => insertVertex(i + 1, mid) }}
                  />
                );
              })}
          </React.Fragment>
        );
      })}

      {/* Chemins de liaison (étape 6.6) : polyline bleue, cliquable hors
          édition (sélection + édition) en modes zones, planification et
          chemins, poignées et pastilles médianes en édition, élastique de
          tracé, aimantation des points sur les portails des zones.
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
                          setAddMode(false);
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
                      updateCorridorVertex(i, snapToPortail(map, [lat, lng], zones, zoneEntryPoints));
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
                    eventHandlers={{ click: () => insertCorridorVertex(i + 1, snapToPortail(map, mid, zones, zoneEntryPoints)) }}
                  />
                );
              })}
          </React.Fragment>
        );
      })}
    </>
  );
};
