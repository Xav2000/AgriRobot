import { Point, Polygon } from '../types/mapTypes';

/**
 * Calcule la distance entre deux points (en mètres)
 */
export function distanceBetweenPoints(a: Point, b: Point): number {
  const R = 6371000; // Rayon de la Terre en mètres
  const φ1 = a.lat * Math.PI / 180;
  const φ2 = b.lat * Math.PI / 180;
  const Δφ = (b.lat - a.lat) * Math.PI / 180;
  const Δλ = (b.lng - a.lng) * Math.PI / 180;

  const x = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));

  return R * c;
}

/**
 * Calcule le centre d'un polygone
 */
export function getPolygonCenter(polygon: Polygon): Point {
  let lat = 0, lng = 0;
  polygon.points.forEach(p => {
    lat += p.lat;
    lng += p.lng;
  });
  return {
    lat: lat / polygon.points.length,
    lng: lng / polygon.points.length
  };
}

/**
 * Calcule l'angle principal d'un polygone
 */
export function getPolygonMainAngle(polygon: Polygon): number {
  const p1 = polygon.points[0];
  const p2 = polygon.points[polygon.points.length - 1];
  return Math.atan2(p2.lng - p1.lng, p2.lat - p1.lat) * 180 / Math.PI;
}

/**
 * Calcule les bounds d'un polygone
 */
export function getPolygonBounds(polygon: Polygon) {
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;

  polygon.points.forEach(p => {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  });

  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Calcule le rayon maximum d'un polygone par rapport à son centre
 */
export function getPolygonMaxRadius(polygon: Polygon, center: Point): number {
  let maxRadius = 0;
  polygon.points.forEach(p => {
    const d = distanceBetweenPoints(center, p);
    maxRadius = Math.max(maxRadius, d);
  });
  return maxRadius;
}