#!/usr/bin/env python3
"""mission_supervisor_node v2 - depart sur commande EXPLICITE.

Changement v2 : le plan recu sur /coverage/plan est STOCKE et l etat
passe en 'pending' — le robot ne part QUE sur {"action": "start_mission"}
(alias "start_all_tasks"). Cela permet de GENERER DES APERCUS dans le
frontend sans naviguer (f2c_planner_node publie le plan, le superviseur
attend).

Pilotage waypoint par waypoint via l action navigate_to_pose de
bt_navigator (retour d etat fiable) :
    - sweep       : outil ON ; transition : outil OFF ;
    - SUCCEEDED   -> waypoint suivant ; ABORTED/CANCELED -> nouvel essai ;
    - 3 echecs consecutifs -> PAUSE (reprise {"action": "resume"}) ;
    - watchdog waypoint_timeout s sans reponse -> echec aussi ;
    - pause/abort -> annulation propre du goal en cours.

TOPICS / ACTION
    Souscrit : /coverage/plan, /task/command, /odom
    Publie   : /tool/state (Bool), /mission/state (String JSON)
    Action   : navigate_to_pose (nav2_msgs/action/NavigateToPose)

ETATS /mission/state : idle | pending | running | paused | aborted | done
    {task, status, currentWaypoint, totalWaypoints, completedWaypoints, toolActive}

Test :
    ros2 run agrirobot_core mission_supervisor_node
    -> generer un plan (frontend ou ros2 topic pub /task/command) : etat pending
    -> ros2 topic pub -1 /task/command std_msgs/String \
           "{data: '{\"action\": \"start_mission\"}'}"
"""
import json
import math

from action_msgs.msg import GoalStatus
from nav2_msgs.action import NavigateToPose
from nav_msgs.msg import Odometry
from rclpy.action import ActionClient
from rclpy.node import Node
from std_msgs.msg import Bool, String

from agrirobot_core.geo import ORIGIN_LAT, ORIGIN_LNG, DEG_PER_METER


def latlng_to_xy(lat, lng):
    return ((lng - ORIGIN_LNG) / DEG_PER_METER,
            (lat - ORIGIN_LAT) / DEG_PER_METER)


