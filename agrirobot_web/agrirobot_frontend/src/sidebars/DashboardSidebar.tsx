import React, { useState } from 'react';
import {
  Card, CardContent, Typography, Stack, Button, Slider, Switch,
  FormControlLabel, MenuItem, TextField, Divider,
} from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import StopIcon from '@mui/icons-material/Stop';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ROSLIB from 'roslib';

import { CurrentTaskCard } from '../dashboard/CurrentTaskCard';
import { useNav2Status } from '../hooks/useNav2Status';
import { useRos } from '../hooks/useRos';
import { useUiMode } from '../context/UiModeContext';
import { useZones } from '../context/ZonesContext';

/** Options de generation exposees par f2c_planner_node v2 (F2C 2.1.0). */
export interface GenOptions {
  workWidth: number;
  headlandPasses: number;
  mowHeadland: boolean;
  refAngleDeg: number | null;
  sgObj: string;
  rpAlg: string;
  ppAlg: string;
  minTurningRadius: number;
}

export const DEFAULT_OPTIONS: GenOptions = {
  workWidth: 0.5,
  headlandPasses: 1,
  mowHeadland: true,
  refAngleDeg: null,
  sgObj: 'field_cov',
  rpAlg: 'boustrophedon',
  ppAlg: 'reeds_shepp',
  minTurningRadius: 0.3,
};

const SG_OBJ_LABELS: Record<string, string> = {
  field_cov: 'Couverture max',
  n_swath: 'Nb passes min',
  n_swath_mod: 'Nb passes min (mod)',
  overlaps: 'Chevauchements min',
  swath_length: 'Longueur min',
};

const RP_LABELS: Record<string, string> = {
  boustrophedon: 'Boustrophedon',
  snake: 'Serpent',
  spiral: 'Spirale',
};

const PP_LABELS: Record<string, string> = {
  dubins: 'Marche avant seule (Dubins)',
  dubins_cc: 'Dubins + continuite',
  reeds_shepp: 'Avant/arriere (Reeds-Shepp)',
  reeds_shepp_hc: 'Reeds-Shepp HC',
};

/**
 * Sidebar Dashboard (banc feat/nav2-f2c, etape options F2C) :
 * - panneau de generation : TOUS les curseurs F2C reglables, bouton
 *   "Apercu" (le plan s affiche, le robot ne bouge PAS) ;
 * - "Tondre les zones" : genere puis envoie start_mission au superviseur ;
 * - controle mission : Pause / Reprendre / Arreter ;
 * - si un plan est en attente : bouton "Lancer la mission".
 */
