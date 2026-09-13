import React from 'react';
import { AppBar, Toolbar, Typography, Box, Stack, IconButton, Chip } from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import MapView from './maps/MapView';
import TaskList from './tasks/TaskList';
import RobotInfo from './robot/RobotInfo';
import { useRos } from './hooks/useRos';
import { useColorMode } from './ColorModeContext';

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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" color="default" elevation={0} sx={{ bgcolor: 'background.paper' }}>
        <Toolbar>
          <Typography variant="h6" component="h1" sx={{ flexGrow: 1, fontWeight: 700 }}>
            AgriRobot — Gestion des robots agricoles
          </Typography>
          <Chip label={'ROS 2 : ' + statusText} color={statusColor as any} size="small" sx={{ mr: 1 }} />
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
        {/* Sidebar à gauche — largeur fixe */}
        <Stack sx={{
          width: { xs: '100%', md: 340 },
          flexShrink: 0,
          gap: 2,
          overflow: 'auto',
        }}>
          <RobotInfo />
          <TaskList />
        </Stack>
        {/* Carte — occupe tout l'espace restant */}
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
  );
}

export default App;
