#!/usr/bin/env python3
"""Etape 4 feat/nav2-f2c : superviseur de mission Nav2.

ROLE
    Consomme /coverage/plan (sortie du f2c_planner_node) et pilote le robot
    waypoint par waypoint via /goal_pose (le meme canal que le 2D Goal Pose de
    RViz, deja valide a l'etape 2). Suit l'avancement via /odom, gere l'etat
    de l'outil selon waypointKinds, et publie l'avancement pour le frontend.

REGLES
    - sweep        : outil ON (tondeuse), deplacement a vitesse de travail ;
    - transition    : outil OFF, deplacement libre ;
    - un waypoint est ATTEINT quand le robot est a moins de goal_tolerance m ;
    - timeout par waypoint (parametre) -> echec ; 3 echecs consecutifs -> PAUSE
      (plus aucun goal envoye jusqu'a une reprise manuelle /task/command
      {"action": "resume"} ) ;
    - nav_goal_yaw : oriente le goal vers le waypoint SUIVANT (direction de
      travail), ce qui evite les rotations inutiles de Nav2.

TOPICS
    Souscrit : /coverage/plan (String JSON), /odom (nav_msgs/Odometry),
               /task/command (String JSON, actions pause/resume/abort)
    Publie   : /goal_pose (geometry_msgs/PoseStamped),
               /tool/state (std_msgs/Bool : True = tondeuse ON),
               /mission/state (String JSON : progression frontend)

TEST (nav2.launch.py actif) :
  ros2 run agrirobot_core mission_supervisor_node
  # puis generer un plan (f2c_planner_node actif) :
  ros2 topic pub --once /task/command std_msgs/String "{data: '{\"action\": \"generate_coverage\", ...}'}"
  # le robot tond le carre tout seul dans RViz ; suivre :
  ros2 topic echo /mission/state
"""
import json
import math

import rclpy
from geometry_msgs.msg import PoseStamped
from nav_msgs.msg import Odometry
from rclpy.node import Node
from std_msgs.msg import Bool, String

ORIGIN_LAT = 48.8566
ORIGIN_LNG = 2.3522
DEG_PER_METER = 1e-5

IDLE = 'idle'
RUNNING = 'running'
PAUSED = 'paused'
ABORTED = 'aborted'
DONE = 'done'


def to_xy(lat, lng):
    return ((lng - ORIGIN_LNG) / DEG_PER_METER, (lat - ORIGIN_LAT) / DEG_PER_METER)


def yaw_from(dx, dy):
    return math.atan2(dy, dx)


def quat_from_yaw(yaw):
    return (0.0, 0.0, math.sin(yaw / 2.0), math.cos(yaw / 2.0))


