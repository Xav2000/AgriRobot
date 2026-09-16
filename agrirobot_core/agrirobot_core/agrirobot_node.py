#!/usr/bin/env python3
"""
AgriRobot Node - Main ROS 2 node for agricultural robot management.

Simulation : position du robot, mission (waypoints par tâche),
progression des tâches et batterie.
Topics publiés :
  - /robot/position (PoseStamped, mètres)
  - /robot/status   (String JSON : status, battery, position)
  - /tasks/list     (String JSON : tâches + progression)
  - /mission/path   (String JSON : waypoints [lat,lng] + statut par tâche)
Commandes (/task/command, String JSON) :
  add_task, generate_mission, start_all_tasks, stop_all_tasks,
  start_task, stop_task, go_to_charge, leave_charge, return_to_charge
"""

import rclpy
from rclpy.node import Node
from std_msgs.msg import String
from geometry_msgs.msg import PoseStamped
import json

# Origine simulée (Paris) — cohérente avec la conversion lat/lng du frontend
ORIGIN_LAT = 48.8566
ORIGIN_LNG = 2.3522
DEG_PER_METER = 0.00001


def meters_to_latlng(x, y):
    """Convertit des mètres (x vers l'est, y vers le nord) en [lat, lng]."""
    return [ORIGIN_LAT + y * DEG_PER_METER, ORIGIN_LNG + x * DEG_PER_METER]


