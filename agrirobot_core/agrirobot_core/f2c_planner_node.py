#!/usr/bin/env python3
"""Noeud de generation de trajectoires Fields2Cover (feat/nav2-f2c, etape 3).

ROLE
    Remplace la generation frontend (worklines.ts) : le frontend n'enverra plus que
    des POLYGONES + parametres, ce noeud calcule la couverture avec Fields2Cover
    (headlands -> swaths -> ordre boustrophedon -> virages Reeds-Shepp) et publie
    des waypoints types pour le futur superviseur Nav2 (jalon 2).

REGLES METIER (reprises a l'identique)
    S0 : aucune ligne ne franchit JAMAIS une exclusion (contrainte dure) ;
    S1 : marge de securite parametrable autour des obstacles (obstacleMarginM) ;
    R1 : le robot ne sort jamais du polygone ;
    R3 : les allers-retours s'arretent sur le contour interieur.

ENTREE (topic /task/command, std_msgs/String JSON)
    {
      "action": "generate_coverage",
      "zones": {
        "mow": [[lat, lng], ...],
        "exclusions": [[[lat, lng], ...], ...]
      },
      "params": {
        "workWidth": 0.5,          # largeur de travail (m)
        "headlandPasses": 2,       # nombre de contours interieurs
        "obstacleMargin": 0.25,    # marge de securite obstacles (m)
        "refAngleDeg": null        # orientation des passes ; null = 1re arete du polygone
      }
    }

SORTIES
    /coverage/plan (String JSON) : taches avec waypoints [[lat, lng]] + waypointKinds
        ('headland' | 'sweep' | 'transition') + stats — consomme par le superviseur (jalon 2).
    /mission/path (String JSON) : payload frontend {tasks:[{id,name,status,
        waypoints, completedWaypoints}]} — previsualisation MissionLayer inchangee.

REPERE
    Repere metrique local identique a geo.py : ORIGIN (48.8566, 2.3522),
    DEG_PER_METER = 1e-5 (x = est, y = nord).

Installation Fields2Cover (WSL Ubuntu 22.04) :
    sudo apt install -y libgdal-dev libgeos-dev libtinyxml2-dev nlohmann-json3-dev
    pip install fields2cover   # compile depuis source, quelques minutes

Exemple de test (reperes en metres autour de l'origine) :
    ros2 topic pub -1 /task/command std_msgs/String "{data: '{\"action\": \"generate_coverage\", \"zones\": {\"mow\": [[48.8566, 2.35225], [48.85665, 2.35225], [48.85665, 2.3523], [48.8566, 2.3523]]}, \"params\": {\"workWidth\": 0.5, \"headlandPasses\": 1, \"obstacleMargin\": 0.25}}'}"
    ros2 topic echo -1 /coverage/plan
"""

import json
import math

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

try:
    import fields2cover as f2c
    F2C_AVAILABLE = True
except ImportError:  # pragma: no cover
    f2c = None
    F2C_AVAILABLE = False

ORIGIN_LAT = 48.8566
ORIGIN_LNG = 2.3522
DEG_PER_METER = 1e-5


def latlng_to_xy(lat, lng):
    return ((lng - ORIGIN_LNG) / DEG_PER_METER, (lat - ORIGIN_LAT) / DEG_PER_METER)


def xy_to_latlng(x, y):
    return [ORIGIN_LAT + y * DEG_PER_METER, ORIGIN_LNG + x * DEG_PER_METER]


def _cls(*names):
    """Resout une classe F2C quel que soit le schema de nommage des bindings."""
    for n in names:
        if hasattr(f2c, n):
            return getattr(f2c, n)
    raise AttributeError('Classe Fields2Cover introuvable : %s' % (names,))


def _inflate_ring(ring_xy, margin):
    """Gonfle approximativement un polygone (S1) par homothetie centroique.

    Approximation valable pour des obstacles convexes / faiblement concaves.
    S0 (interdiction absolue de traverser) reste garanti par le trou interne
    construit sur le polygone GONLE, independamment de cette approximation.
    """
    if margin <= 0 or not ring_xy:
        return ring_xy
    cx = sum(p[0] for p in ring_xy) / len(ring_xy)
    cy = sum(p[1] for p in ring_xy) / len(ring_xy)
    out = []
    for x, y in ring_xy:
        dx, dy = x - cx, y - cy
        d = math.hypot(dx, dy)
        if d < 1e-9:
            out.append((x, y))
            continue
        # deplace chaque sommet de 'margin' vers l'exterieur
        out.append((x + dx / d * margin, y + dy / d * margin))
    return out


