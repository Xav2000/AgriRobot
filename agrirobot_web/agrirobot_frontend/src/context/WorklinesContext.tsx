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
  /**
   * Marge de sécurité autour des zones d'exclusion (m) ; null = demi-largeur
   * de travail. Une exclusion est un danger absolu (mare, trou) : le robot
   * ne s'en approche jamais plus près que cette marge.
   */
  obstacleMarginM: number | null;
}

/** Portails (points d'entrée) mémorisés par zone : [zoneId -> [lat, lng]].
 *  Sert à l'aimantation des chemins de liaison sur les portails et à la
 *  restauration du point d'entrée au changement de zone cible. */
export type ZoneEntryPoints = Record<string, [number, number]>;

const DEFAULT_PARAMS: WorklinesParams = {
  targetZoneId: null,
  entryPoint: null,
  referenceBorderIndex: null,
  headlands: 0,
  workingWidthM: 0.5,
  outlineObstacles: true,
  obstacleMarginM: null,
};

interface WorklinesContextValue {
  params: WorklinesParams;
  pickMode: PickMode;
  setPickMode: (mode: PickMode) => void;
  /**
   * Fusionne un patch dans les paramètres. Ignoré si le parcours est
   * verrouillé. Changer de zone cible réinitialise la bordure de
   * référence, le résultat et le verrou ; le point d'entrée est
   * RESTAURÉ depuis le portail mémorisé de la zone s'il existe.
   */
  setParams: (patch: Partial<WorklinesParams>) => void;
  resetParams: () => void;
  /** Résultat de la dernière génération (null si rien de généré) */
  result: WorklinesResult | null;
  /** Calcule les lignes à partir des paramètres et des zones courants */
  generate: () => void;
  clearResult: () => void;
  /**
   * Étape 6.4 — parcours VALIDÉ par l'opérateur : lignes verrouillées
   * (paramètres et génération gelés) jusqu'au déverrouillage ou au
   * changement de zone cible.
   */
  locked: boolean;
  /** Verrouille le parcours validé */
  lock: () => void;
  /** Déverrouille (retour en prévisualisation éditable) */
  unlock: () => void;
  /** Portail (point d'entrée) mémorisé de chaque zone déjà configurée */
  zoneEntryPoints: ZoneEntryPoints;
}

const WorklinesContext = createContext<WorklinesContextValue | null>(null);

export const WorklinesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { zones } = useZones();
  const [params, setParamsState] = useState<WorklinesParams>(DEFAULT_PARAMS);
  const [pickMode, setPickModeState] = useState<PickMode>(null);
  const [result, setResult] = useState<WorklinesResult | null>(null);
  const [locked, setLocked] = useState(false);
  // Portail de chaque zone déjà configurée (persiste au changement de zone)
  const [zoneEntryPoints, setZoneEntryPoints] = useState<ZoneEntryPoints>({});

  // Verrouillé : plus aucune sélection sur la carte
  const setPickMode = useCallback((mode: PickMode) => {
    if (locked) return;
    setPickModeState(mode);
  }, [locked]);

  const setParams = useCallback((patch: Partial<WorklinesParams>) => {
    if (locked) return;
    // Mémorise le portail de la zone cible à chaque placement du point
    // d'entrée : il servira à l'aimantation des chemins de liaison et
    // sera restauré si on revient sur cette zone.
    if (patch.entryPoint && params.targetZoneId) {
      const zid = params.targetZoneId;
      const ep = patch.entryPoint;
      setZoneEntryPoints(m => {
        const cur = m[zid];
        if (cur && cur[0] === ep[0] && cur[1] === ep[1]) return m;
        return { ...m, [zid]: ep };
      });
    }
    setParamsState(prev => {
      const next = { ...prev, ...patch };
      // Le point d'entrée et la bordure de référence sont liés à la zone
      // cible. Au changement de zone : bordure reset, point d'entrée
      // restauré depuis le portail mémorisé s'il existe.
      if (patch.targetZoneId !== undefined && patch.targetZoneId !== prev.targetZoneId) {
        next.entryPoint = patch.targetZoneId != null
          ? (zoneEntryPoints[patch.targetZoneId] ?? null)
          : null;
        next.referenceBorderIndex = null;
      }
      return next;
    });
    // Changer de zone cible invalide les lignes affichées et le verrou
    if (patch.targetZoneId !== undefined) {
      setResult(null);
      setLocked(false);
    }
  }, [locked, params, zoneEntryPoints]);

  const generate = useCallback(() => {
    if (locked) return;
    setResult(generateWorklines(params, zones));
  }, [params, zones, locked]);

  const clearResult = useCallback(() => {
    if (locked) return;
    setResult(null);
  }, [locked]);

  const resetParams = useCallback(() => {
    setParamsState(DEFAULT_PARAMS);
    setPickModeState(null);
    setResult(null);
    setLocked(false);
  }, []);

  const lock = useCallback(() => setLocked(true), []);
  const unlock = useCallback(() => setLocked(false), []);

  return (
    <WorklinesContext.Provider
      value={{ params, pickMode, setPickMode, setParams, resetParams, result, generate, clearResult, locked, lock, unlock, zoneEntryPoints }}
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
