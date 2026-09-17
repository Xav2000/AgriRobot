import React from 'react';
import {
  Card, CardContent, Typography, Button, Alert, Stack, Box, TextField, Select,
  MenuItem, InputLabel, FormControl, Switch, FormControlLabel, Divider,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import BorderStyleIcon from '@mui/icons-material/BorderStyle';
import { useUiMode } from '../context/UiModeContext';
import { useZones } from '../context/ZonesContext';
import { useWorklines } from '../context/WorklinesContext';

/**
 * Sidebar du mode lignes de guidage : saisie des paramètres de génération
 * (zone cible, point d'entrée, bordure de référence, headlands, largeur,
 * obstacles) puis génération et prévisualisation sur la carte.
 * Sur la carte : blanc = passages et contours, orange pointillé =
 * transitions (contrôle visuel du trajet du robot).
 */
const WorklinesSidebar: React.FC = () => {
  const { goBack } = useUiMode();
  const { zones } = useZones();
  const { params, pickMode, setPickMode, setParams, result, generate, clearResult } = useWorklines();

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
            <Button size="small" onClick={() => setPickMode('entryPoint')}>
              Replacer
            </Button>
          </Stack>
        ) : (
          <Button
            variant="outlined"
            startIcon={<MyLocationIcon />}
            disabled={!targetZone}
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
            <Button size="small" onClick={() => setPickMode('referenceBorder')}>
              Changer
            </Button>
          </Stack>
        ) : (
          <Button
            variant="outlined"
            startIcon={<BorderStyleIcon />}
            disabled={!targetZone}
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
          inputProps={{ min: 0, step: 0.05 }}
          helperText="Vide = demi-largeur de travail. Distance minimale aux zones interdites."
          sx={{ mt: 1.5 }}
        />

        <Button
          variant="contained"
          fullWidth
          sx={{ mt: 2 }}
          disabled={!targetZone}
          onClick={generate}
        >
          Générer les lignes
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
              Sur la carte : blanc = passages entiers ; bleu, violet… = passages raccourcis par l'obstacle, une couleur par phase de parcours (changée à chaque contour d'obstacle) ; orange pointillé = transitions, rouge pointillé = contour d'obstacle.
            </Typography>
            <Button size="small" onClick={clearResult} sx={{ mt: 0.5 }}>
              Effacer les lignes
            </Button>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default WorklinesSidebar;
