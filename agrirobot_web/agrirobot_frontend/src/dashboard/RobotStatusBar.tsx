import React from 'react';
import { Paper, Typography, Box, Chip } from '@mui/material';
import BuildIcon from '@mui/icons-material/Build';
import { useNav2Status } from '../hooks/useNav2Status';

const STATUS_INFO: Record<
  string,
  { color: 'success' | 'warning' | 'info' | 'error' | 'default'; label: string }
> = {
  running: { color: 'success', label: 'En travail' },
  paused:  { color: 'warning', label: 'En pause' },
  done:    { color: 'info',    label: 'Mission terminée' },
  aborted: { color: 'error',   label: 'Mission annulée' },
};

/**
 * Pilule d'etat du robot (banc feat/nav2-f2c) :
 * - statut de la mission (/mission/state) ;
 * - outil actif / releve (/tool/state).
 * Batterie, meteo, RTK et station : non supportes par ce banc -
 * a recabler quand le materiel reel existera.
 */
export const RobotStatusBar: React.FC = () => {
  const { mission, toolActive } = useNav2Status();

  const statusInfo = mission && STATUS_INFO[mission.status]
    ? STATUS_INFO[mission.status]
    : { color: 'default' as const, label: 'Inactif' };

  const total = mission?.totalWaypoints ?? 0;
  const done = mission?.completedWaypoints ?? 0;

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
        <Chip color={statusInfo.color} label={statusInfo.label} size="small" />
        {mission && total > 0 && (
          <Typography variant="caption" sx={{ lineHeight: 1 }}>
            {done}/{total} waypoints
          </Typography>
        )}
        <Chip
          size="small"
          icon={<BuildIcon />}
          color={toolActive ? 'success' : 'default'}
          label={toolActive ? 'Outil actif' : 'Outil relevé'}
          sx={toolActive ? {} : { opacity: 0.6 }}
        />
      </Paper>
    </Box>
  );
};
