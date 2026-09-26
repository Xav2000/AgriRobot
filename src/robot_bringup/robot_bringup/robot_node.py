"""Noeud principal du robot agricole v2 (simulation minimale).

Publie :
  /robot/state            (robot_interfaces/RobotState)
  /robot/docking_station  (robot_interfaces/DockingStation)

S'abonne :
  /robot/cmd              (std_msgs/String) - commandes simples

En attente des branches F2C / manuelle pour la generation des lignes.
"""
import rclpy
from rclpy.node import Node

from std_msgs.msg import String
from geometry_msgs.msg import Pose
from robot_interfaces.msg import RobotState, DockingStation


class RobotNode(Node):

    def __init__(self):
        super().__init__('robot_node')
        # Parametres (fichier config/robot.yaml)
        self.declare_parameter('robot_id', 'robot_1')
        self.declare_parameter('station.x', 0.0)
        self.declare_parameter('station.y', 0.0)
        self.declare_parameter('publish_hz', 2.0)

        self.robot_id = self.get_parameter('robot_id').value
        hz = self.get_parameter('publish_hz').value

        self.state_pub = self.create_publisher(RobotState, 'robot/state', 10)
        self.station_pub = self.create_publisher(DockingStation, 'robot/docking_station', 10)
        self.cmd_sub = self.create_subscription(String, 'robot/cmd', self.on_cmd, 10)

        self.battery = 100.0
        self.charging = False
        self.status = 'idle'
        self.timer = self.create_timer(1.0 / hz, self.publish)

        self.get_logger().info('robot_node demarre (%s)' % self.robot_id)

    def on_cmd(self, msg):
        cmd = msg.data.strip().lower()
        self.get_logger().info('Commande recue : %s' % cmd)
        if cmd == 'start':
            self.status = 'working'
        elif cmd == 'stop':
            self.status = 'idle'
        elif cmd == 'dock':
            self.status = 'docking'
        elif cmd == 'charge_on':
            self.charging = True
            self.status = 'charging'
        elif cmd == 'charge_off':
            self.charging = False
            self.status = 'idle'

    def publish(self):
        now = self.get_clock().now().to_msg()

        state = RobotState()
        state.header.stamp = now
        state.robot_id = self.robot_id
        state.status = self.status
        state.battery = self.battery
        state.charging = self.charging
        state.pose = Pose()
        self.state_pub.publish(state)

        station = DockingStation()
        station.header.stamp = now
        station.station_id = 'station_1'
        station.pose = Pose()
        station.pose.position.x = self.get_parameter('station.x').value
        station.pose.position.y = self.get_parameter('station.y').value
        station.occupied = self.charging
        station.output_power = 60.0 if self.charging else 120.0
        self.station_pub.publish(station)


def main(args=None):
    rclpy.init(args=args)
    node = RobotNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
