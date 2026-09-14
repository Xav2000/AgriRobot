import React from 'react';
import { Box, CssBaseline, ThemeProvider } from '@mui/material';
import { ColorModeContext } from './ColorModeContext';
import { MapView } from './maps/MapView';
import RobotInfo from './robot/RobotInfo';
import TaskList from './tasks/TaskList';
import theme from './theme';

function App() {
  const [mode, setMode] = React.useState<'light' | 'dark'>('light');
  const colorMode = React.useMemo(
    () => ({
      toggleColorMode: () => {
        setMode((prevMode) => (prevMode === 'light' ? 'dark' : 'light'));
      },
    }),
    [setMode],
  );

  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme(mode)}>
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