class MissionSupervisor(Node):

    def __init__(self):
        super().__init__('mission_supervisor')
        self.declare_parameter('min_wp_spacing', 0.5)
        self.declare_parameter('goal_settle', 0.2)
        self.declare_parameter('waypoint_timeout', 90.0)
        self.declare_parameter('poll_rate', 5.0)
        self.declare_parameter('max_failures', 3)
        self.min_spacing = float(self.get_parameter('min_wp_spacing').value)
        self.settle = float(self.get_parameter('goal_settle').value)
        self.wp_timeout = float(self.get_parameter('waypoint_timeout').value)
        self.max_failures = int(self.get_parameter('max_failures').value)

        # client d action NavigateToPose (bt_navigator)
        self.nav_client = ActionClient(self, NavigateToPose, 'navigate_to_pose')

        self.task_id = ''
        self.wps = []          # [(x, y)] metres
        self.kinds = []        # 'sweep' | 'transition'
        self.idx = 0
        self.status = 'idle'
        self.failures = 0
        self.goal_sent = False
        self.goal_time = 0.0
        self.goal_handle = None
        self.last_reach = 0.0
        self.x = 0.0
        self.y = 0.0

        self.tool_pub = self.create_publisher(Bool, '/tool/state', 10)
        self.state_pub = self.create_publisher(String, '/mission/state', 10)
        self.create_subscription(String, '/coverage/plan', self._on_plan, 10)
        self.create_subscription(String, '/task/command', self._on_command, 10)
        self.create_subscription(Odometry, '/odom', self._on_odom, 10)
        self.create_timer(1.0 / float(self.get_parameter('poll_rate').value), self._tick)

        self.get_logger().info(
            'MissionSupervisor v2 pret : plans stockes en pending, depart sur start_mission')

    # ------------------------------------------------------------------ #
    # entrees
    # ------------------------------------------------------------------ #
    def _on_odom(self, msg):
        self.x = msg.pose.pose.position.x
        self.y = msg.pose.pose.position.y

    def _on_plan(self, msg):
        try:
            plan = json.loads(msg.data)
            task = (plan.get('tasks') or [])[0]
            wps_ll = task.get('waypoints') or []
            kinds = task.get('waypointKinds') or ['sweep'] * len(wps_ll)
        except Exception as e:  # noqa: BLE001
            self.get_logger().error('Plan illisible : %s' % e)
            return
        if len(wps_ll) < 2:
            self.get_logger().error('Plan trop court')
            return
        raw = [latlng_to_xy(lat, lng) for lat, lng in wps_ll]
        self.wps, self.kinds = self._filter_close(raw, kinds)
        self.task_id = task.get('id', 'f2c-1')
        self.idx = 0
        self.failures = 0
        self.status = 'pending'
        self._set_tool(False)
        self.get_logger().info(
            'Plan recu (%s) : %d waypoints — EN ATTENTE (start_mission pour partir)'
            % (self.task_id, len(self.wps)))
        self._publish_state()

    def _on_command(self, msg):
        try:
            cmd = json.loads(msg.data)
        except Exception:  # noqa: BLE001
            return
        action = cmd.get('action')
        if action in ('start_mission', 'start_all_tasks'):
            if self.status in ('pending', 'aborted', 'done'):
                if not self.wps:
                    self.get_logger().warning('start_mission sans plan')
                    return
                self.status = 'running'
                self.idx = 0 if self.status == 'pending' else self.idx
                self.failures = 0
                self.last_reach = self.get_clock().now().nanoseconds * 1e-9
                self.get_logger().info('Mission DEMARREE : %d waypoints' % len(self.wps))
            elif self.status == 'paused':
                self.status = 'running'
                self.last_reach = self.get_clock().now().nanoseconds * 1e-9
                self.get_logger().info('Mission REPRISE au waypoint %d' % (self.idx + 1))
        elif action == 'pause' or action == 'pause_mission':
            if self.status == 'running':
                self._cancel_goal()
                self.status = 'paused'
                self.get_logger().info('Mission en PAUSE (waypoint %d)' % (self.idx + 1))
        elif action == 'resume':
            if self.status == 'paused':
                self.status = 'running'
                self.last_reach = self.get_clock().now().nanoseconds * 1e-9
                self.get_logger().info('Mission REPRISE au waypoint %d' % (self.idx + 1))
        elif action in ('abort', 'cancel_mission', 'emergency_stop'):
            if self.status in ('running', 'paused', 'pending'):
                self._cancel_goal()
                self.status = 'aborted'
                self._set_tool(False)
                self.get_logger().warn('Mission ANNULEE au waypoint %d' % (self.idx + 1))
        self._publish_state()

    # ------------------------------------------------------------------ #
    # boucle de pilotage
    # ------------------------------------------------------------------ #
    def _tick(self):
        now = self.get_clock().now().nanoseconds * 1e-9
        if self.status == 'running':
            if self.goal_sent:
                if now - self.goal_time > self.wp_timeout:
                    self.get_logger().warn('Watchdog : aucune reponse Nav2')
                    self._cancel_goal()
                    self.goal_sent = False
                    self._on_waypoint_result(False)
                return
            if now - self.last_reach < self.settle:
                return
            if self.idx >= len(self.wps):
                return
            self._send_goal(now)

    def _send_goal(self, now):
        tx, ty = self.wps[self.idx]
        # orientation vers le waypoint SUIVANT (ou le precedent au dernier)
        if self.idx + 1 < len(self.wps):
            ax, ay = self.wps[self.idx + 1]
        else:
            ax, ay = self.wps[self.idx - 1] if self.idx > 0 else (tx, ty)
        yaw = math.atan2(ay - ty, ax - tx)
        goal = NavigateToPose.Goal()
        goal.pose.header.frame_id = 'map'
        goal.pose.header.stamp = self.get_clock().now().to_msg()
        goal.pose.pose.position.x = float(tx)
        goal.pose.pose.position.y = float(ty)
        goal.pose.pose.orientation.z = math.sin(yaw / 2.0)
        goal.pose.pose.orientation.w = math.cos(yaw / 2.0)

        self.goal_sent = True
        self.goal_time = now
        self._set_tool(self.kinds[self.idx] == 'sweep')
        self.get_logger().info(
            'Goal %d/%d -> (%.2f, %.2f) [outil %s]' % (
                self.idx + 1, len(self.wps), tx, ty,
                'ON' if self.kinds[self.idx] == 'sweep' else 'OFF'))
        self._publish_state()

        future = self.nav_client.send_goal_async(
            goal, feedback_callback=lambda fb: None)
        future.add_done_callback(self._goal_response_cb)

    def _goal_response_cb(self, future):
        try:
            handle = future.result()
        except Exception:  # noqa: BLE001
            handle = None
        if handle is None or not handle.accepted:
            self.get_logger().warn('bt_navigator a refuse le goal')
            self.goal_sent = False
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
        self.goal_sent = False
        self.goal_handle = None
        self._on_waypoint_result(ok)

    def _on_waypoint_result(self, ok):
        if ok:
            self.last_reach = self.get_clock().now().nanoseconds * 1e-9
            self.failures = 0
            self.get_logger().info(
                'Waypoint %d/%d atteint (%s)' % (
                    self.idx + 1, len(self.wps), self.kinds[self.idx]))
            self.idx += 1
            if self.idx >= len(self.wps):
                self.status = 'done'
                self._set_tool(False)
                self.get_logger().info(
                    'MISSION TERMINEE : %d waypoints' % len(self.wps))
        else:
            self.failures += 1
            self.get_logger().warn(
                'Echec waypoint %d — %d/%d' % (
                    self.idx + 1, self.failures, self.max_failures))
            if self.failures >= self.max_failures:
                self.status = 'paused'
                self._set_tool(False)
                self.get_logger().error(
                    'PAUSE auto apres %d echecs (resume pour reprendre)'
                    % self.max_failures)
            else:
                self.last_reach = self.get_clock().now().nanoseconds * 1e-9
        self._publish_state()

    def _cancel_goal(self):
        self.goal_sent = False
        if self.goal_handle is not None:
            try:
                self.goal_handle.cancel_goal_async()
            except Exception:  # noqa: BLE001
                pass
        self.goal_handle = None

    # ------------------------------------------------------------------ #
    # utilitaires
    # ------------------------------------------------------------------ #
    def _set_tool(self, active):
        self.tool_pub.publish(Bool(data=active))

    def _publish_state(self):
        state = {
            'task': self.task_id,
            'status': self.status,
            'currentWaypoint': min(self.idx + 1, len(self.wps)) if self.wps else 0,
            'totalWaypoints': len(self.wps),
            'completedWaypoints': self.idx,
            'toolActive': (self.idx < len(self.kinds)
                           and self.status == 'running'
                           and self.kinds[self.idx] == 'sweep'),
        }
        self.state_pub.publish(String(data=json.dumps(state)))

    def _filter_close(self, raw, kinds):
        """Filtre les waypoints trop rapproches (< min_spacing). Conserve le
        1er, le dernier, et le dernier de chaque segment sweep/transition."""
        if len(raw) < 3:
            return raw, list(kinds)
        kept = [0]
        for i in range(1, len(raw)):
            last_seg = i + 1 >= len(raw) or kinds[i + 1] != kinds[i]
            d = math.hypot(raw[i][0] - raw[kept[-1]][0],
                          raw[i][1] - raw[kept[-1]][1])
            if d >= self.min_spacing or last_seg:
                kept.append(i)
        if kept[-1] != len(raw) - 1:
            kept.append(len(raw) - 1)
        return ([raw[i] for i in kept], [kinds[i] for i in kept])


def main():
    import rclpy
    rclpy.init()
    node = MissionSupervisor()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
