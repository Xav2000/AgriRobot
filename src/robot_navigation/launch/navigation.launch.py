"""Lancement Nav2 (robot agricole v2).

  ros2 launch robot_navigation navigation.launch.py

Squelette minimal : bt_navigator + planner + controller + behaviors +
smoother + costmaps. Les parametres sont dans config/nav2_params.yaml.
"""
from launch import LaunchDescription
from launch_ros.actions import Node

import os
from ament_index_python.packages import get_package_share_directory


def generate_launch_description():
    nav_dir = get_package_share_directory('robot_navigation')
    params_file = os.path.join(nav_dir, 'config', 'nav2_params.yaml')

    use_sim_time = False

    common = {'use_sim_time': use_sim_time, 'autostart': True}

    map_server = Node(
        package='nav2_map_server', executable='map_server', name='map_server',
        parameters=[params_file, common],
    )

    amcl = Node(
        package='nav2_amcl', executable='amcl', name='amcl',
        parameters=[params_file, common],
    )

    planner = Node(
        package='nav2_planner', executable='planner_server', name='planner_server',
        parameters=[params_file, common],
    )

    controller = Node(
        package='nav2_controller', executable='controller_server', name='controller_server',
        parameters=[params_file, common],
    )

    behavior = Node(
        package='nav2_behaviors', executable='behavior_server', name='behavior_server',
        parameters=[params_file, common],
    )

    smoother = Node(
        package='nav2_smoother', executable='smoother_server', name='smoother_server',
        parameters=[params_file, common],
    )

    bt_navigator = Node(
        package='nav2_bt_navigator', executable='bt_navigator', name='bt_navigator',
        parameters=[params_file, common],
    )

    lifecycle = Node(
        package='nav2_lifecycle_manager', executable='lifecycle_manager',
        name='lifecycle_manager_navigation',
        parameters=[{'use_sim_time': use_sim_time},
                    {'autostart': True},
                    {'node_names': ['map_server', 'amcl', 'planner_server',
                                   'controller_server', 'behavior_server',
                                   'smoother_server', 'bt_navigator']}],
    )

    return LaunchDescription([
        map_server, amcl, planner, controller, behavior, smoother, bt_navigator, lifecycle,
    ])
