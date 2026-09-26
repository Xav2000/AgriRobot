# Etat de la station de recharge, publie sur /robot/docking_station
std_msgs/Header header

string station_id
geometry_msgs/Pose pose  # emplacement de la station
bool occupied           # un robot y est present
float32 output_power    # puissance de charge disponible (W), 0 = hors service
