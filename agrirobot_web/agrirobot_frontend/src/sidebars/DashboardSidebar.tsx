import React from 'react';
import { Card, CardContent, Typography, Stack, Button } from '@mui/material';
import ScheduleIcon from '@mui/icons-material/Schedule';
import MapIcon from '@mui/icons-material/Map';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import ROSLIB from 'roslib';

import { CurrentTaskCard } from '../dashboard/CurrentTaskCard';
import { useTasks } from '../hooks/useTasks';
import { useRos } from '../hooks/useRos';
import { useUiMode } from '../context/UiModeContext';

/**
 * Sidebar du mode Dashboard (l'état du robot est désormais dans la
 * RobotStatusBar flottante en haut de la carte) :
 * - Tâche en cours avec progression
 * - Boutons de contrôle (Démarrer / Arrêter)
 * - Bouton "Planifier" visible UNIQUEMENT si le robot est inactif
 */
const DashboardSidebar: React.FC = () => {
  const { ros, connectionState } = useRos();
  const { hasRunningTask } = useTasks();
  const { setMode } = useUiMode();

  const disabled = connectionState !== 'connected';

  // Le robot est considéré comme inactif si :
  // - Pas de tâche en cours ET ROS connecté
  const robotInactive = !hasRunningTask && !disabled;

  const handleTaskCommand = (action: 'start_all_tasks' | 'stop_all_tasks') => {
    if (!ros || disabled) return;
    const cmdPub = new ROSLIB.Topic({
      ros,
      name: '/task/command',
      messageType: 'std_msgs/String',
    });
    cmdPub.publish(new ROSLIB.Message({ data: JSON.stringify({ action }) }));
  };

  return (
    <>
      {/* Tâche en cours avec progression */}
      <CurrentTaskCard />

      {/* Boutons de contrôle global des tâches */}
      <Card>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            Contrôle des tâches
          </Typography>
          <Stack direction="row" spacing={1}>
            {hasRunningTask ? (
              <Button
                variant="contained"
                color="error"
                startIcon={<StopIcon />}
                onClick={() => handleTaskCommand('stop_all_tasks')}
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
                onClick={() => handleTaskCommand('start_all_tasks')}
                disabled={disabled}
                fullWidth
              >
                Démarrer les tâches
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* Bouton Planifier — visible UNIQUEMENT si le robot est inactif */}
      {robotInactive && (
        <Card>
          <CardContent>
            <Button
              variant="outlined"
              startIcon={<ScheduleIcon />}
              onClick={() => setMode('planning')}
              fullWidth
            >
              Planifier les tâches
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Boutons Zones et Chemins de liaison — toujours visibles */}
      <Card>
        <CardContent>
          <Button
            variant="outlined"
            startIcon={<MapIcon />}
            onClick={() => setMode('zones')}
            fullWidth
            sx={{ mb: 1 }}
          >
            Zones
          </Button>
          <Button
            variant="outlined"
            startIcon={<AltRouteIcon />}
            onClick={() => setMode('corridors')}
            fullWidth
          >
            Chemins de liaison
          </Button>
        </CardContent>
      </Card>
    </>
  );
};

export default DashboardSidebar;
