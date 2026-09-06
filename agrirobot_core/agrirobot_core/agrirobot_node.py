#!/usr/bin/env python3
"""
AgriRobot Node - Main ROS 2 node for agricultural robot management
"""

import rclpy
from rclpy.node import Node
from std_msgs.msg import String
from geometry_msgs.msg import PoseStamped
from nav_msgs.msg import Path
import json


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

        # Subscribers
        self.task_command_sub = self.create_subscription(
            String,
            '/task/command',
            self.task_command_callback,
            10)

        # Timer for simulated position (replace with real GPS later)
        self.timer = self.create_timer(1.0, self.publish_simulated_position)

        # Internal state
        self.tasks = []
        self.robot_status = "idle"

        self.get_logger().info("AgriRobot node is running!")

    def publish_simulated_position(self):
        """Publish simulated robot position (for testing)"""
        msg = PoseStamped()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.header.frame_id = "map"
        msg.pose.position.x = 0.0
        msg.pose.position.y = 0.0
        msg.pose.position.z = 0.0
        msg.pose.orientation.w = 1.0
        self.robot_position_pub.publish(msg)

        # Also publish status
        status_msg = String()
        status_msg.data = json.dumps({
            "status": self.robot_status,
            "battery": 100,
            "position": {"x": 0.0, "y": 0.0}
        })
        self.robot_status_pub.publish(status_msg)

    def task_command_callback(self, msg):
        """Handle task commands from frontend"""
        self.get_logger().info(f"Received task command: {msg.data}")
        
        try:
            command = json.loads(msg.data)
            action = command.get("action")
            
            if action == "add_task":
                task = command.get("task", {})
                self.tasks.append(task)
                self.publish_tasks_list()
                self.get_logger().info(f"Added task: {task.get('name')}")
                
            elif action == "start_task":
                task_id = command.get("task_id")
                self.robot_status = "working"
                self.get_logger().info(f"Started task: {task_id}")
                
            elif action == "stop_task":
                self.robot_status = "idle"
                self.get_logger().info("Stopped current task")
                
            elif action == "go_to_charge":
                self.robot_status = "going_to_charge"
                self.get_logger().info("Robot going to charging station")
                
            elif action == "leave_charge":
                self.robot_status = "leaving_charge"
                self.get_logger().info("Robot leaving charging station")
                
            elif action == "return_to_charge":
                self.robot_status = "returning_to_charge"
                self.get_logger().info("Robot returning to charging station")
                
        except Exception as e:
            self.get_logger().error(f"Error processing command: {e}")

    def publish_tasks_list(self):
        """Publish current tasks list"""
        msg = String()
        msg.data = json.dumps(self.tasks)
        self.tasks_list_pub.publish(msg)


def main(args=None):
    rclpy.init(args=args)
    node = AgriRobotNode()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
