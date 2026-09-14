import React, { useState } from 'react';
import { MapContainer, TileLayer, Polygon as LeafletPolygon, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { ZoneEditor } from '../components/maps/ZoneEditor';
import { WorklineGenerator } from '../components/maps/WorklineGenerator';
import { PathPlanner } from '../components/maps/PathPlanner';
import { MapData, Polygon as PolygonType, Workline, Path } from '../types/mapTypes';

const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = defaultIcon;

const initialMapData: MapData = { zones: [], worklines: [], paths: [] };

export const MapView: React.FC = () => {
  const [mapData, setMapData] = useState<MapData>(initialMapData);
  const [selectedZone, setSelectedZone] = useState<PolygonType | null>(null);
  const center: [number, number] = [48.8566, 2.3522];

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapContainer center={center} zoom={15} style={{ width: '100%', height: '100%' }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
        
        {mapData.zones.map((zone) => (
          <LeafletPolygon 
            key={zone.id} 
            positions={zone.points.map(p => [p.lat, p.lng])} 
            color={zone.color || '#4CAF50'} 
            fillOpacity={0.5} 
            weight={2}
            eventHandlers={{
              click: () => setSelectedZone(zone)
            }}
          />
        ))}
        
        {mapData.worklines.map((workline: Workline) => (
          <Polyline 
            key={workline.id} 
            positions={workline.points.map(p => [p.lat, p.lng])} 
            color="#FF5733" 
            weight={2} 
          />
        ))}
        
        {mapData.paths.map((path: Path) => (
          <Polyline 
            key={path.id} 
            positions={path.points.map(p => [p.lat, p.lng])} 
            color="#2196F3" 
            weight={3} 
            dashArray="5, 5"
          />
        ))}
        
        <ZoneEditor mapData={mapData} setMapData={setMapData} />
      </MapContainer>
      
      <div style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        zIndex: 1000,
        background: 'white',
        padding: '16px',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        minWidth: '280px',
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '16px' }}>AgriRobot - Éditeur</h3>
        <WorklineGenerator selectedZone={selectedZone} mapData={mapData} setMapData={setMapData} />
        <PathPlanner zones={mapData.zones} mapData={mapData} setMapData={setMapData} />
        <div style={{ marginTop: '16px', textAlign: 'center' }}>
          <button 
            onClick={() => { setMapData(initialMapData); setSelectedZone(null); }} 
            style={{
              padding: '8px 16px',
              background: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Tout effacer
          </button>
        </div>
      </div>
    </div>
  );
};

export default MapView;
