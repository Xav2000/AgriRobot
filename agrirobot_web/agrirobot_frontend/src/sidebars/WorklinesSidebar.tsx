import React from 'react';
import {
  Card, CardContent, Typography, Button, Alert, Stack, Box, TextField, Select,
  MenuItem, InputLabel, FormControl, Switch, FormControlLabel, Divider,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import BorderStyleIcon from '@mui/icons-material/BorderStyle';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import RouteIcon from '@mui/icons-material/Route';
import ROSLIB from 'roslib';
import { useUiMode } from '../context/UiModeContext';
import { useZones } from '../context/ZonesContext';
import { useWorklines } from '../context/WorklinesContext';
import { useRos } from '../hooks/useRos';
import { toWaypoints } from '../lib/worklines';

/**
 * Sidebar du mode lignes de guidage : saisie des paramètres de génération
 * (zone cible, point d'entrée, bordure de référence, headlands, largeur,
 * obstacles) puis génération et prévisualisation sur la carte.
 * Étape 6.4 : « Valider le parcours » verrouille les lignes (paramètres
 * gelés) et ajoute une tâche avec les WAYPOINTS RÉELS à la file de
 * planification — la mission générée suit exactement ce parcours.
 * Sur la carte : blanc = passages et contours, orange pointillé =
 * transitions (contrôle visuel du trajet du robot).
 */
const WorklinesSidebar: React.FC = () => {
  const { goBack, setMode } = useUiMode();
  const { zones } = useZones();
  const { ros, connectionState } = useRos();
  const {
    params, pickMode, setPickMode, setParams, result, generate, clearResult,
    locked, lock, unlock,
  } = useWorklines();

  const mowZones = zones.filter(z => z.type === 'mow' && z.points.length >= 3);
  const targetZone = zones.find(z => z.id === params.targetZoneId) ?? null;

  // Champs numériques édités comme chaînes (autorise la saisie intermédiaire),
  // la valeur est commitée dans le contexte à chaque changement valide.
  const [headlandsInput, setHeadlandsInput] = React.useState('0');
  const [widthInput, setWidthInput] = React.useState('0.5');

  const commitHeadlands = (v: string) => {
    setHeadlandsInput(v);
    const n = parseInt(v, 10);
    if (!Number.isNaN(n) && n >= 0) setParams({ headlands: n });
  };

  const commitWidth = (v: string) => {
    setWidthInput(v);
    const n = parseFloat(v);
    if (!Number.isNaN(n) && n > 0) setParams({ workingWidthM: n });
  };

  // Marge de sécurité autour des obstacles : vide = demi-largeur de travail
  const [marginInput, setMarginInput] = React.useState('');
  const commitMargin = (v: string) => {
    setMarginInput(v);
    if (v.trim() === '') { setParams({ obstacleMarginM: null }); return; }
    const n = parseFloat(v);
    if (!Number.isNaN(n) && n >= 0) setParams({ obstacleMarginM: n });
  };

  // Resynchronise les champs numériques quand les paramètres changent
  // (changement de zone cible, rechargement d'un parcours validé).
  React.useEffect(() => { setHeadlandsInput(String(params.headlands)); }, [params.headlands]);
  React.useEffect(() => { setWidthInput(String(params.workingWidthM)); }, [params.workingWidthM]);
  React.useEffect(() => {
    setMarginInput(params.obstacleMarginM == null ? '' : String(params.obstacleMarginM));
  }, [params.obstacleMarginM]);

  // ---- Étape 6.4 : validation et verrouillage (PAR ZONE) ----
  // Le taskId de la tâche robot est mémorisé dans le contexte, par zone.
  const [confirmUnlock, setConfirmUnlock] = React.useState(false);

  const validateCourse = () => {
    if (!ros || connectionState !== 'connected' || !result || !targetZone) return;
    const id = 'wl-' + Date.now();
    const cmdPub = new ROSLIB.Topic({
      ros,
      name: '/task/command',
      messageType: 'std_msgs/String',
    });
    cmdPub.publish(new ROSLIB.Message({
      data: JSON.stringify({
        action: 'add_task',
        task: {
          id,
          name: 'Tonte — ' + targetZone.name,
          type: 'mowing',
          field: targetZone.name,
          waypoints: toWaypoints(result),
        },
      }),
    }));
    setConfirmUnlock(false);
    lock(id);
  };

  // Déverrouillage en deux clics (confirmation) : la tâche validée est
  // retirée de la file du robot, les paramètres redeviennent éditables.
  const handleUnlock = () => {
    if (!confirmUnlock) { setConfirmUnlock(true); return; }
    const tid = unlock();
    if (ros && connectionState === 'connected' && tid) {
      const cmdPub = new ROSLIB.Topic({
        ros,
        name: '/task/command',
        messageType: 'std_msgs/String',
      });
      cmdPub.publish(new ROSLIB.Message({
        data: JSON.stringify({ action: 'remove_task', id: tid }),
      }));
    }
    setConfirmUnlock(false);
    unlock();
  };

  return (
    <Card>
      <CardContent>
        <Button startIcon={<ArrowBackIcon />} onClick={goBack} sx={{ mb: 2 }}>
          Retour
        </Button>

        <Typography variant="h6" gutterBottom>Lignes de guidage</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Paramètres de génération pour la zone cible.
        </Typography>

        {/* Zone de tonte cible */}
        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel id="worklines-target-zone-label">Zone de tonte cible</InputLabel>
          <Select
            labelId="worklines-target-zone-label"
            label="Zone de tonte cible"
            value={params.targetZoneId ?? ''}
            onChange={e => setParams({ targetZoneId: e.target.value || null })}
          >
            {mowZones.length === 0 && (
              <MenuItem value="" disabled>Aucune zone de tonte</MenuItem>
            )}
            {mowZones.map(z => (
              <MenuItem key={z.id} value={z.id}>{z.name}</MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Point d'entrée */}
        <Typography variant="subtitle2" gutterBottom>Point d'entrée</Typography>
        {params.entryPoint ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <MyLocationIcon fontSize="small" color="action" />
            <Typography variant="body2" sx={{ flex: 1, fontFamily: 'monospace' }}>
              {params.entryPoint[0].toFixed(6)}, {params.entryPoint[1].toFixed(6)}
            </Typography>
            <Button size="small" disabled={locked} onClick={() => setPickMode('entryPoint')}>
              Replacer
            </Button>
          </Stack>
        ) : (
          <Button
            variant="outlined"
            startIcon={<MyLocationIcon />}
            disabled={!targetZone || locked}
            onClick={() => setPickMode('entryPoint')}
            fullWidth
            sx={{ mb: 1 }}
          >
            Placer le point d'entrée
          </Button>
        )}
        {pickMode === 'entryPoint' && (
          <Alert severity="info" sx={{ mb: 1 }}>
            Clique sur la carte pour placer le point de départ du robot.
          </Alert>
        )}

        <Divider sx={{ my: 2 }} />

        {/* Bordure de référence */}
        <Typography variant="subtitle2" gutterBottom>Bordure de référence</Typography>
        {params.referenceBorderIndex != null && targetZone ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <BorderStyleIcon fontSize="small" color="action" />
            <Typography variant="body2" sx={{ flex: 1 }}>
              Bordure n°{params.referenceBorderIndex + 1}
            </Typography>
            <Button size="small" disabled={locked} onClick={() => setPickMode('referenceBorder')}>
              Changer
            </Button>
          </Stack>
        ) : (
          <Button
            variant="outlined"
            startIcon={<BorderStyleIcon />}
            disabled={!targetZone || locked}
            onClick={() => setPickMode('referenceBorder')}
            fullWidth
            sx={{ mb: 1 }}
          >
            Choisir la bordure de référence
          </Button>
        )}
        {pickMode === 'referenceBorder' && (
          <Alert severity="info" sx={{ mb: 1 }}>
            Clique sur l'arête (en bleu) qui oriente les allers-retours.
          </Alert>
        )}

        <Divider sx={{ my: 2 }} />

        {/* Contours intérieurs */}
        <TextField
          label="Contours intérieurs (headlands)"
          type="number"
          size="small"
          fullWidth
          value={headlandsInput}
          onChange={e => commitHeadlands(e.target.value)}
          disabled={locked}
          onBlur={() => setHeadlandsInput(String(params.headlands))}
          inputProps={{ min: 0, max: 10, step: 1 }}
          helperText="Demi-tours de dégagement avant les allers-retours"
          sx={{ mb: 2 }}
        />

        {/* Largeur de travail */}
        <TextField
          label="Largeur de travail (m)"
          type="number"
          size="small"
          fullWidth
          value={widthInput}
          onChange={e => commitWidth(e.target.value)}
          disabled={locked}
          onBlur={() => setWidthInput(String(params.workingWidthM))}
          inputProps={{ min: 0.1, step: 0.05 }}
          helperText="Espacement entre deux passages"
          sx={{ mb: 2 }}
        />

        {/* Exclusions */}
        <FormControlLabel
          control={
            <Switch
              checked={params.outlineObstacles}
              onChange={e => setParams({ outlineObstacles: e.target.checked })}
              disabled={locked}
            />
          }
          label="Contour autour des obstacles"
        />
        <Typography variant="caption" color="text.secondary">
          Les zones d'exclusion ne sont jamais traversées.
        </Typography>

        {/* Marge de sécurité autour des obstacles */}
        <TextField
          label="Marge de sécurité obstacles (m)"
          type="number"
          size="small"
          fullWidth
          value={marginInput}
          onChange={e => commitMargin(e.target.value)}
          disabled={locked}
          inputProps={{ min: 0, step: 0.05 }}
          helperText="Vide = demi-largeur de travail. Distance minimale aux zones interdites."
          sx={{ mt: 1.5 }}
        />

        <Button
          variant="contained"
          fullWidth
          sx={{ mt: 2 }}
          disabled={!targetZone || locked}
          onClick={generate}
        >
          {locked ? 'Parcours verrouillé' : 'Générer les lignes'}
        </Button>

        {result && (
          <Box sx={{ mt: 1.5 }}>
            <Alert severity="success">
              {result.stats.sweepPasses} passes • {result.stats.headlandLoops} contour
              {result.stats.headlandLoops > 1 ? 's' : ''} • {result.stats.obstacleContours} contour
              {result.stats.obstacleContours > 1 ? 's' : ''} d'obstacle • {result.stats.transitions} transitions
              • {result.stats.totalLengthM} m au total
            </Alert>
            {result.warnings.map((warn, i) => (
              <Alert key={i} severity="warning" sx={{ mt: 1 }}>{warn}</Alert>
            ))}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Sur la carte : blanc = passages entiers ; chaque obstacle a sa PAIRE de couleurs propre (côté 1 / côté 2 : bleu/violet, vert/rose, jaune/indigo…) pour les passages s'arrêtant sur son contour ; transitions pointillées de la couleur du côté destination (orange sinon) ; rouge pointillé = contour d'obstacle.
            </Typography>
            {!locked ? (
              <>
                <Button
                  variant="contained"
                  color="success"
                  fullWidth
                  startIcon={<LockIcon />}
                  sx={{ mt: 1 }}
                  disabled={connectionState !== 'connected'}
                  onClick={validateCourse}
                >
                  Valider le parcours
                </Button>
                {connectionState !== 'connected' && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    ROS 2 non connecté — la validation ajoute la tâche au robot.
                  </Typography>
                )}
                <Button size="small" onClick={clearResult} sx={{ mt: 0.5 }}>
                  Effacer les lignes
                </Button>
              </>
            ) : (
              <>
                <Alert severity="success" sx={{ mt: 1 }} icon={<LockIcon fontSize="inherit" />}>
                  Parcours validé et verrouillé — tâche ajoutée à la file de planification.
                </Alert>
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    color="warning"
                    startIcon={<LockOpenIcon />}
                    onClick={handleUnlock}
                    sx={{ flex: 1 }}
                  >
                    {confirmUnlock ? 'Confirmer ?' : 'Déverrouiller'}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<RouteIcon />}
                    onClick={() => setMode('planning')}
                    sx={{ flex: 1 }}
                  >
                    Planifier
                  </Button>
                </Stack>
              </>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default WorklinesSidebar;
