import { useEffect, useState, useRef } from 'react';
import ROSLIB from 'roslib';

// Singleton ROS connection partagée entre tous les composants
let rosInstance: ROSLIB.Ros | null = null;
let connectionState: 'connecting' | 'connected' | 'error' = 'connecting';
const listeners = new Set<(state: string) => void>();

function notifyListeners() {
  listeners.forEach(cb => cb(connectionState));
}

function getRos(url: string): ROSLIB.Ros {
  if (rosInstance) return rosInstance;

  const ros = new ROSLIB.Ros({ url });

  ros.on('connection', () => {
    connectionState = 'connected';
    console.log('Connecté à rosbridge');
    notifyListeners();
  });

  ros.on('error', (error: Error) => {
    connectionState = 'error';
    console.error('Erreur rosbridge:', error.message);
    notifyListeners();
  });

  ros.on('close', () => {
    connectionState = 'connecting';
    console.log('Connexion rosbridge fermée');
    notifyListeners();
  });

  rosInstance = ros;
  return ros;
}

export function useRos(url: string = 'ws://localhost:9090') {
  const [state, setState] = useState(connectionState);
  const rosRef = useRef<ROSLIB.Ros | null>(null);

  useEffect(() => {
    rosRef.current = getRos(url);
    const cb = (s: string) => setState(s as any);
    listeners.add(cb);
    setState(connectionState);

    return () => {
      listeners.delete(cb);
    };
  }, [url]);

  return { ros: rosRef.current, connectionState: state };
}
