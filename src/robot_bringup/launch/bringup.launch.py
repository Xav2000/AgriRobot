"""Lancement de base du robot agricole v2.

  ros2 launch robot_bringup bringup.launch.py

Demarre : robot_node + navigation Nav2 + rosbridge (WebSocket :9090).
"""
from launch import LaunchDescription
from launch.actions import IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescription
from launch_ros.actions import Node

import os
from ament_index_python.packages import get_package_share_directory


def generate_launch_description():
    bringup_dir = get_package_share_directory('robot_bringup')
    robot_yaml = os.path.join(bringup_dir, 'config', 'robot.yaml')

    robot_node = Node(
        package='robot_bringup',
        executable='robot_node',
        name='robot_node',
        parameters=[robot_yaml],
        output='screen',
    )

    # Navigation Nav2 (package robot_navigation)
    nav_launch = IncludeLaunchDescription(
        PythonLaunchDescription(
            os.path.join(
                get_package_share_directory('robot_navigation'),
                'launch', 'navigation.launch.py',
            )
        )
    )

    # rosbridge : pont WebSocket pour la future interface graphique
    rosbridge = Node(
        package='rosbridge_server',
        executable='rosbridge_websocket',
        name='rosbridge_websocket',
        output='screen',
    )

    return LaunchDescription([robot_node, nav_launch, rosbridge])
