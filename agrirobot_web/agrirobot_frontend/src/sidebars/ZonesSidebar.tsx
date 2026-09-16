import React from 'react';
import { Card, CardContent, Typography, Button, Alert } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useUiMode } from '../context/UiModeContext';

/**
 * Sidebar du mode édition de zones (polygones), style OpenMowerApp.
 * Contenu fonctionnel à venir (étape 5) : création / édition / suppression
 * de polygones via les outils de la carte.
 */
const ZonesSidebar: React.FC = () => {
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

        <Typography variant="h6" gutterBottom>Édition des zones</Typography>

        <Alert severity="info">
          Étape 5 à venir : création et édition de polygones directement sur la carte,
          avec panneau d'outils latéral façon OpenMowerApp.
        </Alert>
      </CardContent>
    </Card>
  );
};

export default ZonesSidebar;
