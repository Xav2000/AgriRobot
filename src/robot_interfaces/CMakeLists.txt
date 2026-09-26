cmake_minimum_required(VERSION 3.8)
project(robot_interfaces)

if(NOT CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 17)
endif()

find_package(ament_cmake REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(rosidl_default_generators REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/RobotState.msg"
  "msg/DockingStation.msg"
  "msg/WorkPath.msg"
  DEPENDENCIES geometry_msgs
)

ament_package()
