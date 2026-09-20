import React, { useEffect, useState } from 'react';
import {
  Card, CardContent, Typography, Stack, TextField, Button,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import ROSLIB from 'roslib';

import { useRos } from '../hooks/useRos';
import { useRobotStatus } from '../hooks/useRobotStatus';
import { useUiMode } from '../context/UiModeContext';

/**
 * Réglages du robot (étape 6.10b) : paramètres persistés côté node
 * (~/.agrirobot/automation.json). Pour l'instant les seuils batterie
 * utilisés par le mode automatique ; plus tard la géométrie du robot
 * (largeur, roues motrices...).
 */
const SettingsSidebar: React.FC = () => {
  const { ros, connectionState } = useRos();
  const { robotStatus } = useRobotStatus();
  const { goBack } = useUiMode();
  const disabled = connectionState !== 'connected';

  const [batteryMin, setBatteryMin] = useState('80');
  const [batteryFull, setBatteryFull] = useState('100');
  const [rainDelay, setRainDelay] = useState('20');
  const [saved, setSaved] = useState(false);

  // Valeurs courantes venant du node.
  const cfgMin = robotStatus?.config?.batteryMin;
  const cfgFull = robotStatus?.config?.batteryFull;
  const cfgRain = robotStatus?.config?.rainDelayMin;
  useEffect(() => {
    if (cfgMin !== undefined) setBatteryMin(String(cfgMin));
    if (cfgFull !== undefined) setBatteryFull(String(cfgFull));
    if (cfgRain !== undefined) setRainDelay(String(cfgRain));
  }, [cfgMin, cfgFull, cfgRain]);

  const handleSave = () => {
    if (!ros || disabled) return;
    const cmdPub = new ROSLIB.Topic({
      ros,
      name: '/task/command',
      messageType: 'std_msgs/String',
    });
    cmdPub.publish(new ROSLIB.Message({
      data: JSON.stringify({
        action: 'set_robot_config',
        config: {
          batteryMin: Number(batteryMin),
          batteryFull: Number(batteryFull),
          rainDelayMin: Number(rainDelay),
        },
      }),
    }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <Button startIcon={<ArrowBackIcon />} onClick={goBack} size="small">
            Retour
          </Button>
          <Typography variant="subtitle2">
            Réglages du robot
          </Typography>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          Seuils de batterie et délai de reprise après la pluie —
          utilisés par le mode automatique, persistés sur le robot.
        </Typography>

        <Stack spacing={2}>
          <TextField
            label="Seuil bas — départ autorisé (%)"
            type="number"
            value={batteryMin}
            onChange={e => setBatteryMin(e.target.value)}
            inputProps={{ min: 0, max: 100 }}
            disabled={disabled}
            size="small"
            fullWidth
          />
          <TextField
            label="Seuil haut — batterie pleine (%)"
            type="number"
            value={batteryFull}
            onChange={e => setBatteryFull(e.target.value)}
            inputProps={{ min: 0, max: 100 }}
            disabled={disabled}
            size="small"
            fullWidth
          />
          <TextField
            label="Reprise après pluie — délai (min)"
            type="number"
            value={rainDelay}
            onChange={e => setRainDelay(e.target.value)}
            inputProps={{ min: 0, max: 480 }}
            disabled={disabled}
            size="small"
            fullWidth
          />
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            disabled={disabled}
            fullWidth
          >
            {saved ? 'Enregistré ✓' : 'Enregistrer'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default SettingsSidebar;
