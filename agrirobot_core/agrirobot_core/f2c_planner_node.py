#!/usr/bin/env python3
"""f2c_planner_node v2 - Fields2Cover 2.1.0, TOUTES les options exposees.

Banc feat/nav2-f2c, etape 6 : la commande generate_coverage accepte
desormais l integralite des curseurs F2C. Le plan est PUBLIE mais le
robot ne part que si le mission_supervisor recoit start_mission ->
on peut generer des apercus sans naviguer.

ENTREE (topic /task/command, std_msgs/String JSON)
    {
      "action": "generate_coverage",
      "zones": {
        "mow": [[lat, lng], ...],
        "exclusions": [[[lat, lng], ...], ...]
      },
      "params": {
        "workWidth": 0.5,          # largeur de travail (m)
        "headlandPasses": 1,       # 0 = AUCUN contour (passes sur tout le champ)
        "mowHeadland": true,       # contour TONDU (anneau Python) ou juste reserve
        "obstacleMargin": 0.25,    # marge de securite obstacles (S1)
        "refAngleDeg": null,       # null = angle optimal ; sinon angle fixe
        "sgObj": "field_cov",      # field_cov | n_swath | n_swath_mod |
                                   # overlaps | swath_length
        "rpAlg": "boustrophedon",  # boustrophedon | snake | spiral
        "ppAlg": "reeds_shepp",    # dubins | dubins_cc | reeds_shepp |
                                   # reeds_shepp_hc
        "minTurningRadius": 0.3   # rayon de braquage du robot (m)
      }
    }

SORTIES
    /coverage/plan : taches avec waypoints + waypointKinds + echo des options.
    /mission/path : payload frontend (preview).

REPERE
    ORIGIN (48.8566, 2.3522), DEG_PER_METER = 1e-5 (x = est, y = nord).
"""
import json
import math

try:
    import fields2cover as f2c
    F2C_AVAILABLE = True
except Exception:  # noqa: BLE001
    F2C_AVAILABLE = False

from rclpy.node import Node
from std_msgs.msg import String

ORIGIN_LAT = 48.8566
ORIGIN_LNG = 2.3522
DEG_PER_METER = 1e-5


def latlng_to_xy(lat, lng):
    return ((lng - ORIGIN_LNG) / DEG_PER_METER,
            (lat - ORIGIN_LAT) / DEG_PER_METER)


def xy_to_latlng(x, y):
    return (ORIGIN_LAT + y * DEG_PER_METER, ORIGIN_LNG + x * DEG_PER_METER)


def _cls(*names):
    """Renvoie la premiere classe F2C disponible (nommage SWIG variable)."""
    for n in names:
        c = getattr(f2c, n, None)
        if c is not None:
            return c
    raise RuntimeError('Classe F2C introuvable : %s' % '/'.join(names))


