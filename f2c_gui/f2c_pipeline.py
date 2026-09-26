"""Pipeline F2C canonique (fields2cover 2.1.0) - sans code artisanal.

Chaine validee sur le banc vierge (~/agrirobot_NAV2_F2C_ws, sept. 2026) :
  HG_Const_gen.generateHeadlands  -> SG_BruteForce.generateSwaths
  -> RP_RoutePlannerBase.genRoute -> PP_PathPlanning.planPath(PP_ReedsSheppCurves)

Toutes les fonctions sont defensives : les signatures SWIG varient, on
essaie plusieurs formes et on remonte un message d'erreur clair a l'UI.
"""
import math
import fields2cover as f2c


# ---------------------------------------------------------------- geometrie

def make_cells(coords):
    """coords: liste [[x, y], ...] en metres -> f2c.Cells"""
    ring = f2c.LinearRing()
    for x, y in coords:
        ring.addPoint(f2c.Point(float(x), float(y)))
    cell = f2c.Cell(ring)
    return f2c.Cells(cell)


def make_robot(width, radius):
    """Le constructeur de Robot varie selon les versions : on essaie plusieurs
    formes, puis on force le rayon de giration via le setter si present."""
    attempts = [
        (width, 0.5 * width, radius, 1.0, 1.0, 20.0),
        (width, 0.5 * width, radius, 1.0, 1.0),
        (width, 0.5 * width, radius),
        (width, 0.5 * width),
        (width,),
    ]
    last_err = None
    for args in attempts:
        try:
            robot = f2c.Robot(*args)
            try:
                robot.setMinTurningRadius(radius)
            except Exception:
                pass
            return robot
        except TypeError as e:
            last_err = e
    raise RuntimeError("Construction Robot impossible : %s" % last_err)


def _linestring_points(ls):
    """f2c.LineString -> [[x, y], ...] (API variable selon la version)."""
    n = None
    for getter in ("getNumPoints", "size", "length"):
        try:
            v = getattr(ls, getter)()
            if isinstance(v, int) and v > 0:
                n = v
                break
        except Exception:
            pass
    if n is None:
        raise RuntimeError("LineString illisible (pas de getNumPoints/size)")
    pts = []
    for i in range(n):
        p = ls.getPoint(i)
        pts.append([p.getX(), p.getY()])
    return pts


# ------------------------------------------------------------------ solvers

ROUTE_PLANNERS = ("base", "boustrophedon", "snake", "spiral")
PATH_SOLVERS = ("reeds_shepp", "reeds_shepp_hc", "dubins", "dubins_cc")


def _route_planner(name):
    return {
        "base": f2c.RP_RoutePlannerBase,
        "boustrophedon": f2c.RP_Boustrophedon,
        "snake": f2c.RP_Snake,
        "spiral": f2c.RP_Spiral,
    }.get(name, f2c.RP_RoutePlannerBase)


def _path_solver(name):
    return {
        "reeds_shepp": f2c.PP_ReedsSheppCurves,
        "reeds_shepp_hc": f2c.PP_ReedsSheppCurvesHC,
        "dubins": f2c.PP_DubinsCurves,
        "dubins_cc": f2c.PP_DubinsCurvesCC,
    }.get(name, f2c.PP_ReedsSheppCurves)


# ----------------------------------------------------------------- pipeline

def generate(coords, options):
    """Pipeline canonique complet. Retourne un dict exploitable par l'UI.

    options: workWidth, headlandPasses, angleDeg, routePlanner,
             pathSolver, minTurningRadius
    """
    width = float(options.get("workWidth", 0.5))
    passes = int(options.get("headlandPasses", 1))
    angle = math.radians(float(options.get("angleDeg", 90.0)))
    radius = float(options.get("minTurningRadius", 1.0))

    cells = make_cells(coords)
    robot = make_robot(width, radius)

    # Headlands canoniques (tutoriel 5) : mid = (n+0,5)*w, outer = (2n+1)*w
    # passes=0 -> plein champ, swaths generes directement sur la parcelle.
    if passes <= 0:
        mid_hl = None
        swaths_cells = cells
    else:
        mid_hl = f2c.HG_Const_gen().generateHeadlands(cells, (passes + 0.5) * width)
        swaths_cells = f2c.HG_Const_gen().generateHeadlands(cells, (2 * passes + 1) * width)

    swaths = f2c.SG_BruteForce().generateSwaths(angle, width, swaths_cells)

    rp = _route_planner(options.get("routePlanner", "base"))()
    route = rp.genRoute(mid_hl if mid_hl is not None else cells, swaths)

    solver = _path_solver(options.get("pathSolver", "reeds_shepp"))()
    path = f2c.PP_PathPlanning().planPath(robot, route, solver)

    # ---- serialisation pour l'UI
    result = {
        "options": {
            "workWidth": width,
            "headlandPasses": passes,
            "angleDeg": float(options.get("angleDeg", 90.0)),
            "routePlanner": options.get("routePlanner", "base"),
            "pathSolver": options.get("pathSolver", "reeds_shepp"),
            "minTurningRadius": radius,
        },
        "field": coords,
        "route": _linestring_points(route.asLineString()),
        "states": [],
        "stats": {},
    }

    # Etats du chemin (type SWATH / TURN / HL_SWATH...) - defensif
    try:
        states = path.getStates()
        n = None
        for getter in ("size", "length", "getNumPoints"):
            try:
                v = getattr(states, getter)()
                if isinstance(v, int):
                    n = v
                    break
            except Exception:
                pass
        if n is None:
            states = list(states)
            n = len(states)
        for i in range(n):
            st = states[i]
            p = st.point
            t = str(st.type)
            result["states"].append([p.getX(), p.getY(), t])
    except Exception as e:
        result["statesError"] = "etats illisibles : %s" % e

    # Statistiques - defensif
    try:
        result["stats"]["routeLength"] = route.getLength()
    except Exception:
        pass
    try:
        result["stats"]["pathLength"] = path.getLength()
    except Exception:
        pass
    result["stats"]["numStates"] = len(result["states"])
    return result
