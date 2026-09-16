import React from 'react';
import { Box, Paper, IconButton, Tooltip } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import UndoIcon from '@mui/icons-material/Undo';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import { useZones } from '../context/ZonesContext';

/**
 * Toolbar d'édition des zones, flottante sur le côté droit de la carte
 * (style OpenMowerApp). Visible uniquement en mode zones.
 * - bouton Édition : active/désactive l'édition des polygones (poignées,
 *   ajout de sommets au clic). Désactivée = carte propre et cliquable
 *   sans effet, utile pour créer une zone dans une autre sans détourner
 *   les clics.
 * - annulation du dernier sommet, suppression de la zone sélectionnée
 */
export const ZoneToolbar: React.FC = () => {
  const { zones, selectedZoneId, editMode, setEditMode, popPoint, deleteZone } = useZones();

  const selectedZone = zones.find(z => z.id === selectedZoneId) ?? null;
  const hasSelection = selectedZone !== null;

  return (
    <Box sx={{ position: 'absolute', right: 16, top: 16, zIndex: 1000 }}>
      <Paper
        elevation={3}
        sx={{ display: 'flex', flexDirection: 'column', p: 0.5, gap: 0.5, borderRadius: 2 }}
      >
        <Tooltip
          title={
            editMode
              ? "Désactiver l'édition — poignées masquées, clics sans effet"
              : "Activer l'édition — poignées visibles, clic carte : ajouter un sommet"
          }
          placement="left"
        >
          <IconButton
            color={editMode ? 'success' : 'default'}
            onClick={() => setEditMode(!editMode)}
          >
            <EditIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title="Supprimer le dernier sommet" placement="left">
          <span>
            <IconButton
              onClick={popPoint}
              disabled={!hasSelection || !editMode || selectedZone!.points.length === 0}
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
