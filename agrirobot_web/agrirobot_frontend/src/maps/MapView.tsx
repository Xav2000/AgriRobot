import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import ROSLIB from 'roslib';
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

interface MapViewProps {
  onRosConnect?: (connected: boolean) => void;
}

const MapView: React.FC<MapViewProps> = ({ onRosConnect }) => {
  const [robotPosition, setRobotPosition] = useState<[number, number] | null>(null);
  const [ros, setRos] = useState<ROSLIB.Ros | null>(null);
  const [zones, setZones] = useState<any[]>([]);

  // Coordonnées par défaut (à remplacer par tes données)
  const defaultPosition: [number, number] = [48.8566, 2.3522]; // Paris

  useEffect(() => {
    // Connexion à rosbridge
    const ros = new ROSLIB.Ros({
      url: 'ws://localhost:9090'
    });

    setRos(ros);

    ros.on('connection', () => {
      console.log('Connected to ROS bridge');
      onRosConnect?.(true);
    });

    ros.on('error', (error) => {
      console.error('ROS bridge error:', error);
      onRosConnect?.(false);
    });

    ros.on('close', () => {
      console.log('ROS bridge closed');
      onRosConnect?.(false);
    });

    // Écouter le topic /robot/position
    const positionTopic = new ROSLIB.Topic({
      ros: ros,
      name: '/robot/position',
      messageType: 'geometry_msgs/PoseStamped'
    });

    positionTopic.subscribe((msg: any) => {
      // Convertir les coordonnées ROS (mètres) en lat/long
      // Pour l'instant, on utilise des coordonnées simulées
      // À adapter avec ta propre conversion si nécessaire
      setRobotPosition([defaultPosition[0] + msg.pose.position.y * 0.00001, 
                        defaultPosition[1] + msg.pose.position.x * 0.00001]);
    });

    return () => {
      positionTopic.unsubscribe();
      ros.close();
    };
  }, [onRosConnect]);

  // Fonction pour ajouter une zone (à implémenter)
  const handleAddZone = () => {
    // Logique pour ajouter une zone sur la carte
    console.log('Ajouter une zone');
  };

  return (
    <>
      <MapContainer
        center={defaultPosition}
        zoom={18}
        style={{ height: '100%', width: '100%', minHeight: '600px' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        
        {/* Afficher la position du robot */}
        {robotPosition && (
          <Marker position={robotPosition}>
            <Popup>
              <strong>Robot Agricole</strong><br />
              Position: {robotPosition[0].toFixed(6)}, {robotPosition[1].toFixed(6)}
            </Popup>
          </Marker>
        )}

        {/* Afficher les zones (à implémenter) */}
        {zones.map((zone, index) => (
          <React.Fragment key={index}>
            {/* Ici on ajoutera les polygones pour les zones */}
          </React.Fragment>
        ))}

        {/* Bouton pour ajouter une zone */}
        <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000 }}>
          <button 
            onClick={handleAddZone}
            style={{ 
              padding: '10px', 
              background: 'white',
              border: '1px solid #ccc',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            + Ajouter une zone
          </button>
        </div>
      </MapContainer>
    </>
  );
};

export default MapView;