class MissionSupervisorNode(Node):
    def __init__(self):
        super().__init__('mission_supervisor')
        self.declare_parameter('goal_tolerance', 0.15)      # m : waypoint atteint
        self.declare_parameter('waypoint_timeout', 90.0)     # s : echec si depasse
        self.declare_parameter('poll_rate', 5.0)            # Hz : suivi de progression
        self.declare_parameter('max_failures', 3)           # echecs consecutifs -> pause
        self.goal_tol = float(self.get_parameter('goal_tolerance').value)
        self.timeout = float(self.get_parameter('waypoint_timeout').value)
        self.max_failures = int(self.get_parameter('max_failures').value)

        self.plan_sub = self.create_subscription(String, '/coverage/plan', self._on_plan, 10)
        self.cmd_sub = self.create_subscription(String, '/task/command', self._on_command, 10)
        self.odom_sub = self.create_subscription(Odometry, '/odom', self._on_odom, 10)

        self.goal_pub = self.create_publisher(PoseStamped, '/goal_pose', 10)
        self.tool_pub = self.create_publisher(Bool, '/tool/state', 10)
        self.state_pub = self.create_publisher(String, '/mission/state', 10)

        # etat de mission
        self.status = IDLE
        self.task_id = None
        self.wps = []            # [(x, y)] metres
        self.kinds = []          # ['sweep' | 'transition']
        self.idx = 0             # waypoint courant
        self.failures = 0        # echecs consecutifs
        self.goal_sent = False
        self.goal_time = None

        self.x = None            # pose odom du robot (metres)
        self.y = None
        self.timer = self.create_timer(1.0 / float(self.get_parameter('poll_rate').value), self._tick)
        self.get_logger().info('MissionSupervisor pret : attends un plan sur /coverage/plan')

    # ------------------------------------------------------------------ #
    # entrees
    def _on_plan(self, msg):
        try:
            plan = json.loads(msg.data)
            task = (plan.get('tasks') or [None])[0]
            wps_latlng = task['waypoints']
            kinds = task.get('waypointKinds') or ['sweep'] * len(wps_latlng)
        except Exception as e:  # noqa: BLE001
            self.get_logger().error('Plan illisible : %s' % e)
            return
        if len(wps_latlng) < 2:
            self.get_logger().error('Plan trop court')
            return
        self.task_id = task.get('id', 'task')
        self.wps = [to_xy(lat, lng) for lat, lng in wps_latlng]
        self.kinds = kinds
        self.idx = 0
        self.failures = 0
        self.goal_sent = False
        self.status = RUNNING
        self.get_logger().info(
            'Mission recue (%s) : %d waypoints' % (self.task_id, len(self.wps)))

    def _on_command(self, msg):
        try:
            cmd = json.loads(msg.data)
        except json.JSONDecodeError:
            return
        action = cmd.get('action')
        if action == 'pause' and self.status == RUNNING:
            self.status = PAUSED
            self._set_tool(False)
            self.get_logger().warn('PAUSE manuelle')
        elif action == 'resume' and self.status == PAUSED:
            self.failures = 0
            self.goal_sent = False
            self.status = RUNNING
            self.get_logger().info('REPRISE au waypoint %d' % self.idx)
        elif action == 'abort' and self.status in (RUNNING, PAUSED):
            self.status = ABORTED
            self._set_tool(False)
            self.get_logger().warn('Mission ABORTEE')

    def _on_odom(self, msg: Odometry):
        self.x = msg.pose.pose.position.x
        self.y = msg.pose.pose.position.y

    # ------------------------------------------------------------------ #
    # boucle de pilotage
    def _tick(self):
        if self.status != RUNNING or self.x is None:
            return
        if not self.goal_sent:
            self._send_goal()
            return
        # distance au waypoint courant
        tx, ty = self.wps[self.idx]
        dist = math.hypot(self.x - tx, self.y - ty)
        now = self.get_clock().now()
        elapsed = (now - self.goal_time).nanoseconds / 1e9 if self.goal_time else 0.0
        if dist <= self.goal_tol:
            self.get_logger().info(
                'Waypoint %d/%d atteint (%s)' % (self.idx + 1, len(self.wps), self.kinds[self.idx]))
            self.idx += 1
            self.failures = 0
            self.goal_sent = False
            if self.idx >= len(self.wps):
                self.status = DONE
                self._set_tool(False)
                self.get_logger().info('MISSION TERMINEE : %d waypoints' % len(self.wps))
        elif elapsed > self.timeout:
            self.failures += 1
            self.get_logger().warn(
                'Echec waypoint %d (timeout %.0f s) — %d/%d' % (self.idx + 1, elapsed, self.failures, self.max_failures))
            self.goal_sent = False  # on retente depuis la pose courante
            if self.failures >= self.max_failures:
                self.status = PAUSED
                self._set_tool(False)
                self.get_logger().error(
                    '3 echecs consecutifs — PAUSE (resume via /task/command {"action":"resume"})')
        self._publish_state()

    def _send_goal(self):
        tx, ty = self.wps[self.idx]
        # orientation : direction vers le waypoint SUIVANT (dernier = garder cap)
        if self.idx + 1 < len(self.wps):
            nx, ny = self.wps[self.idx + 1]
            yaw = yaw_from(nx - tx, ny - ty)
        else:
            yaw = 0.0
        qz, qw = math.sin(yaw / 2.0), math.cos(yaw / 2.0)
        goal = PoseStamped()
        goal.header.stamp = self.get_clock().now().to_msg()
        goal.header.frame_id = 'map'
        goal.pose.position.x = tx
        goal.pose.position.y = ty
        goal.pose.orientation.z = qz
        goal.pose.orientation.w = qw
        self.goal_pub.publish(goal)
        self.goal_time = self.get_clock().now()
        self.goal_sent = True
        self._set_tool(self.kinds[self.idx] == 'sweep')
        self.get_logger().info(
            'Goal %d/%d -> (%.2f, %.2f) [outil %s]' % (
                self.idx + 1, len(self.wps), tx, ty,
                'ON' if self.kinds[self.idx] == 'sweep' else 'OFF'))

    def _set_tool(self, on: bool):
        self.tool_pub.publish(Bool(data=on))

    def _publish_state(self):
        state = {
            'task': self.task_id,
            'status': self.status,
            'currentWaypoint': self.idx,
            'totalWaypoints': len(self.wps),
            'completedWaypoints': self.idx,
            'toolActive': bool(self.kinds[self.idx]) if self.idx < len(self.kinds) else False,
        }
        self.state_pub.publish(String(data=json.dumps(state)))


def main(args=None):
    rclpy.init(args=args)
    node = MissionSupervisorNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
