import React from 'react';
import { AppBar, Toolbar, Typography, Box, Stack, IconButton, Chip } from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import MapView from './maps/MapView';
import { RobotStatusBar } from './dashboard/RobotStatusBar';
import DashboardSidebar from './sidebars/DashboardSidebar';
import PlanningSidebar from './sidebars/PlanningSidebar';
import ZonesSidebar from './sidebars/ZonesSidebar';
import { useRos } from './hooks/useRos';
import { useColorMode } from './ColorModeContext';
import { UiModeProvider, useUiMode } from './context/UiModeContext';

/**
 * Sélecteur de sidebar contextuelle.
 * La carte Leaflet reste montée en permanence (pas de perte du flux rosbridge),
 * seul le contenu de la sidebar gauche change selon le mode.
 */
const SidebarSwitcher: React.FC = () => {
  const { mode } = useUiMode();

  switch (mode) {
    case 'planning':
      return <PlanningSidebar />;
    case 'zones':
      return <ZonesSidebar />;
    default:
      return <DashboardSidebar />;
  }
};

function App() {
  const { connectionState } = useRos();
  const { mode, toggleColorMode } = useColorMode();

  const statusText =
    connectionState === 'connected' ? 'Connecté'
    : connectionState === 'connecting' ? 'Connexion…'
    : 'Déconnecté';
  const statusColor =
    connectionState === 'connected' ? 'success'
    : connectionState === 'connecting' ? 'warning'
    : 'error';

  return (
    <UiModeProvider>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
        <AppBar position="static" color="default" elevation={0} sx={{ bgcolor: 'background.paper' }}>
          <Toolbar sx={{ position: 'relative' }}>
            <Typography variant="h6" component="h1" sx={{ flexGrow: 1, fontWeight: 700 }}>
              AgriRobot — Gestion des robots agricoles
            </Typography>
            {/*
              Pilule d'état du robot, dans la barre du haut, alignée sur le bord
              gauche de la carte : padding page 16 + sidebar 340 + gap 16 = 372px.
            */}
            <Box sx={{
              position: { xs: 'static', md: 'absolute' },
              left: { md: 372 },
              top: { md: 0 },
              bottom: { md: 0 },
              display: 'flex',
              alignItems: 'center',
              minWidth: 0,
            }}>
              <RobotStatusBar />
            </Box>
            <Chip label={'ROS 2 : ' + statusText} color={statusColor as any} size="small" sx={{ mr: 1, flexShrink: 0 }} />
            <IconButton onClick={toggleColorMode} color="inherit" aria-label="basculer le mode sombre">
              {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Toolbar>
        </AppBar>
        <Box sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          gap: 2,
          p: 2,
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}>
          {/* Sidebar contextuelle — largeur fixe, contenu selon le mode */}
          <Stack sx={{
            width: { xs: '100%', md: 340 },
            flexShrink: 0,
            gap: 2,
            overflow: 'auto',
          }}>
            <SidebarSwitcher />
          </Stack>
          {/* Carte — occupe tout l'espace restant, jamais démontée */}
          <Box sx={{
            flex: 1,
            position: 'relative',
            minHeight: 0,
            borderRadius: 2,
            overflow: 'hidden',
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: 1,
          }}>
            <MapView />
          </Box>
        </Box>
      </Box>
    </UiModeProvider>
  );
}

export default App;
