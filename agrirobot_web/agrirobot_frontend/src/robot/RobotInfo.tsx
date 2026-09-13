import React, { useState, useEffect } from 'react';
import {
  Card, CardContent, Typography, Box, Button, Chip, Stack, Alert, LinearProgress,
} from '@mui/material';
import ROSLIB from 'roslib';
import { useRos } from '../hooks/useRos';

interface RobotStatus {
  status: string;
  battery: number;
  position?: { x: number; y: number };
}

const RobotInfo: React.FC = () => {
  const { ros, connectionState } = useRos();
  const [robotStatus, setRobotStatus] = useState<RobotStatus | null>(null);

  useEffect(() => {
    if (!ros || connectionState !== 'connected') return;

    const statusTopic = new ROSLIB.Topic({
      ros: ros,
      name: '/robot/status',
      messageType: 'std_msgs/String'
    });

    statusTopic.subscribe((msg: any) => {
      try {
        const status = JSON.parse(msg.data);
        setRobotStatus(status);
      } catch (e) {
        console.error('Erreur de parsing du status:', e);
      }
    });

    return () => {
      statusTopic.unsubscribe();
    };
  }, [ros, connectionState]);

  const handleAction = (action: string) => {
    if (!ros || connectionState !== 'connected') return;

    const cmdPub = new ROSLIB.Topic({
      ros: ros,
      name: '/task/command',
      messageType: 'std_msgs/String'
    });

    cmdPub.publish(new ROSLIB.Message({
      data: JSON.stringify({ action })
    }));
  };

  const statusInfo = (() => {
    if (!robotStatus) return { color: 'default' as const, label: 'Inconnu' };
    switch (robotStatus.status) {
      case 'working': return { color: 'success' as const, label: 'En travail' };
      case 'going_to_charge': return { color: 'warning' as const, label: 'En route vers la station' };
      case 'leaving_charge': return { color: 'warning' as const, label: 'Quitte la station' };
      case 'returning_to_charge': return { color: 'warning' as const, label: 'Retour à la station' };
      case 'charging': return { color: 'info' as const, label: 'En charge' };
      case 'error': return { color: 'error' as const, label: 'Erreur' };
      default: return { color: 'default' as const, label: 'Inactif' };
    }
  })();

  const getBatteryIcon = () => {
    if (!robotStatus) return '🔋';
    return robotStatus.battery >= 20 ? '🔋' : '🪫';
  };

  const batteryColor = robotStatus
    ? robotStatus.battery > 50 ? 'success'
    : robotStatus.battery > 20 ? 'warning'
    : 'error'
    : 'primary';

  const disabled = connectionState !== 'connected';

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>État du robot</Typography>

        {disabled && (
          <Alert severity="warning" sx={{ mb: 2 }}>⚠️ ROS 2 non connecté</Alert>
        )}

        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: '2rem' }}>{getBatteryIcon()}</Typography>
          <Box sx={{ flex: 1 }}>
            <Typography>Batterie : {robotStatus ? robotStatus.battery : '…'} %</Typography>
            <LinearProgress
              variant="determinate"
              value={robotStatus ? robotStatus.battery : 0}
              color={batteryColor as any}
              sx={{ mt: 0.5 }}
            />
            <Box sx={{ mt: 1 }}>
              <Typography component="span" variant="body2" sx={{ mr: 1 }}>Statut :</Typography>
              <Chip color={statusInfo.color} label={statusInfo.label} size="small" />
            </Box>
          </Box>
        </Stack>

        <Typography variant="subtitle2" gutterBottom>Actions rapides</Typography>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Button variant="contained" color="info" onClick={() => handleAction('go_to_charge')} disabled={disabled}>
            Aller à la station
          </Button>
          <Button variant="contained" color="info" onClick={() => handleAction('leave_charge')} disabled={disabled}>
            Quitter la station
          </Button>
          <Button variant="contained" color="info" onClick={() => handleAction('return_to_charge')} disabled={disabled}>
            Retour à la station
          </Button>
        </Stack>

        {robotStatus?.position && (
          <Box sx={{ mt: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="subtitle2">Position actuelle</Typography>
            <Typography variant="body2">
              X : {robotStatus.position.x.toFixed(2)} m<br />
              Y : {robotStatus.position.y.toFixed(2)} m
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default RobotInfo;
