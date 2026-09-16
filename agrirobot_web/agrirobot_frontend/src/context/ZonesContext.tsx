import React, { createContext, useCallback, useContext, useState } from 'react';

export interface Zone {
  id: string;
  name: string;
  color: string;
  /** Sommets [lat, lng] dans l'ordre du contour */
  points: [number, number][];
}

const PALETTE = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336', '#00BCD4'];

interface ZonesContextValue {
  zones: Zone[];
  selectedZoneId: string | null;
  drawMode: boolean;
  setDrawMode: (v: boolean) => void;
  selectZone: (id: string | null) => void;
  addZone: () => void;
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
 * carte et la toolbar d'édition. Persistance (JSON côté ROS) à venir.
 */
export const ZonesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState(false);

  const addZone = useCallback(() => {
    const zone: Zone = {
      id: 'zone-' + Date.now(),
      name: 'Zone ' + (zones.length + 1),
      color: PALETTE[zones.length % PALETTE.length],
      points: [],
    };
    setZones(prev => [...prev, zone]);
    setSelectedZoneId(zone.id);
    setDrawMode(true);
  }, [zones.length]);

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
