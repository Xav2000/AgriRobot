from setuptools import find_packages, setup

package_name = 'robot_bringup'

setup(
    name=package_name,
    version='0.1.0',
    packages=find_packages(exclude=['launch', 'config']),
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        ('share/' + package_name + '/launch', ['launch/bringup.launch.py']),
        ('share/' + package_name + '/config', ['config/robot.yaml']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='Xavier Rossignol',
    maintainer_email='xav@localhost',
    description='Nœud principal + lancement du robot agricole v2',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'robot_node = robot_bringup.robot_node:main',
        ],
    },
)
