import React from 'react';
import { Polygon, Workline, MapData } from '../../types/mapTypes';
import { generateParallelWorklines, generateSpiralWorklines } from '../../utils/coverage';

interface WorklineGeneratorProps {
  selectedZone: Polygon | null;
  mapData: MapData;
  setMapData: React.Dispatch<React.SetStateAction<MapData>>;
}

export const WorklineGenerator: React.FC<WorklineGeneratorProps> = ({
  selectedZone,
  mapData,
  setMapData,
}) => {
  const [patternType, setPatternType] = React.useState<'parallel' | 'spiral'>('parallel');
  const [spacing, setSpacing] = React.useState<number>(1.0);
  const [angle, setAngle] = React.useState<number>(0);

  const generateWorklines = () => {
    if (!selectedZone) return;

    let worklines: Workline[] = [];
    switch (patternType) {
      case 'parallel':
        worklines = generateParallelWorklines(selectedZone, spacing, angle);
        break;
      case 'spiral':
        worklines = generateSpiralWorklines(selectedZone, spacing);
        break;
    }

    setMapData(prev => ({
      ...prev,
      worklines: [...prev.worklines, ...worklines],
    }));
  };

  return (
    <div style={{ padding: '16px', background: 'white', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.2)' }}>
      <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Générateur de lignes</h3>
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input type="radio" checked={patternType === 'parallel'} onChange={() => setPatternType('parallel')} />
          Lignes parallèles
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '16px' }}>
          <input type="radio" checked={patternType === 'spiral'} onChange={() => setPatternType('spiral')} />
          Spirale
        </label>
      </div>
      {patternType === 'parallel' && (
        <>
          <div style={{ marginBottom: '16px' }}>
            <label>
              Espacement (m):
              <input type="number" value={spacing} onChange={(e) => setSpacing(parseFloat(e.target.value) || 1.0)} step="0.1" min="0.1" style={{ marginLeft: '8px', padding: '4px', width: '80px' }} />
            </label>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label>
              Angle (°):
              <input type="number" value={angle} onChange={(e) => setAngle(parseFloat(e.target.value) || 0)} step="1" min="0" max="360" style={{ marginLeft: '8px', padding: '4px', width: '80px' }} />
            </label>
          </div>
        </>
      )}
      {patternType === 'spiral' && (
        <div style={{ marginBottom: '16px' }}>
          <label>
            Espacement (m):
            <input type="number" value={spacing} onChange={(e) => setSpacing(parseFloat(e.target.value) || 1.0)} step="0.1" min="0.1" style={{ marginLeft: '8px', padding: '4px', width: '80px' }} />
          </label>
        </div>
      )}
      <button onClick={generateWorklines} disabled={!selectedZone} style={{ padding: '8px 16px', background: selectedZone ? '#4CAF50' : '#cccc', color: 'white', border: 'none', borderRadius: '4px', cursor: selectedZone ? 'pointer' : 'not-allowed' }}>
        Générer les lignes
      </button>
    </div>
  );
};
