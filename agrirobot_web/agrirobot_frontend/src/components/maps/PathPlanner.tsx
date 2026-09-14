import React from 'react';
import { Polygon, MapData } from '../../types/mapTypes';
import { findPathBetweenZones } from '../../utils/pathfinding';

interface PathPlannerProps {
  zones: Polygon[];
  mapData: MapData;
  setMapData: React.Dispatch<React.SetStateAction<MapData>>;
}

export const PathPlanner: React.FC<PathPlannerProps> = ({
  zones,
  mapData,
  setMapData,
}) => {
  const [selectedFrom, setSelectedFrom] = React.useState<string>('');
  const [selectedTo, setSelectedTo] = React.useState<string>('');

  const calculatePath = () => {
    if (!selectedFrom || !selectedTo) return;
    const fromZone = zones.find(z => z.id === selectedFrom);
    const toZone = zones.find(z => z.id === selectedTo);
    if (!fromZone || !toZone) return;
    const obstacles = zones.filter(z => z.id !== fromZone.id && z.id !== toZone.id);
    const path = findPathBetweenZones(fromZone, toZone, obstacles);
    setMapData(prev => ({ ...prev, paths: [...prev.paths, path] }));
  };

  return (
    <div style={{ marginTop: '20px', padding: '16px', background: '#f5f5f5', borderRadius: '8px' }}>
      <h3 style={{ marginTop: 0 }}>Planificateur de trajets</h3>
      <div style={{ marginBottom: '16px' }}>
        <label>
          Zone de départ:
          <select value={selectedFrom} onChange={(e) => setSelectedFrom(e.target.value)} style={{ marginLeft: '8px', padding: '4px', minWidth: '150px' }}>
            <option value="">-- Sélectionner --</option>
            {zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
          </select>
        </label>
      </div>
      <div style={{ marginBottom: '16px' }}>
        <label>
          Zone d'arrivée:
          <select value={selectedTo} onChange={(e) => setSelectedTo(e.target.value)} style={{ marginLeft: '8px', padding: '4px', minWidth: '150px' }}>
            <option value="">-- Sélectionner --</option>
            {zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
          </select>
        </label>
      </div>
      <button onClick={calculatePath} disabled={!selectedFrom || !selectedTo} style={{ padding: '8px 16px', background: selectedFrom && selectedTo ? '#2196F3' : '#cccc', color: 'white', border: 'none', borderRadius: '4px', cursor: selectedFrom && selectedTo ? 'pointer' : 'not-allowed' }}>
        Calculer le trajet
      </button>
    </div>
  );
};
