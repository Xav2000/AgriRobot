"""Mixin de navigation : itinéraires, contournement
d'obstacles, évacuation batterie."""
import math
import os
import json
from datetime import datetime, timezone
import rclpy
from rclpy.node import Node
from std_msgs.msg import String
from geometry_msgs.msg import PoseStamped
from .geo import *


class NavigationMixin:
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

    def _inflate_ring(self, ring, margin):
        """Gonfle un polygone d'obstacle vers l'extérieur de margin
        mètres (approximation : éloigne chaque sommet du centroïde —
        le chemin évite l'obstacle sans passer à ras)."""
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        out = []
        for p in ring:
            dx, dy = p[0] - cx, p[1] - cy
            d = math.hypot(dx, dy)
            if d < 1e-9:
                out.append((p[0] + margin, p[1]))
                continue
            out.append((p[0] + dx / d * margin,
                        p[1] + dy / d * margin))
        return out

    def _route_in_zone(self, task, start, goal):
        """Plus court chemin SÛR dans la zone (graphe de visibilité) :
        position, but et sommets des obstacles GONFLÉS d'une marge de
        sécurité ; une arête est valide si son segment ne traverse
        aucun anneau d'obstacle. Le contour de la zone ne bloque PAS
        (le portail est à l'extérieur du polygone — sinon aucun chemin
        ne pourrait y accéder). Renvoie None sans géométrie ou sans
        chemin (fallback backtrack)."""
        geo = task.get('geometry') or {}
        rings = []
        for ring in geo.get('obstacles') or []:
            if len(ring) >= 3:
                rings.append(self._inflate_ring(ring, OBSTACLE_CLEARANCE_M))
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
        # obstacles à distance), puis Dijkstra sur les corridors
        # jusqu'à la station. Sans géométrie : backtrack du chemin
        # parcouru.
        portal = self._zone_portal(task)
        zone_route = (self._route_in_zone(task, self.robot_pos, portal)
                      if portal is not None else None)
        if zone_route:
            back = zone_route[1:]
            self.get_logger().info(
                'Évacuation : chemin optimal (visibilité) vers le portail')
        else:
            self.get_logger().info(
                'Évacuation : backtrack (géométrie de zone absente ou '
                'sans chemin)')
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
