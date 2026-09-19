import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useZones } from './ZonesContext';
import { generateWorklines, WorklinesResult } from '../lib/worklines';
import { loadSlice, saveSlice } from '../lib/storage';

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

/**
 * Parcours validé (étape 6.4) mémorisé PAR ZONE : chaque zone garde ses
 * propres paramètres, son résultat et l'identifiant de la tâche de la
 * file de planification. Le verrouillage est donc par zone, pas global —
 * on peut valider la zone A puis configurer et valider la zone B sans
 * déverrouiller A.
 */
export interface ValidatedCourse {
  params: WorklinesParams;
  result: WorklinesResult;
  /** Id de la tâche de la file de planification ('wl-…'), retirée au déverrouillage */
  taskId?: string;
}

interface WorklinesContextValue {
  params: WorklinesParams;
  pickMode: PickMode;
  setPickMode: (mode: PickMode) => void;
  /**
   * Fusionne un patch dans les paramètres. Ignoré si le parcours de la
   * zone courante est verrouillé, SAUF targetZoneId : changer de zone
   * recharge le parcours validé de la nouvelle zone s'il existe, sinon
   * une configuration fraîche avec le portail mémorisé restauré.
   */
  setParams: (patch: Partial<WorklinesParams>) => void;
  resetParams: () => void;
  /** Résultat de la dernière génération (null si rien de généré) */
  result: WorklinesResult | null;
  /** Calcule les lignes à partir des paramètres et des zones courants */
  generate: () => void;
  clearResult: () => void;
  /**
   * Étape 6.4 — la zone COURANTE a un parcours validé : ses paramètres
   * et son résultat sont gelés jusqu'au déverrouillage.
   */
  locked: boolean;
  /** Valide et verrouille le parcours de la zone courante (taskId optionnel) */
  lock: (taskId?: string) => void;
  /**
   * Déverrouille la zone courante (retour en prévisualisation éditable)
   * et renvoie le taskId de la tâche à retirer de la file (null si absent).
   */
  unlock: () => string | null;
  /** Parcours validés mémorisés par zone (zoneId -> ValidatedCourse) */
  validated: Record<string, ValidatedCourse>;
  /** Portail (point d'entrée) mémorisé de chaque zone déjà configurée */
  zoneEntryPoints: ZoneEntryPoints;
  /** Import d'une sauvegarde (refonte R1) */
  importState: (validated: Record<string, ValidatedCourse>, zoneEntryPoints: ZoneEntryPoints) => void;
}

const WorklinesContext = createContext<WorklinesContextValue | null>(null);

export const WorklinesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { zones } = useZones();
  const [params, setParamsState] = useState<WorklinesParams>(DEFAULT_PARAMS);
  const [pickMode, setPickModeState] = useState<PickMode>(null);
  const [result, setResult] = useState<WorklinesResult | null>(null);
  // Parcours validés PAR ZONE : verrou, paramètres, résultat et tâche
  // (persistés, refonte R1)
  const [validated, setValidated] = useState<Record<string, ValidatedCourse>>(
    () => loadSlice<Record<string, ValidatedCourse>>('worklines.validated', {}));
  // Portail de chaque zone déjà configurée (persiste au changement de zone)
  const [zoneEntryPoints, setZoneEntryPoints] = useState<ZoneEntryPoints>(
    () => loadSlice<ZoneEntryPoints>('worklines.entryPoints', {}));

  // Sauvegarde automatique (refonte R1) : parcours validés et portails
  // survivent au rechargement de la page.
  useEffect(() => { saveSlice('worklines.validated', validated); }, [validated]);
  useEffect(() => { saveSlice('worklines.entryPoints', zoneEntryPoints); }, [zoneEntryPoints]);

  // La zone courante est verrouillée si elle possède un parcours validé
  const locked = params.targetZoneId != null
    && Object.prototype.hasOwnProperty.call(validated, params.targetZoneId);

  // Verrouillé : plus aucune sélection sur la carte
  const setPickMode = useCallback((mode: PickMode) => {
    if (locked) return;
    setPickModeState(mode);
  }, [locked]);

  const setParams = useCallback((patch: Partial<WorklinesParams>) => {
    // Gelé si la zone courante est verrouillée, SAUF le changement de
    // zone cible : on doit pouvoir quitter une zone verrouillée.
    if (locked && patch.targetZoneId === undefined) return;
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
      // Changement de zone cible : recharge le parcours validé s'il
      // existe, sinon configuration fraîche (bordure reset, point
      // d'entrée restauré depuis le portail mémorisé s'il existe).
      if (patch.targetZoneId !== undefined && patch.targetZoneId !== prev.targetZoneId) {
        const saved = patch.targetZoneId != null ? validated[patch.targetZoneId] : undefined;
        if (saved) return { ...saved.params };
        return {
          ...DEFAULT_PARAMS,
          targetZoneId: patch.targetZoneId,
          entryPoint: patch.targetZoneId != null
            ? (zoneEntryPoints[patch.targetZoneId] ?? null)
            : null,
        };
      }
      return { ...prev, ...patch };
    });
    // Le changement de zone rafraîchit les lignes affichées : parcours
    // validé de la nouvelle zone, sinon rien.
    if (patch.targetZoneId !== undefined && patch.targetZoneId !== params.targetZoneId) {
      const saved = patch.targetZoneId != null ? validated[patch.targetZoneId] : undefined;
      setResult(saved ? saved.result : null);
    }
  }, [locked, params, zoneEntryPoints, validated]);

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
  }, []);

  // Valide le parcours de la zone courante : paramètres, résultat et
  // taskId de la tâche de planification sont gelés ensemble, par zone.
  const lock = useCallback((taskId?: string) => {
    const zid = params.targetZoneId;
    if (zid == null || result == null) return;
    setValidated(m => ({ ...m, [zid]: { params, result, taskId } }));
  }, [params, result]);

  // Déverrouille la zone courante et renvoie le taskId de sa tâche
  // (pour la retirer de la file de planification), null si pas de tâche.
  const unlock = useCallback((): string | null => {
    const zid = params.targetZoneId;
    if (zid == null) return null;
    const tid = validated[zid]?.taskId ?? null;
    setValidated(m => {
      if (!Object.prototype.hasOwnProperty.call(m, zid)) return m;
      const next = { ...m };
      delete next[zid];
      return next;
    });
    return tid;
  }, [params, validated]);

  // Import d'une sauvegarde (refonte R1) : remplace les parcours
  // validés et les portails mémorisés.
  const importState = useCallback((v: Record<string, ValidatedCourse>, e: ZoneEntryPoints) => {
    setValidated(v);
    setZoneEntryPoints(e);
    // Recharge l'affichage si la zone courante est concernée.
    const saved = params.targetZoneId != null ? v[params.targetZoneId] : undefined;
    setResult(saved ? saved.result : null);
  }, [params.targetZoneId]);

  return (
    <WorklinesContext.Provider
      value={{
        params, pickMode, setPickMode, setParams, resetParams, result,
        generate, clearResult, locked, lock, unlock, validated, zoneEntryPoints, importState,
      }}
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
