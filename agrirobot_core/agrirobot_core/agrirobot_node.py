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

# Origine simulée (Paris) — cohérente avec la conversion lat/lng du frontend
ORIGIN_LAT = 48.8566
ORIGIN_LNG = 2.3522
DEG_PER_METER = 0.00001

# Fichier d'état persisté (refonte R4)
STATE_FILE = os.path.join(
    os.path.expanduser('~'), '.agrirobot', 'state.json')

# Batterie : seuil de retour automatique et niveau de reprise
LOW_BATTERY = 20.0
RESUME_BATTERY = 90.0
# Drain (%/tick à 2 Hz) et charge (%/tick)
WORK_DRAIN = 0.25
TRANSIT_DRAIN = 0.1
CHARGE_RATE = 1.0

# Réserve d'énergie dynamique : consommation estimée pour rentrer à la
# station (évacuation zone + corridors), marge de sécurité incluse.
TRANSIT_DRAIN_PER_METER = 0.2   # %/m en transit (simulation)
SAFETY_MARGIN = 1.5
MIN_RESERVE = 10.0
MAX_RESERVE = 60.0

# Activités du robot (machine à états)
MOVING_ACTIVITIES = ('transit', 'work', 'to_station', 'resume',
                     'final_return')


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

        # Timer principal (2 Hz) : tonte = 1 waypoint/tick (2/s, double
        # de l'ancien), transits = 1 waypoint/2 ticks (1/s, visible).
        self.timer = self.create_timer(0.5, self.tick)

        # État interne
        self.tasks = []                 # tâches avec waypoints (mètres)
        self.robot_status = 'idle'
        self.battery = 100.0
        self.robot_pos = (0.0, 0.0)     # mètres (x, y)

        # Machine à états : activity = None (repos) | 'transit' |
        # 'work' | 'to_station' | 'charging' | 'resume' | 'final_return'
        self.activity = None
        self.paused = False
        self.current_task_idx = 0
        self.task_phase = 'transit'     # 'transit' | 'work'
        self.current_wp_idx = 0
        # Route courante (to_station / resume / final_return), mètres
        self.route = []
        self.route_idx = 0
        # Reprise automatique après recharge (batterie faible)
        self.resume_pending = False
        self.resume_task_phase = 'work'
        self.resume_pos = None            # point d'interruption (mètres)

        # Réseau de circulation reçu avec la mission (mètres) :
        # sert aux retours d'urgence calculés par le nœud.
        self.graph_nodes = []           # [(x, y), ...]
        self.graph_edges = []           # [(a, b), ...]
        self.station_m = None           # (x, y)
        self.return_route_m = []        # route de fin de mission

        self._ticks = 0
        self.load_state()

        self.get_logger().info('AgriRobot node is running!')

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

    # ------------------------------------------------------------- routage

    def _nearest_node(self, p):
        """Index du nœud du graphe le plus proche du point p (mètres)."""
        best, best_d = -1, float('inf')
        for i, n in enumerate(self.graph_nodes):
            d = math.hypot(n[0] - p[0], n[1] - p[1])
            if d < best_d:
                best_d, best = d, i
        return best

    def route_to(self, target, start=None):
        """Route (mètres) du point start (défaut : position courante)
        vers target, par le plus court chemin du graphe des corridors.
        Sans graphe ou sans chemin : ligne directe (fallback)."""
        if start is None:
            start = self.robot_pos
        if not self.graph_nodes or self.station_m is None or target is None:
            return [target]
        s = self._nearest_node(start)
        goal = self._nearest_node(target)
        if s < 0 or goal < 0:
            return [target]
        n = len(self.graph_nodes)
        adj = [[] for _ in range(n)]
        for a, b in self.graph_edges:
            w = math.hypot(self.graph_nodes[a][0] - self.graph_nodes[b][0],
                           self.graph_nodes[a][1] - self.graph_nodes[b][1])
            adj[a].append((b, w))
            adj[b].append((a, w))
        dist = [float('inf')] * n
        prev = [-1] * n
        done = [False] * n
        dist[s] = 0.0
        for _ in range(n):
            u, ud = -1, float('inf')
            for i in range(n):
                if not done[i] and dist[i] < ud:
                    ud, u = dist[i], i
            if u < 0 or u == goal:
                break
            done[u] = True
            for v, w in adj[u]:
                nd = dist[u] + w
                if nd < dist[v]:
                    dist[v] = nd
                    prev[v] = u
        if not math.isfinite(dist[goal]):
            return [target]
        nodes = []
        v = goal
        while v >= 0:
            nodes.append(self.graph_nodes[v])
            v = prev[v]
        nodes.reverse()
        return [start] + nodes + [target]

    def _zone_portal(self, task):
        """Point d'entrée de la zone : avant-dernier point du transit
        (dernier sommet de corridor — le transit se termine au premier
        waypoint de travail, à l'intérieur de la zone)."""
        tr = task.get('transit') or []
        if len(tr) >= 2:
            return tr[-2]
        return None

    def _route_length(self, route):
        """Longueur totale (m) d'une route."""
        total = 0.0
        for i in range(1, len(route)):
            total += math.hypot(route[i][0] - route[i - 1][0],
                                route[i][1] - route[i - 1][1])
        return total

    def _seg_cross(self, p1, p2, p3, p4):
        """Vrai si les segments [p1, p2] et [p3, p4] se croisent."""
        def orient(a, b, c):
            v = ((b[0] - a[0]) * (c[1] - a[1])
                 - (b[1] - a[1]) * (c[0] - a[0]))
            if abs(v) < 1e-12:
                return 0
            return 1 if v > 0 else -1
        o1 = orient(p1, p2, p3)
        o2 = orient(p1, p2, p4)
        o3 = orient(p3, p4, p1)
        o4 = orient(p3, p4, p2)
        return o1 != o2 and o3 != o4

    def _route_in_zone(self, task, start, goal):
        """Plus court chemin SÛR dans la zone (graphe de visibilité) :
        position, but et sommets du contour et des obstacles ; une
        arête est valide si son segment ne traverse aucun anneau.
        Renvoie None sans géométrie ou sans chemin (fallback)."""
        geo = task.get('geometry') or {}
        rings = []
        boundary = geo.get('boundary') or []
        if len(boundary) >= 3:
            rings.append(boundary)
        for ring in geo.get('obstacles') or []:
            if len(ring) >= 3:
                rings.append(ring)
        if not rings:
            return None
        pts = [tuple(start), tuple(goal)]
        for r in rings:
            pts += [tuple(p) for p in r]
        n = len(pts)

        def blocked(i, j):
            p, q = pts[i], pts[j]
            if abs(p[0] - q[0]) < 1e-9 and abs(p[1] - q[1]) < 1e-9:
                return True
            for r in rings:
                m = len(r)
                for k in range(m):
                    if self._seg_cross(p, q, r[k], r[(k + 1) % m]):
                        return True
            return False

        adj = [[] for _ in range(n)]
        for i in range(n):
            for j in range(i + 1, n):
                if blocked(i, j):
                    continue
                w = math.hypot(pts[i][0] - pts[j][0],
                               pts[i][1] - pts[j][1])
                adj[i].append((j, w))
                adj[j].append((i, w))
        dist = [float('inf')] * n
        prev = [-1] * n
        done = [False] * n
        dist[0] = 0.0
        for _ in range(n):
            u, ud = -1, float('inf')
            for i in range(n):
                if not done[i] and dist[i] < ud:
                    ud, u = dist[i], i
            if u < 0 or u == 1:
                break
            done[u] = True
            for v, w in adj[u]:
                if dist[u] + w < dist[v]:
                    dist[v] = dist[u] + w
                    prev[v] = u
        if not math.isfinite(dist[1]):
            return None
        path = []
        v = 1
        while v >= 0:
            path.append(pts[v])
            v = prev[v]
        path.reverse()
        return path

    def battery_reserve(self, task):
        """Réserve d'énergie dynamique (%) : consommation estimée pour
        rentrer à la station depuis la position courante (évacuation
        de la zone + corridors), marge de sécurité incluse. Grandes
        parcelles ou station éloignée => retour anticipé."""
        portal = self._zone_portal(task)
        if portal is None or self.station_m is None:
            return LOW_BATTERY
        zr = self._route_in_zone(task, self.robot_pos, portal)
        d_zone = (self._route_length(zr) if zr else
                  math.hypot(self.robot_pos[0] - portal[0],
                             self.robot_pos[1] - portal[1]) * 1.5)
        d_corridor = self._route_length(
            self.route_to(self.station_m, start=portal))
        reserve = ((d_zone + d_corridor)
                   * TRANSIT_DRAIN_PER_METER * SAFETY_MARGIN) + 3.0
        return min(MAX_RESERVE, max(MIN_RESERVE, reserve))

    # ------------------------------------------------------------- simulation

    def tick(self):
        """Tick 2 Hz : avance l'activité courante, publie l'état,
        sauvegarde périodiquement (10 s)."""
        self._ticks += 1
        if not self.paused:
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
                task['completed_waypoints'] = len(task['waypoints'])
                task['last_executed_at'] = datetime.now(
                    timezone.utc).isoformat()
                self.current_task_idx += 1
                if self.current_task_idx >= len(self.tasks):
                    self.start_final_return()
                else:
                    self.task_phase = 'transit'
                    self.current_wp_idx = 0

    def _task_path(self, task):
        """Chemin déjà validé jusqu'à la position courante : transit
        d'entrée + waypoints effectués (ne traverse jamais un
        obstacle). En phase transit : portion du transit parcourue."""
        if self.task_phase == 'work':
            return (list(task.get('transit') or [])
                    + list(task['waypoints'][:self.current_wp_idx]))
        return list(task.get('transit') or [])[:self.current_wp_idx]

    def interrupt_for_charge(self):
        """Batterie faible : pause automatique de la mission, retour à
        la station (itinéraire calculé par le nœud), puis reprise."""
        task = self.tasks[self.current_task_idx]
        if self.task_phase == 'work':
            task['completed_waypoints'] = self.current_wp_idx
        if task['status'] == 'running':
            task['status'] = 'pending'
        self.resume_pending = True
        self.resume_task_phase = self.task_phase
        self.resume_pos = self.robot_pos
        # Itinéraire d'évacuation : plus court chemin SÛR vers le
        # portail de la zone (graphe de visibilité contournant les
        # obstacles), puis Dijkstra sur les corridors jusqu'à la
        # station. Sans géométrie : backtrack du chemin parcouru.
        portal = self._zone_portal(task)
        zone_route = (self._route_in_zone(task, self.robot_pos, portal)
                      if portal is not None else None)
        if zone_route:
            back = zone_route[1:]
        else:
            back = list(reversed(self._task_path(task)))
            if back and tuple(back[0]) == tuple(self.robot_pos):
                back = back[1:]
        if self.station_m:
            join = back[-1] if back else self.robot_pos
            rest = self.route_to(self.station_m, start=join)
            self.route = (back[:-1] + rest) if back else rest
        else:
            self.route = back
        self.route_idx = 0
        self.activity = 'to_station'
        self.robot_status = 'returning_to_charge'
        self.get_logger().warning(
            'Batterie faible : retour à la station, mission en pause '
            '(reprise automatique après recharge)')

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
            'waypoints': ([meters_to_latlng(x, y) for (x, y) in t['waypoints']]
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
                # Réseau de circulation (retours d'urgence) + station +
                # route de retour pré-calculée
                graph = command.get('graph') or {}
                self.graph_nodes = [latlng_to_meters(p)
                                    for p in graph.get('nodes', [])]
                self.graph_edges = [tuple(e)
                                    for e in graph.get('edges', [])]
                self.station_m = (latlng_to_meters(command['station'])
                                  if command.get('station') else None)
                self.return_route_m = ([latlng_to_meters(p)
                                        for p in command.get('returnRoute', [])]
                                       if command.get('returnRoute') else [])
                self.publish_tasks_list()
                self.publish_mission_path()
                self.get_logger().info(
                    f'Mission générée : {len(self.tasks)} tâche(s)')

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
    rclpy.spin(node)
    node.save_state()
    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()