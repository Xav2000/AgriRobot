import React, { useState, useEffect } from 'react';
import {
  Card, CardContent, Typography, Box, TextField, Select, MenuItem,
  Button, Chip, List, ListItem, Stack, Alert,
} from '@mui/material';
import ROSLIB from 'roslib';
import { useRos } from '../hooks/useRos';

interface Task {
  id: string;
  name: string;
  type: 'mowing' | 'plowing' | 'seeding' | 'custom';
  status: 'pending' | 'running' | 'completed' | 'failed';
  field?: string;
  priority?: number;
}

const TaskList: React.FC = () => {
  const { ros, connectionState } = useRos();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskType, setNewTaskType] = useState<Task['type']>('mowing');

  useEffect(() => {
    if (!ros || connectionState !== 'connected') return;

    const tasksTopic = new ROSLIB.Topic({
      ros: ros,
      name: '/tasks/list',
      messageType: 'std_msgs/String'
    });

    tasksTopic.subscribe((msg: any) => {
      try {
        const taskList = JSON.parse(msg.data);
        if (Array.isArray(taskList)) {
          setTasks(taskList);
        }
      } catch (e) {
        console.error('Erreur de parsing des tâches:', e);
      }
    });

    return () => {
      tasksTopic.unsubscribe();
    };
  }, [ros, connectionState]);

  const handleAddTask = () => {
    if (!newTaskName.trim() || !ros || connectionState !== 'connected') return;

    const newTask: Task = {
      id: Date.now().toString(),
      name: newTaskName,
      type: newTaskType,
      status: 'pending'
    };

    const cmdPub = new ROSLIB.Topic({
      ros: ros,
      name: '/task/command',
      messageType: 'std_msgs/String'
    });

    cmdPub.publish(new ROSLIB.Message({
      data: JSON.stringify({ action: 'add_task', task: newTask })
    }));

    setTasks([...tasks, newTask]);
    setNewTaskName('');
  };

  const handleStartTask = (taskId: string) => {
    if (!ros || connectionState !== 'connected') return;

    const cmdPub = new ROSLIB.Topic({
      ros: ros,
      name: '/task/command',
      messageType: 'std_msgs/String'
    });

    cmdPub.publish(new ROSLIB.Message({
      data: JSON.stringify({ action: 'start_task', task_id: taskId })
    }));

    setTasks(tasks.map(task =>
      task.id === taskId ? { ...task, status: 'running' } : task
    ));
  };

  const handleStopTask = (taskId: string) => {
    if (!ros || connectionState !== 'connected') return;

    const cmdPub = new ROSLIB.Topic({
      ros: ros,
      name: '/task/command',
      messageType: 'std_msgs/String'
    });

    cmdPub.publish(new ROSLIB.Message({
      data: JSON.stringify({ action: 'stop_task', task_id: taskId })
    }));

    setTasks(tasks.map(task =>
      task.id === taskId ? { ...task, status: 'pending' } : task
    ));
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return '#2196F3';
      case 'completed': return '#4CAF50';
      case 'failed': return '#f44336';
      default: return '#FF9800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'running': return 'En cours';
      case 'completed': return 'Terminée';
      case 'failed': return 'Échouée';
      default: return 'En attente';
    }
  };

  const disabled = connectionState !== 'connected';

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>Liste des tâches</Typography>

        {disabled && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            ⚠️ ROS 2 non connecté — les tâches ne peuvent pas être envoyées
          </Alert>
        )}

        <Box sx={{ mb: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              size="small"
              placeholder="Nom de la tâche"
              value={newTaskName}
              onChange={(e) => setNewTaskName(e.target.value)}
              disabled={disabled}
              sx={{ flex: 1 }}
            />
            <Select
              size="small"
              value={newTaskType}
              onChange={(e) => setNewTaskType(e.target.value as Task['type'])}
              disabled={disabled}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="mowing">Tonte</MenuItem>
              <MenuItem value="plowing">Labour</MenuItem>
              <MenuItem value="seeding">Semis</MenuItem>
              <MenuItem value="custom">Personnalisée</MenuItem>
            </Select>
            <Button variant="contained" onClick={handleAddTask} disabled={disabled}>
              Ajouter
            </Button>
          </Stack>
        </Box>

        <List disablePadding>
          {tasks.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 1 }}>Aucune tâche</Typography>
          ) : (
            tasks.map((task) => (
              <ListItem
                key={task.id}
                disableGutters
                sx={{
                  display: 'block',
                  py: 1,
                  px: 1.5,
                  mb: 1,
                  borderRadius: 1,
                  bgcolor: 'background.default',
                  borderLeft: 4,
                  borderColor: getStatusColor(task.status),
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                  <Typography component="span" fontWeight={600}>{task.name}</Typography>
                  <Typography component="span" color="text.secondary" variant="body2">({task.type})</Typography>
                  <Chip
                    label={getStatusText(task.status)}
                    size="small"
                    sx={{ bgcolor: getStatusColor(task.status), color: '#fff' }}
                  />
                </Stack>
                <Box sx={{ mt: 1 }}>
                  {task.status === 'pending' && (
                    <Button size="small" variant="contained" color="info" onClick={() => handleStartTask(task.id)} disabled={disabled}>
                      Démarrer
                    </Button>
                  )}
                  {task.status === 'running' && (
                    <Button size="small" variant="contained" color="error" onClick={() => handleStopTask(task.id)} disabled={disabled}>
                      Arrêter
                    </Button>
                  )}
                </Box>
              </ListItem>
            ))
          )}
        </List>
      </CardContent>
    </Card>
  );
};

export default TaskList;