class AgriRobotNode(Node):
    def __init__(self):
        super().__init__('agrirobot_node')

        # Publishers
        self.robot_position_pub = self.create_publisher(
            PoseStamped, '/robot/position', 10)
        self.tasks_list_pub = self.create_publisher(
            String, '/tasks/list', 10)
        self.robot_status_pub = self.create_publisher(
            String, '/robot/status', 10)
        self.mission_path_pub = self.create_publisher(
            String, '/mission/path', 10)

        # Subscribers
        self.task_command_sub = self.create_subscription(
            String, '/task/command', self.task_command_callback, 10)

        # Timer principal (1 Hz) : avance la mission puis publie l'état
        self.timer = self.create_timer(1.0, self.tick)

        # État interne
        self.tasks = []                 # tâches avec waypoints (mètres)
        self.robot_status = 'idle'
        self.battery = 100.0
        self.robot_pos = (0.0, 0.0)     # mètres (x, y)

        # Exécution de la mission
        self.executing = False
        self.current_task_idx = 0
        self.current_wp_idx = 0

        self.get_logger().info('AgriRobot node is running!')

    # ------------------------------------------------------------- simulation

    def tick(self):
        """Tick 1 Hz : avance la mission si en cours, puis publie l'état."""
        if self.executing:
            self.advance_mission()
        self.publish_position()
        self.publish_status()
        if self.tasks:
            self.publish_tasks_list()
            self.publish_mission_path()

    def advance_mission(self):
        """Avance le robot d'un waypoint ; termine la tâche puis la mission."""
        task = self.tasks[self.current_task_idx]
        wps = task['waypoints']

        if self.current_wp_idx < len(wps):
            self.robot_pos = wps[self.current_wp_idx]
            self.current_wp_idx += 1
            task['completed_waypoints'] = self.current_wp_idx
            task['status'] = 'running'
            self.battery = max(5.0, self.battery - 0.5)
        else:
            task['status'] = 'completed'
            task['completed_waypoints'] = len(wps)
            self.current_task_idx += 1
            self.current_wp_idx = 0
            if self.current_task_idx >= len(self.tasks):
                self.executing = False
                self.robot_status = 'idle'
                self.get_logger().info('Mission terminée')

    def generate_waypoints(self, index):
        """Chemin simulé en zigzag (3 allers-retours), décalé par tâche."""
        ox, oy = index * 40.0, index * 25.0
        wps = []
        for lane in range(3):
            y = oy + lane * 10.0
            if lane % 2 == 0:
                wps += [(ox, y), (ox + 30.0, y)]
            else:
                wps += [(ox + 30.0, y), (ox, y)]
        return wps

    # ------------------------------------------------------------- publishing

    def publish_position(self):
        msg = PoseStamped()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.header.frame_id = 'map'
        msg.pose.position.x = self.robot_pos[0]
        msg.pose.position.y = self.robot_pos[1]
        msg.pose.position.z = 0.0
        msg.pose.orientation.w = 1.0
        self.robot_position_pub.publish(msg)

    def publish_status(self):
        msg = String()
        msg.data = json.dumps({
            'status': self.robot_status,
            'battery': round(self.battery, 1),
            'position': {'x': self.robot_pos[0], 'y': self.robot_pos[1]},
        })
        self.robot_status_pub.publish(msg)

    def public_task(self, t):
        """Représentation d'une tâche pour /tasks/list (avec progression)."""
        total = len(t.get('waypoints', []))
        done = t.get('completed_waypoints', 0)
        return {
            'id': t['id'],
            'name': t['name'],
            'type': t.get('type', 'custom'),
            'status': t['status'],
            'field': t.get('field'),
            'totalSteps': total,
            'currentStep': done,
            'progress': round(done / total * 100.0, 1) if total else 0.0,
        }

    def publish_tasks_list(self):
        msg = String()
        msg.data = json.dumps([self.public_task(t) for t in self.tasks])
        self.tasks_list_pub.publish(msg)

    def publish_mission_path(self):
        msg = String()
        msg.data = json.dumps({
            'tasks': [
                {
                    'id': t['id'],
                    'name': t['name'],
                    'status': t['status'],
                    'waypoints': [meters_to_latlng(x, y) for (x, y) in t['waypoints']],
                    'completedWaypoints': t.get('completed_waypoints', 0),
                }
                for t in self.tasks
            ]
        })
        self.mission_path_pub.publish(msg)

    # -------------------------------------------------------------- commandes

    def task_command_callback(self, msg):
        """Handle task commands from frontend"""
        self.get_logger().info(f'Received task command: {msg.data}')

        try:
            command = json.loads(msg.data)
            action = command.get('action')

            if action == 'add_task':
                task = command.get('task', {})
                self.tasks.append({
                    'id': task.get('id', f'task-{len(self.tasks)}'),
                    'name': task.get('name', 'Tâche'),
                    'type': task.get('type', 'custom'),
                    'status': 'pending',
                    'field': task.get('field'),
                    'waypoints': self.generate_waypoints(len(self.tasks)),
                    'completed_waypoints': 0,
                })
                self.publish_tasks_list()
                self.publish_mission_path()
                self.get_logger().info(f"Added task: {task.get('name')}")

            elif action == 'generate_mission':
                # Remplace la mission courante par la file ordonnée reçue
                self.executing = False
                self.robot_status = 'idle'
                self.current_task_idx = 0
                self.current_wp_idx = 0
                self.tasks = []
                for i, t in enumerate(command.get('tasks', [])):
                    self.tasks.append({
                        'id': t.get('id', f'task-{i}'),
                        'name': t.get('name', f'Tâche {i + 1}'),
                        'type': t.get('type', 'custom'),
                        'status': 'pending',
                        'field': t.get('field'),
                        'waypoints': self.generate_waypoints(i),
                        'completed_waypoints': 0,
                    })
                self.publish_tasks_list()
                self.publish_mission_path()
                self.get_logger().info(
                    f'Mission générée : {len(self.tasks)} tâche(s)')

            elif action == 'start_all_tasks':
                if not self.tasks:
                    self.get_logger().warning('Aucune tâche à démarrer')
                    return
                self.executing = True
                self.robot_status = 'working'
                self.current_task_idx = 0
                self.current_wp_idx = 0
                self.get_logger().info('Mission démarrée')

            elif action == 'stop_all_tasks':
                self.executing = False
                self.robot_status = 'idle'
                for t in self.tasks:
                    if t['status'] == 'running':
                        t['status'] = 'pending'
                self.get_logger().info('Mission arrêtée')

            elif action == 'start_task':
                self.robot_status = 'working'
                self.get_logger().info('Started task')

            elif action == 'stop_task':
                self.robot_status = 'idle'
                self.get_logger().info('Stopped current task')

            elif action == 'go_to_charge':
                self.robot_status = 'going_to_charge'
                self.get_logger().info('Robot going to charging station')

            elif action == 'leave_charge':
                self.robot_status = 'leaving_charge'
                self.get_logger().info('Robot leaving charging station')

            elif action == 'return_to_charge':
                self.robot_status = 'returning_to_charge'
                self.get_logger().info('Robot returning to charging station')

        except Exception as e:
            self.get_logger().error(f'Error processing command: {e}')


def main(args=None):
    rclpy.init(args=args)
    node = AgriRobotNode()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
