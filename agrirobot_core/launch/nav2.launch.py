"""Etape 2 feat/nav2-f2c : banc d'essai Nav2 mapless (simulateur + Nav2 + RViz).

Test :
  ros2 launch agrirobot_core nav2.launch.py
  -> RViz : outil "2D Goal Pose" (bouton en haut), clic sur la carte
  -> le robot atteint le goal (planner REEDS_SHEPP rayon 0.3, DWB suit).

Pieges corriges ici :
  - params_file BIEN passe au navigation_launch.py de nav2_bringup
    (sinon Nav2 tourne avec ses parametres PAR DEFAUT et rien ne bouge)
  - use_composition: 'False' avec F MAJUSCULE (evalue en Python)
  - use_sim_time: 'false' (transmis, jamais evalue)
"""
import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.conditions import IfCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue


def generate_launch_description():
    pkg_share = get_package_share_directory('agrirobot_core')
    nav2_bringup_share = get_package_share_directory('nav2_bringup')

    use_rviz = LaunchConfiguration('use_rviz')
    start_x = LaunchConfiguration('start_x')
    start_y = LaunchConfiguration('start_y')
    start_yaw_deg = LaunchConfiguration('start_yaw_deg')
    params_file = PathJoinSubstitution([pkg_share, 'config', 'nav2_params.yaml'])
    rviz_config = PathJoinSubstitution([pkg_share, 'config', 'nav2.rviz'])

    return LaunchDescription([
        DeclareLaunchArgument('use_rviz', default_value='true'),
        DeclareLaunchArgument('start_x', default_value='0.0'),
        DeclareLaunchArgument('start_y', default_value='0.0'),
        DeclareLaunchArgument('start_yaw_deg', default_value='0.0'),

        # --- simulateur (etape 1, inchange) ---
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

        # --- Nav2 (navigation_launch.py de nav2_bringup) ---
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(
                os.path.join(nav2_bringup_share, 'launch', 'navigation_launch.py')),
            launch_arguments={
                # PIEGE : sans params_file, Nav2 prend ses valeurs PAR DEFAUT.
                'params_file': params_file,
                'use_sim_time': 'false',
                'autostart': 'true',
                # PIEGE : 'False' MAJUSCULE (PythonExpression evalue "not ...").
                'use_composition': 'False',
                'use_respawn': 'False',
                'container_name': 'nav2_container_rebuild',
            }.items(),
        ),

        # --- RViz avec config dediee ---
        Node(
            package='rviz2',
            executable='rviz2',
            name='rviz2',
            output='screen',
            condition=IfCondition(use_rviz),
            arguments=['-d', rviz_config],
        ),
    ])
