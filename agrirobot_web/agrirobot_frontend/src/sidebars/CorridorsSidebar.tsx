import React from 'react';
import {
  Card, CardContent, Typography, Button, Alert, Stack, Box, Paper,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import { useZones, CORRIDOR_COLOR } from '../context/ZonesContext';
import { corridorWarnings } from '../lib/corridors';
import { useUiMode } from '../context/UiModeContext';

/**
 * Sidebar du mode chemins de liaison (étape 6.6) :
 * - création d'un chemin, puis clics sur la carte pour tracer
 * - liste des chemins avec état de conformité (clic = édition directe)
 * - pas de renommage : comme les exclusions, un chemin est une
 *   infrastructure sans identité propre
 * - la conformité est aussi contrôlée dans la planification avant la
 *   génération du parcours
 */
const CorridorsSidebar: React.FC = () => {
  const { goBack } = useUiMode();
  const {
    zones, corridors, selectedCorridorId, selectCorridor, selectZone,
    selectedZoneId, setEditMode, setAddMode, addCorridor,
  } = useZones();

  // En mode chemins, on n'édite pas les polygones : la sélection de zone
  // éventuellement héritée du mode zones est libérée.
  React.useEffect(() => {
    if (selectedZoneId) selectZone(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

        <Typography variant="h6" gutterBottom>Chemins de liaison</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Les chemins relient la station (à venir) et les zones de tonte :
          c'est le seul passage autorisé pour sortir d'un polygone.
        </Typography>

        <Button
          variant="contained"
          startIcon={<AltRouteIcon />}
          onClick={addCorridor}
          fullWidth
          sx={{ mb: 1.5 }}
          style={{ backgroundColor: CORRIDOR_COLOR }}
        >
          Ajouter un chemin
        </Button>

        {corridors.length === 0 ? (
          <Alert severity="info">
            Ajoute un chemin, puis clique sur la carte pour tracer. Le tracé
            suit le curseur (élastique) : dessine dans le sens que tu veux.
          </Alert>
        ) : (
          <Stack spacing={1} sx={{ mb: 2 }}>
            {corridors.map(corridor => {
              const warnings = corridorWarnings(corridor, zones);
              return (
                <Paper
                  key={corridor.id}
                  onClick={() => {
                    // Sélection = édition directe sur la carte, sans
                    // ajout de points (déplacement des poignées).
                    selectCorridor(corridor.id);
                    setEditMode(true);
                    setAddMode(false);
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    p: 1,
                    cursor: 'pointer',
                    borderRadius: 1,
                    border: '2px solid',
                    borderColor: corridor.id === selectedCorridorId ? CORRIDOR_COLOR : 'divider',
                    bgcolor: corridor.id === selectedCorridorId ? 'action.selected' : 'background.default',
                  }}
                >
                  <AltRouteIcon sx={{ color: CORRIDOR_COLOR, fontSize: 20, flexShrink: 0 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography noWrap fontWeight={600}>{corridor.name}</Typography>
                    {warnings.length > 0 ? (
                      warnings.map((w, i) => (
                        <Typography key={i} variant="caption" color="error" sx={{ display: 'block' }}>
                          ⚠ {w}
                        </Typography>
                      ))
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {corridor.points.length} point{corridor.points.length > 1 ? 's' : ''} — valide
                      </Typography>
                    )}
                  </Box>
                </Paper>
              );
            })}
          </Stack>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Édition : glisse les pastilles pour déplacer, pastilles translucides
          pour insérer un point, clic droit pour supprimer. Pour prolonger le
          tracé au clic carte, active le bouton « + » de la toolbar (actif
          automatiquement à la création). Un point posé près du portail
          (point d'entrée) d'une zone s'y colle automatiquement.
        </Typography>
      </CardContent>
    </Card>
  );
};

export default CorridorsSidebar;
