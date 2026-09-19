#!/usr/bin/env python3
"""
AgriRobot Node - Main ROS 2 node for agricultural robot management.

Simulation : position du robot, mission complète (transits sur les
chemins de liaison + parcours de travail + retour station), progression
des tâches et batterie.
Topics publiés :
  - /robot/position (PoseStamped, mètres)
  - /robot/status   (String JSON : status, battery, position)
  - /tasks/list     (String JSON : tâches + progression)
  - /mission/path   (String JSON : waypoints [lat,lng] + statut par tâche)
Commandes (/task/command, String JSON) :
  generate_mission (tasks avec transit optionnel + graph + station +
  returnRoute + keepProgress optionnel), start_all_tasks (reprise si
  entamee), stop_all_tasks, emergency_stop (arret immediat + outils
  coupes), pause_mission, cancel_mission (retour station), start_task,
  stop_task, go_to_charge, leave_charge, return_to_charge, add_task,
  remove_task
Refonte R4 : état persisté dans ~/.agrirobot/state.json.
Trajets réels : le frontend pré-calcule transits et retour (Dijkstra
sur le graphe des corridors) ; le nœud suit. En cas de batterie faible
(réserve DYNAMIQUE estimée sur la distance à la station), le nœud
évacue la zone par le plus court chemin sûr (graphe de visibilité
contournant les obstacles — géométrie fournie par le frontend),
rejoint la station par les corridors, se recharge puis reprend seul
la mission à sa progression.
Vitesses : tonte 2 waypoints/s (double de l'ancien 1/s), transits
1 waypoint/s (visible).
"""

import math
import os
import json
from datetime import datetime, timezone

import rclpy
from rclpy.node import Node
from std_msgs.msg import String
from geometry_msgs.msg import PoseStamped


from .geo import *
from .automation import AutomationMixin
from .navigation import NavigationMixin
from .weather import WeatherMonitor


