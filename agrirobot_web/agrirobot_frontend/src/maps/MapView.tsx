import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import ROSLIB from 'roslib';
import { useRos } from '../hooks/useRos';
import { MissionLayer } from './MissionLayer';
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
      style={{ position: 'absolute', inset: 0 }}
    >
      <ResizeFix />
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
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
