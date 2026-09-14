import { Point, Polygon, Path } from '../types/mapTypes';
import { distanceBetweenPoints, getPolygonCenter } from './geometry';

/**
 * Trouve le chemin optimal entre deux zones
 */
export function findPathBetweenZones(
  fromZone: Polygon,
  toZone: Polygon,
  obstacles: Polygon[] = []
): Path {
  const start = getPolygonCenter(fromZone);
  const end = getPolygonCenter(toZone);

  const directPath = [start, end];
  if (!intersectsAnyObstacle(directPath, obstacles)) {
    return {
      id: `path-${Date.now()}`,
      points: directPath,
      fromZoneId: fromZone.id,
      toZoneId: toZone.id
    };
  }

  const waypoints = calculateWaypoints(start, end, obstacles);
  return {
    id: `path-${Date.now()}`,
    points: waypoints,
    fromZoneId: fromZone.id,
    toZoneId: toZone.id
  };
}

function intersectsAnyObstacle(path: Point[], obstacles: Polygon[]): boolean {
  for (const obstacle of obstacles) {
    if (lineIntersectsPolygon(path, obstacle)) {
      return true;
    }
  }
  return false;
}

function calculateWaypoints(start: Point, end: Point, obstacles: Polygon[]): Point[] {
  const waypoints: Point[] = [start];
  for (const obstacle of obstacles) {
    if (lineIntersectsPolygon([start, end], obstacle)) {
      const closestPoint = findClosestPointOnPolygon(start, obstacle);
      waypoints.push(closestPoint);
    }
  }
  waypoints.push(end);
  return waypoints;
}

function lineIntersectsPolygon(line: Point[], polygon: Polygon): boolean {
  for (const point of line) {
    if (isPointInPolygon(point, polygon)) {
      return true;
    }
  }
  return false;
}

function isPointInPolygon(point: Point, polygon: Polygon): boolean {
  let inside = false;
  const { lat, lng } = point;
  const points = polygon.points;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].lng, yi = points[i].lat;
    const xj = points[j].lng, yj = points[j].lat;
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function findClosestPointOnPolygon(point: Point, polygon: Polygon): Point {
  let closest = polygon.points[0];
  let minDist = distanceBetweenPoints(point, closest);
  for (const p of polygon.points) {
    const d = distanceBetweenPoints(point, p);
    if (d < minDist) {
      minDist = d;
      closest = p;
    }
  }
  return closest;
}