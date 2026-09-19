import React, { useEffect, useRef, useState } from 'react';
import { AppBar, Toolbar, Typography, Box, Stack, IconButton, Chip } from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import SettingsIcon from '@mui/icons-material/Settings';
import MapView from './maps/MapView';
import { RobotStatusBar } from './dashboard/RobotStatusBar';
import { ZoneToolbar } from './maps/ZoneToolbar';
import DashboardSidebar from './sidebars/DashboardSidebar';
import PlanningSidebar from './sidebars/PlanningSidebar';
import ZonesSidebar from './sidebars/ZonesSidebar';
import CorridorsSidebar from './sidebars/CorridorsSidebar';
import WorklinesSidebar from './sidebars/WorklinesSidebar';
import SettingsSidebar from './sidebars/SettingsSidebar';
import { useRos } from './hooks/useRos';
import { useColorMode } from './ColorModeContext';
import { UiModeProvider, useUiMode } from './context/UiModeContext';
import { ZonesProvider } from './context/ZonesContext';
import { WorklinesProvider } from './context/WorklinesContext';
import { StationProvider } from './context/StationContext';
import { PlanProvider } from './context/PlanContext';
import { loadSlice, saveSlice } from './lib/storage';

/**
 * Les sidebars restent montées (état préservé, notamment la file
 * de tâches du mode planning quand on part éditer les zones) ; seule celle du
 * mode actif est affichée. La carte reste elle aussi montée en permanence.
 */
const SIDEBAR_DEFAULT = 340;
const SIDEBAR_MIN = 280;
const SIDEBAR_MAX = 640;

const SidebarSwitcher: React.FC = () => {
  const { mode } = useUiMode();

  return (
    <>
      <Box sx={{ display: mode === 'dashboard' ? 'block' : 'none' }}>
        <DashboardSidebar />
      </Box>
      <Box sx={{ display: mode === 'planning' ? 'block' : 'none' }}>
        <PlanningSidebar />
      </Box>
      <Box sx={{ display: mode === 'zones' ? 'block' : 'none' }}>
        <ZonesSidebar />
      </Box>
      <Box sx={{ display: mode === 'corridors' ? 'block' : 'none' }}>
        <CorridorsSidebar />
      </Box>
      <Box sx={{ display: mode === 'worklines' ? 'block' : 'none' }}>
        <WorklinesSidebar />
      </Box>
      <Box sx={{ display: mode === 'settings' ? 'block' : 'none' }}>
        <SettingsSidebar />
      </Box>
    </>
  );
};

/**
 * Superpositions de la carte selon le mode : toolbar d'édition visible
 * en modes zones et corridors SEULEMENT — la planification n'est que
 * l'organisation des tâches et la génération du parcours, l'édition des
 * polygones/chemins n'y a pas lieu (choix utilisateur).
 */
const MapOverlays: React.FC = () => {
  const { mode } = useUiMode();
  if (mode !== 'zones' && mode !== 'corridors') return null;
  return <ZoneToolbar />;
};

/** Bouton réglages de l'AppBar (étape 6.10b) : ouvre la sidebar de
 * configuration du robot (seuils batterie, plus tard géométrie, etc.). */
const SettingsButton: React.FC = () => {
  const { setMode } = useUiMode();
  return (
    <IconButton
      onClick={() => setMode('settings')}
      color="inherit"
      aria-label="réglages du robot"
    >
      <SettingsIcon />
    </IconButton>
  );
};

function App() {
  const { connectionState } = useRos();
  const { mode, toggleColorMode } = useColorMode();

  // Largeur de la sidebar, réglable à la souris via la poignée du bord
  // droit (double-clic : retour à la largeur par défaut). Persistée.
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const v = loadSlice<number>('sidebarWidth', SIDEBAR_DEFAULT);
    const n = typeof v === 'number' && !Number.isNaN(v) ? v : SIDEBAR_DEFAULT;
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));
  });
  useEffect(() => { saveSlice('sidebarWidth', sidebarWidth); }, [sidebarWidth]);

  const resizingRef = useRef(false);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizingRef.current = true;
    document.body.style.userSelect = 'none';
  };
  const doResize = (e: React.PointerEvent) => {
    if (!resizingRef.current) return;
    const w = Math.round(e.clientX - 16); // padding de page
    setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));
  };
  const endResize = (e: React.PointerEvent) => {
    resizingRef.current = false;
    document.body.style.userSelect = '';
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* déjà libéré */ }
  };

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
      <ZonesProvider>
        <WorklinesProvider>
          <StationProvider>
          <PlanProvider>
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
                  left: { md: sidebarWidth + 32 },
                  top: { md: 0 },
                  bottom: { md: 0 },
                  display: 'flex',
                  alignItems: 'center',
                  minWidth: 0,
                }}>
                  <RobotStatusBar />
                </Box>
                <Chip label={'ROS 2 : ' + statusText} color={statusColor as any} size="small" sx={{ mr: 1, flexShrink: 0 }} />
                <SettingsButton />
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
              {/* Sidebar contextuelle — largeur réglable via la poignée,
                  contenu selon le mode */}
              <Box sx={{
                position: 'relative',
                flexShrink: 0,
                width: { xs: '100%', md: sidebarWidth },
              }}>
                <Stack sx={{
                  width: '100%',
                  height: '100%',
                  gap: 2,
                  overflow: 'auto',
                }}>
                  <SidebarSwitcher />
                </Stack>
                <Box
                  onPointerDown={startResize}
                  onPointerMove={doResize}
                  onPointerUp={endResize}
                  onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)}
                  sx={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    right: -4,
                    width: 8,
                    cursor: 'col-resize',
                    zIndex: 10,
                    touchAction: 'none',
                    borderRadius: 1,
                    '&:hover, &:active': { bgcolor: 'action.selected' },
                  }}
                />
              </Box>
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
                <MapOverlays />
              </Box>
            </Box>
          </Box>
          </PlanProvider>
          </StationProvider>
        </WorklinesProvider>
      </ZonesProvider>
    </UiModeProvider>
  );
}

export default App;
