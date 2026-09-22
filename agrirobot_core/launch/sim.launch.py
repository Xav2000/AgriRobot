"""Etape 1 feat/nav2-f2c : simulateur seul + RViz.

AUCUN Nav2 ici. Objectif : valider le socle (build, launch, TF, /odom).
  ros2 launch agrirobot_core sim.launch.py
  ros2 topic pub -r 10 /cmd_vel geometry_msgs/msg/Twist \
    "{linear: {x: 0.3}, angular: {z: 0.2}}"
"""
from launch import LaunchDescription
from launch.substitutions import LaunchConfiguration
from launch.actions import DeclareLaunchArgument
from launch.conditions import IfCondition
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue


def generate_launch_description():
    use_rviz = LaunchConfiguration('use_rviz')
    start_x = LaunchConfiguration('start_x')
    start_y = LaunchConfiguration('start_y')
    start_yaw_deg = LaunchConfiguration('start_yaw_deg')

    return LaunchDescription([
        DeclareLaunchArgument('use_rviz', default_value='true'),
        DeclareLaunchArgument('start_x', default_value='0.0'),
        DeclareLaunchArgument('start_y', default_value='0.0'),
        DeclareLaunchArgument('start_yaw_deg', default_value='0.0'),

        # Piège documenté : une LaunchConfiguration nue arrive en chaîne,
        # il faut ParameterValue(type=float) pour un paramètre numérique.
        Node(
            package='agrirobot_core',
            executable='nav2_sim_node',
            output='screen',
            parameters=[{
                'start_x': ParameterValue(start_x, value_type=float),
                'start_y': ParameterValue(start_y, value_type=float),
                'start_yaw_deg': ParameterValue(start_yaw_deg, value_type=float),
            }],
        ),
        Node(
            package='rviz2',
            executable='rviz2',
            name='rviz2',
            output='screen',
            condition=IfCondition(use_rviz),
            arguments=['--dg', 'Grid;TF'],
        ),
    ])
