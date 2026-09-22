import os
from glob import glob

from setuptools import find_packages, setup

package_name = 'agrirobot_core'

setup(
    name=package_name,
    version='0.1.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        (os.path.join('share', package_name, 'launch'), glob('launch/*.launch.py')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='Xavier Rossignol',
    maintainer_email='xav2000@free.fr',
    description='AgriRobot - backend ROS 2 (reconstruction feat/nav2-f2c)',
    license='MIT',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
            'nav2_sim_node = agrirobot_core.nav2_sim_node:main',
        ],
    },
)
