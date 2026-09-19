import React, { useEffect, useRef, useState } from 'react';
import {
  Card, CardContent, Typography, Button, Alert, Stack, Box, TextField,
  Select, MenuItem, IconButton, Chip, Paper, InputLabel, FormControl,
  Switch, FormControlLabel,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import HistoryIcon from '@mui/icons-material/History';
import RouteIcon from '@mui/icons-material/Route';
import MapIcon from '@mui/icons-material/Map';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import ROSLIB from 'roslib';
import { useTasks, Task } from '../hooks/useTasks';
import { useRos } from '../hooks/useRos';
import { useUiMode } from '../context/UiModeContext';
import { useZones } from '../context/ZonesContext';
import { corridorWarnings } from '../lib/corridors';
import { distanceToNetwork } from '../lib/graph';
import { useStation } from '../context/StationContext';

const TYPE_LABELS: Record<Task['type'], string> = {
  mowing: 'Tonte',
  plowing: 'Labour',
  seeding: 'Semis',
  custom: 'Personnalisée',
};

/**
 * Etape 6.9 : formate la date de dernière exécution d'une tâche
 * (undefined -> « jamais exécutée »).
 */
const formatLastRun = (iso?: string): string => {
  if (!iso) return 'Jamais exécutée';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Jamais exécutée';
  return 'Exécutée le ' + d.toLocaleString('fr-FR', {
    dateStyle: 'short', timeStyle: 'short',
  });
};

/**
 * Sidebar du mode planification : gestion de la file de tâches.
 * - File locale (brouillon) importée des tâches en attente reçues de
 *   /tasks/list ; les nouvelles tâches pending (parcours validés) sont
 *   ajoutées en fin de file sans toucher à l'ordre existant
 * - Ajout (nom, type, zone), suppression, réordonnancement par drag & drop
 * - Contrôle de conformité des chemins de liaison avant génération
 *   (leur dessin/édition vit dans le mode dédié, accessible en bas)
 * - Activation/désactivation individuelle des tâches (etape 6.9) : une
 *   tâche désactivée reste dans la file mais sera sautée par le robot ;
 *   la date de dernière exécution est affichée sous le nom
 * - "Générer le parcours" publie generate_mission avec la file ordonnée
 *   puis ramène au dashboard ; les tâches envoyées restent visibles
 *   (ré-importées depuis la file pending du robot, source de vérité)
 */
const PlanningSidebar: React.FC = () => {
  const { ros, connectionState } = useRos();
  const { tasks } = useTasks();
  const { setMode, goBack } = useUiMode();
  const { zones, corridors } = useZones();
  const { station } = useStation();

  const disabled = connectionState !== 'connected';

  // File locale (brouillon de la mission)
  const [queue, setQueue] = useState<Task[]>([]);
  // Tâches retirées LOCALEMENT par l'utilisateur (brouillon) : ne sont
  // pas ré-importées tant que le robot ne les renvoie pas. Les tâches
  // envoyées en mission ne sont plus blacklistées : la file du robot
  // reste visible et éditable après « Générer le parcours ».
  const removedRef = useRef<Set<string>>(new Set());

  // Synchronisation avec la file en attente du robot (/tasks/list) :
  // - file vide (première ouverture, ou après génération) -> repart des
  //   tâches pending du robot : la file ENVOYÉE reste donc visible et
  //   éditable après « Générer le parcours »
  // - nouvelles tâches pending (p. ex. parcours validé en mode lignes
  //   de guidage) ajoutées en fin de file, l'ordre existant est préservé
  // - une tâche ROBOT qui disparaît des pending (retirée côté robot ou
  //   terminée) quitte la file ; les tâches locales ne sont pas touchées
  useEffect(() => {
    setQueue(prev => {
      const pending = tasks.filter(
        t => t.status === 'pending' && !removedRef.current.has(t.id));
      if (prev.length === 0) return pending.length > 0 ? pending : prev;
      // Préserve l'ordre : les entrées existantes gardent leur place si
      // elles existent toujours, les nouvelles vont en fin de file.
      const pendingById = new Map(pending.map(t => [t.id, t]));
      const kept = prev.filter(t => t.id.startsWith('local-') || pendingById.has(t.id));
      const keptIds = new Set(kept.map(t => t.id));
      const fresh = pending.filter(t => !keptIds.has(t.id));
      // Met à jour les tâches robot (progression, enabled, dates) sans
      // toucher à l'ordre ni aux tâches locales. Le drapeau enabled est
      // conservé depuis la file locale tant que le robot ne renvoie pas
      // EXPLICITEMENT ce champ : sinon une bascule locale (le robot ne
      // connaît pas encore set_task_enabled) serait écrasée au prochain
      // /tasks/list et le Switch se rallumerait aussitôt.
      const refreshed = kept.map(t => {
        if (t.id.startsWith('local-')) return t;
        const rt = pendingById.get(t.id);
        if (!rt) return t;
        return { ...rt, enabled: rt.enabled !== undefined ? rt.enabled : t.enabled };
      });
      return fresh.length > 0 ? [...refreshed, ...fresh] : refreshed;
    });
  }, [tasks]);

  // Formulaire d'ajout
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<Task['type']>('mowing');
  const [newField, setNewField] = useState('');

  // Drag & drop natif HTML5
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Régénération par-dessus une mission partiellement exécutée :
  // l'opérateur choisit de conserver la progression des tâches
  // entamées ou de les reprendre de zéro.
  const [progressDialogOpen, setProgressDialogOpen] = useState(false);
  const [progressTasks, setProgressTasks] = useState<Task[]>([]);

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

  // Etape 6.9 : bascule d'activation d'une tâche de la file. Les tâches
  // connues du robot (id non local) voient l'état propagé immédiatement
  // via set_task_enabled pour garder /tasks/list synchronisé.
  const toggleEnabled = (id: string, enabled: boolean) => {
    setQueue(prev => prev.map(t => t.id === id ? { ...t, enabled } : t));
    if (ros && connectionState === 'connected' && !id.startsWith('local-')) {
      const cmdPub = new ROSLIB.Topic({
        ros,
        name: '/task/command',
        messageType: 'std_msgs/String',
      });
      cmdPub.publish(new ROSLIB.Message({
        data: JSON.stringify({ action: 'set_task_enabled', id, enabled }),
      }));
    }
  };

  // Retire une tâche de la file. Les tâches connues du robot sont AUSSI
  // retirées de sa file via remove_task (sinon elles réapparaîtraient au
  // prochain /tasks/list).
  const removeTask = (id: string) => {
    removedRef.current.add(id);
    setQueue(prev => prev.filter(t => t.id !== id));
    if (ros && connectionState === 'connected' && !id.startsWith('local-')) {
      const cmdPub = new ROSLIB.Topic({
        ros,
        name: '/task/command',
        messageType: 'std_msgs/String',
      });
      cmdPub.publish(new ROSLIB.Message({
        data: JSON.stringify({ action: 'remove_task', id }),
      }));
    }
  };

  const generateMission = () => {
    if (!ros || disabled || queue.length === 0 || prereqWarnings.length > 0) return;
    // Missions déjà partiellement exécutées : demander à l'opérateur si
    // la progression des tâches entamées doit être conservée ou remise
    // à zéro avant de remplacer la mission.
    const started = queue.filter(
      t => (t.currentStep ?? 0) > 0 && t.status !== 'completed');
    if (started.length > 0) {
      setProgressTasks(started);
      setProgressDialogOpen(true);
      return;
    }
    publishMission(false);
  };

  // Publie generate_mission avec (ou sans) conservation de la
  // progression des tâches entamées, puis vide la file locale.
  const publishMission = (keepProgress: boolean) => {
    if (!ros || disabled) return;
    const cmdPub = new ROSLIB.Topic({
      ros,
      name: '/task/command',
      messageType: 'std_msgs/String',
    });
    cmdPub.publish(new ROSLIB.Message({
      data: JSON.stringify({ action: 'generate_mission', tasks: queue, keepProgress }),
    }));
    // File vidée localement : elle sera ré-importée depuis la file
    // pending du robot (/tasks/list) — les tâches envoyées restent
    // visibles et éditables (retrait, désactivation, réordonnancement).
    setQueue([]);
    setMode('dashboard');
  };

  // Nombre de tâches désactivées dans la file (etape 6.9)
  const disabledCount = queue.filter(t => t.enabled === false).length;

  // Prérequis de mission : le robot doit pouvoir REJOINDRE les zones
  // depuis la station via les chemins de liaison. Sans station ni
  // réseau raccordé, la génération (et l'exécution) est impossible.
  const prereqWarnings: string[] = [];
  if (!station) {
    prereqWarnings.push('aucune station de recharge — pose-la dans le mode « Chemins de liaison »');
  } else if (corridors.length === 0) {
    prereqWarnings.push('aucun chemin de liaison — le robot ne pourrait pas rejoindre les zones');
  } else {
    if (distanceToNetwork(corridors, station.position) > 1) {
      prereqWarnings.push('la station est isolée (à plus de 1 m des chemins de liaison)');
    }
    // Point d'entrée de chaque tâche à waypoints : raccordé au réseau
    for (const t of queue) {
      if (!t.waypoints || t.waypoints.length === 0) continue;
      if (distanceToNetwork(corridors, t.waypoints[0]) > 1) {
        prereqWarnings.push('« ' + t.name + ' » : point d\u2019entrée non raccordé aux chemins de liaison');
      }
    }
  }

  // Conformité des chemins de liaison (avertissement, pas blocage)
  const invalidCorridorCount = corridors.filter(
    c => corridorWarnings(c, zones).length > 0
  ).length;

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
          File de tâches ({queue.length}{disabledCount > 0 ? ' • ' + disabledCount + ' désactivée' + (disabledCount > 1 ? 's' : '') : ''})
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
                  opacity: dragIndex === i ? 0.5 : (task.enabled === false ? 0.55 : 1),
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
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <HistoryIcon sx={{ fontSize: 13 }} color="action" />
                    <Typography variant="caption" color="text.secondary">
                      {formatLastRun(task.lastExecutedAt)}
                    </Typography>
                  </Stack>
                </Box>
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={task.enabled !== false}
                      onChange={e => toggleEnabled(task.id, e.target.checked)}
                    />
                  }
                  label="Active"
                  labelPlacement="top"
                  sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 11 } }}
                />
                <IconButton size="small" onClick={() => removeTask(task.id)} aria-label="supprimer la tâche">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Paper>
            ))}
          </Box>
        )}

        {/* Régénération par-dessus une mission partiellement exécutée :
            l'opérateur choisit de conserver la progression des tâches
            entamées ou de les reprendre de zéro. */}
        <Dialog open={progressDialogOpen} onClose={() => setProgressDialogOpen(false)}>
          <DialogTitle>Mission partiellement exécutée</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {progressTasks.map(t => '« ' + t.name + ' » : ' + Math.round(t.progress ?? 0) + ' % effectué').join(', ')}.<br />
              Générer une nouvelle mission remplace la mission actuelle — veux-tu conserver la progression de ces tâches ou les reprendre de zéro ?
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setProgressDialogOpen(false); publishMission(false); }}>
              Reprendre de zéro
            </Button>
            <Button variant="contained" onClick={() => { setProgressDialogOpen(false); publishMission(true); }}>
              Conserver la progression
            </Button>
          </DialogActions>
        </Dialog>

        {/* Actions */}
        <Stack spacing={1}>
          {prereqWarnings.length > 0 && (
            <Alert severity="error">
              Génération impossible : {prereqWarnings.join(' ; ')}.
            </Alert>
          )}
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
            disabled={disabled || queue.length === 0 || prereqWarnings.length > 0}
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
          <Button
            variant="outlined"
            startIcon={<AltRouteIcon />}
            onClick={() => setMode('corridors')}
            fullWidth
          >
            Éditer les chemins de liaison{corridors.length > 0 ? ' (' + corridors.length + ')' : ''}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default PlanningSidebar;
