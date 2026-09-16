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
 * - liste des zones (sélection, suppression)
 * - renommage de la zone sélectionnée
 * - accès au mode lignes de guidage (dès qu'une zone de tonte est complète)
 */
const ZonesSidebar: React.FC = () => {
  const { goBack, setMode } = useUiMode();
  const { zones, selectedZoneId, selectZone, addZone, renameZone, deleteZone } = useZones();

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
          <Stack spacing={1} sx={{ mb: 2 }}>
            {zones.map(zone => (
              <Paper
                key={zone.id}
                onClick={() => selectZone(zone.id)}
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
                    {zone.type === 'exclusion' ? 'Exclusion • ' : ''}
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
            <Typography variant="caption" color="text.secondary">
              Clique sur la carte pour ajouter un sommet. Glisse les pastilles pour les
              déplacer, clic droit sur une pastille pour la supprimer.
            </Typography>
          </Box>
        )}

        <Alert severity="info" sx={{ mt: 2 }}>
          Les zones d'exclusion (rouge) ne seront jamais traversées par les lignes de
          guidage. Persistance à venir.
        </Alert>
      </CardContent>
    </Card>
  );
};

export default ZonesSidebar;
