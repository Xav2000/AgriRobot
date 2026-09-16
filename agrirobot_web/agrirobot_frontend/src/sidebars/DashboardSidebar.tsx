import React from 'react';
import { Card, CardContent, Typography, Stack, Button } from '@mui/material';
import ScheduleIcon from '@mui/icons-material/Schedule';
import MapIcon from '@mui/icons-material/Map';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import RobotInfo from '../robot/RobotInfo';
import { CurrentTaskCard } from './CurrentTaskCard';
import { useTasks } from '../hooks/useTasks';
import { useRos } from '../hooks/useRos';
import { useUiMode } from '../context/UiModeContext';

/**
 * Sidebar du mode Dashboard :
 * - État du robot (batterie, statut, position)
 * - Tâche en cours avec progression
 * - Boutons de contrôle (Démarrer / Arrêter / Retour station via RobotInfo)
 * - Bouton "Planifier" visible UNIQUEMENT si le robot est inactif
 */
const DashboardSidebar: React.FC = () => {
  const { connectionState } = useRos();
  const { hasRunningTask } = useTasks();
  const { setMode } = useUiMode();

  const disabled = connectionState !== 'connected';

  // Le robot est considéré comme inactif si :
  // - Pas de tâche en cours ET
  // - ROS est connecté (sinon on ne peut pas planifier)
  const robotInactive = !hasRunningTask && !disabled;

  return (
    <>
      {/* État du robot (batterie, statut, position + actions station) */}
      <RobotInfo />

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
                onClick={() => {
                  if (!disabled) {
                    const cmdPub = new (window as any).ROSLIB.Topic({
                      ros: (window as any).rosInstance,
                      name: '/task/command',
                      messageType: 'std_msgs/String',
                    });
                    cmdPub.publish(new (window as any).ROSLIB.Message({
                      data: JSON.stringify({ action: 'stop_all_tasks' }),
                    }));
                  }
                }}
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
                onClick={() => {
                  if (!disabled) {
                    const cmdPub = new (window as any).ROSLIB.Topic({
                      ros: (window as any).rosInstance,
                      name: '/task/command',
                      messageType: 'std_msgs/String',
                    });
                    cmdPub.publish(new (window as any).ROSLIB.Message({
                      data: JSON.stringify({ action: 'start_all_tasks' }),
                    }));
                  }
                }}
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

      {/* Bouton Zones — toujours visible */}
      <Card>
        <CardContent>
          <Button
            variant="outlined"
            startIcon={<MapIcon />}
            onClick={() => setMode('zones')}
            fullWidth
          >
            Zones
          </Button>
        </CardContent>
      </Card>
    </>
  );
};

export default DashboardSidebar;
