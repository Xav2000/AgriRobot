import React, { createContext, useCallback, useContext, useState } from 'react';

export type ZoneType = 'mow' | 'exclusion';

export interface Zone {
  id: string;
  name: string;
  type: ZoneType;
  color: string;
  /** Sommets [lat, lng] dans l'ordre du contour */
  points: [number, number][];
}

/** Palette des zones de tonte (le rouge est réservé aux exclusions). */
const MOW_PALETTE = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#00BCD4'];
const EXCLUSION_COLOR = '#f44336';

interface ZonesContextValue {
  zones: Zone[];
  selectedZoneId: string | null;
  drawMode: boolean;
  setDrawMode: (v: boolean) => void;
  selectZone: (id: string | null) => void;
  addZone: (type?: ZoneType) => void;
  renameZone: (id: string, name: string) => void;
  deleteZone: (id: string) => void;
  appendPoint: (point: [number, number]) => void;
  popPoint: () => void;
  removeVertex: (index: number) => void;
  updateVertex: (index: number, point: [number, number]) => void;
}

const ZonesContext = createContext<ZonesContextValue | null>(null);

/**
 * État des zones (polygones), partagé entre la sidebar Zones, la couche
 * carte et la toolbar d'édition. Deux types :
 * - 'mow' : zone de tonte/travail (palette de couleurs)
 * - 'exclusion' : obstacle / non-tonte (rouge) — les lignes de guidage
 *   générées ne devront jamais la traverser.
 * Persistance (JSON hors navigateur) à venir.
 */
export const ZonesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState(false);

  const addZone = useCallback((type: ZoneType = 'mow') => {
    const mowCount = zones.filter(z => z.type === 'mow').length;
    const exclusionCount = zones.filter(z => z.type === 'exclusion').length;
    const zone: Zone = {
      id: 'zone-' + Date.now(),
      name: type === 'mow'
        ? 'Zone ' + (mowCount + 1)
        : 'Exclusion ' + (exclusionCount + 1),
      type,
      color: type === 'exclusion' ? EXCLUSION_COLOR : MOW_PALETTE[mowCount % MOW_PALETTE.length],
      points: [],
    };
    setZones(prev => [...prev, zone]);
    setSelectedZoneId(zone.id);
    setDrawMode(true);
  }, [zones]);

  const selectZone = useCallback((id: string | null) => {
    setSelectedZoneId(id);
  }, []);

  const renameZone = useCallback((id: string, name: string) => {
    setZones(prev => prev.map(z => (z.id === id ? { ...z, name } : z)));
  }, []);

  const deleteZone = useCallback((id: string) => {
    setZones(prev => prev.filter(z => z.id !== id));
    setSelectedZoneId(sel => (sel === id ? null : sel));
  }, []);

  const appendPoint = useCallback((point: [number, number]) => {
    if (!selectedZoneId) return;
    setZones(prev =>
      prev.map(z => (z.id === selectedZoneId ? { ...z, points: [...z.points, point] } : z))
    );
  }, [selectedZoneId]);

  const popPoint = useCallback(() => {
    if (!selectedZoneId) return;
    setZones(prev =>
      prev.map(z => (z.id === selectedZoneId ? { ...z, points: z.points.slice(0, -1) } : z))
    );
  }, [selectedZoneId]);

  const removeVertex = useCallback((index: number) => {
    if (!selectedZoneId) return;
    setZones(prev =>
      prev.map(z =>
        z.id === selectedZoneId
          ? { ...z, points: z.points.filter((_, i) => i !== index) }
          : z
      )
    );
  }, [selectedZoneId]);

  const updateVertex = useCallback((index: number, point: [number, number]) => {
    if (!selectedZoneId) return;
    setZones(prev =>
      prev.map(z =>
        z.id === selectedZoneId
          ? { ...z, points: z.points.map((p, i) => (i === index ? point : p)) }
          : z
      )
    );
  }, [selectedZoneId]);

  const value: ZonesContextValue = {
    zones,
    selectedZoneId,
    drawMode,
    setDrawMode,
    selectZone,
    addZone,
    renameZone,
    deleteZone,
    appendPoint,
    popPoint,
    removeVertex,
    updateVertex,
  };

  return <ZonesContext.Provider value={value}>{children}</ZonesContext.Provider>;
};

export function useZones(): ZonesContextValue {
  const ctx = useContext(ZonesContext);
  if (!ctx) {
    throw new Error("useZones doit être utilisé à l'intérieur d'un ZonesProvider");
  }
  return ctx;
}
