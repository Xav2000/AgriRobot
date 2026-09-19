import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { loadSlice, saveSlice } from '../lib/storage';

export type ZoneType = 'mow' | 'exclusion';

export interface Zone {
  id: string;
  name: string;
  type: ZoneType;
  color: string;
  /** Sommets [lat, lng] dans l'ordre du contour */
  points: [number, number][];
}

/**
 * Chemin de liaison (etape 6.6) : polyline ouverte dessinee par
 * l'operateur, reliant la station (a venir) et/ou les zones de tonte.
 * Seul chemin autorise pour sortir d'un polygone. Les jonctions entre
 * chemins seront automatiques (graphe, etape 6.7).
 */
export interface Corridor {
  id: string;
  name: string;
  /** Points [lat, lng] dans l'ordre du tracé */
  points: [number, number][];
}

/** Couleur des chemins de liaison sur la carte. */
export const CORRIDOR_COLOR = '#2196F3';

/** Palette des zones de tonte (le rouge est réservé aux exclusions). */
const MOW_PALETTE = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#00BCD4'];
const EXCLUSION_COLOR = '#f44336';

interface ZonesContextValue {
  zones: Zone[];
  selectedZoneId: string | null;
  /**
   * Édition des polygones : poignées visibles sur la zone sélectionnée et
   * clic carte = ajout d'un sommet. Inactive par défaut (carte propre) ;
   * activée automatiquement à la création d'une zone, via la liste ou en
   * cliquant un polygone quand l'édition est off. Pendant l'édition, les
   * clics sur les autres polygones traversent (pas de détournement de la
   * sélection) — indispensable pour dessiner une exclusion dans une zone.
   */
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  /**
   * Ajout de points au clic carte : activé automatiquement à la CRÉATION
   * d'une zone ou d'un chemin (on enchaîne les clics de tracé),
   * désactivé à l'édition d'un objet existant (déplacement des poignées
   * sans créer de sommets parasites à côté — choix utilisateur).
   * Bascule via le bouton dédié de la toolbar.
   */
  addMode: boolean;
  setAddMode: (v: boolean) => void;
  selectZone: (id: string | null) => void;
  addZone: (type?: ZoneType) => void;
  renameZone: (id: string, name: string) => void;
  deleteZone: (id: string) => void;
  appendPoint: (point: [number, number]) => void;
  popPoint: () => void;
  removeVertex: (index: number) => void;
  updateVertex: (index: number, point: [number, number]) => void;
  /** Insère un sommet à l'index donné (point médian cliqué) */
  insertVertex: (index: number, point: [number, number]) => void;
  /** Chemins de liaison (étape 6.6) — édition depuis la planification */
  corridors: Corridor[];
  selectedCorridorId: string | null;
  selectCorridor: (id: string | null) => void;
  addCorridor: () => void;
  renameCorridor: (id: string, name: string) => void;
  deleteCorridor: (id: string) => void;
  appendCorridorPoint: (point: [number, number]) => void;
  popCorridorPoint: () => void;
  removeCorridorVertex: (index: number) => void;
  updateCorridorVertex: (index: number, point: [number, number]) => void;
  /** Insère un sommet à l'index donné (point médian cliqué) */
  insertCorridorVertex: (index: number, point: [number, number]) => void;
  /** Import d'une sauvegarde (refonte R1) : remplace zones et chemins */
  importAll: (zones: Zone[], corridors: Corridor[]) => void;
}

const ZonesContext = createContext<ZonesContextValue | null>(null);

/**
 * État des zones (polygones), partagé entre la sidebar Zones, la couche
 * carte et la toolbar d'édition. Deux types :
 * - 'mow' : zone de tonte/travail (palette, listée dans la sidebar)
 * - 'exclusion' : obstacle / non-tonte (rouge, NON listée dans la sidebar —
 *   édition par clic sur la carte) — les lignes de guidage générées ne
 *   devront jamais la traverser.
 * Persistance (refonte R1) : localStorage automatique + export/import
 * d'un document JSON complet.
 */
