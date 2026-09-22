import React from 'react';
import { MapContainer, Marker, Popup, useMap, LayersControl, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import { useNav2Status, xyToLatLng } from '../hooks/useNav2Status';
import CoverageLayer from './CoverageLayer';
import { ZonesLayer } from './ZonesLayer';
import { WorklinesLayer } from './WorklinesLayer';
import { GraphLayer } from './GraphLayer';
import { StationLayer } from './StationLayer';
import 'leaflet/dist/leaflet.css';

// Force Leaflet a recalculer sa taille apres montage
const ResizeFix: React.FC = () => {
  const map = useMap();
  React.useEffect(() => {
    const t1 = setTimeout(() => map.invalidateSize(), 50);
    const t2 = setTimeout(() => map.invalidateSize(), 200);
    const t3 = setTimeout(() => map.invalidateSize(), 500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [map]);
  return null;
};

/** Fleche orientee selon le cap du robot (triangle bleu, pointe = avant). */
function robotIcon(yawDeg: number) {
  const html = [
    '<div style="width:28px;height:28px;transform:rotate(' + (90 - yawDeg) + 'deg);',
    'transform-origin:center;display:flex;align-items:center;justify-content:center;">',
    '<svg width="28" height="28" viewBox="0 0 28 28">',
    '<circle cx="14" cy="14" r="9" fill="#1976D2" fill-opacity="0.25" stroke="#1976D2" stroke-width="2"/>',
    '<polygon points="14,3 18,14 14,11 10,14" fill="#1976D2"/>',
    '</svg></div>',
  ].join('');
  return L.divIcon({
    className: 'robot-arrow',
    html,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/**
 * Banc feat/nav2-f2c : le robot vient de /odom (metres, repere local
 * origine 48.8566/2.3522), le plan de couverture de /coverage/plan.
 * Zoom max 23 (au-dela des tuiles natives 19, le vectoriel reste net).
 */
const MapView: React.FC = () => {
  const { pose, mission } = useNav2Status();
  const robotPosition = pose ? xyToLatLng(pose.x, pose.y) : null;
  const yawDeg = pose ? (pose.yaw * 180) / Math.PI : 0;

  const defaultPosition: [number, number] = [48.8566, 2.3522]; // Paris

  let popupText = 'Robot Agricole';
  if (robotPosition) {
    popupText = 'Robot Agricole — ' +
      robotPosition[0].toFixed(6) + ', ' + robotPosition[1].toFixed(6);
  }
  if (mission) {
    popupText = 'Robot Agricole — Mission ' + mission.status + ' : ' +
      String(mission.completedWaypoints) + '/' +
      String(mission.totalWaypoints) + ' waypoints';
  }

  return (
    <MapContainer
      center={defaultPosition}
      zoom={19}
      maxZoom={23}
      style={{ position: 'absolute', inset: 0 }}
    >
      <ResizeFix />
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Satellite">
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Imagerie &copy; Esri, Maxar, Earthstar Geographics"
            maxNativeZoom={19}
            maxZoom={23}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Plan (OSM)">
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxNativeZoom={19}
            maxZoom={23}
          />
        </LayersControl.BaseLayer>
      </LayersControl>
      {/* Zones (polygones) + edition des sommets */}
      <ZonesLayer />
      {/* Parametres des lignes de guidage (mode worklines) */}
      <WorklinesLayer />
      {/* Jonctions automatiques du graphe de circulation (etape 6.7) */}
      <GraphLayer />
      {/* Station de recharge (etape 6.8) */}
      <StationLayer />
      {/* Plan de couverture F2C + progression (banc nav2-f2c) */}
      <CoverageLayer />
      {robotPosition && (
        <Marker position={robotPosition} icon={robotIcon(yawDeg)}>
          <Popup>{popupText}</Popup>
        </Marker>
      )}
    </MapContainer>
  );
};

export default MapView;