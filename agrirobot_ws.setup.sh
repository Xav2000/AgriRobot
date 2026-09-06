#!/bin/bash
# Script pour configurer le workspace AgriRobot

# Source ROS 2 Humble
source /opt/ros/humble/setup.bash

# Source le workspace local
source ~/agrirobot_ws/install/setup.bash

# Exporter les variables d'environnement
export ROS_DOMAIN_ID=0

# Lancer rosbridge en arrière-plan
ros2 launch rosbridge_server rosbridge_websocket_launch.xml &

# Attendre que rosbridge soit prêt
sleep 3

# Lancer le nœud AgriRobot
ros2 run agrirobot_core agrirobot_node
