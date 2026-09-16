import React from 'react';
import { Card, CardContent, Typography, Box, LinearProgress, Chip, Stack } from '@mui/material';
import { useTasks, Task } from '../hooks/useTasks';
import { useRos } from '../hooks/useRos';

const statusLabel: Record<string, string> = {
  pending: 'En attente',
  running: 'En cours',
  completed: 'Terminée',
  failed: 'Échouée',
};

const statusColor: Record<string, string> = {
  pending: '#FF9800',
  running: '#2196F3',
  completed: '#4CAF50',
  failed: '#f44336',
};

/**
 * Affiche la tâche actuellement en cours avec sa progression.
 * Si aucune tâche n'est en cours, propose un message clair.
 */
export const CurrentTaskCard: React.FC = () => {
  const { connectionState } = useRos();
  const { currentTask, hasRunningTask } = useTasks();

  const disabled = connectionState !== 'connected';

  // Calcul de la progression à partir de currentStep/totalSteps si disponibles
  // Sinon on utilise le champ progress direct
  const progressValue = currentTask?.progress
    ?? (currentTask?.totalSteps && currentTask.totalSteps > 0
      ? (currentTask.currentStep ?? 0) / currentTask.totalSteps * 100
      : 0);

  // Texte "ce qu'il reste à faire"
  const remainingText = currentTask
    ? currentTask.totalSteps
      ? `Il reste ${currentTask.totalSteps - (currentTask.currentStep ?? 0)}/${currentTask.totalSteps} étapes`
      : 'Progression non détaillée'
    : null;

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Tâche en cours
        </Typography>

        {disabled && (
          <Typography color="text.secondary" variant="body2">
            ROS 2 non connecté
          </Typography>
        )}

        {!hasRunningTask ? (
          <Box sx={{ textAlign: 'center', py: 2, color: 'text.secondary' }}>
            <Typography>Aucune tâche en cours</Typography>
            <Typography variant="body2">Le robot est à l'arrêt</Typography>
          </Box>
        ) : currentTask && (
          <Stack spacing={1.5}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle1" fontWeight={600}>
                {currentTask.name}
              </Typography>
              <Chip
                label={currentTask.type}
                size="small"
                variant="outlined"
              />
              <Chip
                label={statusLabel[currentTask.status] || currentTask.status}
                size="small"
                sx={{ bgcolor: statusColor[currentTask.status] || '#666', color: '#fff' }}
              />
            </Stack>

            {progressValue > 0 && (
              <>
                <Typography variant="body2">
                  Progression : {Math.round(progressValue)}%
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={progressValue}
                  sx={{ height: 8, borderRadius: 4 }}
                />
                {remainingText && (
                  <Typography variant="body2" color="text.secondary">
                    {remainingText}
                  </Typography>
                )}
              </>
            )}

            <Box sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                État : {statusLabel[currentTask.status] || currentTask.status}
              </Typography>
            </Box>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};
