import React from 'react';
import {
  Card, CardContent, Typography, Button, Alert, Stack, Box, Paper, IconButton, TextField,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import BlockIcon from '@mui/icons-material/Block';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import TimelineIcon from '@mui/icons-material/Timeline';
import { useZones } from '../context/ZonesContext';
import { useUiMode } from '../context/UiModeContext';

/**
 * Sidebar du mode édition de zones (polygones) :
 * - création de zones de tonte (palette) ou d'exclusion (rouge : obstacle,
 *   non-tonte — jamais traversée par les lignes de guidage)
 * - liste des zones de TONTE uniquement (sélection + édition, suppression) ;
 *   les exclusions ne sont pas listées : on les édite en cliquant dessus
 *   sur la carte (édition inactive)
 * - renommage de la zone sélectionnée
 * - accès au mode lignes de guidage (dès qu'une zone de tonte est complète)
 */
const ZonesSidebar: React.FC = () => {
  const { goBack, setMode } = useUiMode();
  const {
    zones, selectedZoneId, selectZone, setEditMode, addZone, renameZone, deleteZone, editMode,
  } = useZones();

  const mowZones = zones.filter(z => z.type === 'mow');
  const exclusionCount = zones.filter(z => z.type === 'exclusion').length;
  const selectedZone = zones.find(z => z.id === selectedZoneId) ?? null;
  const hasMowZone = zones.some(z => z.type === 'mow' && z.points.length >= 3);

  return (
    <Card>
      <CardContent>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={goBack}
          sx={{ mb: 2 }}
        >
          Retour
        </Button>

        <Typography variant="h6" gutterBottom>Édition des zones</Typography>

        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Button
            variant="contained"
            color="success"
            startIcon={<AddIcon />}
            onClick={() => addZone('mow')}
            fullWidth
          >
            Zone de tonte
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<BlockIcon />}
            onClick={() => addZone('exclusion')}
            fullWidth
          >
            Exclusion
          </Button>
        </Stack>

        {zones.length === 0 ? (
          <Alert severity="info">
            Crée une zone, puis clique sur la carte pour placer ses sommets.
          </Alert>
        ) : (
          <Stack spacing={1} sx={{ mb: exclusionCount > 0 ? 1 : 2 }}>
            {mowZones.map(zone => (
              <Paper
                key={zone.id}
                onClick={() => {
                  // Sélection depuis la liste = édition directe de la zone.
                  selectZone(zone.id);
                  setEditMode(true);
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1,
                  cursor: 'pointer',
                  borderRadius: 1,
                  border: '2px solid',
                  borderColor: zone.id === selectedZoneId ? zone.color : 'divider',
                  bgcolor: zone.id === selectedZoneId ? 'action.selected' : 'background.default',
                }}
              >
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    bgcolor: zone.color,
                    flexShrink: 0,
                  }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap fontWeight={600}>{zone.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {zone.points.length} sommet{zone.points.length > 1 ? 's' : ''}
                  </Typography>
                </Box>
                <IconButton
                  size="small"
                  onClick={e => {
                    e.stopPropagation();
                    deleteZone(zone.id);
                  }}
                  aria-label="supprimer la zone"
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Paper>
            ))}
          </Stack>
        )}

        {exclusionCount > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            {exclusionCount} exclusion{exclusionCount > 1 ? 's' : ''} — pas dans la liste,
            clique dessus sur la carte pour l'éditer.
          </Typography>
        )}

        {hasMowZone && (
          <Button
            variant="outlined"
            startIcon={<TimelineIcon />}
            onClick={() => setMode('worklines')}
            fullWidth
            sx={{ mb: 2 }}
          >
            Lignes de guidage
          </Button>
        )}

        {selectedZone && (
          <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
            <TextField
              size="small"
              label="Nom de la zone"
              fullWidth
              value={selectedZone.name}
              onChange={e => renameZone(selectedZone.id, e.target.value)}
              sx={{ mb: 1 }}
            />
            {editMode ? (
              <Typography variant="caption" color="text.secondary">
                Édition active : clique sur la carte pour ajouter un sommet. Glisse les
                pastilles pour les déplacer, clic droit sur une pastille pour la supprimer.
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary">
                Édition inactive : active le bouton crayon (à droite de la carte) pour
                ajouter ou déplacer des sommets.
              </Typography>
            )}
          </Box>
        )}

        <Alert severity="info" sx={{ mt: 2 }}>
          Les zones d'exclusion (rouge) ne sont jamais traversées par les lignes de guidage.
          Persistance à venir.
        </Alert>
      </CardContent>
    </Card>
  );
};

export default ZonesSidebar;