const DashboardSidebar: React.FC = () => {
  const { ros, connectionState } = useRos();
  const { mission } = useNav2Status();
  const { setMode } = useUiMode();
  const { zones } = useZones();
  const [opts, setOpts] = useState<GenOptions>(DEFAULT_OPTIONS);

  const disabled = connectionState !== 'connected';
  const missionRunning = mission?.status === 'running';
  const missionPaused = mission?.status === 'paused';
  const missionPending = mission?.status === 'pending';
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

  const buildPayload = () => {
    const mowZone = zones.find(z => z.type === 'mow' && z.points.length >= 3);
    if (!mowZone) {
      window.alert("Dessine d'abord une zone de tonte (mode Zones, bouton vert).");
      return null;
    }
    const exclusions = zones
      .filter(z => z.type === 'exclusion' && z.points.length >= 3)
      .map(z => z.points);
    return {
      action: 'generate_coverage',
      zones: { mow: mowZone.points, exclusions },
      params: {
        workWidth: opts.workWidth,
        headlandPasses: opts.headlandPasses,
        mowHeadland: opts.mowHeadland,
        refAngleDeg: opts.refAngleDeg,
        sgObj: opts.sgObj,
        rpAlg: opts.rpAlg,
        ppAlg: opts.ppAlg,
        minTurningRadius: opts.minTurningRadius,
      },
    };
  };

  const handlePreview = () => {
    const payload = buildPayload();
    if (payload) sendCommand(payload);
  };

  const handleMow = () => {
    const payload = buildPayload();
    if (!payload) return;
    sendCommand(payload);
    setTimeout(() => sendCommand({ action: 'start_mission' }), 800);
  };

  return (
    <>
      <Card>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            Génération du plan (Fields2Cover)
          </Typography>

          <Typography variant="caption" color="text.secondary">
            Largeur de travail : {opts.workWidth.toFixed(2)} m
          </Typography>
          <Slider
            value={opts.workWidth}
            onChange={(_, v) => setOpts({ ...opts, workWidth: v as number })}
            min={0.2} max={1.5} step={0.05} size="small"
            disabled={disabled} valueLabelDisplay="auto"
          />

          <TextField
            select fullWidth size="small" margin="dense"
            label="Contour (headland)"
            value={opts.headlandPasses}
            onChange={e => setOpts({ ...opts, headlandPasses: Number(e.target.value) })}
            disabled={disabled}
          >
            <MenuItem value={0}>Aucun (passes plein champ)</MenuItem>
            <MenuItem value={1}>1 passe</MenuItem>
            <MenuItem value={2}>2 passes</MenuItem>
            <MenuItem value={3}>3 passes</MenuItem>
          </TextField>

          <FormControlLabel
            control={
              <Switch
                checked={opts.mowHeadland}
                onChange={e => setOpts({ ...opts, mowHeadland: e.target.checked })}
                disabled={disabled || opts.headlandPasses === 0}
                size="small"
              />
            }
            label={<Typography variant="body2">Contour tondu (sinon réservé aux demi-tours)</Typography>}
          />

          <TextField
            select fullWidth size="small" margin="dense"
            label="Angle des passes"
            value={opts.refAngleDeg === null ? 'auto' : String(opts.refAngleDeg)}
            onChange={e => {
              const v = e.target.value;
              setOpts({ ...opts, refAngleDeg: v === 'auto' ? null : Number(v) });
            }}
            disabled={disabled}
          >
            <MenuItem value="auto">Automatique (optimal)</MenuItem>
            <MenuItem value="0">0° (est)</MenuItem>
            <MenuItem value="45">45°</MenuItem>
            <MenuItem value="90">90° (nord)</MenuItem>
            <MenuItem value="135">135°</MenuItem>
          </TextField>

          <TextField
            select fullWidth size="small" margin="dense"
            label="Optimisation des passes"
            value={opts.sgObj}
            onChange={e => setOpts({ ...opts, sgObj: e.target.value })}
            disabled={disabled}
          >
            {Object.entries(SG_OBJ_LABELS).map(([k, l]) => (
              <MenuItem key={k} value={k}>{l}</MenuItem>
            ))}
          </TextField>

          <TextField
            select fullWidth size="small" margin="dense"
            label="Ordre des passes"
            value={opts.rpAlg}
            onChange={e => setOpts({ ...opts, rpAlg: e.target.value })}
            disabled={disabled}
          >
            {Object.entries(RP_LABELS).map(([k, l]) => (
              <MenuItem key={k} value={k}>{l}</MenuItem>
            ))}
          </TextField>

          <TextField
            select fullWidth size="small" margin="dense"
            label="Virages"
            value={opts.ppAlg}
            onChange={e => setOpts({ ...opts, ppAlg: e.target.value })}
            disabled={disabled}
          >
            {Object.entries(PP_LABELS).map(([k, l]) => (
              <MenuItem key={k} value={k}>{l}</MenuItem>
            ))}
          </TextField>

          <Typography variant="caption" color="text.secondary">
            Rayon de braquage : {opts.minTurningRadius.toFixed(2)} m
          </Typography>
          <Slider
            value={opts.minTurningRadius}
            onChange={(_, v) => setOpts({ ...opts, minTurningRadius: v as number })}
            min={0.2} max={1.0} step={0.05} size="small"
            disabled={disabled} valueLabelDisplay="auto"
          />

          <Divider sx={{ my: 1.5 }} />
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<VisibilityIcon />}
              onClick={handlePreview}
              disabled={disabled}
              fullWidth
            >
              Aperçu
            </Button>
            <Button
              variant="contained"
              color="success"
              startIcon={<PlayArrowIcon />}
              onClick={handleMow}
              disabled={disabled || robotBusy}
              fullWidth
            >
              Tondre
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            Aperçu = plan affiché sans navigation. Tondre = plan + départ robot.
          </Typography>
        </CardContent>
      </Card>

      <CurrentTaskCard />

      <Card>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            Contrôle de la mission
          </Typography>
          <Stack direction="row" spacing={1}>
            {missionPending && (
              <Button
                variant="contained"
                color="success"
                startIcon={<PlayArrowIcon />}
                onClick={() => sendCommand({ action: 'start_mission' })}
                disabled={disabled}
                fullWidth
              >
                Lancer la mission
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
          </Stack>
        </CardContent>
      </Card>

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
