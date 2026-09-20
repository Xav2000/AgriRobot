import { useState, useEffect } from 'react';
import ROSLIB from 'roslib';
import { useRos } from './useRos';

export interface Task {
  id: string;
  name: string;
  type: 'mowing' | 'plowing' | 'seeding' | 'custom';
  status: 'pending' | 'running' | 'completed' | 'failed';
  field?: string;
  priority?: number;
  /** Pourcentage de progression (0-100) pour les tâches en cours */
  progress?: number;
  /** Nombre total d'étapes/points de la tâche */
  totalSteps?: number;
  /** Étape courante */
  currentStep?: number;
  /** Waypoints reels [lat, lng] du parcours valide (etape 6.4) */
  waypoints?: [number, number][];
  /** Types de segment paralleles aux waypoints (headland/sweep/transition/obstacle) - etape outils */
  waypointKinds?: string[];
  /**
   * Etape 6.9 : tâche active (true par defaut) ou désactivée — une tâche
   * désactivée reste dans la file mais le robot la saute lors de la mission.
   */
  enabled?: boolean;
  /** Date (ISO 8601) de la dernière exécution terminée, tenue à jour par le robot */
  lastExecutedAt?: string;
  /**
   * Etape 6.9 : planification recurrente (voir lib/schedule.ts pour
   * le calcul d'echeance). Absente = tache due en permanence
   * (comportement historique).
   */
  schedule?: {
    daysOfWeek: number[];   // 0 = dimanche ... 6 = samedi
    windowStart: string;    // "HH:MM" ('' = toute la journee)
    windowEnd: string;      // "HH:MM"
    intervalDays?: number;  // >= 1 : jours minimum entre deux debuts
  };
}

interface TasksState {
  tasks: Task[];
  /** La tâche actuellement en cours (status === 'running'), ou null */
  currentTask: Task | null;
  /** Vrai si au moins une tâche est en cours */
  hasRunningTask: boolean;
}

export function useTasks(): TasksState {
  const { ros, connectionState } = useRos();
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (!ros || connectionState !== 'connected') return;

    const tasksTopic = new ROSLIB.Topic({
      ros,
      name: '/tasks/list',
      messageType: 'std_msgs/String',
    });

    tasksTopic.subscribe((msg: any) => {
      try {
        const list = JSON.parse(msg.data);
        if (Array.isArray(list)) {
          setTasks(list);
        }
      } catch (e) {
        console.error('Erreur parsing tâches:', e);
      }
    });

    return () => tasksTopic.unsubscribe();
  }, [ros, connectionState]);

  // Calcul de la tâche en cours et état dérivé
  const currentTask = tasks.find(t => t.status === 'running') ?? null;
  const hasRunningTask = currentTask !== null;

  return { tasks, currentTask, hasRunningTask };
}
