import React, { useState, useEffect } from 'react';
import ROSLIB from 'roslib';

interface Task {
  id: string;
  name: string;
  type: 'mowing' | 'plowing' | 'seeding' | 'custom';
  status: 'pending' | 'running' | 'completed' | 'failed';
  field?: string;
  priority?: number;
}

const TaskList: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [ros, setRos] = useState<ROSLIB.Ros | null>(null);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskType, setNewTaskType] = useState<'mowing' | 'plowing' | 'seeding' | 'custom'>('mowing');

  useEffect(() => {
    const ros = new ROSLIB.Ros({
      url: 'ws://localhost:9090'
    });

    setRos(ros);

    // Écouter le topic /tasks/list
    const tasksTopic = new ROSLIB.Topic({
      ros: ros,
      name: '/tasks/list',
      messageType: 'std_msgs/String'
    });

    tasksTopic.subscribe((msg: any) => {
      try {
        const taskList = JSON.parse(msg.data);
        if (Array.isArray(taskList)) {
          setTasks(taskList);
        }
      } catch (e) {
        console.error('Erreur de parsing des tâches:', e);
      }
    });

    return () => {
      tasksTopic.unsubscribe();
      ros.close();
    };
  }, []);

  const handleAddTask = () => {
    if (!newTaskName.trim() || !ros) return;

    const newTask: Task = {
      id: Date.now().toString(),
      name: newTaskName,
      type: newTaskType,
      status: 'pending'
    };

    // Envoyer la commande au backend ROS 2
    const cmdPub = new ROSLIB.Topic({
      ros: ros,
      name: '/task/command',
      messageType: 'std_msgs/String'
    });

    cmdPub.publish(new ROSLIB.Message({
      data: JSON.stringify({
        action: 'add_task',
        task: newTask
      })
    }));

    // Ajouter localement pour un retour immédiat
    setTasks([...tasks, newTask]);
    setNewTaskName('');
  };

  const handleStartTask = (taskId: string) => {
    if (!ros) return;

    const cmdPub = new ROSLIB.Topic({
      ros: ros,
      name: '/task/command',
      messageType: 'std_msgs/String'
    });

    cmdPub.publish(new ROSLIB.Message({
      data: JSON.stringify({
        action: 'start_task',
        task_id: taskId
      })
    }));

    // Mettre à jour localement
    setTasks(tasks.map(task => 
      task.id === taskId ? { ...task, status: 'running' } : task
    ));
  };

  const handleStopTask = (taskId: string) => {
    if (!ros) return;

    const cmdPub = new ROSLIB.Topic({
      ros: ros,
      name: '/task/command',
      messageType: 'std_msgs/String'
    });

    cmdPub.publish(new ROSLIB.Message({
      data: JSON.stringify({
        action: 'stop_task',
        task_id: taskId
      })
    }));

    // Mettre à jour localement
    setTasks(tasks.map(task => 
      task.id === taskId ? { ...task, status: 'pending' } : task
    ));
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return '#2196F3';
      case 'completed': return '#4CAF50';
      case 'failed': return '#f44336';
      default: return '#FF9800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'running': return 'En cours';
      case 'completed': return 'Terminée';
      case 'failed': return 'Échouée';
      default: return 'En attente';
    }
  };

  return (
    <div className="task-list">
      <h2>Liste des tâches</h2>
      
      {/* Formulaire pour ajouter une tâche */}
      <div style={{ marginBottom: '15px', padding: '10px', background: '#f5f5f5', borderRadius: '4px' }}>
        <input
          type="text"
          placeholder="Nom de la tâche"
          value={newTaskName}
          onChange={(e) => setNewTaskName(e.target.value)}
          style={{ padding: '8px', marginRight: '10px', borderRadius: '4px', border: '1px solid #ddd' }}
        />
        <select
          value={newTaskType}
          onChange={(e) => setNewTaskType(e.target.value as any)}
          style={{ padding: '8px', marginRight: '10px', borderRadius: '4px', border: '1px solid #ddd' }}
        >
          <option value="mowing">Tonte</option>
          <option value="plowing">Labour</option>
          <option value="seeding">Semis</option>
          <option value="custom">Personnalisée</option>
        </select>
        <button onClick={handleAddTask} className="btn">
          Ajouter
        </button>
      </div>

      {/* Liste des tâches */}
      <ul>
        {tasks.length === 0 ? (
          <li style={{ color: '#999' }}>Aucune tâche</li>
        ) : (
          tasks.map((task) => (
            <li key={task.id} className={task.status}>
              <strong>{task.name}</strong> ({getStatusText(task.type)})
              <span 
                className="status-badge" 
                style={{ 
                  backgroundColor: getStatusColor(task.status),
                  color: 'white',
                  marginLeft: '10px'
                }}
              >
                {getStatusText(task.status)}
              </span>
              <div style={{ marginTop: '5px' }}>
                {task.status === 'pending' && (
                  <button onClick={() => handleStartTask(task.id)} className="btn btn-info">
                    Démarrer
                  </button>
                )}
                {task.status === 'running' && (
                  <button onClick={() => handleStopTask(task.id)} className="btn btn-danger">
                    Arrêter
                  </button>
                )}
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
};

export default TaskList;
