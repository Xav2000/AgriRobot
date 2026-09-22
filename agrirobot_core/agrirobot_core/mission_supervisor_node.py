#!/usr/bin/env python3
"""Etape 4 feat/nav2-f2c : superviseur de mission Nav2 (client d'action).

ROLE
    Consomme /coverage/plan (sortie du f2c_planner_node) et pilote le robot
    waypoint par waypoint via l'action navigate_to_pose de bt_navigator
    (retour d'etat fiable : SUCCEEDED / ABORTED / CANCELED — fini les goals
    publies a l'aveugle sur /goal_pose qui se perdaient pendant une
    preemption et claquaient le timeout de 90 s).

REGLES
    - sweep        : outil ON (tondeuse) ;
    - transition    : outil OFF ;
    - un waypoint est valide quand Nav2 repond SUCCEEDED ;
    - ABORTED -> nouvel essai ; 3 echecs consecutifs -> PAUSE
      (reprise via /task/command {"action": "resume"}) ;
    - watchdog : si aucune reponse en waypoint_timeout s -> echec aussi ;
    - pause/abort -> annulation propre du goal en cours (cancel_goal).

TOPICS / SERVICES
    Souscrit : /coverage/plan, /task/command, /odom
    Publie   : /tool/state (Bool), /mission/state (String JSON)
    Action   : navigate_to_pose (nav2_msgs/action/NavigateToPose)

TEST (nav2.launch.py actif) :
  ros2 run agrirobot_core mission_supervisor_node
  # generer un plan, puis :
  ros2 topic echo /mission/state
"""
import json
import math

import rclpy
from action_msgs.msg import GoalStatus
from geometry_msgs.msg import PoseStamped
from nav2_msgs.action import NavigateToPose
from nav_msgs.msg import Odometry
from rclpy.action import ActionClient
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


