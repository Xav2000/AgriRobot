import React, { createContext, useCallback, useContext, useState } from 'react';
import { useZones } from './ZonesContext';
import { generateWorklines, WorklinesResult } from '../lib/worklines';

/** Ce que l'opérateur est en train de sélectionner sur la carte. */
export type PickMode = null | 'entryPoint' | 'referenceBorder';

/**
 * Paramètres de génération des lignes de guidage (étape 6.2) :
 * - zone de tonte cible
 * - point d'entrée / départ du robot
 * - bordure de référence (orientation des allers-retours)
 * - nombre de contours intérieurs (headlands) avant les allers-retours
 * - largeur de travail (m)
 * - contour optionnel autour des zones d'exclusion
 *
 * L'algorithme (étape 6.3) vit dans src/lib/worklines.ts : ce contexte
 * stocke les paramètres, lance la génération et garde le résultat pour
 * l'affichage (prévisualisation) et l'étape de validation (6.4).
 */
export interface WorklinesParams {
  targetZoneId: string | null;
  /** [lat, lng] */
  entryPoint: [number, number] | null;
  /**
   * Index du sommet de départ de la bordure de référence dans le polygone
   * cible (l'arête relie les sommets i et i+1, modulo le nombre de sommets).
   */
  referenceBorderIndex: number | null;
  headlands: number;
  workingWidthM: number;
  outlineObstacles: boolean;
}

const DEFAULT_PARAMS: WorklinesParams = {
  targetZoneId: null,
  entryPoint: null,
  referenceBorderIndex: null,
  headlands: 0,
  workingWidthM: 0.5,
  outlineObstacles: true,
};

interface WorklinesContextValue {
  params: WorklinesParams;
  pickMode: PickMode;
  setPickMode: (mode: PickMode) => void;
  /**
   * Fusionne un patch dans les paramètres. Changer de zone cible
   * réinitialise le point d'entrée, la bordure de référence et le résultat.
   */
  setParams: (patch: Partial<WorklinesParams>) => void;
  resetParams: () => void;
  /** Résultat de la dernière génération (null si rien de généré) */
  result: WorklinesResult | null;
  /** Calcule les lignes à partir des paramètres et des zones courants */
  generate: () => void;
  clearResult: () => void;
}

const WorklinesContext = createContext<WorklinesContextValue | null>(null);

export const WorklinesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { zones } = useZones();
  const [params, setParamsState] = useState<WorklinesParams>(DEFAULT_PARAMS);
  const [pickMode, setPickMode] = useState<PickMode>(null);
  const [result, setResult] = useState<WorklinesResult | null>(null);

  const setParams = useCallback((patch: Partial<WorklinesParams>) => {
    setParamsState(prev => {
      const next = { ...prev, ...patch };
      // Le point d'entrée et la bordure de référence sont liés à la zone cible.
      if (patch.targetZoneId !== undefined && patch.targetZoneId !== prev.targetZoneId) {
        next.entryPoint = null;
        next.referenceBorderIndex = null;
      }
      return next;
    });
    // Changer de zone cible invalide les lignes affichées
    if (patch.targetZoneId !== undefined) setResult(null);
  }, []);

  const generate = useCallback(() => {
    setResult(generateWorklines(params, zones));
  }, [params, zones]);

  const clearResult = useCallback(() => setResult(null), []);

  const resetParams = useCallback(() => {
    setParamsState(DEFAULT_PARAMS);
    setPickMode(null);
    setResult(null);
  }, []);

  return (
    <WorklinesContext.Provider
      value={{ params, pickMode, setPickMode, setParams, resetParams, result, generate, clearResult }}
    >
      {children}
    </WorklinesContext.Provider>
  );
};

export function useWorklines(): WorklinesContextValue {
  const ctx = useContext(WorklinesContext);
  if (!ctx) {
    throw new Error("useWorklines doit être utilisé à l'intérieur d'un WorklinesProvider");
  }
  return ctx;
}
