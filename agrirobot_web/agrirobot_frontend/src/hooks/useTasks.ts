import { useEffect, useState } from 'react';
import { useNav2Status } from './useNav2Status';

export interface Task {
  id: string;
  name: string;
  type: 'mowing' | 'plowing' | 'seeding' | 'custom';
  status: 'pending' | 'running' | 'completed' | 'failed';
  field?: string;
  priority?: number;
  progress?: number;
  totalSteps?: number;
  currentStep?: number;
  waypoints?: [number, number][];
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
  currentTask: Task | null;
  hasRunningTask: boolean;
}

/**
 * Banc feat/nav2-f2c : liste derivee de /mission/state.
 * pending = plan genere (apercu), robot arrete.
 * running / paused -> tache en cours ; done -> terminee ; aborted -> echouee.
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
    if (mission.status === 'pending') status = 'pending';
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
