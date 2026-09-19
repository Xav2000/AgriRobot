"""Constantes et géométrie pure (sans ROS)."""
import math
import os
import json
from datetime import datetime, timezone
import rclpy
from rclpy.node import Node
from std_msgs.msg import String
from geometry_msgs.msg import PoseStamped


# Origine simulée (Paris) — cohérente avec la conversion lat/lng du frontend
ORIGIN_LAT = 48.8566
ORIGIN_LNG = 2.3522
DEG_PER_METER = 0.00001

# Fichier d'état persisté (refonte R4)
STATE_FILE = os.path.join(
    os.path.expanduser('~'), '.agrirobot', 'state.json')

# Batterie : seuil de retour automatique et niveau de reprise
LOW_BATTERY = 20.0
RESUME_BATTERY = 90.0
# Drain (%/tick à 2 Hz) et charge (%/tick)
WORK_DRAIN = 0.25
TRANSIT_DRAIN = 0.1
CHARGE_RATE = 1.0

# Réserve d'énergie dynamique : consommation estimée pour rentrer à la
# station (évacuation zone + corridors), marge de sécurité incluse.
TRANSIT_DRAIN_PER_METER = 0.2   # %/m en transit (simulation)
SAFETY_MARGIN = 1.5
MIN_RESERVE = 10.0
MAX_RESERVE = 60.0

# Marge de sécurité autour des obstacles lors de l'évacuation : le
# chemin les longe mais jamais à ras (choix utilisateur).
OBSTACLE_CLEARANCE_M = 1.0

# Activités du robot (machine à états)
MOVING_ACTIVITIES = ('transit', 'work', 'to_station', 'resume',
                     'final_return')


def meters_to_latlng(x, y):
    """Convertit des mètres (x vers l'est, y vers le nord) en [lat, lng]."""
    return [ORIGIN_LAT + y * DEG_PER_METER, ORIGIN_LNG + x * DEG_PER_METER]


def latlng_to_meters(latlng):
    """Convertit un waypoint [lat, lng] du frontend en mètres (x, y)."""
    lat, lng = latlng[0], latlng[1]
    return ((lng - ORIGIN_LNG) / DEG_PER_METER, (lat - ORIGIN_LAT) / DEG_PER_METER)