class MissionSupervisorNode(Node):
    def __init__(self):
        super().__init__('mission_supervisor')
        self.declare_parameter('goal_settle', 0.2)          # s : petite pause entre goals
        self.declare_parameter('waypoint_timeout', 90.0)     # s : watchdog si Nav2 ne repond pas
        self.declare_parameter('poll_rate', 5.0)
        self.declare_parameter('max_failures', 3)
        self.declare_parameter('min_wp_spacing', 0.5)       # m : filtre waypoints trop serres
        self.settle = float(self.get_parameter('goal_settle').value)
        self.timeout = float(self.get_parameter('waypoint_timeout').value)
        self.max_failures = int(self.get_parameter('max_failures').value)
        self.min_spacing = float(self.get_parameter('min_wp_spacing').value)

        self.plan_sub = self.create_subscription(String, '/coverage/plan', self._on_plan, 10)
        self.cmd_sub = self.create_subscription(String, '/task/command', self._on_command, 10)
        self.odom_sub = self.create_subscription(Odometry, '/odom', self._on_odom, 10)

        self.tool_pub = self.create_publisher(Bool, '/tool/state', 10)
        self.state_pub = self.create_publisher(String, '/mission/state', 10)

        # client d'action NavigateToPose (bt_navigator)
        self.nav_client = ActionClient(self, NavigateToPose, 'navigate_to_pose')

        # etat de mission
        self.status = IDLE
        self.task_id = None
        self.wps = []
        self.kinds = []
        self.idx = 0
        self.failures = 0
        self.goal_sent = False
        self.goal_done = True          # vrai quand le resultat a ete traite
        self.goal_ok = False
        self.goal_handle = None
        self.goal_time = None
        self.last_reach = None

        self.x = None
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
        wps = [to_xy(lat, lng) for lat, lng in wps_latlng]
        self.wps, self.kinds = self._filter_close(wps, kinds)
        self.idx = 0
        self.failures = 0
        self.goal_sent = False
        self.goal_done = True
        self.status = RUNNING
        self.get_logger().info('Mission recue (%s) : %d waypoints' % (self.task_id, len(self.wps)))

    def _on_command(self, msg):
        try:
            cmd = json.loads(msg.data)
        except json.JSONDecodeError:
            return
        action = cmd.get('action')
        if action == 'pause' and self.status == RUNNING:
            self.status = PAUSED
            self._cancel_goal()
            self._set_tool(False)
            self.get_logger().warn('PAUSE manuelle')
        elif action == 'resume' and self.status == PAUSED:
            self.failures = 0
            self.goal_sent = False
            self.goal_done = True
            self.status = RUNNING
            self.get_logger().info('REPRISE au waypoint %d' % self.idx)
        elif action == 'abort' and self.status in (RUNNING, PAUSED):
            self.status = ABORTED
            self._cancel_goal()
            self._set_tool(False)
            self.get_logger().warn('Mission ABORTEE')

    def _on_odom(self, msg: Odometry):
        self.x = msg.pose.pose.position.x
        self.y = msg.pose.pose.position.y

    # ------------------------------------------------------------------ #
    # boucle de pilotage
    def _tick(self):
        now = self.get_clock().now()
        if self.status == RUNNING and self.x is not None:
            if not self.goal_sent:
                self._maybe_send_goal(now)
            elif not self.goal_done:
                # watchdog : Nav2 muet trop longtemps ?
                elapsed = (now - self.goal_time).nanoseconds / 1e9 if self.goal_time else 0.0
                if elapsed > self.timeout:
                    self.get_logger().warn(
                        'Watchdog : pas de reponse Nav2 depuis %.0f s' % elapsed)
                    self._cancel_goal()
                    self._on_waypoint_result(False)
            self._publish_state()

    def _maybe_send_goal(self, now):
        if self.last_reach is not None:
            since = (now - self.last_reach).nanoseconds / 1e9
            if since < self.settle:
                return
        if not self.nav_client.wait_for_server(timeout_sec=0.1):
            self.get_logger().warn('bt_navigator indisponible — nouvelle tentative au prochain tick', throttle_duration_sec=5.0)
            return
        tx, ty = self.wps[self.idx]
        # orientation : direction vers le waypoint SUIVANT
        if self.idx + 1 < len(self.wps):
            nx, ny = self.wps[self.idx + 1]
            yaw = math.atan2(ny - ty, nx - tx)
        else:
            yaw = 0.0
        goal = NavigateToPose.Goal()
        goal.pose.header.stamp = now.to_msg()
        goal.pose.header.frame_id = 'map'
        goal.pose.pose.position.x = tx
        goal.pose.pose.position.y = ty
        goal.pose.pose.orientation.z = math.sin(yaw / 2.0)
        goal.pose.pose.orientation.w = math.cos(yaw / 2.0)

        self.goal_sent = True
        self.goal_done = False
        self.goal_ok = False
        self.goal_time = now
        self._set_tool(self.kinds[self.idx] == 'sweep')
        self.get_logger().info(
            'Goal %d/%d -> (%.2f, %.2f) [outil %s]' % (
                self.idx + 1, len(self.wps), tx, ty,
                'ON' if self.kinds[self.idx] == 'sweep' else 'OFF'))

        future = self.nav_client.send_goal_async(goal, feedback_callback=lambda fb: None)
        future.add_done_callback(self._goal_response_cb)

    def _goal_response_cb(self, future):
        try:
            handle = future.result()
        except Exception:  # noqa: BLE001
            handle = None
        if handle is None or not handle.accepted:
            self.get_logger().warn('Goal refuse par bt_navigator')
            self._on_waypoint_result(False)
            return
        self.goal_handle = handle
        result_future = handle.get_result_async()
        result_future.add_done_callback(self._result_cb)

    def _result_cb(self, future):
        try:
            result = future.result()
            ok = result is not None and result.status == GoalStatus.STATUS_SUCCEEDED
        except Exception:  # noqa: BLE001
            ok = False
        self._on_waypoint_result(ok)

    def _on_waypoint_result(self, ok: bool):
        if not self.goal_sent:
            return
        self.goal_sent = False
        self.goal_done = True
        self.goal_handle = None
        now = self.get_clock().now()
        if ok:
            self.get_logger().info(
                'Waypoint %d/%d atteint (%s)' % (self.idx + 1, len(self.wps), self.kinds[self.idx]))
            self.idx += 1
            self.failures = 0
            self.last_reach = now
            if self.idx >= len(self.wps):
                self.status = DONE
                self._set_tool(False)
                self.get_logger().info('MISSION TERMINEE : %d waypoints' % len(self.wps))
        else:
            self.failures += 1
            self.get_logger().warn(
                'Echec waypoint %d — %d/%d' % (self.idx + 1, self.failures, self.max_failures))
            if self.failures >= self.max_failures:
                self.status = PAUSED
                self._set_tool(False)
                self.get_logger().error(
                    '3 echecs consecutifs — PAUSE (resume via /task/command {"action":"resume"})')

    def _cancel_goal(self):
        if self.goal_handle is not None:
            try:
                self.goal_handle.cancel_goal_async()
            except Exception:  # noqa: BLE001
                pass
        self.goal_handle = None

    # ------------------------------------------------------------------ #
    # utilitaires
    def _filter_close(self, wps, kinds):
        """Filtre les waypoints trop rapproches (< min_spacing). Conserve le
        1er, le dernier, et le dernier de chaque segment sweep/transition."""
        if len(wps) < 3:
            return wps, kinds
        kept_x, kept_y, kept_k = [wps[0][0]], [wps[0][1]], [kinds[0]]
        ref = wps[0]
        for i in range(1, len(wps)):
            last_of_segment = (i + 1 >= len(wps)) or (kinds[i + 1] != kinds[i])
            d = math.hypot(wps[i][0] - ref[0], wps[i][1] - ref[1])
            if d >= self.min_spacing or last_of_segment:
                kept_x.append(wps[i][0])
                kept_y.append(wps[i][1])
                kept_k.append(kinds[i])
                ref = wps[i]
        n = len(kept_x)
        self.get_logger().info(
            'Filtrage waypoints : %d -> %d (espacement mini %.2f m)' % (len(wps), n, self.min_spacing))
        return list(zip(kept_x, kept_y)), kept_k

    def _set_tool(self, on: bool):
        self.tool_pub.publish(Bool(data=on))

    def _publish_state(self):
        state = {
            'task': self.task_id,
            'status': self.status,
            'currentWaypoint': self.idx,
            'totalWaypoints': len(self.wps),
            'completedWaypoints': self.idx,
            'toolActive': (self.idx < len(self.kinds) and self.kinds[self.idx] == 'sweep'),
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
