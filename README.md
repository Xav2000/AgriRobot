# AgriRobot - Application de gestion pour robots agricoles

## Description
Application moderne pour la gestion de robots agricoles, inspiree d'OpenMower. Permet de gerer les champs, zones, lignes de travail et taches via une interface web reactive.

## Architecture
- Backend: ROS 2 Humble (Python)
- Frontend: React + TypeScript + Leaflet
- Communication: rosbridge_suite (WebSocket)

## Structure du projet
AgriRobot/
├── agrirobot_core/          # Package ROS 2 (logique metier)
│   ├── agrirobot_core/
│   │   ├── __init__.py
│   │   └── agrirobot_node.py
│   ├── package.xml
│   └── setup.py
├── agrirobot_web/           # Frontend React
│   └── agrirobot_frontend/
│       ├── public/
│       └── src/
│           ├── components/
│           ├── maps/
│           ├── tasks/
│           ├── robot/
│           ├── App.tsx
│           └── index.tsx
├── resources/               # Cartes, images, etc.
├── docs/                    # Documentation
└── README.md

## Prerequis
- Ubuntu 22.04 (WSL 2)
- ROS 2 Humble
- Node.js 18+
- Python 3.8+

## Installation
### Backend (ROS 2)
```bash
# Installer les dependances
sudo apt install -y ros-humble-rosbridge-suite

# Builder le workspace
cd ~/agrirobot_ws
colcon build
source install/setup.bash

# Lancer rosbridge
ros2 launch rosbridge_server rosbridge_websocket_launch.xml

# Lancer le noeud AgriRobot
ros2 run agrirobot_core agrirobot_node
```

### Frontend (React)
```bash
cd agrirobot_web/agrirobot_frontend
npm install
npm start
```

## Acces
- Frontend: http://localhost:3000
- rosbridge: ws://localhost:9090

## Licence
Apache License 2.0