# ---------------------------------------------------------------------- #
# geometrie pure Python (contour tondu)
# ---------------------------------------------------------------------- #
def _inflate_ring(ring_xy, margin):
    """Offset d un anneau ferme : margin > 0 vers l exterieur, < 0 interieur.

    Deplace chaque sommet le long de la bissectrice exterieure — exact
    pour les polygones convexes (zones dessinees a la souris : OK).
    """
    n = len(ring_xy)
    out = []
    for i in range(n):
        x1, y1 = ring_xy[i]
        x2, y2 = ring_xy[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        d = math.hypot(dx, dy)
        if d < 1e-9:
            continue
        # normale exterieure selon le sens de parcours
        nx, ny = -dy / d, dx / d
        out.append((x1 + nx * margin, y1 + ny * margin))
    # recentre pour eviter la derive sur les longs perimetres
    if out and n == len(out):
        cx_o = sum(p[0] for p in ring_xy) / n
        cy_o = sum(p[1] for p in ring_xy) / n
        cx_i = sum(p[0] for p in out) / n
        cy_i = sum(p[1] for p in out) / n
        out = [(x - (cx_i - cx_o), y - (cy_i - cy_o)) for x, y in out]
    return out


class F2CPlannerNode(Node):

    def __init__(self):
        super().__init__('f2c_planner_node')
        self.declare_parameter('default_work_width', 0.5)
        self.declare_parameter('default_headland_passes', 1)
        self.declare_parameter('default_obstacle_margin', 0.25)
        self.declare_parameter('default_min_turning_radius', 0.3)

        self.plan_pub = self.create_publisher(String, '/coverage/plan', 10)
        self.mission_pub = self.create_publisher(String, '/mission/path', 10)
        self.create_subscription(String, '/task/command', self._on_command, 10)

        if not F2C_AVAILABLE:
            self.get_logger().error(
                'fields2cover NON installe — le noeud attend mais echouera a la generation')
        self.get_logger().info(
            'f2c_planner_node v2 pret (Fields2Cover: %s, toutes options)'
            % ('OK' if F2C_AVAILABLE else 'ABSENT'))

    # ------------------------------------------------------------------ #
    # commandes
    # ------------------------------------------------------------------ #
    def _on_command(self, msg):
        try:
            cmd = json.loads(msg.data)
        except Exception as e:  # noqa: BLE001
            self.get_logger().error('Commande illisible : %s' % e)
            return
        if cmd.get('action') != 'generate_coverage':
            return
        self._generate(cmd)

    def _generate(self, cmd):
        zones = cmd.get('zones') or {}
        mow = zones.get('mow') or []
        excl = zones.get('exclusions') or []
        if len(mow) < 3:
            self.get_logger().error('Zone de tonte invalide (3 sommets minimum)')
            return
        mow_xy = [latlng_to_xy(lat, lng) for lat, lng in mow]
        obs_xy = [[latlng_to_xy(lat, lng) for lat, lng in ring]
                  for ring in excl if len(ring) >= 3]

        p = cmd.get('params') or {}
        work_width = float(p.get('workWidth',
                                 self.get_parameter('default_work_width').value))
        headland_passes = int(p.get('headlandPasses',
                                    self.get_parameter('default_headland_passes').value))
        mow_headland = bool(p.get('mowHeadland', True))
        obstacle_margin = float(p.get('obstacleMargin',
                                      self.get_parameter('default_obstacle_margin').value))
        ref_angle_deg = p.get('refAngleDeg')
        sg_obj = str(p.get('sgObj', 'field_cov'))
        rp_alg = str(p.get('rpAlg', 'boustrophedon'))
        pp_alg = str(p.get('ppAlg', 'reeds_shepp'))
        min_turn = float(p.get('minTurningRadius',
                               self.get_parameter('default_min_turning_radius').value))

        # --- geometrie F2C (bindings confirmes 2.1.0)
        Ring = _cls('LinearRing', 'Ring', 'F2CRing')

        def make_ring(pts):
            ring = Ring()
            for x, y in pts:
                ring.addPoint(float(x), float(y))
            ring.addPoint(*[float(v) for v in pts[0]])  # fermeture
            return ring

        Cell = _cls('Cell', 'F2CCell')
        cell = Cell()
        cell.addRing(make_ring(mow_xy))
        for ring_xy in obs_xy:
            inflated = _inflate_ring(ring_xy, obstacle_margin)  # S1
            cell.addRing(make_ring(inflated))  # trou interne -> S0
        cells = _cls('Cells')()
        cells.addGeometry(cell)

        # --- headland : aire reservee aux demi-tours (0 = passes plein champ)
        if headland_passes > 0:
            ConstHL = _cls('HG_Const_gen', 'HG_ConstHL', 'ConstHL')
            no_hl = None
            try:
                no_hl = ConstHL().generateHeadlandArea(cells, work_width, headland_passes)
            except Exception as e:  # noqa: BLE001
                self.get_logger().warning(
                    'generateHeadlandArea a echoue (%s) — champ entier' % e)
            try:
                hl_empty = no_hl is None or no_hl.isEmpty()
            except Exception:  # noqa: BLE001
                hl_empty = not bool(no_hl)
            if hl_empty:
                no_hl = cells
        else:
            no_hl = cells

        # --- swaths : objectif + angle (optimal ou fixe)
        bf = _cls('SG_BruteForce', 'BruteForce')()
        obj_map = {
            'field_cov': _cls('OBJ_FieldCoverage', 'FieldCoverage'),
            'n_swath': _cls('OBJ_NSwath', 'NSwath'),
            'n_swath_mod': _cls('OBJ_NSwathModified', 'NSwathModified'),
            'overlaps': _cls('OBJ_Overlaps', 'Overlaps'),
            'swath_length': _cls('OBJ_SwathLength', 'SwathLength'),
        }
        obj_cls = obj_map.get(sg_obj, obj_map['field_cov'])

        swaths = None
        if ref_angle_deg is not None:
            angle = math.radians(float(ref_angle_deg))
            for call in (lambda: bf.generateSwaths(angle, work_width, no_hl),
                         lambda: bf.generateBestSwaths(obj_cls(), work_width, no_hl),
                         lambda: bf.generateBestSwaths(work_width, no_hl)):
                try:
                    swaths = call()
                    break
                except Exception:  # noqa: BLE001
                    continue
        else:
            for call in (lambda: bf.generateBestSwaths(obj_cls(), work_width, no_hl),
                         lambda: bf.generateBestSwaths(work_width, no_hl),
                         lambda: bf.generateSwaths(0.0, work_width, no_hl)):
                try:
                    swaths = call()
                    break
                except Exception:  # noqa: BLE001
                    continue
        if swaths is None:
            self.get_logger().error('Aucune signature de generation ne convient')
            return
        swaths = self._flatten_swaths(swaths)
        n_swaths = swaths.size() if hasattr(swaths, 'size') else len(swaths)
        if n_swaths == 0:
            self.get_logger().error(
                'Aucun swath (champ trop etroit pour w=%.2f m ?)' % work_width)
            return

        # --- ordre des passes
        rp_map = {
            'boustrophedon': _cls('RP_Boustrophedon', 'RP_BoustrophedonOrder'),
            'snake': _cls('RP_Snake', 'RP_SnakeOrder'),
            'spiral': _cls('RP_Spiral', 'RP_SpiralOrder'),
        }
        order_cls = rp_map.get(rp_alg, rp_map['boustrophedon'])
        try:
            swaths = order_cls().genSortedSwaths(swaths)
        except Exception as e:  # noqa: BLE001
            self.get_logger().warning('Tri %s indisponible (%s) — ordre brut'
                                      % (rp_alg, e))

        # --- chemin avec virages (ppAlg)
        Robot = _cls('Robot', 'F2CRobot')
        robot = Robot()
        for setter, val in (('setCovWidth', work_width),
                            ('setWidth', work_width),
                            ('setMinTurningRadius', min_turn)):
            if hasattr(robot, setter):
                try:
                    getattr(robot, setter)(float(val))
                except Exception:  # noqa: BLE001
                    pass

        pp_map = {
            'dubins': _cls('PP_DubinsCurves', 'PP_Dubins', 'DubinsCurves'),
            'dubins_cc': _cls('PP_DubinsCurvesCC', 'PP_DubinsCC'),
            'reeds_shepp': _cls('PP_ReedsSheppCurves', 'PP_ReedsSheppSolver'),
            'reeds_shepp_hc': _cls('PP_ReedsSheppCurvesHC', 'PP_ReedsSheppHC'),
        }
        turn_cls = pp_map.get(pp_alg, pp_map['reeds_shepp'])
        PathPlanning = _cls('PP_PathPlanning', 'PathPlanning')
        pp = PathPlanning()

        waypoints, kinds = None, None
        first_err = None
        for call in (lambda: pp.planPath(robot, swaths, turn_cls()),
                     lambda: pp.planPath(robot, swaths),
                     lambda: pp.planBestPath(robot, swaths),
                     lambda: pp.searchBestPath(robot, swaths)):
            try:
                path = call()
                waypoints, kinds = self._extract_path(path)
                break
            except Exception as e:  # noqa: BLE001
                if first_err is None:
                    first_err = '%s: %s' % (type(e).__name__, e)
                continue
        if not waypoints:
            self.get_logger().warning(
                'Path planner indisponible (%s) — sortie swaths bruts' % first_err)
            waypoints, kinds = self._extract_swaths(swaths)

        # --- contour TONDU (anneau pur Python), prefixes au chemin
        if mow_headland and headland_passes > 0:
            hl_pts, hl_kinds = self._headland_ring_pts(
                mow_xy, work_width, headland_passes)
            if hl_pts:
                waypoints = hl_pts + list(waypoints)
                kinds = hl_kinds + list(kinds)
                self.get_logger().info(
                    'Headland : %d points de contour (%d anneau(x)) TONDUS prefixes'
                    % (len(hl_pts), headland_passes))
        elif headland_passes > 0:
            self.get_logger().info(
                'Headland : %d passe(s) reservee(s) aux demi-tours (non tondue(s))'
                % headland_passes)

        if len(waypoints) < 2:
            self.get_logger().error('Chemin vide apres extraction')
            return

        # --- publication (echo des options pour le frontend)
        options = {
            'workWidth': work_width,
            'headlandPasses': headland_passes,
            'mowHeadland': mow_headland,
            'obstacleMargin': obstacle_margin,
            'refAngleDeg': ref_angle_deg,
            'sgObj': sg_obj,
            'rpAlg': rp_alg,
            'ppAlg': pp_alg,
            'minTurningRadius': min_turn,
        }
        latlng = [xy_to_latlng(x, y) for x, y in waypoints]
        plan = {
            'tasks': [{
                'id': 'f2c-1',
                'name': 'Couverture F2C',
                'status': 'pending',
                'waypoints': latlng,
                'waypointKinds': kinds,
                'options': options,
                'stats': {
                    'swaths': n_swaths,
                    'waypoints': len(latlng),
                    'exclusions': len(obs_xy),
                },
            }],
        }
        self.plan_pub.publish(String(data=json.dumps(plan)))
        self.mission_pub.publish(String(data=json.dumps(plan)))
        self.get_logger().info(
            'Plan genere : %d waypoints, %d swaths [angle=%s, obj=%s, ordre=%s, virages=%s]'
            % (len(latlng), n_swaths,
               'auto' if ref_angle_deg is None else str(ref_angle_deg),
               sg_obj, rp_alg, pp_alg))

    # ------------------------------------------------------------------ #
    # extraction / helpers (bindings 2.1.0 confirmes)
    # ------------------------------------------------------------------ #
    def _flatten_swaths(self, swaths):
        """SwathsByCells -> Swaths. Sonde de type SWIG : push_back accepte
        le premier element = deja plat ; TypeError = groupes a aplatir."""
        SwathsCls = _cls('Swaths')
        n = swaths.size() if hasattr(swaths, 'size') else len(swaths)
        if n == 0:
            return swaths
        first = swaths.at(0) if hasattr(swaths, 'at') else swaths[0]
        probe = SwathsCls()
        try:
            probe.push_back(first)
            return swaths
        except TypeError:
            pass
        flat = SwathsCls()
        for i in range(n):
            group = swaths.at(i) if hasattr(swaths, 'at') else swaths[i]
            m = group.size() if hasattr(group, 'size') else len(group)
            for j in range(m):
                flat.push_back(group.at(j) if hasattr(group, 'at') else group[j])
        return flat

    def _swath_ends(self, s):
        for getter in (lambda: (s.startPoint(), s.endPoint()),
                       lambda: (s.getStartPoint(), s.getEndPoint()),
                       lambda: (s.start(), s.end())):
            try:
                a, b = getter()
                return a, b
            except Exception:  # noqa: BLE001
                continue
        return None, None

    def _extract_swaths(self, swaths):
        """Fallback : extremites des swaths."""
        pts, kinds = [], []
        n = swaths.size() if hasattr(swaths, 'size') else len(swaths)
        for i in range(n):
            s = swaths.at(i) if hasattr(swaths, 'at') else swaths[i]
            start, end = self._swath_ends(s)
            if start is not None:
                pts.append((float(start.getX()), float(start.getY())))
                kinds.append('sweep')
            if end is not None:
                pts.append((float(end.getX()), float(end.getY())))
                kinds.append('sweep')
        return pts, kinds

    def _extract_path(self, path):
        """F2CPath 2.1.0 : PathState{point, angle, dir, len, type, velocity},
        virages = PathSectionType_TURN."""
        TURN = getattr(f2c, 'PathSectionType_TURN', None)
        pts, kinds = [], []
        states = None
        for getter in (lambda: path.getStates(),
                       lambda: [path[i] for i in range(path.size())]):
            try:
                states = getter()
                break
            except Exception:  # noqa: BLE001
                continue
        if states is None:
            raise RuntimeError('Impossible de lire les etats du Path F2C')
        for ps in states:
            p = ps.point
            pts.append((float(p.getX()), float(p.getY())))
            is_turn = False
            try:
                is_turn = TURN is not None and ps.type == TURN
            except Exception:  # noqa: BLE001
                pass
            kinds.append('transition' if is_turn else 'sweep')
        return pts, kinds

    def _headland_ring_pts(self, mow_xy, work_width, passes, step=0.6):
        """Anneaux de contour TONDUS (100 % Python — generateHeadlandSwaths
        2.1.0 renvoie un tuple de Cells inexploitable, sonde terrain).

        Anneau k = offset interieur a (k + 0.5) largeurs : le 1er a w/2 du
        bord (bande [0, w] couverte), densifie au pas step.
        """
        pts, kinds = [], []
        for k in range(passes):
            offset = (k + 0.5) * work_width
            ring = _inflate_ring(mow_xy, -offset)
            if len(ring) < 3:
                break
            peri = ring + [ring[0]]
            for i in range(len(peri) - 1):
                (x1, y1), (x2, y2) = peri[i], peri[i + 1]
                seg = math.hypot(x2 - x1, y2 - y1)
                if seg < 1e-9:
                    continue
                n_sub = max(1, int(seg / step))
                for j in range(n_sub):
                    t = j / n_sub
                    pts.append((x1 + (x2 - x1) * t, y1 + (y2 - y1) * t))
                    kinds.append('sweep')
            if pts:
                pts.append(peri[0])
                kinds.append('sweep')
        return pts, kinds


def main():
    import rclpy
    rclpy.init()
    node = F2CPlannerNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
