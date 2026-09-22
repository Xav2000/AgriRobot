import React from 'react';
import {
  Card, CardContent, Typography, Stack, Button,
} from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import StopIcon from '@mui/icons-material/Stop';
import ROSLIB from 'roslib';

import { CurrentTaskCard } from '../dashboard/CurrentTaskCard';
import { useNav2Status } from '../hooks/useNav2Status';
import { useRos } from '../hooks/useRos';
import { useUiMode } from '../context/UiModeContext';
import { useZones } from '../context/ZonesContext';

/**
 * Sidebar du mode Dashboard (banc feat/nav2-f2c) :
 * - tache en cours avec progression (via /mission/state) ;
 * - quand la mission tourne : Reprendre / Pause / Arreter
 *   (actions pause / resume / abort du mission_supervisor_node) ;
 * - quand le robot est inactif : bouton "Tondre les zones" qui envoie
 *   generate_coverage au f2c_planner_node avec la 1re zone de tonte
 *   dessinee sur la carte et toutes les exclusions (S0/S1).
 * Batterie / meteo / RTK / mode auto : non supportes par ce banc.
 */
const DashboardSidebar: React.FC = () => {
  const { ros, connectionState } = useRos();
  const { mission } = useNav2Status();
  const { setMode } = useUiMode();
  const { zones } = useZones();

  const disabled = connectionState !== 'connected';
  const missionRunning = mission?.status === 'running';
  const missionPaused = mission?.status === 'paused';
  const robotBusy = missionRunning || missionPaused;

  const sendCommand = (payload: Record<string, unknown>) => {
    if (!ros || disabled) return;
    const cmdPub = new ROSLIB.Topic({
      ros,
      name: '/task/command',
      messageType: 'std_msgs/String',
    });
    cmdPub.publish(new ROSLIB.Message({ data: JSON.stringify(payload) }));
  };

  // Genere la couverture de la 1re zone de tonte dessinee + exclusions.
  // Format f2c_planner_node : zones.mow = [[lat,lng]...] (1 anneau),
  // zones.exclusions = [[[lat,lng]...], ...] ; params par defaut du banc.
  const handleMowZones = () => {
    const mowZone = zones.find(z => z.type === 'mow' && z.points.length >= 3);
    if (!mowZone) {
      window.alert(
        'Dessine dabord une zone de tonte (mode Zones, bouton vert).');
      return;
    }
    const exclusions = zones
      .filter(z => z.type === 'exclusion' && z.points.length >= 3)
      .map(z => z.points);
    sendCommand({
      action: 'generate_coverage',
      zones: {
        mow: mowZone.points,
        exclusions,
      },
      params: {
        workWidth: 0.5,
        headlandPasses: 1,
        obstacleMargin: 0.25,
      },
    });
  };

  return (
    <>
      {/* Tache en cours avec progression */}
      <CurrentTaskCard />

      {/* Controle de la mission (mission_supervisor_node) */}
      <Card>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            Contrôle de la mission
          </Typography>
          <Stack direction="row" spacing={1}>
            {missionPaused && (
              <Button
                variant="contained"
                color="success"
                startIcon={<PlayArrowIcon />}
                onClick={() => sendCommand({ action: 'resume' })}
                disabled={disabled}
                fullWidth
              >
                Reprendre
              </Button>
            )}
            {missionRunning && (
              <Button
                variant="contained"
                color="warning"
                startIcon={<PauseIcon />}
                onClick={() => sendCommand({ action: 'pause' })}
                disabled={disabled}
                fullWidth
              >
                Pause
              </Button>
            )}
            {robotBusy && (
              <Button
                variant="contained"
                color="error"
                startIcon={<StopIcon />}
                onClick={() => sendCommand({ action: 'abort' })}
                disabled={disabled}
                fullWidth
              >
                Arrêter
              </Button>
            )}
            {!robotBusy && (
              <Button
                variant="contained"
                color="success"
                startIcon={<PlayArrowIcon />}
                onClick={handleMowZones}
                disabled={disabled}
                fullWidth
              >
                Tondre les zones
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* Edition des zones — toujours visible */}
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
