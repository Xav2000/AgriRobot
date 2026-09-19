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
  add_task (waypoints [lat,lng] optionnels), remove_task, generate_mission
  (keepProgress optionnel), start_all_tasks (reprise si entamee),
  stop_all_tasks, emergency_stop (arret immediat + outils coupes),
  pause_mission, cancel_mission (retour station), start_task, stop_task,
  go_to_charge, leave_charge, return_to_charge
Refonte R4 : l'état complet (position, batterie, mission, progression,
dernière exécution par tâche) est persisté dans ~/.agrirobot/state.json
(écriture périodique + après chaque commande) et rechargé au démarrage
du node — le robot survit à un reboot système. Une mission interrompue
par le reboot repart en PAUSE (progression conservée).
"""

import os
import json
from datetime import datetime, timezone

import rclpy
from rclpy.node import Node
from std_msgs.msg import String
from geometry_msgs.msg import PoseStamped

# Origine simulée (Paris) — cohérente avec la conversion lat/lng du frontend
ORIGIN_LAT = 48.8566
ORIGIN_LNG = 2.3522
DEG_PER_METER = 0.00001

# Fichier d'état persisté (refonte R4)
STATE_FILE = os.path.join(
    os.path.expanduser('~'), '.agrirobot', 'state.json')

def meters_to_latlng(x, y):
    """Convertit des mètres (x vers l'est, y vers le nord) en [lat, lng]."""
    return [ORIGIN_LAT + y * DEG_PER_METER, ORIGIN_LNG + x * DEG_PER_METER]

def latlng_to_meters(latlng):
    """Convertit un waypoint [lat, lng] du frontend en mètres (x, y)."""
    lat, lng = latlng[0], latlng[1]
    return ((lng - ORIGIN_LNG) / DEG_PER_METER, (lat - ORIGIN_LAT) / DEG_PER_METER)

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

        # Persistance (refonte R4) : compteur de ticks pour la
        # sauvegarde périodique, puis rechargement du dernier état.
        self._ticks = 0
        self.load_state()

        self.get_logger().info('AgriRobot node is running!')

    # ------------------------------------------------------------- persistance

    def save_state(self):
        """Écrit l'état complet dans state.json (atomique : fichier
        temporaire puis remplacement). Rechargé au démarrage du node."""
        state = {
            'savedAt': datetime.now(timezone.utc).isoformat(),
            'robot_status': self.robot_status,
            'battery': self.battery,
            'robot_pos': list(self.robot_pos),
            'executing': self.executing,
            'current_task_idx': self.current_task_idx,
            'current_wp_idx': self.current_wp_idx,
            'tasks': self.tasks,
        }
        try:
            os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
            tmp = STATE_FILE + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(state, f, ensure_ascii=False)
            os.replace(tmp, STATE_FILE)
        except OSError as e:
            self.get_logger().error(f'Impossible d écrire {STATE_FILE} : {e}')

    def load_state(self):
        """Recharge le dernier état sauvegardé (reboot du node). Une
        mission interrompue repart en PAUSE : la progression est
        conservée, l'opérateur reprend via start_all_tasks."""
        if not os.path.exists(STATE_FILE):
            return
        try:
            with open(STATE_FILE, encoding='utf-8') as f:
                state = json.load(f)
            self.tasks = state.get('tasks', [])
            self.robot_status = state.get('robot_status', 'idle')
            self.battery = state.get('battery', 100.0)
            pos = state.get('robot_pos', [0.0, 0.0])
            self.robot_pos = (pos[0], pos[1])
            self.current_task_idx = state.get('current_task_idx', 0)
            self.current_wp_idx = state.get('current_wp_idx', 0)
            if state.get('executing'):
                # Le node s'est arrêté en pleine mission : on ne repart
                # pas tout seul — pause, progression conservée.
                self.executing = False
                self.robot_status = 'paused'
                self.get_logger().warning(
                    'État rechargé : mission interrompue, en pause '
                    '(reprise via start_all_tasks)')
            else:
                self.executing = False
            self.get_logger().info(
                f'État rechargé depuis {STATE_FILE} : '
                f'{len(self.tasks)} tâche(s), batterie '
                f'{round(self.battery, 1)} %')
        except (OSError, ValueError) as e:
            self.get_logger().error(f'État illisible ({STATE_FILE}) : {e}')

    # ------------------------------------------------------------- simulation

    def tick(self):
        """Tick 1 Hz : avance la mission si en cours, puis publie l'état.
        Sauvegarde périodique de l'état (toutes les 10 s, refonte R4)."""
        self._ticks += 1
        if self.executing:
            self.advance_mission()
        self.publish_position()
        self.publish_status()
        if self.tasks:
            self.publish_tasks_list()
            self.publish_mission_path()
        if self._ticks % 10 == 0:
            self.save_state()

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
            # Refonte R4 : date de dernière exécution terminée,
            # rapportée au frontend (lastExecutedAt).
            task['last_executed_at'] = datetime.now(timezone.utc).isoformat()
            self.current_task_idx += 1
            if self.current_task_idx >= len(self.tasks):
                self.executing = False
                self.robot_status = 'idle'
                self.save_state()
                self.get_logger().info('Mission terminée')
            else:
                # Reprise de la tâche suivante : sa progression conservée
                # (completed_waypoints, p. ex. mission régénérée avec
                # keepProgress, ou pause) doit être respectée quelle que
                # soit sa position dans la file — pas seulement pour la
                # première tâche au moment du start_all_tasks.
                nxt = self.tasks[self.current_task_idx]
                self.current_wp_idx = nxt.get('completed_waypoints', 0)

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
            # Waypoints [lat, lng] (etape 6.9) : le planificateur frontend
            # verifie que le point d'entree de chaque tache est raccorde
            # au reseau de chemins de liaison avant de generer la mission.
            'waypoints': ([meters_to_latlng(x, y) for (x, y) in t['waypoints']]
                          if t.get('waypoints') else []),
            # Refonte R4 : date de dernière exécution terminée.
            'lastExecutedAt': t.get('last_executed_at'),
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
                # Waypoints réels [lat, lng] si fournis (parcours validé
                # par l'opérateur), zigzag simulé sinon
                wps = ([latlng_to_meters(p) for p in task['waypoints']]
                       if task.get('waypoints')
                       else self.generate_waypoints(len(self.tasks)))
                self.tasks.append({
                    'id': task.get('id', f'task-{len(self.tasks)}'),
                    'name': task.get('name', 'Tâche'),
                    'type': task.get('type', 'custom'),
                    'status': 'pending',
                    'field': task.get('field'),
                    'waypoints': wps,
                    'completed_waypoints': 0,
                })
                self.publish_tasks_list()
                self.publish_mission_path()
                self.get_logger().info(f"Added task: {task.get('name')}")

            elif action == 'remove_task':
                # Retire une tâche PENDING (déverrouillage d'un parcours
                # validé) — les tâches en cours ou complétées sont gardées
                tid = command.get('id')
                before = len(self.tasks)
                self.tasks = [t for t in self.tasks
                              if t.get('id') != tid or t.get('status') != 'pending']
                if len(self.tasks) < before:
                    self.publish_tasks_list()
                    self.publish_mission_path()
                    self.get_logger().info(f'Removed pending task: {tid}')
                else:
                    self.get_logger().warning(f'No pending task to remove: {tid}')

            elif action == 'generate_mission':
                # Remplace la mission courante par la file ordonnée reçue.
                # Waypoints : ceux envoyés par le frontend (parcours
                # validé), sinon ceux déjà stockés pour cet id, sinon le
                # zigzag simulé.
                self.executing = False
                self.robot_status = 'idle'
                self.current_task_idx = 0
                self.current_wp_idx = 0
                previous = {t['id']: t for t in self.tasks}
                self.tasks = []
                for i, t in enumerate(command.get('tasks', [])):
                    tid = t.get('id', f'task-{i}')
                    if t.get('waypoints'):
                        wps = [latlng_to_meters(p) for p in t['waypoints']]
                    elif tid in previous and previous[tid].get('waypoints'):
                        wps = previous[tid]['waypoints']
                    else:
                        wps = self.generate_waypoints(i)
                    # Progression des taches entamees : conservee si
                    # l'operateur le demande (keepProgress), remise a
                    # zero sinon.
                    done = (previous[tid].get('completed_waypoints', 0)
                            if (command.get('keepProgress')
                                and tid in previous) else 0)
                    # Statut conservé si keepProgress : une tâche déjà
                    # terminée reste terminée (sautée à la reprise), une
                    # tâche entamée reste entamée.
                    status = 'pending'
                    if (command.get('keepProgress') and tid in previous
                            and previous[tid].get('status') == 'completed'):
                        status = 'completed'
                    self.tasks.append({
                        'id': tid,
                        'name': t.get('name', f'Tâche {i + 1}'),
                        'type': t.get('type', 'custom'),
                        'status': status,
                        'field': t.get('field'),
                        'waypoints': wps,
                        'completed_waypoints': done,
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
                # Reprise apres pause : saute les taches terminees et
                # reprend la premiere tache entamee la ou elle s'etait
                # arretee (waypoints deja atteints).
                self.current_task_idx = next(
                    (i for i, t in enumerate(self.tasks)
                     if t.get('status') != 'completed'), 0)
                first = self.tasks[self.current_task_idx]
                self.current_wp_idx = first.get('completed_waypoints', 0)
                self.get_logger().info('Mission démarrée (ou reprise)')

            elif action == 'stop_all_tasks':
                self.executing = False
                self.robot_status = 'idle'
                for t in self.tasks:
                    if t['status'] == 'running':
                        t['status'] = 'pending'
                self.get_logger().info('Mission arrêtée')

            elif action == 'emergency_stop':
                # Arret IMMEDIAT, securite d'abord : le robot stoppe sur
                # place et ses outils sont coupes / releves (simule : lame
                # de tonte, outil de travail du sol). La decision pause ou
                # annulation est prise ensuite par l'operateur via la
                # fenetre contextuelle du frontend.
                self.executing = False
                self.robot_status = 'stopped'
                self.get_logger().warning(
                    'ARRET D URGENCE : robot stoppe, outils coupes')

            elif action == 'pause_mission':
                # Pause : progression conservee, reprise possible via
                # start_all_tasks (qui reprend a completed_waypoints).
                self.executing = False
                self.robot_status = 'paused'
                for t in self.tasks:
                    if t['status'] == 'running':
                        t['status'] = 'pending'
                self.publish_tasks_list()
                self.publish_mission_path()
                self.get_logger().info('Mission en pause (progression conservée)')

            elif action == 'cancel_mission':
                # Annulation complete : mission supprimee, le robot
                # rentre a la station de recharge (simule).
                self.executing = False
                self.tasks = []
                self.current_task_idx = 0
                self.current_wp_idx = 0
                self.robot_status = 'returning_to_charge'
                self.publish_tasks_list()
                self.publish_mission_path()
                self.get_logger().info('Mission annulée : retour à la station')

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
        finally:
            # Refonte R4 : chaque commande (changement d'état) est
            # persistée immédiatement.
            self.save_state()

def main(args=None):
    rclpy.init(args=args)
    node = AgriRobotNode()
    rclpy.spin(node)
    # Refonte R4 : dernier état écrit à l'arrêt propre du node.
    node.save_state()
    node.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()
