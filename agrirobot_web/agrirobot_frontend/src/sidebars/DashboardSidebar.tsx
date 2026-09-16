import React from 'react';
import { Card, CardContent, Typography, Stack, Button } from '@mui/material';
import ScheduleIcon from '@mui/icons-material/Schedule';
import MapIcon from '@mui/icons-material/Map';
import RobotInfo from '../robot/RobotInfo';
import TaskList from '../tasks/TaskList';
import { useUiMode } from '../context/UiModeContext';

/**
 * Sidebar principale (mode dashboard) : état du robot, tâches en cours
 * et accès aux autres modes de l'interface.
 */
const DashboardSidebar: React.FC = () => {
  const { setMode } = useUiMode();

  return (
    <>
      <RobotInfo />
      <TaskList />

      <Card>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>Navigation</Typography>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<ScheduleIcon />}
              onClick={() => setMode('planning')}
              sx={{ flex: 1 }}
            >
              Planifier les tâches
            </Button>
            <Button
              variant="outlined"
              startIcon={<MapIcon />}
              onClick={() => setMode('zones')}
              sx={{ flex: 1 }}
            >
              Zones
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </>
  );
};

export default DashboardSidebar;
