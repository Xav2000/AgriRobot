import React from 'react';
import {
  Card, CardContent, Typography, Button, Alert, Stack, Box, Paper, IconButton, TextField,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import { useZones } from '../context/ZonesContext';
import { useUiMode } from '../context/UiModeContext';

/**
 * Sidebar du mode édition de zones (polygones) :
 * - liste des zones (sélection, suppression)
 * - création de zone (passe automatiquement en mode dessin)
 * - renommage de la zone sélectionnée
 */
const ZonesSidebar: React.FC = () => {
  const { goBack } = useUiMode();
  const { zones, selectedZoneId, selectZone, addZone, renameZone, deleteZone } = useZones();

  const selectedZone = zones.find(z => z.id === selectedZoneId) ?? null;

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

        <Button
          variant="contained"
          color="success"
          startIcon={<AddIcon />}
          onClick={addZone}
          fullWidth
          sx={{ mb: 2 }}
        >
          Nouvelle zone
        </Button>

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
          Persistance des zones (fichier JSON côté ROS) à venir — elles sont conservées
          pendant la session.
        </Alert>
      </CardContent>
    </Card>
  );
};

export default ZonesSidebar;
