import React, { useState } from 'react';
import {
  Card, CardContent, Typography, Stack, Button,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
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
 * - Boutons de contrôle (Démarrer/Reprendre / Arrêt d'urgence puis
 *   choix opérateur : pause ou annulation de la mission)
 * - Bouton "Planifier" visible UNIQUEMENT si le robot est inactif
 */
const DashboardSidebar: React.FC = () => {
  const { ros, connectionState } = useRos();
  const { hasRunningTask, tasks } = useTasks();
  const { setMode } = useUiMode();

  const disabled = connectionState !== 'connected';

  // Arrêt d'URGENCE : le robot stoppe IMMÉDIATEMENT sur place et coupe
  // ses outils (lame, outil de travail du sol — simulé) : un arrêt
  // manuel peut être un geste de sécurité, on n'attend pas la décision.
  // Le choix pause / annulation est ensuite fait dans la fenêtre.
  const [stopDialogOpen, setStopDialogOpen] = useState(false);

  const handleEmergencyStop = () => {
    handleTaskCommand('emergency_stop');
    setStopDialogOpen(true);
  };

  // Le robot est considéré comme inactif si :
  // - Pas de tâche en cours ET ROS connecté
  const robotInactive = !hasRunningTask && !disabled;

  const handleTaskCommand = (
    action: 'start_all_tasks' | 'stop_all_tasks' | 'emergency_stop'
      | 'pause_mission' | 'cancel_mission'
  ) => {
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
                onClick={handleEmergencyStop}
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
                {tasks.some(t => (t.currentStep ?? 0) > 0 && t.status !== 'completed')
                  ? 'Reprendre les tâches'
                  : 'Démarrer les tâches'}
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

      {/* Choix après arrêt d'urgence : pause (progression conservée,
          reprise possible) ou annulation (mission supprimée, retour à la
          station). Fermer la fenêtre revient à mettre en pause. */}
      <Dialog
        open={stopDialogOpen}
        onClose={() => { setStopDialogOpen(false); handleTaskCommand('pause_mission'); }}
      >
        <DialogTitle>Mission interrompue</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Le robot est arrêté sur place et ses outils sont coupés.
            Que veux-tu faire ?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            color="error"
            onClick={() => { setStopDialogOpen(false); handleTaskCommand('cancel_mission'); }}
          >
            Annuler la mission
          </Button>
          <Button
            variant="contained"
            onClick={() => { setStopDialogOpen(false); handleTaskCommand('pause_mission'); }}
          >
            Mettre en pause
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default DashboardSidebar;
