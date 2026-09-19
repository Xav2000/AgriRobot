import { Task } from '../hooks/useTasks';

/**
 * Etape 6.9 : planification recurrente des taches.
 * Regles :
 * - sans planification : tache due en permanence (historique) ;
 * - tache inachevee (interrompue en cours d'execution) : due en
 *   PRIORITE, quel que soit le jour/plage -- on continue la tonte
 *   la ou elle s'etait arretee ;
 * - sinon : jour de semaine autorise + heure dans la plage + (si
 *   intervalle defini) assez de jours ecoules depuis la derniere
 *   execution terminee.
 */
const DAY_LABELS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

const minutesOfDay = (d: Date): number => d.getHours() * 60 + d.getMinutes();

const parseHm = (hm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

/** Tache inachevee : a reprendre en priorite. */
export const isCarryOver = (t: Task): boolean =>
  t.status === 'running' || t.status === 'failed'
  || ((t.currentStep ?? 0) > 0 && t.status !== 'completed');

/** Vrai si la tache peut demarrer maintenant. */
export const isTaskDue = (t: Task, now: Date = new Date()): boolean => {
  if (!t.schedule) return true;
  if (isCarryOver(t)) return true;
  const s = t.schedule;
  if (s.daysOfWeek.length > 0 && !s.daysOfWeek.includes(now.getDay())) {
    return false;
  }
  if (s.windowStart && s.windowEnd) {
    const a = parseHm(s.windowStart);
    const b = parseHm(s.windowEnd);
    const cur = minutesOfDay(now);
    if (a !== null && b !== null && a <= b && (cur < a || cur > b)) {
      return false;
    }
  }
  const interval = s.intervalDays ?? 0;
  if (interval > 0 && t.lastExecutedAt) {
    const last = new Date(t.lastExecutedAt).getTime();
    if (!Number.isNaN(last)
      && now.getTime() - last < interval * 86400000) {
      return false;
    }
  }
  return true;
};

/** Libelle court pour le badge de la file (vide si non planifiee). */
export const scheduleBadge = (t: Task, now: Date = new Date()): string => {
  if (!t.schedule) return '';
  if (isCarryOver(t)) return 'reprise à faire';
  if (isTaskDue(t, now)) return 'due';
  const s = t.schedule;
  const days = [...s.daysOfWeek].sort((x, y) => x - y);
  if (days.length === 0) return 'planifiée';
  const today = now.getDay();
  const next = days.find(d => d >= today) ?? days[0];
  const delta = (next - today + 7) % 7;
  const when = delta === 0 ? 'aujourd’hui' : delta === 1 ? 'demain' : DAY_LABELS[next];
  let label = 'prochaine : ' + when;
  if (s.windowStart && s.windowEnd) {
    label += ' ' + s.windowStart + '–' + s.windowEnd;
  }
  if (s.intervalDays && t.lastExecutedAt) {
    const last = new Date(t.lastExecutedAt).getTime();
    if (!Number.isNaN(last)) {
      const ready = new Date(last + s.intervalDays * 86400000);
      label += ' (intervalle ' + s.intervalDays + ' j : prête le '
        + ready.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
        + ')';
    }
  }
  return label;
};
