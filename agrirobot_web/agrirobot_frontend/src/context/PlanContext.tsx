import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Task } from '../hooks/useTasks';
import { loadSlice, saveSlice } from '../lib/storage';

/**
 * File de planification (refonte R3) : vit DANS le frontend et y
 * persiste (localStorage) — c'est la source de vérité de la mission à
 * venir. Le robot ne reçoit plus que « generate_mission » avec la file
 * ordonnée ; add_task / remove_task / set_task_enabled disparaissent
 * du flux normal.
 *
 * Le robot ne fait que RAPPORTER l'état d'exécution (progression,
 * statut, dernière exécution) via /tasks/list : mergeRobotState
 * fusionne ces champs dans la file sans jamais toucher à l'ordre ni
 * au drapeau enabled, qui restent des décisions de l'opérateur.
 */
interface PlanContextValue {
  queue: Task[];
  /** Ajoute une tâche en fin de file (id générée si absente), renvoie son id */
  addTask: (task: Partial<Task> & { name: string }) => string;
  removeTask: (id: string) => void;
  setTaskEnabled: (id: string, enabled: boolean) => void;
  /** Déplace une tâche de l'index from vers l'index to */
  moveTask: (from: number, to: number) => void;
  /** Fusionne l'état d'exécution rapporté par le robot (lecture seule) */
  mergeRobotState: (robotTasks: Task[]) => void;
  /** Remplace toute la file (import de sauvegarde) */
  replaceQueue: (tasks: Task[]) => void;
  /** Definit la planification recurrente d'une tache (etape 6.9) */
  setTaskSchedule: (id: string, schedule: Task['schedule']) => void;
}

const PlanContext = createContext<PlanContextValue | null>(null);

export const PlanProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [queue, setQueue] = useState<Task[]>(() => loadSlice<Task[]>('plan', []));

  // Sauvegarde automatique (refonte R1)
  useEffect(() => { saveSlice('plan', queue); }, [queue]);

  const addTask = useCallback((task: Partial<Task> & { name: string }): string => {
    const id = task.id ?? 'wl-' + Date.now();
    setQueue(prev => [...prev, {
      id,
      name: task.name,
      type: task.type ?? 'custom',
      status: 'pending',
      field: task.field,
      waypoints: task.waypoints,
      waypointKinds: task.waypointKinds,
      enabled: true,
    }]);
    return id;
  }, []);

  const removeTask = useCallback((id: string) => {
    setQueue(prev => prev.filter(t => t.id !== id));
  }, []);

  const setTaskEnabled = useCallback((id: string, enabled: boolean) => {
    setQueue(prev => prev.map(t => (t.id === id ? { ...t, enabled } : t)));
  }, []);

  const moveTask = useCallback((from: number, to: number) => {
    setQueue(prev => {
      if (from === to || from < 0 || from >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const mergeRobotState = useCallback((robotTasks: Task[]) => {
    setQueue(prev => {
      const byId = new Map(robotTasks.map(t => [t.id, t]));
      let changed = false;
      const next = prev.map(t => {
        const rt = byId.get(t.id);
        if (!rt) {
          // Tâche inconnue du robot (mission annulée côté robot) : la
          // définition reste dans la file, seul le statut d'exécution
          // retombe à « en attente ».
          if (t.status !== 'pending' && t.status !== 'completed') {
            changed = true;
            return { ...t, status: 'pending' as const };
          }
          return t;
        }
        if (rt.status === t.status && rt.progress === t.progress
          && rt.currentStep === t.currentStep && rt.totalSteps === t.totalSteps
          && rt.lastExecutedAt === t.lastExecutedAt) return t;
        changed = true;
        return {
          ...t,
          status: rt.status,
          progress: rt.progress,
          currentStep: rt.currentStep,
          totalSteps: rt.totalSteps,
          lastExecutedAt: rt.lastExecutedAt,
        };
      });
      return changed ? next : prev;
    });
  }, []);

  const replaceQueue = useCallback((tasks: Task[]) => setQueue(tasks), []);

  const setTaskSchedule = useCallback(
    (id: string, schedule: Task['schedule']) => {
      setQueue(prev => prev.map(t => (t.id === id ? { ...t, schedule } : t)));
    }, []);

  return (
    <PlanContext.Provider
      value={{ queue, addTask, removeTask, setTaskEnabled, moveTask, mergeRobotState, replaceQueue, setTaskSchedule }}
    >
      {children}
    </PlanContext.Provider>
  );
};

export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) {
    throw new Error("usePlan doit être utilisé à l'intérieur d'un PlanProvider");
  }
  return ctx;
}
