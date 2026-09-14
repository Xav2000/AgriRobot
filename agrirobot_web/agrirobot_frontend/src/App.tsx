import React from 'react';
import { Box, CssBaseline, ThemeProvider } from '@mui/material';
import { ColorModeContext, useMode } from './ColorModeContext';
import { MapView } from './maps/MapView';
import RobotInfo from './robot/RobotInfo';
import TaskList from './tasks/TaskList';

function App() {
  const [mode, colorMode] = useMode();

  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeProvider theme={mode === 'light' ? /* ton thème light */ : /* ton thème dark */}>
        <CssBaseline />
        <Box sx={{ display: 'flex', height: '100vh' }}>
          {/* Sidebar gauche */}
          <Box sx={{ width: 340, p: 2, overflowY: 'auto' }}>
            <RobotInfo />
            <TaskList />
          </Box>
          {/* Carte principale */}
          <Box sx={{ flex: 1, position: 'relative' }}>
            <MapView />
          </Box>
        </Box>
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}

export default App;