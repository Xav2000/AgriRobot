import React from 'react';
import { Card, CardContent, Typography, Button, Alert } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useUiMode } from '../context/UiModeContext';

/**
 * Sidebar du mode planification : gestion de la file de tâches.
 * Contenu fonctionnel à venir (étape 3) : ajout, retrait, priorisation
 * (drag & drop) et génération du parcours principal.
 */
const PlanningSidebar: React.FC = () => {
  const { setMode } = useUiMode();

  return (
    <Card>
      <CardContent>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => setMode('dashboard')}
          sx={{ mb: 2 }}
        >
          Retour
        </Button>

        <Typography variant="h6" gutterBottom>Planification des tâches</Typography>

        <Alert severity="info">
          Étape 3 à venir : ajout / retrait / réordonnancement des tâches (drag &amp; drop)
          puis génération du parcours principal.
        </Alert>
      </CardContent>
    </Card>
  );
};

export default PlanningSidebar;