export const ZonesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [zones, setZones] = useState<Zone[]>(() => loadSlice<Zone[]>('zones', []));
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [corridors, setCorridors] = useState<Corridor[]>(() => loadSlice<Corridor[]>('corridors', []));
  const [selectedCorridorId, setSelectedCorridorId] = useState<string | null>(null);

  // Sauvegarde automatique (refonte R1) : le frontend est la source de
  // vérité, zones et chemins survivent au rechargement de la page.
  useEffect(() => { saveSlice('zones', zones); }, [zones]);
  useEffect(() => { saveSlice('corridors', corridors); }, [corridors]);

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
    // La création démarre directement l'édition de la nouvelle zone,
    // en mode ajout de sommets (on enchaîne les clics de tracé).
    setEditMode(true);
    setAddMode(true);
  }, [zones]);

  const selectZone = useCallback((id: string | null) => {
    setSelectedZoneId(id);
    // Zone et chemin de liaison : sélections exclusives
    if (id !== null) setSelectedCorridorId(null);
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

  const insertVertex = useCallback((index: number, point: [number, number]) => {
    if (!selectedZoneId) return;
    setZones(prev =>
      prev.map(z => {
        if (z.id !== selectedZoneId) return z;
        const points = [...z.points];
        points.splice(index, 0, point);
        return { ...z, points };
      })
    );
  }, [selectedZoneId]);

  // ---- Chemins de liaison : même mécanique que les zones (polyline ouverte) ----

  const addCorridor = useCallback(() => {
    const corridor: Corridor = {
      id: 'corridor-' + Date.now(),
      name: 'Chemin ' + (corridors.length + 1),
      points: [],
    };
    setCorridors(prev => [...prev, corridor]);
    setSelectedCorridorId(corridor.id);
    setSelectedZoneId(null);
    setEditMode(true);
    setAddMode(true);
  }, [corridors]);

  const renameCorridor = useCallback((id: string, name: string) => {
    setCorridors(prev => prev.map(c => (c.id === id ? { ...c, name } : c)));
  }, []);

  const deleteCorridor = useCallback((id: string) => {
    setCorridors(prev => prev.filter(c => c.id !== id));
    setSelectedCorridorId(sel => (sel === id ? null : sel));
  }, []);

  const appendCorridorPoint = useCallback((point: [number, number]) => {
    if (!selectedCorridorId) return;
    setCorridors(prev =>
      prev.map(c => (c.id === selectedCorridorId ? { ...c, points: [...c.points, point] } : c))
    );
  }, [selectedCorridorId]);

  const popCorridorPoint = useCallback(() => {
    if (!selectedCorridorId) return;
    setCorridors(prev =>
      prev.map(c => (c.id === selectedCorridorId ? { ...c, points: c.points.slice(0, -1) } : c))
    );
  }, [selectedCorridorId]);

  const removeCorridorVertex = useCallback((index: number) => {
    if (!selectedCorridorId) return;
    setCorridors(prev =>
      prev.map(c =>
        c.id === selectedCorridorId
          ? { ...c, points: c.points.filter((_, i) => i !== index) }
          : c
      )
    );
  }, [selectedCorridorId]);

  const updateCorridorVertex = useCallback((index: number, point: [number, number]) => {
    if (!selectedCorridorId) return;
    setCorridors(prev =>
      prev.map(c =>
        c.id === selectedCorridorId
          ? { ...c, points: c.points.map((p, i) => (i === index ? point : p)) }
          : c
      )
    );
  }, [selectedCorridorId]);

  const insertCorridorVertex = useCallback((index: number, point: [number, number]) => {
    if (!selectedCorridorId) return;
    setCorridors(prev =>
      prev.map(c => {
        if (c.id !== selectedCorridorId) return c;
        const points = [...c.points];
        points.splice(index, 0, point);
        return { ...c, points };
      })
    );
  }, [selectedCorridorId]);

  const selectCorridor = useCallback((id: string | null) => {
    setSelectedCorridorId(id);
    if (id !== null) setSelectedZoneId(null);
  }, []);

  // Import d'une sauvegarde (refonte R1)
  const importAll = useCallback((nextZones: Zone[], nextCorridors: Corridor[]) => {
    setZones(nextZones);
    setCorridors(nextCorridors);
    setSelectedZoneId(null);
    setSelectedCorridorId(null);
  }, []);

  const value: ZonesContextValue = {
    zones,
    selectedZoneId,
    editMode,
    setEditMode,
    addMode,
    setAddMode,
    selectZone,
    addZone,
    renameZone,
    deleteZone,
    appendPoint,
    popPoint,
    removeVertex,
    updateVertex,
    insertVertex,
    corridors,
    selectedCorridorId,
    addCorridor,
    renameCorridor,
    deleteCorridor,
    appendCorridorPoint,
    popCorridorPoint,
    removeCorridorVertex,
    updateCorridorVertex,
    insertCorridorVertex,
    selectCorridor,
    importAll,
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
