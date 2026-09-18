import React, { createContext, useCallback, useContext, useState } from 'react';

/**
 * Station de recharge (étape 6.8) : simple POINT avec une orientation
 * de sortie (cap en degrés, 0 = nord, sens horaire). Les manœuvres
 * d'entrée/sortie sont SIMULÉES dans un premier temps (pas de
 * cinématique réelle).
 *
 * La station est raccordée au réseau de chemins de liaison si elle est
 * à moins de 1 m d'un segment (nœud du graphe, comme une jonction en
 * T) : c'est le point de départ des plus courts chemins (retours
 * d'urgence, étape 6.10).
 */
export interface Station {
  position: [number, number];
  /** Cap de sortie en degrés (0 = nord, sens horaire) */
  headingDeg: number;
}

interface StationContextValue {
  station: Station | null;
  /** Pose la station au clic (conserve le cap si déjà orientée) */
  setStation: (position: [number, number]) => void;
  /** Déplace la station (glisser du marqueur) */
  moveStation: (position: [number, number]) => void;
  /** Tourne le cap de sortie du nombre de degrés donné */
  rotateStation: (deltaDeg: number) => void;
  clearStation: () => void;
  /** True pendant le placement au clic sur la carte */
  placing: boolean;
  setPlacing: (v: boolean) => void;
}

const StationContext = createContext<StationContextValue | null>(null);

export const StationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [station, setStationState] = useState<Station | null>(null);
  const [placing, setPlacing] = useState(false);

  const setStation = useCallback((position: [number, number]) => {
    setStationState(prev => (prev ? { ...prev, position } : { position, headingDeg: 0 }));
    setPlacing(false);
  }, []);

  const moveStation = useCallback((position: [number, number]) => {
    setStationState(prev => (prev ? { ...prev, position } : prev));
  }, []);

  const rotateStation = useCallback((deltaDeg: number) => {
    setStationState(prev =>
      prev ? { ...prev, headingDeg: (prev.headingDeg + deltaDeg + 360) % 360 } : prev
    );
  }, []);

  const clearStation = useCallback(() => setStationState(null), []);

  return (
    <StationContext.Provider
      value={{ station, setStation, moveStation, rotateStation, clearStation, placing, setPlacing }}
    >
      {children}
    </StationContext.Provider>
  );
};

export function useStation(): StationContextValue {
  const ctx = useContext(StationContext);
  if (!ctx) {
    throw new Error("useStation doit être utilisé à l'intérieur d'un StationProvider");
  }
  return ctx;
}
