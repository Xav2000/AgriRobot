import React, { useMemo } from 'react';
import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { useZones } from '../context/ZonesContext';
import { useUiMode } from '../context/UiModeContext';
import { CORRIDOR_MODES } from './ZonesLayer';
import { buildCorridorGraph } from '../lib/graph';

/** Pastille de jonction : petit point blanc à liseré sombre — distinct
 *  des poignées (couleur du chemin), des pastilles médianes
 *  (translucides) et des portails (bleu foncé). */
const junctionIcon = L.divIcon({
  className: 'zone-vertex',
  html:
    '<div style="width:9px;height:9px;border-radius:50%;background:#fff' +
    ';border:2px solid #37474F;opacity:0.9"></div>',
  iconSize: [9, 9],
  iconAnchor: [4.5, 4.5],
});

/**
 * Couche du graphe de circulation (étape 6.7) : affiche les JONCTIONS
 * automatiques du réseau de chemins de liaison, pour validation
 * visuelle — croisements de segments, extrémités à moins de 1 m
 * fusionnées, extrémité raccrochée à un segment voisin (jonction en
 * T). Seuls les nœuds d'au moins 3 arêtes sont affichés (vrais
 * carrefours) : les extrémités libres et les simples coudes restent
 * discrets. La navigation (plus court chemin, Dijkstra) est déjà
 * prête dans src/lib/graph.ts et servira à la station (6.8) et aux
 * retours d'urgence (6.10).
 *
 * interactive={false} : un Marker Leaflet AVALE le clic — les jonctions
 * ne doivent pas intercepter l'édition des chemins.
 */
export const GraphLayer: React.FC = () => {
  const { mode } = useUiMode();
  const { corridors } = useZones();
  const graph = useMemo(() => buildCorridorGraph(corridors), [corridors]);

  if (!CORRIDOR_MODES.includes(mode)) return null;

  return (
    <>
      {graph.nodes.map((p, i) =>
        graph.degree[i] >= 3 ? (
          <Marker key={'junction-' + i} position={p} icon={junctionIcon} interactive={false} />
        ) : null
      )}
    </>
  );
};
