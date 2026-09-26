# Robot agricole v2 — base ROS 2

Fondation ROS 2 (reprise a zero) du robot agricole v2. Interface graphique
multi-robots (tondeuse, travail du sol sur planches maraicheres) pilotant
le robot via Nav2.

## Organisation (validee par Xavier, 26 sept. 2026)

    src/
    |- robot_interfaces/    Messages custom (RobotState, DockingStation, WorkPath)
    |- robot_bringup/      Noeud principal + launch (robot + Nav2 + rosbridge) + config
    |- robot_navigation/   Configuration Nav2 uniquement (launch + params)

Prefixe des topics : /robot/... (ex. /robot/state, /robot/docking_station).

## Branches
- feat/ros2-base          : cette fondation
- feat/f2c-lignes         : generation des lignes de guidage via Fields2Cover
- feat/generation-manuelle: generation manuelle des lignes

## Deploiement (WSL 2 + VS Code)

    # Workspace colcon
    mkdir -p ~/agrirobot_v2_ws/src
    cd ~/agrirobot_v2_ws/src
    git clone -b feat/ros2-base git@github.com:Xav2000/AgriRobot.git AgriRobot
    cd ~/agrirobot_v2_ws
    rosdep install --from-paths src --ignore-src -r -y
    colcon build --symlink-install
    source install/setup.bash

    # Lancer (robot + Nav2 + rosbridge sur ws://localhost:9090)
    ros2 launch robot_bringup bringup.launch.py

    # Verifier
    ros2 topic echo /robot/state
    ros2 topic echo /robot/docking_station
    ros2 topic pub /robot/cmd std_msgs/String "data: 'start'" -1

## Etat (squelette)
- robot_node : etat robot + station SIMULES, commandes start/stop/dock/charge_on/off.
- Nav2 : squelette standard (carte attendue, a adapter).
- rosbridge : pret pour la future interface graphique.
- Generation de lignes : branches feat/f2c-lignes / feat/generation-manuelle.
