import React from 'react';
import {
  Paper, Typography, Box, LinearProgress, Chip, Button, Divider, Stack,
} from '@mui/material';
import BatteryFullIcon from '@mui/icons-material/BatteryFull';
import BatteryAlertIcon from '@mui/icons-material/BatteryAlert';
import ROSLIB from 'roslib';
import { useRos } from '../hooks/useRos';
import { useRobotStatus } from '../hooks/useRobotStatus';
import { useTasks } from '../hooks/useTasks';

const STATUS_INFO: Record<string, { color: 'success' | 'warning' | 'info' | 'error' | 'default'; label: string }> = {
  working:            { color: 'success', label: 'En travail' },
  going_to_charge:    { color: 'warning', label: 'En route vers la station' },
  leaving_charge:     { color: 'warning', label: 'Quitte la station' },
  returning_to_charge:{ color: 'warning', label: 'Retour à la station' },
  charging:           { color: 'info',    label: 'En charge' },
  error:              { color: 'error',   label: 'Erreur' },
};

/**
 * Barre flottante centrée en haut de la carte :
 * - Batterie + statut du robot, toujours visibles
 * - Actions rapides (station) visibles UNIQUEMENT quand aucune tâche
 *   n'est en cours : le robot doit d'abord être arrêté.
 */
export const RobotStatusBar: React.FC = () => {
  const { ros, connectionState } = useRos();
  const { robotStatus } = useRobotStatus();
  const { hasRunningTask } = useTasks();

  const connected = connectionState === 'connected';
  const showActions = connected && !hasRunningTask;

  const sendCommand = (action: string) => {
    if (!ros || !connected) return;
    const cmdPub = new ROSLIB.Topic({
      ros,
      name: '/task/command',
      messageType: 'std_msgs/String',
    });
    cmdPub.publish(new ROSLIB.Message({ data: JSON.stringify({ action }) }));
  };

  const statusInfo = robotStatus
    ? STATUS_INFO[robotStatus.status] ?? { color: 'default' as const, label: 'Inactif' }
    : { color: 'default' as const, label: 'Inconnu' };

  const battery = robotStatus?.battery ?? 0;
  const batteryColor = battery > 50 ? 'success' : battery > 20 ? 'warning' : 'error';

  return (
    <Paper
      elevation={4}
      sx={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000, /* au-dessus des panes Leaflet */
        px: 2,
        py: 1,
        borderRadius: 999,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        bgcolor: 'background.paper',
        maxWidth: 'calc(100% - 32px)',
      }}
    >
      {!connected ? (
        <Chip label="ROS 2 : non connecté" color="error" size="small" />
      ) : (
        <>
          {battery > 20
            ? <BatteryFullIcon color="success" />
            : <BatteryAlertIcon color="error" />}

          <Box sx={{ minWidth: 110 }}>
            <Typography variant="caption" sx={{ lineHeight: 1 }}>
              Batterie {battery} %
            </Typography>
            <LinearProgress
              variant="determinate"
              value={battery}
              color={batteryColor}
              sx={{ height: 6, borderRadius: 3, mt: 0.5 }}
            />
          </Box>

          <Chip color={statusInfo.color} label={statusInfo.label} size="small" />

          {showActions && (
            <>
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
              <Stack direction="row" spacing={0.5}>
                <Button size="small" onClick={() => sendCommand('go_to_charge')}>
                  Aller à la station
                </Button>
                <Button size="small" onClick={() => sendCommand('leave_charge')}>
                  Quitter la station
                </Button>
                <Button size="small" onClick={() => sendCommand('return_to_charge')}>
                  Retour à la station
                </Button>
              </Stack>
            </>
          )}
        </>
      )}
    </Paper>
  );
};
