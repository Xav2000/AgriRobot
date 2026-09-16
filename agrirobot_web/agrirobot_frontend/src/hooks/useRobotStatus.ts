import { useState, useEffect } from 'react';
import ROSLIB from 'roslib';
import { useRos } from './useRos';

export interface RobotStatus {
  status: string;
  battery: number;
  position?: { x: number; y: number };
}

/** Écoute /robot/status et expose l'état courant du robot. */
export function useRobotStatus(): { robotStatus: RobotStatus | null } {
  const { ros, connectionState } = useRos();
  const [robotStatus, setRobotStatus] = useState<RobotStatus | null>(null);

  useEffect(() => {
    if (!ros || connectionState !== 'connected') return;

    const statusTopic = new ROSLIB.Topic({
      ros,
      name: '/robot/status',
      messageType: 'std_msgs/String',
    });

    statusTopic.subscribe((msg: any) => {
      try {
        setRobotStatus(JSON.parse(msg.data));
      } catch (e) {
        console.error('Erreur de parsing du statut robot:', e);
      }
    });

    return () => statusTopic.unsubscribe();
  }, [ros, connectionState]);

  return { robotStatus };
}
