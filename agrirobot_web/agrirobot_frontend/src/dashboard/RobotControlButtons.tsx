import React from 'react';
import { Stack, Button } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import { useRos } from '../hooks/useRos';

interface RobotControlButtonsProps {
  /** Si vrai, le robot a une tâche en cours (status === 'running') */
  hasRunningTask: boolean;
}

/**
 * Boutons Démarrer / Arrêter pour le contrôle global des tâches.
 * Ces boutons agissent sur la mission principale (toutes les tâches).
 */
export const RobotControlButtons: React.FC<RobotControlButtonsProps> = ({ hasRunningTask }) => {
  const { ros, connectionState } = useRos();

  const disabled = connectionState !== 'connected';

  const handleAction = (action: string) => {
    if (!ros || disabled) return;

    const cmdPub = new (window as any).ROSLIB.Topic({
      ros,
      name: '/task/command',
      messageType: 'std_msgs/String',
    });

    cmdPub.publish(new (window as any).ROSLIB.Message({
      data: JSON.stringify({ action }),
    }));
  };

  return (
    <Stack direction="row" spacing={1}>
      {hasRunningTask ? (
        <Button
          variant="contained"
          color="error"
          startIcon={<StopIcon />}
          onClick={() => handleAction('stop_all_tasks')}
          disabled={disabled}
          fullWidth
        >
          Arrêter
        </Button>
      ) : (
        <Button
          variant="contained"
          color="success"
          startIcon={<PlayArrowIcon />}
          onClick={() => handleAction('start_all_tasks')}
          disabled={disabled}
          fullWidth
        >
          Démarrer les tâches
        </Button>
      )}
    </Stack>
  );
};