class AgriRobotNode(NavigationMixin, AutomationMixin, Node):

    # ------------------------------------------------------------- persistance

    def save_state(self):
        """Écrit l'état complet dans state.json (atomique)."""
        state = {
            'savedAt': datetime.now(timezone.utc).isoformat(),
            'robot_status': self.robot_status,
            'battery': self.battery,
            'robot_pos': list(self.robot_pos),
            'activity': self.activity,
            'paused': self.paused,
            'current_task_idx': self.current_task_idx,
            'task_phase': self.task_phase,
            'current_wp_idx': self.current_wp_idx,
            'route': [list(p) for p in self.route],
            'route_idx': self.route_idx,
            'resume_pending': self.resume_pending,
            'resume_task_phase': self.resume_task_phase,
            'resume_pos': list(self.resume_pos) if self.resume_pos else None,
            'graph_nodes': [list(p) for p in self.graph_nodes],
            'graph_edges': [list(e) for e in self.graph_edges],
            'station_m': list(self.station_m) if self.station_m else None,
            'return_route_m': [list(p) for p in self.return_route_m],
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
        """Recharge le dernier état sauvegardé (reboot du node). Un
        déplacement interrompu repart en PAUSE (progression conservée)."""
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
            self.task_phase = state.get('task_phase', 'transit')
            self.current_wp_idx = state.get('current_wp_idx', 0)
            self.route = [tuple(p) for p in state.get('route', [])]
            self.route_idx = state.get('route_idx', 0)
            self.resume_pending = state.get('resume_pending', False)
            self.resume_task_phase = state.get('resume_task_phase', 'work')
            rp = state.get('resume_pos')
            self.resume_pos = tuple(rp) if rp else None
            self.graph_nodes = [tuple(p) for p in state.get('graph_nodes', [])]
            self.graph_edges = [tuple(e) for e in state.get('graph_edges', [])]
            sm = state.get('station_m')
            self.station_m = tuple(sm) if sm else None
            self.return_route_m = [tuple(p) for p in state.get('return_route_m', [])]
            activity = state.get('activity')
            if activity in MOVING_ACTIVITIES:
                # Le node s'est arrêté en pleine mission : on ne repart
                # pas tout seul — pause, progression conservée.
                self.activity = activity
                self.paused = True
                self.robot_status = 'paused'
                self.get_logger().warning(
                    'État rechargé : déplacement interrompu, en pause '
                    '(reprise via start_all_tasks)')
            else:
                self.activity = activity if activity == 'charging' else None
                self.paused = False
                if self.activity == 'charging':
                    has_pending = any(t.get('status') != 'completed'
                                      for t in self.tasks)
                    in_range = 0 <= self.current_task_idx < len(self.tasks)
                    if not (self.resume_pending and has_pending and in_range):
                        # Charge orpheline (mission terminée ou état
                        # corrompu par un crash) : retour au repos.
                        self.activity = None
                        self.robot_status = 'idle'
            self.get_logger().info(
                f'État rechargé depuis {STATE_FILE} : '
                f'{len(self.tasks)} tâche(s), batterie '
                f'{round(self.battery, 1)} %')
        except (OSError, ValueError) as e:
            self.get_logger().error(f'État illisible ({STATE_FILE}) : {e}')

    # ------------------------------------------------------------- simulation

    def tick(self):
        """Tick 2 Hz : avance l'activité courante, publie l'état,
        sauvegarde périodiquement (10 s)."""
        self._ticks += 1
        if not self.paused and not self.rtk_hold:
            if self.activity == 'work':
                self.advance_mission()
            elif self.activity == 'transit':
                if self._ticks % 2 == 0:
                    self.advance_mission()
            elif self.activity in ('to_station', 'resume', 'final_return'):
                if self._ticks % 2 == 0:
                    self.advance_route()
            elif self.activity == 'charging':
                self.battery = min(100.0, self.battery + CHARGE_RATE)

                target = RESUME_BATTERY if self.resume_pending else 100.0
                if self.battery >= target:
                    self.finish_charging()
        self.publish_position()
        self.publish_status()
        if self.tasks:
            self.publish_tasks_list()
            self.publish_mission_path()
        if self._ticks % 20 == 0:
            self.save_state()

    def advance_mission(self):
        """Avance dans la tâche courante (transit puis travail).
        Transit : suit les waypoints d'approche. Travail : suit le
        parcours, conserve la progression, détecte la batterie faible."""
        task = self.tasks[self.current_task_idx]
        if self.task_phase == 'transit':
            wps = task.get('transit') or []
            if not wps:
                # Pas de transit calculé (tâche manuelle) : direct au travail
                self.task_phase = 'work'
                self.current_wp_idx = task.get('completed_waypoints', 0)
                return
        else:
            wps = task['waypoints']

        if self.current_wp_idx < len(wps):
            self.robot_pos = tuple(wps[self.current_wp_idx])
            self.current_wp_idx += 1
            if self.task_phase == 'transit':
                task['status'] = 'pending'
                self.battery = max(5.0, self.battery - TRANSIT_DRAIN)
            else:
                task['status'] = 'running'
                task['completed_waypoints'] = self.current_wp_idx
                self.battery = max(5.0, self.battery - WORK_DRAIN)
            if (self.battery <= MAX_RESERVE
                    and self.battery <= self.battery_reserve(task)):
                self.interrupt_for_charge()
        else:
            if self.task_phase == 'transit':
                # Arrivé à la zone : début (ou reprise) du travail
                self.task_phase = 'work'
                self.current_wp_idx = task.get('completed_waypoints', 0)
            else:
                task['status'] = 'completed'
                task['completed_waypoints'] = len(task['waypoints']
)
                task['last_executed_at'] = datetime.now(
                    timezone.utc).isoformat()
                self.current_task_idx += 1
                if self.current_task_idx >= len(self.tasks):
                    self.start_final_return()
                else:
                    self.task_phase = 'transit'
                    self.current_wp_idx = 0

    def advance_route(self):
        """Avance sur la route courante (retour station / reprise /
        retour final) puis déclenche la phase suivante à l'arrivée."""
        if self.route_idx < len(self.route):
            self.robot_pos = tuple(self.route[self.route_idx])
            self.route_idx += 1
            self.battery = max(5.0, self.battery - TRANSIT_DRAIN)
            return
        # Arrivée
        if self.activity == 'to_station':
            self.activity = 'charging'
            self.robot_status = 'charging'
            if self.station_m:
                self.robot_pos = tuple(self.station_m)
            self.get_logger().info('À la station : recharge en cours')
        elif self.activity == 'resume':
            # De retour au point d'interruption : reprise de la phase
            # interrompue (tonte, ou transit s'il était en cours).
            task = self.tasks[self.current_task_idx]
            self.task_phase = self.resume_task_phase
            if self.task_phase == 'work':
                self.current_wp_idx = task.get('completed_waypoints', 0)
            self.activity = 'work'
            self.robot_status = 'working'
            self.get_logger().info('Mission reprise après recharge')
        elif self.activity == 'final_return':
            self.activity = 'charging'
            self.robot_status = 'charging'
            if self.station_m:
                self.robot_pos = tuple(self.station_m)
            self.get_logger().info('Mission terminée : à la station, recharge')

    def finish_charging(self):
        """Recharge terminée : reprise automatique de la mission si elle
        avait été interrompue, sinon repos."""
        has_pending = any(t.get('status') != 'completed'
     
                     for t in self.tasks)
        if (self.resume_pending and self.tasks
                and 0 <= self.current_task_idx < len(self.tasks)
                and has_pending):
            task = self.tasks[self.current_task_idx]
            portal = self._zone_portal(task)
            # Reprise : corridor jusqu'au portail de la zone, puis plus
            # court chemin SÛR (visibilité) jusqu'au point
            # d'interruption. Fallback : rejeu du chemin d'origine.
            if portal is not None and self.resume_pos:
                zpath = self._route_in_zone(task, portal, self.resume_pos)
            else:
                zpath = None
            if zpath is None:
                zpath = self._task_path(task)
            entry = (zpath[0] if zpath
                     else (task['waypoints'][0]
                           if task.get('waypoints') else self.station_m))
            if entry is not None:
                rest = self.route_to(entry,
                                     start=self.station_m or self.robot_pos)
                self.route = (rest[:-1] + zpath) if zpath else rest
                self.route_idx = 0
                self.activity = 'resume'
                self.robot_status = 'leaving_charge'
                self.resume_pending = False
                self.get_logger().info('Batterie OK : retour vers la zone interrompue')
                return
            self.task_phase = 'work'
            self.current_wp_idx = task.get('completed_waypoints', 0)
            self.activity = 'work'
            self.robot_status = 'working'
            self.resume_pending = False
            return
        self.activity = None
        self.robot_status = 'idle'
        self.save_state()
        self.get_logger().info('Recharge terminée')

    def start_final_return(self):
        """Fin de mission : retour à la station par la route pré-calculée
        (ou calculée par le nœud), puis recharge."""
        if self.return_route_m:
            self.route = list(self.return_route_m)
            self.route_idx = 0
            self.activity = 'final_return'
        elif self.station_m:
            self.route = self.route_to(self.station_m)

            self.route_idx = 0
            self.activity = 'final_return'
        else:
            self.activity = None
        self.robot_status = 'returning_to_charge'
        self.get_logger().info('Mission terminée : retour à la station')

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
            'weather': self.weather.snapshot(),
            'config': self.robot_config,
            'auto': self.auto_snapshot(),
            'rtk': self.rtk_snapshot(),
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
            'waypoints': ([meters_to_latlng(x, y) for (x, y) in t[
'waypoints']]
                          if t.get('waypoints') else []),
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

            if action == 'generate_mission':
                # Remplace la mission courante par la file ordonnée reçue,
                # avec les trajets pré-calculés (transit par tâche, route
                # de retour), le graphe des corridors et la station.
                self.activity = None
                self.paused = False
                self.robot_status = 'idle'
                self.current_task_idx = 0
                self.task_phase = 'transit'
                self.current_wp_idx = 0
                self.route = []
                self.route_idx = 0
                self.resume_pending = False
                self.resume_task_phase = 'work'
                self.resume_pos = None
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
                    transit = ([latlng_to_meters(p) for p in t['transit']]
                               if t.get('transit') else [])
                    geo = t.get('geometry') or {}
                    geometry = ({
                        'boundary': [latlng_to_meters(p)
                                     for p in geo.get('boundary', [])],
                        'obstacles': [[latlng_to_meters(p) for p in ring]
                                      for ring in geo.get('obstacles', [])],
                    } if geo.get('boundary') else None)
                    done = (previous[tid].get('completed_waypoints', 0)
                            if (command.get('keepProgress')
                                and tid in previous) else 0)
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
                        'transit': transit,
                        'geometry': geometry,
                        'completed_waypoints': done,
                    })
                n_geo = sum(1 for t in self.tasks if t.get('geometry'))
                self.get_logger().info(
                    f'Mission générée : {len(self.tasks)} tâche(s), '
                    f'{n_geo} avec géométrie de zone')
                # Réseau de circulation (retours d'urgence) + station +
                # route de retour pré-calculée
                graph = command.get('graph') or {}
                self.graph_nodes = [latlng_to_meters(p)
                                    for p in graph.get('nodes', [])]
                self.graph_edges = [tuple(e)
                                    for e in graph.get('edges', [])]
                self.station_m = (latlng_to_meters(command['station'])
                                  if command.get('station') else None)
                if command.get('station'):
                    # Meteo : la station sert de reference.
                    self.weather.set_location(command['station'][0],
                                              command['station'][1])
                self.return_route_m = ([latlng_to_meters(p)
                                        for p in command.get('returnRoute', [])]
                                       if command.get('returnRoute') else [])
                self.publish_tasks_list()
                self.publish_mission_path()

            elif action == 'start_all_tasks':
                if not self.tasks:
                    self.get_logger().warning('Aucune tâche à démarrer')
                    return
                self.paused = False
                if self.activity in ('to_station', 'charging'):
                    self.get_logger().info(
                        'Retour/recharge en cours — la reprise est automatique')
                    return
                if self.activity in ('work', 'transit', 'resume'):
                    self.robot_status = 'working'
                    self.get_logger().info('Mission reprise')
                    return
                # Démarrage (ou redémarrage après arrêt) : saute les
                # tâches terminées, transit vers la première à faire.
                self.current_task_idx = next(
                    (i for i, t in enumerate(self.tasks)
                     if t.get('status') != 'completed'), 0)
                self.task_phase = 'transit'
                self.current_wp_idx = 0
                self.activity = 'transit'
                self.robot_status = 'working'
                self.get_logger().info('Mission démarrée (ou reprise)')

            elif action == 'stop_all_tasks':
                self.paused = True
                self.robot_status = 'idle'
                for t in self.tasks:
                    if t['status'] == 'running':
                        t['status'] = 'pending'
                self.get_logger().info('Mission arrêtée')

            elif action == 'emergency_stop':
                # Arret IMMEDIAT, securite d'abord : le robot stoppe sur
      
          # place et ses outils sont coupes / releves (simule).
                self.paused = True
                self.robot_status = 'stopped'
                self.get_logger().warning(
                    'ARRET D URGENCE : robot stoppe, outils coupes')

            elif action == 'pause_mission':
                # Pause : progression conservee, reprise possible via
                # start_all_tasks (ou automatique après recharge).
                self.paused = True
                self.robot_status = 'paused'
                for t in self.tasks:
                    if t['status'] == 'running':
                        t['status'] = 'pending'
                self.publish_tasks_list()
                self.publish_mission_path()
                self.get_logger().info('Mission en pause (progression conservée)')

            elif action == 'cancel_mission':
                # Annulation complete : mission supprimee, retour a la
                # station (route pre-calculee ou calculee par le node).
                self.tasks = []
                self.current_task_idx = 0
                self.task_phase = 'transit'
                self.current_wp_idx = 0
                self.resume_pending = False
                self.resume_task_phase = 'work'
                self.resume_pos = None
                self.paused = False
                self.robot_status = 'returning_to_charge'
                # Retour calculé depuis la position ACTUELLE : la
                # route pré-calculée part de la fin de la dernière
                # tâche et téléporterait le robot s'il annule avant.
                if self.station_m:
                    self.route = self.route_to(self.station_m,
                                               start=self.robot_pos)
                    self.route_idx = 0
                    self.activity = 'final_return'
                else:
                    self.activity = None
                self.publish_tasks_list()
                self.publish_mission_path()
                self.get_logger().info('Mission annulée : retour à la station')

            elif action == 'add_task':
                task = command.get('task', {})
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
                    'transit': ([latlng_to_meters(p) for p in task['transit']]
                                if task.get('transit') else []),
                    'completed_waypoints': 0,
                })
                self.publish_tasks_list()
                self.publish_mission_path()
                self.get_logger().info(f"Added task: {task.get('name')}")

            elif action == 'remove_task':
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

            elif action == 'start_task':
                self.robot_status = 'working'
                self.get_logger().info('Started task')

            elif action == 'stop_task':
                self.robot_status = 'idle'
                self.get_logger().info('Stopped current task')

            elif action == 'reset_mission':
                # Purge complète de la progression : toutes les tâches
                # repassent à pending, tout l'état d'exécution interne
                # est réinitialisé. Position du robot, batterie et date
                # de dernière exécution (lastExecutedAt) sont conservées.
                for t in self.tasks:
                    t['status'] = 'pending'
                    t['progress'] = 0
                    t['currentStep'] = 0
                self.current_task_idx = 0
                self.task_phase = 'transit'
                self.current_wp_idx = 0
                self.route = []
                self.route_idx = 0
                self.resume_pending = False
                self.resume_pos = None
                self.resume_task_phase = 'work'
                self.activity = None
                self.paused = False
                self.robot_status = 'idle'
                self.save_state()
                self.publish_tasks_list()
                self.publish_mission_path()
                self.get_logger().info(
                    'Mission réinitialisée : toutes les tâches sont à nouveau en attente')
            elif action == 'set_battery':
                # Outil de test : force le niveau de batterie.
                level = float(command.get('level', 100.0))
                self.battery = max(0.0, min(100.0, level))
                self.save_state()
                self.get_logger().info(
                    f'Batterie forcée à {self.battery:.1f} % (test)')

            elif action == 'set_speed':
                # Outil de test : multiplicateur de vitesse de
                # simulation (recrée le timer de tick).
                mult = max(0.25, min(4.0,
                                     float(command.get('multiplier', 1.0))))
                self.speed_multiplier = mult
                self.timer.cancel()
                self.timer = self.create_timer(0.5 / mult, self.tick)
                self.get_logger().info(
                    f'Vitesse de simulation x{mult} (tick '
                    f'toutes les {0.5 / mult:.2f} s)')

            elif action == 'set_weather_override':
                # Dev : forcage manuel de la meteo ('sun'/'rain'/null),
                # ou bascule automatique avec toggle=true.
                if command.get('toggle'):
                    self.weather.toggle()
                else:
                    self.weather.set_override(command.get('condition'))

            elif action in ('set_robot_config', 'set_auto_mode',
                            'set_rtk_override'):
                self.handle_automation_command(command)
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
            # Chaque commande (changement d'état) est persistée.
            self.save_state()


def main(args=None):
    rclpy.init(args=args)
    node = AgriRobotNode()
    # Meteo (etape 6.10a) : poll Open-Meteo en tache de fond +
    # override de dev via set_weather_override. Non persiste.
    node.weather = WeatherMonitor()
    node.weather.start()
    # 6.10b/c : mode automatique + RTK.
    node.init_automation()
    try:
        rclpy.spin(node)
    finally:
        node.weather.stop()
        node.save_state()
        node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
