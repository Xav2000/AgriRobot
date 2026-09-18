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
import AltRouteIcon from '@mui/icons-material/AltRoute';
import ROSLIB from 'roslib';
import { useTasks, Task } from '../hooks/useTasks';
import { useRos } from '../hooks/useRos';
import { useUiMode } from '../context/UiModeContext';
import { useZones, CORRIDOR_COLOR } from '../context/ZonesContext';
import { corridorWarnings } from '../lib/corridors';

const TYPE_LABELS: Record<Task['type'], string> = {
  mowing: 'Tonte',
  plowing: 'Labour',
  seeding: 'Semis',
  custom: 'Personnalisée',
};

/**
 * Sidebar du mode planification : gestion de la file de tâches et des
 * chemins de liaison.
 * - File locale (brouillon) importée des tâches en attente reçues de
 *   /tasks/list ; les nouvelles tâches pending (parcours validés) sont
 *   ajoutées en fin de file sans toucher à l'ordre existant
 * - Ajout (nom, type, zone), suppression, réordonnancement par drag & drop
 * - Chemins de liaison (étape 6.6) : dessin et édition directement ici,
 *   avec contrôle de conformité avant la génération du parcours
 * - "Générer le parcours" publie generate_mission avec la file ordonnée
 *   puis ramène au dashboard
 */
const PlanningSidebar: React.FC = () => {
  const { ros, connectionState } = useRos();
  const { tasks } = useTasks();
  const { setMode, goBack } = useUiMode();
  const {
    zones, corridors, selectedCorridorId, selectCorridor, selectZone,
    selectedZoneId, setEditMode, addCorridor,
  } = useZones();

  const disabled = connectionState !== 'connected';

  // En planification, on n'édite pas les polygones : la sélection de zone
  // éventuellement héritée du mode zones est libérée.
  useEffect(() => {
    if (selectedZoneId) selectZone(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // File locale (brouillon de la mission)
  const [queue, setQueue] = useState<Task[]>([]);
  // Tâches retirées de la file par l'utilisateur (ou déjà envoyées en
  // mission) : jamais ré-importées automatiquement.
  const removedRef = useRef<Set<string>>(new Set());

  // Import des tâches en attente : la file vide repart des pending ; les
  // NOUVELLES tâches pending (p. ex. un parcours validé en mode lignes
  // de guidage) sont ajoutées en fin de file — l'ordre existant n'est
  // jamais modifié.
  useEffect(() => {
    setQueue(prev => {
      const pending = tasks.filter(
        t => t.status === 'pending' && !removedRef.current.has(t.id));
      if (prev.length === 0) return pending.length > 0 ? pending : prev;
      const known = new Set(prev.map(t => t.id));
      const fresh = pending.filter(t => !known.has(t.id));
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
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
    setQueue(prev => [
      ...prev,
      {
        id: 'local-' + Date.now(),
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
    removedRef.current.add(id);
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
    // File vidée : les tâches envoyées ne sont pas ré-importées, la
    // prochaine session repart des nouvelles tâches pending seulement
    queue.forEach(t => removedRef.current.add(t.id));
    setQueue([]);
    setMode('dashboard');
  };

  // Conformité des chemins de liaison (avertissement, pas blocage)
  const corridorStates = corridors.map(c => ({
    corridor: c,
    warnings: corridorWarnings(c, zones),
  }));
  const invalidCorridorCount = corridorStates.filter(cs => cs.warnings.length > 0).length;

  return (
    <Card>
      <CardContent>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={goBack}
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
                    {TYPE_LABELS[task.type]}{task.field ? ' • ' + task.field : ''}
                  </Typography>
                </Box>
                <IconButton size="small" onClick={() => removeTask(task.id)} aria-label="supprimer la tâche">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Paper>
            ))}
          </Box>
        )}

        {/* Chemins de liaison (étape 6.6) : dessin, édition et contrôle
            de conformité ici, avant la génération du parcours. */}
        <Typography variant="subtitle2" gutterBottom>
          Chemins de liaison ({corridors.length})
        </Typography>

        <Button
          variant="contained"
          startIcon={<AltRouteIcon />}
          onClick={addCorridor}
          fullWidth
          sx={{ mb: 1.5 }}
          style={{ backgroundColor: CORRIDOR_COLOR }}
        >
          Ajouter un chemin de liaison
        </Button>

        {corridors.length === 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            Un chemin de liaison relie la station (à venir) et les zones de tonte :
            c'est le seul passage autorisé pour sortir d'un polygone.
          </Typography>
        ) : (
          <Stack spacing={1} sx={{ mb: 1 }}>
            {corridorStates.map(({ corridor, warnings }) => (
              <Paper
                key={corridor.id}
                onClick={() => {
                  // Sélection = édition directe sur la carte.
                  selectCorridor(corridor.id);
                  setEditMode(true);
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1,
                  cursor: 'pointer',
                  borderRadius: 1,
                  border: '2px solid',
                  borderColor: corridor.id === selectedCorridorId ? CORRIDOR_COLOR : 'divider',
                  bgcolor: corridor.id === selectedCorridorId ? 'action.selected' : 'background.default',
                }}
              >
                <AltRouteIcon sx={{ color: CORRIDOR_COLOR, fontSize: 20, flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap fontWeight={600}>{corridor.name}</Typography>
                  {warnings.length > 0 ? (
                    warnings.map((w, i) => (
                      <Typography key={i} variant="caption" color="error" sx={{ display: 'block' }}>
                        ⚠ {w}
                      </Typography>
                    ))
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      {corridor.points.length} point{corridor.points.length > 1 ? 's' : ''} — valide
                    </Typography>
                  )}
                </Box>
              </Paper>
            ))}
          </Stack>
        )}

        {corridors.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            Clique sur un chemin pour l'éditer : clics sur la carte pour le prolonger,
            pastilles pour déplacer, pastilles translucides pour insérer un point,
            clic droit sur une pastille pour supprimer. Suppression du chemin via la
            corbeille (à droite de la carte).
          </Typography>
        )}

        {/* Actions */}
        <Stack spacing={1}>
          {invalidCorridorCount > 0 && (
            <Alert severity="warning">
              {invalidCorridorCount} chemin{invalidCorridorCount > 1 ? 's' : ''} de liaison
              invalide{invalidCorridorCount > 1 ? 's' : ''} — le robot ne pourra pas
              l'{invalidCorridorCount > 1 ? 'es' : 'e'} emprunter en l'état.
            </Alert>
          )}
          <Button
            variant="contained"
            color="success"
            size="large"
            startIcon={<RouteIcon />}
            onClick={generateMission}
            disabled={disabled || queue.length === 0}
            fullWidth
          >
            Générer le parcours{queue.length > 0 ? ' (' + queue.length + ' tâche' + (queue.length > 1 ? 's' : '') + ')' : ''}
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
