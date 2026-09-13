import React, { useState } from 'react';
import './App.css';
import MapView from './maps/MapView';
import TaskList from './tasks/TaskList';
import RobotInfo from './robot/RobotInfo';
import { useRos } from './hooks/useRos';

function App() {
  const { connectionState } = useRos();
  const rosConnected = connectionState === 'connected';

  let statusColor = '#f44336';
  let statusText = 'Déconnecté';
  if (connectionState === 'connected') {
    statusColor = '#4CAF50';
    statusText = 'Connecté';
  } else if (connectionState === 'connecting') {
    statusColor = '#FF9800';
    statusText = 'Connexion...';
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>AgriRobot - Gestion des robots agricoles</h1>
        <div style={{ color: statusColor, fontSize: '0.9rem' }}>
          ROS 2: {statusText}
          {connectionState === 'error' && (
            <span style={{ marginLeft: '10px', fontSize: '0.8rem' }}>
              (rosbridge non lancé sur ws://localhost:9090)
            </span>
          )}
        </div>
      </header>
      <div className="App-content">
        <div className="map-container">
          <MapView />
        </div>
        <div className="sidebar">
          <RobotInfo />
          <TaskList />
        </div>
      </div>
    </div>
  );
}

export default App;
