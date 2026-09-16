import React, { useEffect, useRef, useState } from 'react';
import {
  Card, CardContent, Typography, Button, Alert, Stack, Box, TextField,
  Select, MenuItem, IconButton, Chip, Paper, InputLabel, FormControl,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import RouteIcon from '@mui/icons-material/Route';
import MapIcon from '@mui/icons-material/Map';
import ROSLIB from 'roslib';
import { useTasks, Task } from '../hooks/useTasks';
import { useRos } from '../hooks/useRos';
import { useUiMode } from '../context/UiModeContext';

const TYPE_LABELS: Record<Task['type'], string> = {
  mowing: 'Tonte',
  plowing: 'Labour',
  seeding: 'Semis',
  custom: 'Personnalisée',
};

/**
 * Sidebar du mode planification : gestion de la file de tâches.
 * - File locale (brouillon) initialisée une seule fois avec les tâches
 *   en attente reçues de /tasks/list (sans écraser les modifs utilisateur)
 * - Ajout (nom, type, zone), suppression, réordonnancement par drag & drop
 * - "Générer le parcours" publie generate_mission avec la file ordonnée
 *   puis ramène au dashboard
 */
const PlanningSidebar: React.FC = () => {
  const { ros, connectionState } = useRos();
  const { tasks } = useTasks();
  const { setMode } = useUiMode();

  const disabled = connectionState !== 'connected';

  // File locale (brouillon de la mission)
  const [queue, setQueue] = useState<Task[]>([]);
  const importedRef = useRef(false);

  // Auto-import unique des tâches en attente existantes
  useEffect(() => {
    if (importedRef.current) return;
    const pending = tasks.filter(t => t.status === 'pending');
    if (pending.length > 0) {
      importedRef.current = true;
      setQueue(prev => (prev.length === 0 ? pending : prev));
    }
  }, [tasks]);

  // Formulaire d'ajout
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<Task['type']>('mowing');
  const [newField, setNewField] = useState('');

  // Drag & drop natif HTML5
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => setDragIndex(index);

  const handleDragEnter = (index: number) => {
    if (dragIndex === null || dragIndex === index) return;
    setQueue(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(index, 0, moved);
      return next;
    });
    setDragIndex(index);
  };

  const handleDragEnd = () => setDragIndex(null);

  const addTask = () => {
    if (!newName.trim()) return;
    importedRef.current = true; // l'utilisateur a pris la main, plus d'auto-import
    setQueue(prev => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        name: newName.trim(),
        type: newType,
        status: 'pending',
        field: newField.trim() || undefined,
      },
    ]);
    setNewName('');
    setNewField('');
  };

  const removeTask = (id: string) => {
    importedRef.current = true;
    setQueue(prev => prev.filter(t => t.id !== id));
  };

  const generateMission = () => {
    if (!ros || disabled || queue.length === 0) return;
    const cmdPub = new ROSLIB.Topic({
      ros,
      name: '/task/command',
      messageType: 'std_msgs/String',
    });
    cmdPub.publish(new ROSLIB.Message({
      data: JSON.stringify({ action: 'generate_mission', tasks: queue }),
    }));
    setMode('dashboard');
  };

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
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Glisse les tâches pour définir l'ordre de priorité, puis génère le parcours.
        </Typography>

        {disabled && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            ROS 2 non connecté — la génération du parcours sera impossible
          </Alert>
        )}

        {/* Formulaire d'ajout */}
        <Stack spacing={1} sx={{ mb: 3 }}>
          <TextField
            size="small"
            label="Nom de la tâche"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addTask()}
          />
          <FormControl size="small">
            <InputLabel>Type</InputLabel>
            <Select
              value={newType}
              label="Type"
              onChange={e => setNewType(e.target.value as Task['type'])}
            >
              {(Object.keys(TYPE_LABELS) as Task['type'][]).map(t => (
                <MenuItem key={t} value={t}>{TYPE_LABELS[t]}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="Zone / champ (optionnel)"
            value={newField}
            onChange={e => setNewField(e.target.value)}
          />
          <Button
            variant="contained"
            color="success"
            startIcon={<AddIcon />}
            onClick={addTask}
            disabled={!newName.trim()}
          >
            Ajouter à la file
          </Button>
        </Stack>

        {/* File de tâches ordonnée */}
        <Typography variant="subtitle2" gutterBottom>
          File de tâches ({queue.length})
        </Typography>

        {queue.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 1 }}>
            Aucune tâche dans la file
          </Typography>
        ) : (
          <Box sx={{ mb: 3 }}>
            {queue.map((task, i) => (
              <Paper
                key={task.id}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragEnter={() => handleDragEnter(i)}
                onDragEnd={handleDragEnd}
                onDragOver={e => e.preventDefault()}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1,
                  mb: 1,
                  borderRadius: 1,
                  bgcolor: 'background.default',
                  cursor: 'grab',
                  opacity: dragIndex === i ? 0.5 : 1,
                  border: '1px solid',
                  borderColor: dragIndex === i ? 'primary.main' : 'divider',
                }}
              >
                <DragIndicatorIcon color="action" fontSize="small" />
                <Chip label={i + 1} size="small" color="primary" />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap fontWeight={600}>{task.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {TYPE_LABELS[task.type]}{task.field ? ` • ${task.field}` : ''}
                  </Typography>
                </Box>
                <IconButton size="small" onClick={() => removeTask(task.id)} aria-label="supprimer la tâche">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Paper>
            ))}
          </Box>
        )}

        {/* Actions */}
        <Stack spacing={1}>
          <Button
            variant="contained"
            color="success"
            size="large"
            startIcon={<RouteIcon />}
            onClick={generateMission}
            disabled={disabled || queue.length === 0}
            fullWidth
          >
            Générer le parcours{queue.length > 0 ? ` (${queue.length} tâche${queue.length > 1 ? 's' : ''})` : ''}
          </Button>
          <Button
            variant="outlined"
            startIcon={<MapIcon />}
            onClick={() => setMode('zones')}
            fullWidth
          >
            Éditer les zones
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default PlanningSidebar;
