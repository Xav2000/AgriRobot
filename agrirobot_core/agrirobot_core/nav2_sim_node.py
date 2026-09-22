#!/usr/bin/env python3
"""Simulateur differentiel minimal - AgriRobot feat/nav2-f2c, etape 1.

Robot virtuel sans carte ni Nav2 : souscrit /cmd_vel, integre le modele
differentiel (Euler) a 20 Hz, publie /odom et les TF odom->base_link +
map->odom (statique identite). Watchdog 0.5 s : cmd_vel muet => arret.

Test (launch actif) :
  ros2 topic pub -r 10 /cmd_vel geometry_msgs/msg/Twist \
    "{linear: {x: 0.3}, angular: {z: 0.2}}"
  -> le robot decrit un cercle dans RViz, /odom suit.
"""
import math

import rclpy
from geometry_msgs.msg import Twist, TransformStamped
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rclpy.qos import QoSDurabilityPolicy, QoSProfile, QoSReliabilityPolicy
from tf2_ros import StaticTransformBroadcaster, TransformBroadcaster
from tf_transformations import quaternion_from_euler


class SimNode(Node):
    def __init__(self):
        super().__init__('agrirobot_sim')
        # --- parametres ---
        self.declare_parameter('start_x', 0.0)
        self.declare_parameter('start_y', 0.0)
        self.declare_parameter('start_yaw_deg', 0.0)
        self.declare_parameter('rate', 20.0)
        self.declare_parameter('watchdog_s', 0.5)
        self.declare_parameter('frame_map', 'map')
        self.declare_parameter('frame_odom', 'odom')
        self.declare_parameter('frame_base', 'base_link')

        self.x = self.get_parameter('start_x').value
        self.y = self.get_parameter('start_y').value
        self.yaw = math.radians(self.get_parameter('start_yaw_deg').value)
        rate = float(self.get_parameter('rate').value)
        self.watchdog_s = float(self.get_parameter('watchdog_s').value)
        f_map = self.get_parameter('frame_map').value
        f_odom = self.get_parameter('frame_odom').value
        f_base = self.get_parameter('frame_base').value

        # --- entree / sorties ---
        # cmd_vel peut venir de Nav2 (BEST_EFFORT) : QoS compatible.
        cmd_qos = QoSProfile(depth=10,
                             reliability=QoSReliabilityPolicy.BEST_EFFORT,
                             durability=QoSDurabilityPolicy.VOLATILE)
        self.create_subscription(Twist, '/cmd_vel', self._on_cmd, cmd_qos)
        self.odom_pub = self.create_publisher(Odometry, '/odom', 10)
        self.tf_pub = TransformBroadcaster(self)

        # TF statique map -> odom (identite) : banc sans localisation.
        static_tf = TransformStamped()
        static_tf.header.frame_id = f_map
        static_tf.child_frame_id = f_odom
        self.static_pub = StaticTransformBroadcaster(self)
        self.static_pub.sendTransform(static_tf)
        self.f_odom = f_odom
        self.f_base = f_base

        # --- etat ---
        self.v = 0.0
        self.w = 0.0
        self.last_cmd_time = None
        self.last_tick = self.get_clock().now()

        self.timer = self.create_timer(1.0 / rate, self._tick)
        self.get_logger().info(
            f'Simulateur actif : depart ({self.x:.2f}, {self.yaw:.1f} deg), {rate:.0f} Hz')

    def _on_cmd(self, msg: Twist):
        self.v = msg.linear.x
        self.w = msg.angular.z
        self.last_cmd_time = self.get_clock().now()

    def _tick(self):
        now = self.get_clock().now()
        dt = (now - self.last_tick).nanoseconds / 1e9
        self.last_tick = now
        if dt <= 0.0 or dt > 1.0:
            return

        # watchdog : pas de commande recente -> robot arrete
        if (self.last_cmd_time is None
                or (now - self.last_cmd_time).nanoseconds / 1e9 > self.watchdog_s):
            self.v = 0.0
            self.w = 0.0

        # integration Euler du modele differentiel
        self.x += self.v * dt * math.cos(self.yaw)
        self.y += self.v * dt * math.sin(self.yaw)
        self.yaw += self.w * dt

        # /odom
        odom = Odometry()
        odom.header.stamp = now.to_msg()
        odom.header.frame_id = self.f_odom
        odom.child_frame_id = self.f_base
        odom.pose.pose.position.x = self.x
        odom.pose.pose.position.y = self.y
        qx, qy, qz, qw = quaternion_from_euler(0.0, 0.0, self.yaw)
        odom.pose.pose.orientation.x = qx
        odom.pose.pose.orientation.y = qy
        odom.pose.pose.orientation.z = qz
        odom.pose.pose.orientation.w = qw
        odom.twist.twist.linear.x = self.v
        odom.twist.twist.angular.z = self.w
        self.odom_pub.publish(odom)

        # TF odom -> base_link
        tf = TransformStamped()
        tf.header.stamp = now.to_msg()
        tf.header.frame_id = self.f_odom
        tf.child_frame_id = self.f_base
        tf.transform.translation.x = self.x
        tf.transform.translation.y = self.y
        tf.transform.rotation.x = qx
        tf.transform.rotation.y = qy
        tf.transform.rotation.z = qz
        tf.transform.rotation.w = qw
        self.tf_pub.sendTransform(tf)


def main(args=None):
    rclpy.init(args=args)
    node = SimNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()