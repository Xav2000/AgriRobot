# Lignes de guidage / chemin de travail pour une zone, publie sur /robot/work_path
std_msgs/Header header

string zone_id          # zone cible (tonte, planche maraichere...)
string path_type        # f2c | manual | transit
geometry_msgs/Pose[] waypoints   # points a suivre (via Nav2)
