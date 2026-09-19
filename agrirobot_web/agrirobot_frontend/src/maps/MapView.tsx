import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import ROSLIB from 'roslib';
import { useRos } from '../hooks/useRos';
import { MissionLayer } from './MissionLayer';
import { ZonesLayer } from './ZonesLayer';
import { WorklinesLayer } from './WorklinesLayer';
import { GraphLayer } from './GraphLayer';
import { StationLayer } from './StationLayer';
import 'leaflet/dist/leaflet.css';

// Fix pour les icônes Leaflet (nécessaire avec Webpack)
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

L.Marker.prototype.options.icon = defaultIcon;

// Force Leaflet à recalculer sa taille après montage
const ResizeFix: React.FC = () => {
  const map = useMap();
  useEffect(() => {
    const t1 = setTimeout(() => map.invalidateSize(), 50);
    const t2 = setTimeout(() => map.invalidateSize(), 200);
    const t3 = setTimeout(() => map.invalidateSize(), 500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [map]);
  return null;
};

/**
 * Zoom max 23 pour pouvoir inspecter des lignes de guidage à faible
 * écartement. Au-delà du zoom natif des tuiles (19), Leaflet agrandit la
 * dernière tuile disponible (maxNativeZoom) : le fond devient flou mais
 * les tracés vectoriels (zones, lignes, parcours) restent nets.
 * Deux fonds de carte : imagerie satellite Esri (défaut) et plan OSM.
 * L'orthophoto IGN française (meilleure résolution) nécessite une clé
 * API Géoportail — option à venir.
 */
const MapView: React.FC = () => {
  const { ros, connectionState } = useRos();
  const [robotPosition, setRobotPosition] = useState<[number, number] | null>(null);

  const defaultPosition: [number, number] = [48.8566, 2.3522]; // Paris

  useEffect(() => {
    if (!ros || connectionState !== 'connected') return;

    const positionTopic = new ROSLIB.Topic({
      ros: ros,
      name: '/robot/position',
      messageType: 'geometry_msgs/PoseStamped'
    });

    positionTopic.subscribe((msg: any) => {
      setRobotPosition([
        defaultPosition[0] + msg.pose.position.y * 0.00001,
        defaultPosition[1] + msg.pose.position.x * 0.00001
      ]);
    });

    return () => {
      positionTopic.unsubscribe();
    };
  }, [ros, connectionState]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MapContainer
      center={defaultPosition}
      zoom={18}
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
      {/* Zones (polygones) + édition des sommets */}
      <ZonesLayer />
      {/* Paramètres des lignes de guidage (mode worklines) */}
      <WorklinesLayer />
      {/* Jonctions automatiques du graphe de circulation (étape 6.7) */}
      <GraphLayer />
      {/* Station de recharge (étape 6.8) */}
      <StationLayer />
      {/* Parcours de la mission + progression des tâches */}
      <MissionLayer />
      {robotPosition && (
        <Marker position={robotPosition}>
          <Popup>
            <strong>Robot Agricole</strong><br />
            Position: {robotPosition[0].toFixed(6)}, {robotPosition[1].toFixed(6)}
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
};

export default MapView;
