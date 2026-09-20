import React, { useEffect, useRef, useState } from 'react';
import {
  Card, CardContent, Typography, Button, Alert, Stack, Box, TextField,
  IconButton, Chip, Paper,
  Switch, FormControlLabel, Divider,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import HistoryIcon from '@mui/icons-material/History';
import RouteIcon from '@mui/icons-material/Route';
import MapIcon from '@mui/icons-material/Map';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import EventRepeatIcon from '@mui/icons-material/EventRepeat';
import ROSLIB from 'roslib';
import { useTasks, Task } from '../hooks/useTasks';
import { useRos } from '../hooks/useRos';
import { useUiMode } from '../context/UiModeContext';
import { useZones, Zone, Corridor } from '../context/ZonesContext';
import { corridorWarnings } from '../lib/corridors';
import { distanceToNetwork } from '../lib/graph';
import { useStation, Station } from '../context/StationContext';
import { useWorklines, ValidatedCourse, ZoneEntryPoints } from '../context/WorklinesContext';
import { usePlan } from '../context/PlanContext';
import { buildProjectDocument, parseProjectDocument } from '../lib/storage';
import { buildMissionPayload } from '../lib/mission';
import { isTaskDue, scheduleBadge } from '../lib/schedule';

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
 * Refonte R3 : la file vit DANS le frontend (PlanContext, persistée) —
 * c'est la source de vérité de la mission à venir.
 * - Suppression, réordonnancement par drag & drop
 * - Activation/désactivation individuelle (décision purement locale :
 *   la mission n'embarque que les tâches actives)
 * - Le robot ne fait que RAPPORTER l'état d'exécution (/tasks/list) :
 *   progression, statut et dernière exécution sont fusionnés dans la
 *   file sans toucher à l'ordre ni au drapeau actif
 * - Contrôle de conformité des chemins de liaison avant génération
 * - « Générer le parcours » publie generate_mission avec les tâches
 *   actives ordonnées ET les trajets pré-calculés (transits sur les
 *   chemins de liaison + retour station, Dijkstra — lib/mission.ts),
 *   puis ramène au dashboard ; la file reste visible et éditable
 * - Sauvegarde du projet (refonte R1) : export/import d'un document
 *   JSON complet (zones, chemins, station, parcours, file)
 */
const PlanningSidebar: React.FC = () => {
  const { ros, connectionState } = useRos();
  const { tasks } = useTasks();
  const { setMode, goBack } = useUiMode();
  const { zones, corridors, importAll } = useZones();
  const { station, importStation } = useStation();
  const { validated, zoneEntryPoints, importState } = useWorklines();
  const {
    queue,  removeTask, setTaskEnabled,
    moveTask, mergeRobotState, replaceQueue, setTaskSchedule,
  } = usePlan();

  const disabled = connectionState !== 'connected';

  // Le robot rapporte l'état d'exécution : on fusionne ces champs
  // (progression, statut, dernière exécution) dans la file locale,
  // sans jamais toucher à l'ordre ni au drapeau actif.
  useEffect(() => { mergeRobotState(tasks); }, [tasks, mergeRobotState]);

  // Drag & drop natif HTML5
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Régénération par-dessus une mission partiellement exécutée :
  // l'opérateur choisit de conserver la progression des tâches
  // entamées ou de les reprendre de zéro.
  const [progressDialogOpen, setProgressDialogOpen] = useState(false);
  const [progressTasks, setProgressTasks] = useState<Task[]>([]);

  // Erreur de construction de la mission (zone non reliée…)
  const [genError, setGenError] = useState<string | null>(null);

  // Etape 6.9 : edition de la planification d'une tache
  const [scheduleTaskId, setScheduleTaskId] = useState<string | null>(null);
  const [schedDays, setSchedDays] = useState<number[]>([]);
  const [schedStart, setSchedStart] = useState('');
  const [schedEnd, setSchedEnd] = useState('');
  const [schedInterval, setSchedInterval] = useState('');
  const [includeNotDue, setIncludeNotDue] = useState(false);

  const handleDragStart = (index: number) => setDragIndex(index);

  const handleDragEnter = (index: number) => {
    if (dragIndex === null || dragIndex === index) return;
    moveTask(dragIndex, index);
    setDragIndex(index);
  };

  const handleDragEnd = () => setDragIndex(null);

  // Etape 6.9 : bascule d'activation — décision LOCALE (la mission
  // n'embarque que les tâches actives ; plus de set_task_enabled).
  const toggleEnabled = (id: string, enabled: boolean) => setTaskEnabled(id, enabled);

  // Ouvre le dialogue de planification pre-rempli depuis la tache.
  const openSchedule = (task: Task) => {
    setScheduleTaskId(task.id);
    setSchedDays(task.schedule?.daysOfWeek ?? [1, 2, 3, 4, 5]);
    setSchedStart(task.schedule?.windowStart ?? '');
    setSchedEnd(task.schedule?.windowEnd ?? '');
    setSchedInterval(task.schedule?.intervalDays
      ? String(task.schedule.intervalDays) : '');
  };

  const saveSchedule = () => {
    if (!scheduleTaskId) return;
    const interval = parseInt(schedInterval, 10);
    setTaskSchedule(scheduleTaskId, {
      daysOfWeek: [...schedDays].sort((a, b) => a - b),
      windowStart: schedStart,
      windowEnd: schedEnd,
      intervalDays: Number.isFinite(interval) && interval > 0
        ? interval : undefined,
    });
    setScheduleTaskId(null);
  };

  const clearSchedule = () => {
    if (!scheduleTaskId) return;
    setTaskSchedule(scheduleTaskId, undefined);
    setScheduleTaskId(null);
  };

  // Retire une tâche de la file locale (plus de remove_task robot).
  const handleRemoveTask = (id: string) => removeTask(id);

  const generateMission = () => {
    if (!ros || disabled || missionTasks.length === 0 || prereqWarnings.length > 0) return;
    // Missions déjà partiellement exécutées : demander à l'opérateur si
    // la progression des tâches entamées doit être conservée ou remise
    // à zéro avant de remplacer la mission.
    const started = missionTasks.filter(
      t => (t.currentStep ?? 0) > 0 && t.status !== 'completed');
    if (started.length > 0) {
      setProgressTasks(started);
      setProgressDialogOpen(true);
      return;
    }
    publishMission(false);
  };

  // Publie generate_mission avec les tâches ACTIVES de la file, dans
  // l'ordre choisi (ou sans) conservation de la progression des tâches
  // entamées. Les trajets (transits sur les chemins de liaison, retour
  // station) sont pré-calculés ici par Dijkstra — le robot suit des
  // waypoints ; le graphe est joint pour ses retours d'urgence.
  // La file locale reste intacte : source de vérité.
  const publishMission = (keepProgress: boolean) => {
    if (!ros || disabled || !station) return;
    let payload;
    try {
      payload = buildMissionPayload(missionTasks, corridors, station, zones);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
      return;
    }
    setGenError(null);
    const cmdPub = new ROSLIB.Topic({
      ros,
      name: '/task/command',
      messageType: 'std_msgs/String',
    });
    cmdPub.publish(new ROSLIB.Message({
      data: JSON.stringify({
        action: 'generate_mission',
        tasks: payload.tasks,
        keepProgress,
        graph: payload.graph,
        station: payload.station,
        returnRoute: payload.returnRoute,
      }),
    }));
    setMode('dashboard');
  };

  // Mission = tâches ACTIVES de la file, dans l'ordre choisi (les
  // désactivées restent dans la file pour une prochaine mission).
  const activeTasks = queue.filter(t => t.enabled !== false);
  // Mission = taches actives ET dues (etape 6.9) sauf inclusion
  // forcee des non-dues par l'operateur.
  const missionTasks = activeTasks.filter(
    t => includeNotDue || isTaskDue(t));
  const notDueCount = activeTasks.length - missionTasks.length;
  const disabledCount = queue.length - activeTasks.length;

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
    for (const t of missionTasks) {
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

  // ---- Sauvegarde manuelle (refonte R1) : tout le projet dans un
  // fichier JSON unique, réimportable (y compris sur un autre poste). ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  const exportProject = () => {
    const doc = buildProjectDocument({
      zones, corridors, station,
      worklines: { validated, zoneEntryPoints },
      plan: queue,
    });
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agrirobot-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importProject = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const doc = parseProjectDocument(String(reader.result));
        importAll((doc.zones as Zone[]) ?? [], (doc.corridors as Corridor[]) ?? []);
        importStation((doc.station as Station | null) ?? null);
        const wl = (doc.worklines ?? {}) as {
          validated?: Record<string, ValidatedCourse>;
          zoneEntryPoints?: ZoneEntryPoints;
        };
        importState(wl.validated ?? {}, wl.zoneEntryPoints ?? {});
        replaceQueue((doc.plan as Task[]) ?? []);
        setImportMsg({
          severity: 'success',
          text: 'Projet importé — zones, chemins, station, parcours et file restaurés.',
        });
      } catch (e) {
        setImportMsg({
          severity: 'error',
          text: 'Import impossible : ' + (e instanceof Error ? e.message : String(e)),
        });
      }
    };
    reader.readAsText(file);
  };

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

        {disabled && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            ROS 2 non connecté — la génération du parcours sera impossible
          </Alert>
        )}

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
                  {task.schedule && (
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <EventRepeatIcon sx={{ fontSize: 13 }} color="action" />
                      <Typography variant="caption"
                        color={scheduleBadge(task) === 'planifiée maintenant' ? 'success.main' : 'text.secondary'}>
                        {scheduleBadge(task)}
                      </Typography>
                    </Stack>
                  )}
                </Box>
                <IconButton size="small" aria-label="planification"
                  onClick={() => openSchedule(task)}>
                  <EventRepeatIcon fontSize="small"
                    color={task.schedule ? 'primary' : 'action'} />
                </IconButton>
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
                <IconButton size="small" onClick={() => handleRemoveTask(task.id)} aria-label="supprimer la tâche">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Paper>
            ))}
          </Box>
        )}

        {/* Etape 6.9 : planification recurrente d'une tache */}
        <Dialog open={scheduleTaskId !== null} onClose={() => setScheduleTaskId(null)}>
          <DialogTitle>Planification</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1, minWidth: 340 }}>
              <Typography variant="body2" color="text.secondary">
                Jours autorisés
              </Typography>
              <ToggleButtonGroup
                size="small"
                value={schedDays}
                onChange={(_, v) => setSchedDays(v)}
              >
                {[1, 2, 3, 4, 5, 6, 0].map(d => (
                  <ToggleButton key={d} value={d}>
                    {['D', 'L', 'M', 'M', 'J', 'V', 'S'][d]}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <Stack direction="row" spacing={2}>
                <TextField
                  size="small" type="time" label="Début"
                  value={schedStart}
                  onChange={e => setSchedStart(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  size="small" type="time" label="Fin"
                  value={schedEnd}
                  onChange={e => setSchedEnd(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Stack>
              <TextField
                size="small" type="number" label="Intervalle minimal (jours)"
                value={schedInterval}
                onChange={e => setSchedInterval(e.target.value)}
                helperText="Vide = aucun minimum entre deux débuts"
              />
              <Typography variant="caption" color="text.secondary">
                Une tâche interrompue reprend en priorité au prochain créneau,
                à sa progression enregistrée.
              </Typography>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={clearSchedule} color="warning">Supprimer</Button>
            <Button onClick={() => setScheduleTaskId(null)}>Annuler</Button>
            <Button variant="contained" onClick={saveSchedule}>Enregistrer</Button>
          </DialogActions>
        </Dialog>

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
          {genError && (
            <Alert severity="error" onClose={() => setGenError(null)}>
              Génération impossible : {genError}.
            </Alert>
          )}
          {invalidCorridorCount > 0 && (
            <Alert severity="warning">
              {invalidCorridorCount} chemin{invalidCorridorCount > 1 ? 's' : ''} de liaison
              invalide{invalidCorridorCount > 1 ? 's' : ''} — le robot ne pourra pas
              l'{invalidCorridorCount > 1 ? 'es' : 'e'} emprunter en l'état.
            </Alert>
          )}
          <FormControlLabel
            control={
              <Switch size="small" checked={includeNotDue}
                onChange={e => setIncludeNotDue(e.target.checked)} />
            }
            label="Inclure les tâches non planifiées"
            sx={{ '& .MuiFormControlLabel-label': { fontSize: 12 } }}
          />
          {notDueCount > 0 && !includeNotDue && (
            <Typography variant="caption" color="text.secondary">
              {notDueCount} tâche{notDueCount > 1 ? 's' : ''} non planifiée{notDueCount > 1 ? 's' : ''}
              exclue{notDueCount > 1 ? 's' : ''} de la mission (pas encore dans un créneau autorisé).
            </Typography>
          )}
          <Button
            variant="contained"
            color="success"
            size="large"
            startIcon={<RouteIcon />}
            onClick={generateMission}
            disabled={disabled || missionTasks.length === 0 || prereqWarnings.length > 0}
            fullWidth
          >
            Générer le parcours{missionTasks.length > 0 ? ' (' + missionTasks.length + ' tâche' + (missionTasks.length > 1 ? 's' : '') + ')' : ''}
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

          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2" gutterBottom>
            Sauvegarde du projet
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<FileDownloadIcon />} onClick={exportProject} fullWidth>
              Exporter
            </Button>
            <Button variant="outlined" startIcon={<FileUploadIcon />} onClick={() => fileInputRef.current?.click()} fullWidth>
              Importer
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Sauvegarde complète (zones, chemins, station, parcours, file) — automatique dans ce navigateur, fichier pour l'archivage ou un autre poste.
          </Typography>
          <input
            hidden
            type="file"
            accept="application/json,.json"
            ref={fileInputRef}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) importProject(f);
              e.target.value = '';
            }}
          />
          {importMsg && (
            <Alert severity={importMsg.severity} onClose={() => setImportMsg(null)} sx={{ mt: 1 }}>
              {importMsg.text}
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default PlanningSidebar;