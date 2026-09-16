import React from 'react';
import { Box, Paper, IconButton, Tooltip } from '@mui/material';
import EditLocationAltIcon from '@mui/icons-material/EditLocationAlt';
import UndoIcon from '@mui/icons-material/Undo';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import { useZones } from '../context/ZonesContext';

/**
 * Toolbar d'édition des zones, flottante sur le côté droit de la carte
 * (style OpenMowerApp). Visible uniquement en mode zones.
 */
export const ZoneToolbar: React.FC = () => {
  const { zones, selectedZoneId, drawMode, setDrawMode, popPoint, deleteZone } = useZones();

  const selectedZone = zones.find(z => z.id === selectedZoneId) ?? null;
  const hasSelection = selectedZone !== null;

  return (
    <Box sx={{ position: 'absolute', right: 16, top: 16, zIndex: 1000 }}>
      <Paper
        elevation={3}
        sx={{ display: 'flex', flexDirection: 'column', p: 0.5, gap: 0.5, borderRadius: 2 }}
      >
        <Tooltip title="Mode dessin — clic sur la carte : ajouter un sommet" placement="left">
          <span>
            <IconButton
              color={drawMode ? 'success' : 'default'}
              onClick={() => setDrawMode(!drawMode)}
              disabled={!hasSelection}
            >
              <EditLocationAltIcon />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="Supprimer le dernier sommet" placement="left">
          <span>
            <IconButton
              onClick={popPoint}
              disabled={!hasSelection || selectedZone!.points.length === 0}
            >
              <UndoIcon />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="Supprimer la zone sélectionnée" placement="left">
          <span>
            <IconButton
              color="error"
              onClick={() => selectedZoneId && deleteZone(selectedZoneId)}
              disabled={!hasSelection}
            >
              <DeleteIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Paper>
    </Box>
  );
};
