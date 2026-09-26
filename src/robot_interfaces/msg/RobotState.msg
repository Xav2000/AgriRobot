# Etat global du robot, publie sur /robot/state
std_msgs/Header header

string robot_id          # identifiant du robot (multi-robots)
string status           # idle | working | docking | charging | error
float32 battery         # niveau de batterie en pourcentage [0..100]
bool charging           # true si en charge sur la station
geometry_msgs/Pose pose  # pose courante du robot (odom ou map)
