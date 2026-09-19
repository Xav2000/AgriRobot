import React from 'react';
import {
  Paper, Typography, Box, LinearProgress, Chip, Button, Divider, Stack,
} from '@mui/material';
import BatteryFullIcon from '@mui/icons-material/BatteryFull';
import BatteryAlertIcon from '@mui/icons-material/BatteryAlert';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import UmbrellaIcon from '@mui/icons-material/Umbrella';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
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
 * Barre d'état du robot, AU-DESSUS de la carte et ALIGNÉE À GAUCHE
 * avec le bord gauche de la carte :
 * - Batterie + statut du robot, toujours visibles
 * - Actions rapides (station) visibles UNIQUEMENT quand aucune tâche
 *   n'est en cours : le robot doit d'abord être arrêté.
 *   Boutons verts "contained" (même style que "Démarrer les tâches").
 */
export const RobotStatusBar: React.FC = () => {
  const { ros, connectionState } = useRos();
  const { robotStatus } = useRobotStatus();
  const { hasRunningTask } = useTasks();

  const connected = connectionState === 'connected';
  const showActions = connected && !hasRunningTask;

  const sendCommand = (action: string, extra?: Record<string, unknown>) => {
    if (!ros || !connected) return;
    const cmdPub = new ROSLIB.Topic({
      ros,
      name: '/task/command',
      messageType: 'std_msgs/String',
    });
    cmdPub.publish(new ROSLIB.Message({ data: JSON.stringify({ action, ...extra }) }));
  };

  const statusInfo = robotStatus
    ? STATUS_INFO[robotStatus.status] ?? { color: 'default' as const, label: 'Inactif' }
    : { color: 'default' as const, label: 'Inconnu' };

  const battery = robotStatus?.battery ?? 0;
  const batteryColor = battery > 50 ? 'success' : battery > 20 ? 'warning' : 'error';

  return (
    <Box sx={{ display: 'flex', flexShrink: 0 }}>
      <Paper
        elevation={2}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 0.75,
          borderRadius: 999,
          bgcolor: 'background.paper',
          maxWidth: '100%',
          overflow: 'auto',
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

            {/* Météo (6.10a) : clic = forçage dev beau temps / pluie */}
            {robotStatus?.weather && (
              <Chip
                size="small"
                icon={robotStatus.weather.condition === 'rain'
                  ? <UmbrellaIcon /> : <WbSunnyIcon />}
                color={robotStatus.weather.condition === 'rain' ? 'info' : 'default'}
                label={(robotStatus.weather.condition === 'rain' ? 'Pluie' : 'Beau temps')
                  + (robotStatus.weather.source === 'override' ? ' (forcé)' : '')}
                onClick={() => sendCommand('set_weather_override', { toggle: true })}
                sx={{ cursor: 'pointer' }}
              />
            )}

            {/* RTK (6.10c) : sous l'abri pas de fix (normal) ; hors
                abri, pas de déplacement sans fix. Clic = forçage dev. */}
            {robotStatus?.rtk && (
              <Chip
                size="small"
                icon={<SatelliteAltIcon />}
                color={robotStatus.rtk.fix ? 'success' : 'error'}
                label={(robotStatus.rtk.fix ? 'RTK' : 'Pas de fix')
                  + (robotStatus.rtk.source === 'override' ? ' (forcé)' : '')}
                onClick={() => sendCommand('set_rtk_override', { toggle: true })}
                sx={{ cursor: 'pointer' }}
              />
            )}

            {showActions && (
              <>
                <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                <Stack direction="row" spacing={0.5}>
                  <Button size="small" variant="contained" color="success" onClick={() => sendCommand('go_to_charge')}>
                    Aller à la station
                  </Button>
                  <Button size="small" variant="contained" color="success" onClick={() => sendCommand('leave_charge')}>
                    Quitter la station
                  </Button>
                  <Button size="small" variant="contained" color="success" onClick={() => sendCommand('return_to_charge')}>
                    Retour à la station
                  </Button>
                </Stack>
              </>
            )}
          </>
        )}
      </Paper>
    </Box>
  );
};
