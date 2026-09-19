/**
 * Persistance locale (refonte R1) : le frontend est la source de vérité
 * pour la DÉFINITION du travail (zones, chemins de liaison, station,
 * parcours validés, file de planification). Tout est sauvegardé
 * automatiquement dans localStorage (clés versionnées) et exportable /
 * importable sous la forme d'un document JSON unique.
 */

const PREFIX = 'agrirobot.v1.';

/** Charge une tranche persistée ; fallback si absente ou illisible. */
export function loadSlice<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch (e) {
    console.error('Lecture localStorage impossible (' + key + ') :', e);
    return fallback;
  }
}

/** Sauvegarde une tranche (échec non bloquant : quota, navigation privée…). */
export function saveSlice(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.error('Écriture localStorage impossible (' + key + ') :', e);
  }
}

/** Tranches persistées du projet. */
export interface ProjectSlices {
  zones?: unknown;
  corridors?: unknown;
  station?: unknown;
  worklines?: unknown;
  plan?: unknown;
}

/** Document d'export : tout le projet dans un seul fichier JSON. */
export interface ProjectDocument extends ProjectSlices {
  format: 'agrirobot-project';
  version: 1;
  exportedAt: string;
}

export function buildProjectDocument(slices: ProjectSlices): ProjectDocument {
  return {
    format: 'agrirobot-project',
    version: 1,
    exportedAt: new Date().toISOString(),
    ...slices,
  };
}

/** Analyse un document importé ; lève une Error si le format est invalide. */
export function parseProjectDocument(text: string): ProjectDocument {
  const doc = JSON.parse(text);
  if (typeof doc !== 'object' || doc === null || doc.format !== 'agrirobot-project') {
    throw new Error("ce fichier n'est pas une sauvegarde AgriRobot");
  }
  return doc as ProjectDocument;
}
