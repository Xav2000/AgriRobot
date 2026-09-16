import { useState, useEffect } from 'react';
import ROSLIB from 'roslib';
import { useRos } from './useRos';

export interface MissionTask {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** Waypoints [lat, lng] dans l'ordre d'exécution */
  waypoints: [number, number][];
  /** Nombre de waypoints déjà atteints */
  completedWaypoints: number;
}

export interface Mission {
  tasks: MissionTask[];
}

/** Écoute /mission/path (parcours de la mission + progression). */
export function useMission(): { mission: Mission | null } {
  const { ros, connectionState } = useRos();
  const [mission, setMission] = useState<Mission | null>(null);

  useEffect(() => {
    if (!ros || connectionState !== 'connected') return;

    const topic = new ROSLIB.Topic({
      ros,
      name: '/mission/path',
      messageType: 'std_msgs/String',
    });

    topic.subscribe((msg: any) => {
      try {
        const data = JSON.parse(msg.data);
        if (data && Array.isArray(data.tasks)) {
          setMission(data);
        }
      } catch (e) {
        console.error('Erreur de parsing de la mission:', e);
      }
    });

    return () => topic.unsubscribe();
  }, [ros, connectionState]);

  return { mission };
}