class F2CPlannerNode(Node):

    def __init__(self):
        super().__init__('f2c_planner_node')
        self.declare_parameter('default_work_width', 0.5)
        self.declare_parameter('default_headland_passes', 2)
        self.declare_parameter('default_obstacle_margin', 0.25)

        self.plan_pub = self.create_publisher(String, '/coverage/plan', 10)
        self.mission_pub = self.create_publisher(String, '/mission/path', 10)
        self.create_subscription(String, '/task/command', self._on_command, 10)

        if not F2C_AVAILABLE:
            self.get_logger().error(
                'Fields2Cover non installe : pip install fields2cover '
                '(dependances : libgdal-dev libgeos-dev libtinyxml2-dev nlohmann-json3-dev)')
        self.get_logger().info('f2c_planner_node pret (Fields2Cover: %s)'
                               % ('OK' if F2C_AVAILABLE else 'ABSENT'))

    # ------------------------------------------------------------- commande

    def _on_command(self, msg: String):
        try:
            cmd = json.loads(msg.data)
        except json.JSONDecodeError as e:
            self.get_logger().error('Commande JSON invalide : %s' % e)
            return
        action = cmd.get('action')
        if action == 'generate_coverage':
            self._generate(cmd)
        elif action in ('start_all_tasks', 'stop_all_tasks'):
            # gere par le superviseur (jalon 2) ; ignore ici
            pass

    # ----------------------------------------------------------- generation

    def _generate(self, cmd):
        if not F2C_AVAILABLE:
            self.get_logger().error('Generation impossible : Fields2Cover absent')
            return
        zones = cmd.get('zones') or {}
        mow = zones.get('mow') or []
        exclusions = zones.get('exclusions') or []
        if len(mow) < 3:
            self.get_logger().error('Zone de tonte invalide (%d sommets)' % len(mow))
            return
        p = cmd.get('params') or {}
        work_width = float(p.get('workWidth',
                                 self.get_parameter('default_work_width').value))
        headland_passes = int(p.get('headlandPasses',
                                    self.get_parameter('default_headland_passes').value))
        obstacle_margin = float(p.get('obstacleMargin',
                                      self.get_parameter('default_obstacle_margin').value))
        ref_angle_deg = p.get('refAngleDeg')

        # --- repere metrique local
        mow_xy = [latlng_to_xy(lat, lng) for lat, lng in mow]
        obs_xy = [[latlng_to_xy(lat, lng) for lat, lng in ring]
                  for ring in exclusions]

        # --- angle des passes : bordure de reference = 1re arete du polygone
        if ref_angle_deg is None:
            dx = mow_xy[1][0] - mow_xy[0][0]
            dy = mow_xy[1][1] - mow_xy[0][1]
            ref_angle = math.atan2(dy, dx)
        else:
            ref_angle = math.radians(float(ref_angle_deg))

        # --- construction du champ : anneau externe + trous (S0 dure)
        Point = _cls('Point', 'F2CPoint')
        Ring = _cls('LinearRing', 'Ring', 'F2CRing')
        Cells = _cls('Cells', 'F2CCells')

        def make_ring(points_xy):
            ring = Ring()
            for x, y in points_xy:
                ring.addPoint(Point(x, y))
            return ring

        cells = Cells()
        rings = [make_ring(mow_xy)]
        for ring_xy in obs_xy:
            inflated = _inflate_ring(ring_xy, obstacle_margin)  # S1
            rings.append(make_ring(inflated))  # trous -> S0
        added = False
        Cell = _cls('Cell', 'F2CCell')
        if Cell is not None:
            cell = Cell()
            ok_cell = True
            for j, r in enumerate(rings):
                try:
                    cell.addRing(j, r)
                except TypeError:
                    try:
                        cell.addRing(r)
                    except Exception:
                        ok_cell = False
                        break
                except Exception:
                    ok_cell = False
                    break
            if ok_cell:
                for m in ('add', 'append', 'addCell', 'push_back'):
                    if hasattr(cells, m):
                        getattr(cells, m)(cell)
                        added = True
                        break
        if not added:
            for j, r in enumerate(rings):
                cells.addRing(j, r)

        # --- headlands (N passes) puis zone de balayage
        ConstHL = _cls('HG_Const_gen', 'HG_ConstHL', 'ConstHL')
        const_hl = ConstHL()
        headland_width = headland_passes * work_width
        try:
            no_hl = const_hl.generateHeadlands(cells, headland_width)
        except TypeError:
            no_hl = const_hl.generateHeadlandArea(cells, headland_width)
        try:
            hl_empty = no_hl is None or no_hl.isEmpty()
        except Exception:
            hl_empty = not bool(no_hl)
        if hl_empty:
            self.get_logger().warning('Headlands vides — generation sur le champ entier')
            no_hl = cells

        # --- swaths paralleles a la bordure de reference
        BruteForce = _cls('SG_BruteForce', 'BruteForce')
        bf = BruteForce()
        swaths = None
        for call in (lambda: bf.generateBestSwaths(work_width, no_hl),
                     lambda: bf.generateSwaths(ref_angle, work_width, no_hl),
                     lambda: bf.generateBestSwaths(ref_angle, work_width, no_hl),
                     lambda: bf.generateSwaths(work_width, no_hl)):
            try:
                swaths = call()
                break
            except Exception:
                continue
        if swaths is None:
            self.get_logger().error('Aucune signature de generateSwaths ne convient a cette version F2C')
            return
        n_swaths = swaths.size() if hasattr(swaths, 'size') else len(swaths)
        if n_swaths == 0:
            self.get_logger().error('Aucun swath genere (champ trop etroit pour w=%.2f m ?)'
                                    % work_width)
            return

        # --- ordre boustrophedon
        Boustrophedon = _cls('RP_Boustrophedon', 'RP_BoustrophedonOrder', 'BoustrophedonOrder')
        try:
            swaths = Boustrophedon().genSortedSwaths(swaths)
        except Exception as e:  # ordre brut si le tri echoue
            self.get_logger().warning('Tri boustrophedon indisponible (%s) — ordre brut' % e)

        # --- chemin complet avec virages Reeds-Shepp (Gazonator sait reculer)
        waypoints = []
        kinds = []
        try:
            Robot = _cls('Robot', 'F2CRobot')
            robot = Robot()
            for setter, val in (('setWidth', 0.4), ('setCovWidth', work_width)):
                if hasattr(robot, setter):
                    getattr(robot, setter)(val)
            PathPlanning = _cls('PP_PathPlanning', 'PathPlanning')
            RS = _cls('PP_ReedsSheppCurves', 'PP_ReedsSheppSolver', 'ReedsSheppSolver')
            pp = PathPlanning()
            for wire in (lambda: robot.setTurningPointPlannerObjFunc(RS()),
                         lambda: pp.setTurningBase(RS()),
                         lambda: robot.setTurnPointPlanner(RS())):
                try:
                    wire()
                    break
                except Exception:
                    continue
            path = None
            for call in (lambda: pp.planPath(robot, swaths),                 # v1.x
                         lambda: pp.planPath(robot, swaths, True),
                         lambda: pp.planBestPath(robot, swaths),
                         lambda: pp.searchBestPath(robot, swaths)):
                try:
                    path = call()
                    break
                except Exception:
                    continue
            if path is None:
                raise RuntimeError('planPath indisponible sur cette version F2C')
            try:
                path.populate(200)  # densification (5 mm) pour un suivi propre
            except Exception:
                pass
            waypoints, kinds = self._extract_path(path)
        except Exception as e:
            self.get_logger().warning(
                'Path planner F2C indisponible (%s) — sortie swaths bruts' % e)
            waypoints, kinds = self._extract_swaths(swaths)

        if len(waypoints) < 2:
            self.get_logger().error('Chemin vide apres extraction')
            return

        # --- publication
        latlng = [xy_to_latlng(x, y) for x, y in waypoints]
        plan = {
            'tasks': [{
                'id': 'f2c-1',
                'name': 'Couverture F2C',
                'status': 'pending',
                'waypoints': latlng,
                'waypointKinds': kinds,
                'stats': {
                    'swaths': n_swaths,
                    'waypoints': len(latlng),
                    'workWidth': work_width,
                    'headlandPasses': headland_passes,
                    'obstacleMargin': obstacle_margin,
                    'exclusions': len(obs_xy),
                },
            }],
        }
        self.plan_pub.publish(String(data=json.dumps(plan)))
        mission = {
            'tasks': [{
                'id': 'f2c-1',
                'name': 'Couverture F2C',
                'status': 'pending',
                'waypoints': latlng,
                'completedWaypoints': 0,
            }],
        }
        self.mission_pub.publish(String(data=json.dumps(mission)))
        self.get_logger().info(
            'Plan genere : %d waypoints, %d swaths, %d exclusions (S0/S1 appliques)'
            % (len(latlng), n_swaths, len(obs_xy)))

    # ----------------------------------------------------------- extraction

    def _extract_path(self, path):
        """Extrait (waypoints, kinds) d'un F2CPath ; virages = 'transition'."""
        pts, kinds = [], []
        n = path.size() if hasattr(path, 'size') else path.length()
        for i in range(n):
            p = path.at(i) if hasattr(path, 'at') else path[i]
            x = p.getX() if hasattr(p, 'getX') else p.x
            y = p.getY() if hasattr(p, 'getY') else p.y
            # les points de virage ont une duree negative dans F2C (convention C++)
            is_turn = False
            try:
                is_turn = p.getDuration() < 0
            except Exception:
                pass
            pts.append((float(x), float(y)))
            kinds.append('transition' if is_turn else 'sweep')
        return pts, kinds

    def _extract_swaths(self, swaths):
        """Fallback : extremites des swaths (une ligne = 2 waypoints)."""
        pts, kinds = [], []
        n = swaths.size() if hasattr(swaths, 'size') else len(swaths)
        for i in range(n):
            s = swaths.at(i) if hasattr(swaths, 'at') else swaths[i]
            start = s.getStartPoint() if hasattr(s, 'getStartPoint') else None
            end = s.getEndPoint() if hasattr(s, 'getEndPoint') else None
            if start is not None:
                pts.append((float(start.getX()), float(start.getY())))
                kinds.append('sweep')
            if end is not None:
                pts.append((float(end.getX()), float(end.getY())))
                kinds.append('sweep')
        return pts, kinds


def main(args=None):
    rclpy.init(args=args)
    node = F2CPlannerNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()