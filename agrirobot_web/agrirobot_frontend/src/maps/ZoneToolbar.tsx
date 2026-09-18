import React, { useState } from 'react';
import {
  Box, Paper, IconButton, Tooltip, Dialog, DialogTitle, DialogContent,
  DialogContentText, DialogActions, Button,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import AddLocationIcon from '@mui/icons-material/AddLocation';
import UndoIcon from '@mui/icons-material/Undo';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import { useZones } from '../context/ZonesContext';

/**
 * Toolbar d'édition, flottante sur le côté droit de la carte
 * (style OpenMowerApp). Visible en mode zones (polygones) et en mode
 * planification (chemins de liaison).
 * - bouton Édition : active/désactive l'édition (poignées
 *   déplaçables). Désactivée = carte propre et cliquable sans effet,
 *   utile pour créer une zone dans une autre sans détourner les clics.
 * - bouton Ajout : le clic carte crée des points. Activé
 *   automatiquement à la création d'un objet, DÉSACTIVÉ quand on
 *   revient éditer un objet existant (pas de sommets parasites à
 *   côté de ceux qu'on déplace).
 * - annulation du dernier point
 * - suppression de la sélection (zone ou chemin de liaison), AVEC
 *   confirmation : un appui trop rapide ne détruit plus le travail
 *   (choix utilisateur)
 */
export const ZoneToolbar: React.FC = () => {
  const {
    zones, selectedZoneId, editMode, setEditMode, addMode, setAddMode, popPoint, deleteZone,
    corridors, selectedCorridorId, popCorridorPoint, deleteCorridor,
  } = useZones();

  const [confirmDelete, setConfirmDelete] = useState(false);

  const selectedZone = zones.find(z => z.id === selectedZoneId) ?? null;
  const selectedCorridor = corridors.find(c => c.id === selectedCorridorId) ?? null;
  const hasSelection = selectedZone !== null || selectedCorridor !== null;

  const deleteLabel = selectedCorridor
    ? 'le chemin de liaison « ' + selectedCorridor.name + ' »'
    : selectedZone
      ? 'la zone « ' + selectedZone.name + ' »'
      : '';

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
              : "Activer l'édition — poignées visibles, clic carte : ajouter un point"
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

        <Tooltip
          title={
            addMode
              ? "Ajout de points ACTIF — le clic carte crée un point (désactiver pour déplacer seulement)"
              : "Activer l'ajout de points — le clic carte créera un nouveau point"
          }
          placement="left"
        >
          <span>
            <IconButton
              color={addMode ? 'primary' : 'default'}
              onClick={() => setAddMode(!addMode)}
              disabled={!hasSelection || !editMode}
            >
              <AddLocationIcon />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="Supprimer le dernier point" placement="left">
          <span>
            <IconButton
              onClick={() => {
                if (selectedCorridorId) popCorridorPoint();
                else if (selectedZoneId) popPoint();
              }}
              disabled={
                !hasSelection ||
                !editMode ||
                !addMode ||
                (selectedCorridor
                  ? selectedCorridor.points.length === 0
                  : selectedZone!.points.length === 0)
              }
            >
              <UndoIcon />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="Supprimer la sélection (zone ou chemin de liaison)" placement="left">
          <span>
            <IconButton
              color="error"
              onClick={() => setConfirmDelete(true)}
              disabled={!hasSelection}
            >
              <DeleteIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Paper>

      {/* Confirmation avant suppression : évite la perte d'un travail
          d'un appui trop rapide sur la corbeille. */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Supprimer ?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Supprimer définitivement {deleteLabel} ?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Annuler</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (selectedCorridorId) deleteCorridor(selectedCorridorId);
              else if (selectedZoneId) deleteZone(selectedZoneId);
              setConfirmDelete(false);
            }}
          >
            Supprimer
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
