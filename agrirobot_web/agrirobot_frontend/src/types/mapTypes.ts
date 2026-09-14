// Point géométrique
export interface Point {
  lat: number;
  lng: number;
}

// Polygone (zone de travail)
export interface Polygon {
  id: string;
  name: string;
  points: Point[];
  color?: string;
}

// Ligne de travail
export interface Workline {
  id: string;
  points: Point[];
  direction: 'horizontal' | 'vertical' | number; // angle en degrés
}

// Trajet entre zones
export interface Path {
  id: string;
  points: Point[];
  fromZoneId: string;
  toZoneId: string;
}

// Carte complète
export interface MapData {
  zones: Polygon[];
  worklines: Workline[];
  paths: Path[];
}