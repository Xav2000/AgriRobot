import { Polygon, Workline, Point } from '../types/mapTypes';
import { distanceBetweenPoints, getPolygonCenter, getPolygonBounds, getPolygonMaxRadius } from './geometry';

/**
 * Clip une ligne avec un polygone (simplifié - à améliorer avec Turf.js)
 */
function clipLineWithPolygon(linePoints: Point[], polygon: Polygon): Point[] {
  return linePoints;
}

/**
 * Génère des lignes de travail parallèles dans un polygone
 */
export function generateParallelWorklines(
  polygon: Polygon,
  spacing: number = 1.0,
  angle: number = 0
): Workline[] {
  const worklines: Workline[] = [];
  const bounds = getPolygonBounds(polygon);
  const perpAngle = angle * Math.PI / 180 + Math.PI / 2;
  const spacingDeg = spacing / 111320;

  let currentLat = bounds.minLat;
  while (currentLat <= bounds.maxLat) {
    const linePoints: Point[] = [
      { lat: currentLat, lng: bounds.minLng },
      { lat: currentLat, lng: bounds.maxLng }
    ];

    const clippedLine = clipLineWithPolygon(linePoints, polygon);
    if (clippedLine.length >= 2) {
      worklines.push({
        id: `wl-${Date.now()}-${worklines.length}`,
        points: clippedLine,
        direction: angle
      });
    }

    currentLat += spacingDeg * Math.abs(Math.cos(perpAngle));
  }

  return worklines;
}

/**
 * Génère des lignes de travail en spirale dans un polygone
 */
export function generateSpiralWorklines(
  polygon: Polygon,
  startSpacing: number = 1.0
): Workline[] {
  const worklines: Workline[] = [];
  const center = getPolygonCenter(polygon);
  const maxRadius = getPolygonMaxRadius(polygon, center);

  let radius = 0;
  let angle = 0;
  const step = 0.1;
  const radiusStep = startSpacing / (2 * Math.PI);

  while (radius <= maxRadius) {
    const radiusDeg = radius / 111320;
    const point1 = {
      lat: center.lat + radiusDeg * Math.cos(angle),
      lng: center.lng + radiusDeg * Math.sin(angle) / Math.cos(center.lat * Math.PI / 180)
    };

    angle += step;
    radius += radiusStep * step;

    const point2 = {
      lat: center.lat + radiusDeg * Math.cos(angle),
      lng: center.lng + radiusDeg * Math.sin(angle) / Math.cos(center.lat * Math.PI / 180)
    };

    const clippedLine = clipLineWithPolygon([point1, point2], polygon);
    if (clippedLine.length >= 2) {
      worklines.push({
        id: `spiral-${Date.now()}-${worklines.length}`,
        points: clippedLine,
        direction: angle * 180 / Math.PI
      });
    }
  }

  return worklines;
}