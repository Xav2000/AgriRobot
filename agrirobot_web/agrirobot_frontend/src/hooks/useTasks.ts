import { useEffect, useState } from 'react';
import { useNav2Status } from './useNav2Status';

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
  /** Waypoints reels [lat, lng] du parcours valide */
  waypoints?: [number, number][];
  /** Types de segment paralleles aux waypoints */
  waypointKinds?: string[];
  enabled?: boolean;
  lastExecutedAt?: string;
  schedule?: {
    daysOfWeek: number[];
    windowStart: string;
    windowEnd: string;
    intervalDays?: number;
  };
}

interface TasksState {
  tasks: Task[];
  /** La tâche actuellement en cours (status === 'running'), ou null */
  currentTask: Task | null;
  /** Vrai si au moins une tâche est en cours (running OU paused) */
  hasRunningTask: boolean;
}

/**
 * Banc feat/nav2-f2c : la liste de tâches est DERIVEE de l'etat de
 * mission (/mission/state, publie par mission_supervisor_node). Une
 * seule mission a la fois = une seule tache "Couverture F2C".
 * - running / paused -> tache en cours (le robot est occupe)
 * - done             -> tache terminee
 * - aborted          -> tache echouee
 */
export function useTasks(): TasksState {
  const { mission } = useNav2Status();
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (!mission || mission.status === 'idle') {
      setTasks([]);
      return;
    }
    const total = mission.totalWaypoints || 0;
    const done = mission.completedWaypoints || 0;
    const progress = total > 0 ? (done / total) * 100 : 0;
    let status: Task['status'] = 'running';
    if (mission.status === 'done') status = 'completed';
    if (mission.status === 'aborted') status = 'failed';
    setTasks([{
      id: mission.task || 'f2c-1',
      name: 'Couverture F2C',
      type: 'mowing',
      status,
      progress,
      totalSteps: total,
      currentStep: done,
    }]);
  }, [mission]);

  const currentTask = tasks.find(t => t.status === 'running') ?? null;
  const hasRunningTask =
    currentTask !== null ||
    (mission !== null && mission.status === 'paused');

  return { tasks, currentTask, hasRunningTask };
}
