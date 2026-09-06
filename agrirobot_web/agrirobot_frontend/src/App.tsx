import React, { useState, useEffect } from 'react';
import './App.css';
import MapView from './maps/MapView';
import TaskList from './tasks/TaskList';
import RobotInfo from './robot/RobotInfo';

function App() {
  const [rosConnected, setRosConnected] = useState(false);

  return (
    <div className="App">
      <header className="App-header">
        <h1>AgriRobot - Gestion des robots agricoles</h1>
        <div style={{ color: rosConnected ? '#4CAF50' : '#f44336' }}>
          ROS 2: {rosConnected ? 'Connecté' : 'Déconnecté'}
        </div>
      </header>
      <div className="App-content">
        <div className="map-container">
          <MapView onRosConnect={(connected) => setRosConnected(connected)} />
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
