import React, { useState, useEffect } from 'react';
import ROSLIB from 'roslib';

interface RobotStatus {
  status: string;
  battery: number;
  position?: { x: number; y: number };
}

const RobotInfo: React.FC = () => {
  const [robotStatus, setRobotStatus] = useState<RobotStatus | null>(null);
  const [ros, setRos] = useState<ROSLIB.Ros | null>(null);

  useEffect(() => {
    const ros = new ROSLIB.Ros({
      url: 'ws://localhost:9090'
    });

    setRos(ros);

    // Écouter le topic /robot/status
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
      ros.close();
    };
  }, []);

  const handleAction = (action: string) => {
    if (!ros) return;

    const cmdPub = new ROSLIB.Topic({
      ros: ros,
      name: '/task/command',
      messageType: 'std_msgs/String'
    });

    cmdPub.publish(new ROSLIB.Message({
      data: JSON.stringify({ action })
    }));
  };

  const getStatusBadge = () => {
    if (!robotStatus) return <span>Connecting...</span>;

    let color = '#9E9E9E';
    let text = robotStatus.status;

    switch (robotStatus.status) {
      case 'working':
        color = '#4CAF50';
        text = 'En travail';
        break;
      case 'going_to_charge':
        color = '#FF9800';
        text = 'En route vers la station';
        break;
      case 'leaving_charge':
        color = '#FF9800';
        text = 'Quitte la station';
        break;
      case 'returning_to_charge':
        color = '#FF9800';
        text = 'Retour à la station';
        break;
      case 'charging':
        color = '#2196F3';
        text = 'En charge';
        break;
      case 'error':
        color = '#f44336';
        text = 'Erreur';
        break;
      default:
        color = '#9E9E9E';
        text = 'Inactif';
    }

    return (
      <span 
        className="status-badge" 
        style={{ backgroundColor: color, color: 'white' }}
      >
        {text}
      </span>
    );
  };

  const getBatteryIcon = () => {
    if (!robotStatus) return '🔋';
    
    const battery = robotStatus.battery;
    if (battery >= 80) return '🔋';
    if (battery >= 50) return '🔋';
    if (battery >= 20) return '🔋';
    return '🪫';
  };

  return (
    <div className="robot-info">
      <h2>État du robot</h2>
      
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '15px',
        marginBottom: '15px'
      }}>
        <div style={{ fontSize: '2rem' }}>
          {getBatteryIcon()}
        </div>
        <div>
          <div style={{ fontSize: '1.2rem' }}>
            Niveau de batterie: {robotStatus ? robotStatus.battery : '...'}%
          </div>
          <div>
            Statut: {getStatusBadge()}
          </div>
        </div>
      </div>

      <div style={{ marginTop: '15px' }}>
        <h3>Actions rapides</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          <button 
            onClick={() => handleAction('go_to_charge')} 
            className="btn btn-info"
          >
            Aller à la station
          </button>
          <button 
            onClick={() => handleAction('leave_charge')} 
            className="btn btn-info"
          >
            Quitter la station
          </button>
          <button 
            onClick={() => handleAction('return_to_charge')} 
            className="btn btn-info"
          >
            Retour à la station
          </button>
        </div>
      </div>

      {robotStatus?.position && (
        <div style={{ marginTop: '15px', padding: '10px', background: '#f5f5f5', borderRadius: '4px' }}>
          <h4>Position actuelle</h4>
          <p>
            X: {robotStatus.position.x.toFixed(2)} m<br />
            Y: {robotStatus.position.y.toFixed(2)} m
          </p>
        </div>
      )}
    </div>
  );
};

export default RobotInfo;
