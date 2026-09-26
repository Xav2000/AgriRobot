import { useEffect, useRef, useState } from 'react';
import ROSLIB from 'roslib';
import { useRos } from './useRos';

/** Origine du repere metrique local (synchronisee backend f2c_planner_node). */
export const ORIGIN_LAT = 48.8566;
export const ORIGIN_LNG = 2.3522;
export const DEG_PER_METER = 1e-5;

export function xyToLatLng(x: number, y: number): [number, number] {
  return [ORIGIN_LAT + y * DEG_PER_METER, ORIGIN_LNG + x * DEG_PER_METER];
}

export interface RobotPose {
  /** metres, repere local (x = est, y = nord) */
  x: number;
  y: number;
  /** cap en radians (0 = est, sens antihoraire) */
  yaw: number;
}

export interface CoveragePlan {
  waypoints: [number, number][];   // [lat, lng]
  kinds: string[];                 // 'sweep' | 'transition'
}

export interface MissionState {
  task: string;
  status: 'idle' | 'pending' | 'running' | 'paused' | 'aborted' | 'done';
  currentWaypoint: number;
  totalWaypoints: number;
  completedWaypoints: number;
  toolActive?: boolean;
}

/** Lit le quaternion (roulement/pitch nuls en 2D) -> cap en radians. */
function yawFromQuaternion(z: number, w: number): number {
  return Math.atan2(2 * w * z, 1 - 2 * z * z);
}

/**
 * Hook du banc feat/nav2-f2c : pose robot (/odom), plan de couverture
 * (/coverage/plan) et progression de mission (/mission/state).
 */
export function useNav2Status(): {
  pose: RobotPose | null;
  plan: CoveragePlan | null;
  mission: MissionState | null;
  toolActive: boolean;
} {
  const { ros, connectionState } = useRos();
  const [pose, setPose] = useState<RobotPose | null>(null);
  const [plan, setPlan] = useState<CoveragePlan | null>(null);
  const [mission, setMission] = useState<MissionState | null>(null);
  const [toolActive, setToolActive] = useState(false);
  const planRef = useRef<CoveragePlan | null>(null);

  useEffect(() => {
    if (!ros || connectionState !== 'connected') return;

    // --- pose robot : /odom (nav_msgs/Odometry, metres) ---
    const odomTopic = new ROSLIB.Topic({
      ros,
      name: '/odom',
      messageType: 'nav_msgs/Odometry',
    });
    odomTopic.subscribe((msg: any) => {
      const p = msg.pose.pose.position;
      const q = msg.pose.pose.orientation;
      setPose({
        x: p.x,
        y: p.y,
        yaw: yawFromQuaternion(q.z, q.w),
      });
    });

    // --- plan de couverture : /coverage/plan (String JSON) ---
    const planTopic = new ROSLIB.Topic({
      ros,
      name: '/coverage/plan',
      messageType: 'std_msgs/String',
    });
    planTopic.subscribe((msg: any) => {
      try {
        const parsed = JSON.parse(msg.data);
        const task = (parsed.tasks || [])[0];
        if (!task || !Array.isArray(task.waypoints)) return;
        planRef.current = {
          waypoints: task.waypoints,
          kinds: task.waypointKinds || task.waypoints.map(() => 'sweep'),
        };
        setPlan(planRef.current);
      } catch (e) {
        console.error('Erreur de parsing du plan de couverture:', e);
      }
    });

    // --- progression : /mission/state (String JSON) ---
    const stateTopic = new ROSLIB.Topic({
      ros,
      name: '/mission/state',
      messageType: 'std_msgs/String',
    });
    stateTopic.subscribe((msg: any) => {
      try {
        setMission(JSON.parse(msg.data));
      } catch (e) {
        console.error('Erreur de parsing de l etat mission:', e);
      }
    });

    // --- outil (tondeuse) : /tool/state (Bool) ---
    const toolTopic = new ROSLIB.Topic({
      ros,
      name: '/tool/state',
      messageType: 'std_msgs/Bool',
    });
    toolTopic.subscribe((msg: any) => setToolActive(!!msg.data));

    return () => {
      odomTopic.unsubscribe();
      planTopic.unsubscribe();
      stateTopic.unsubscribe();
      toolTopic.unsubscribe();
    };
  }, [ros, connectionState]);

  return { pose, plan, mission, toolActive };
}
