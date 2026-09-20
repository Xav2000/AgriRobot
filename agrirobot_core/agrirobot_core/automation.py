#!/usr/bin/env python3
"""
Automatisation (etape 6.10b - mode automatique).

Boucle periodique (60 s) : si le mode auto est arme, le node verifie
les conditions de securite AVANT de lancer la mission :
  - meteo : pas de pluie (service ou override) ;
  - batterie : >= seuil bas (config robot) ;
  - station de recharge definie (reliability verifiee a la generation
    de la mission, cote frontend) ;
  - mission presente avec au moins une tache a faire.
La pause operateur (paused) est SACREE : le mode auto ne relance
jamais un robot mis en pause manuellement.
Journal des decisions (cap 50) expose dans /robot/status ('auto').
Config robot persistee dans ~/.agrirobot/automation.json.

RTK (etape 6.10c) : sous l'abri (le chargeur envoie du courant, soit
activity == 'charging') il n'y a PAS de fix — c'est normal, le depart
reste autorise. Hors abri, tout deplacement exige un fix : perte de
fix en mission => robot fige sur place + outils coupes (rtk_hold),
reprise automatique au retour du fix. Override dev : set_rtk_override.

Pluie (etape 6.10d) : pluie pendant une mission (manuelle ou auto)
=> retour a la station par la machinerie d interruption batterie
(progression conservee). Reprise AUTOMATIQUE quand il ne pleut plus
depuis rainDelayMin minutes (config robot). En mode auto, la reprise
verifie en plus que la tache est toujours dans sa plage horaire
(plannings fournis par le frontend dans set_auto_mode).
"""

import json
import os
import time
from datetime import datetime, timezone
from std_msgs.msg import String

AUTO_INTERVAL_S = 60.0
RTK_POLL_S = 1.0
CONFIG_FILE = os.path.expanduser('~/.agrirobot/automation.json')
DEFAULT_CONFIG = {'batteryMin': 80.0, 'batteryFull': 100.0,
                   'rainDelayMin': 20.0,
                   'keepRunningThroughTransitions': True}
JOURNAL_MAX = 50


class AutomationMixin:
    """Mix-in du node : mode automatique + config robot persistee."""

    def init_automation(self):
        self.auto_enabled = False
        self.auto_journal = []
        self.robot_config = dict(DEFAULT_CONFIG)
        self._load_config()
        self.auto_timer = self.create_timer(AUTO_INTERVAL_S, self.auto_tick)
        # RTK : override dev (None | 'fix' | 'nofix') + gel du robot.
        self.rtk_override = None
        self.rtk_hold = False
        self.rtk_timer = self.create_timer(RTK_POLL_S, self.rtk_tick)
        # Pluie (6.10d) : derniere detection humide + garde de reprise.
        self.rain_last_wet_at = None
        self.rain_wait_logged = False
        self.auto_schedules = {}
        self._install_rain_guard()

    # ------------------------------------------------------------ config

    def _load_config(self):
        try:
            with open(CONFIG_FILE, encoding='utf-8') as f:
                data = json.load(f)
            for key in DEFAULT_CONFIG:
                if key in data:
                    if key == 'keepRunningThroughTransitions':
                        self.robot_config[key] = bool(data[key])
                    else:
                        self.robot_config[key] = float(data[key])
        except (OSError, ValueError, TypeError):
            pass

    def _save_config(self):
        try:
            os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
            tmp = CONFIG_FILE + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(self.robot_config, f)
            os.replace(tmp, CONFIG_FILE)
        except OSError as e:
            self.get_logger().error(
                f'Impossible d ecrire {CONFIG_FILE} : {e}')

    # ------------------------------------------------------------ journal

    def auto_log(self, message):
        self.auto_journal.append({
            'at': datetime.now(timezone.utc).isoformat(),
            'message': message,
        })
        if len(self.auto_journal) > JOURNAL_MAX:
            self.auto_journal = self.auto_journal[-JOURNAL_MAX:]
        self.get_logger().info(f'[auto] {message}')

    def auto_snapshot(self):
        return {
            'enabled': self.auto_enabled,
            'journal': self.auto_journal[-10:],
        }

    # ------------------------------------------------------------- outil

    def tool_snapshot(self):
        """Etat de l'outil de travail (etape outils) : actif + type du
        segment courant. keepRunningThroughTransitions (config) : True
        = l'outil reste en route pendant les transitions (lame de
        tondeuse : on ne coupe pas le moteur au demi-tour) ; False =
        l'outil est releve sur les transitions (travail du sol). Types
        headland/sweep/obstacle = travail ; transition = transit
        interne a la zone."""
        keep = bool(self.robot_config.get('keepRunningThroughTransitions',
                                           True))
        kind = 'idle'
        active = False
        if (self.task_phase == 'work'
                and self.activity in ('work', 'transit')
                and not self.paused and not self.rtk_hold):
            task = (self.tasks[self.current_task_idx]
                    if 0 <= self.current_task_idx < len(self.tasks)
                    else None)
            kinds = (task.get('waypoint_kinds') or []) if task else []
            idx = max(0, self.current_wp_idx - 1)
            kind = kinds[idx] if idx < len(kinds) else 'sweep'
            active = True if keep else kind in ('headland', 'sweep',
                                                'obstacle')
        elif self.activity == 'transit':
            kind = 'transit'
        else:
            kind = self.activity or 'idle'
        return {'active': active, 'kind': kind}

    # ---------------------------------------------------------- publication

    def publish_status(self):
        msg = String()
        msg.data = json.dumps({
            'status': self.robot_status,
            'battery': round(self.battery, 1),
            'position': {'x': self.robot_pos[0], 'y': self.robot_pos[1]},
            'weather': self.weather.snapshot(),
            'config': self.robot_config,
            'auto': self.auto_snapshot(),
            'rtk': self.rtk_snapshot(),
            'tool': self.tool_snapshot(),
        })
        self.robot_status_pub.publish(msg)

    # ---------------------------------------------------------------- RTK

    def rtk_state(self):
        # Sous l'abri = le chargeur envoie du courant (en charge).
        under = self.activity == 'charging'
        if self.rtk_override is not None:
            return {'fix': self.rtk_override == 'fix',
                    'underShelter': under, 'source': 'override'}
        return {'fix': not under, 'underShelter': under,
                'source': 'simu'}

    def rtk_snapshot(self):
        state = self.rtk_state()
        state['hold'] = self.rtk_hold
        return state

    def rtk_tick(self):
        """1 s : gele le robot s'il bouge sans fix (outils coupes),
        reprise automatique des le retour du fix."""
        moving = self.activity in ('work', 'transit', 'resume',
                                   'to_station', 'final_return')
        state = self.rtk_state()
        if moving and not state['fix']:
            if not self.rtk_hold:
                self.rtk_hold = True
                self.auto_log('fix RTK perdu : robot fige, outils coupes')
        elif self.rtk_hold:
            self.rtk_hold = False
            self.auto_log('fix RTK retrouve : reprise du deplacement')
        self._rain_tick()

    # ---------------------------------------------------------------- pluie

    def _raining(self):
        weather = getattr(self, 'weather', None)
        if weather is None:
            return False
        return weather.snapshot().get('condition') == 'rain'

    def rain_wait_active(self):
        """Vrai s'il pleut ou si le delai post-pluie n'est pas ecoule."""
        if self._raining():
            return True
        if self.rain_last_wet_at is None:
            return False
        delay = self.robot_config.get('rainDelayMin', 20.0) * 60.0
        return (time.monotonic() - self.rain_last_wet_at) < delay

    def _rain_tick(self):
        """Pluie pendant la mission : retour a la station (progression
        conservee, meme machinerie que la coupure batterie). La pause
        operateur n est jamais outrepassee."""
        if self._raining():
            self.rain_last_wet_at = time.monotonic()
            if (not self.paused
                    and self.activity in ('work', 'transit', 'resume')):
                self.interrupt_for_charge()
                self.auto_log('pluie detectee : retour a la station')

    def _install_rain_guard(self):
        """Interdit la reprise (finish_charging) tant qu'il pleut ou
        que le delai post-pluie court, et verifie la plage horaire en
        mode auto. Patch pose apres construction du node."""
        node_finish = self.finish_charging

        def guarded_finish():
            if self.rain_wait_active():
                if not self.rain_wait_logged:
                    self.rain_wait_logged = True
                    self.auto_log('pluie : reprise differee a la station')
                return
            if not self._auto_window_ok():
                if not self.rain_wait_logged:
                    self.rain_wait_logged = True
                    self.auto_log('plage horaire terminee : pas de reprise')
                return
            self.rain_wait_logged = False
            node_finish()

        self.finish_charging = guarded_finish

    def _auto_window_ok(self):
        """Mode auto : la tache a reprendre est-elle encore dans sa
        plage horaire ? (plannings recus du frontend a l armement)"""
        if not self.auto_enabled or not self.auto_schedules:
            return True
        if not (0 <= self.current_task_idx < len(self.tasks)):
            return True
        tid = self.tasks[self.current_task_idx].get('id')
        sched = self.auto_schedules.get(tid)
        if not sched:
            return True
        now = datetime.now()
        days = sched.get('daysOfWeek') or []
        if days and now.weekday() not in [(d + 6) % 7 for d in days]:
            return False    # JS : 0 = dimanche ; Python : 0 = lundi
        ws = sched.get('windowStart') or ''
        we = sched.get('windowEnd') or ''
        if ws and we:
            cur = now.hour * 60 + now.minute

            def hm(txt):
                parts = txt.split(':')
                if (len(parts) == 2 and parts[0].isdigit()
                        and parts[1].isdigit()):
                    return int(parts[0]) * 60 + int(parts[1])
                return None

            a, b = hm(ws), hm(we)
            if (a is not None and b is not None and a <= b
                    and not a <= cur <= b):
                return False
        return True

    # ---------------------------------------------------------- commandes

    def handle_automation_command(self, command):
        """Routeur unique des commandes d'automatisation (economise
        des octets dans le node)."""
        action = command.get('action')
        if action == 'set_robot_config':
            self.handle_set_robot_config(command)
        elif action == 'set_auto_mode':
            self.handle_set_auto_mode(command)
        elif action == 'set_rtk_override':
            if command.get('toggle'):
                self.rtk_override = None if self.rtk_override else 'nofix'
            else:
                fix = command.get('fix')
                self.rtk_override = ('fix' if fix else
                                     'nofix' if fix is False else None)
            self.auto_log('override RTK : ' + str(self.rtk_override))

    def handle_set_robot_config(self, command):
        cfg = command.get('config') or {}
        for key in ('batteryMin', 'batteryFull', 'rainDelayMin'):
            if key in cfg:
                try:
                    value = float(cfg[key])
                except (TypeError, ValueError):
                    continue
                limit = 480.0 if key == 'rainDelayMin' else 100.0
                self.robot_config[key] = max(0.0, min(limit, value))
        if 'keepRunningThroughTransitions' in cfg:
            self.robot_config['keepRunningThroughTransitions'] = bool(
                cfg['keepRunningThroughTransitions'])
        self._save_config()
        self.get_logger().info(
            'Config robot : batterie min %.1f %% / pleine %.1f %%'
            % (self.robot_config['batteryMin'],
               self.robot_config['batteryFull']))

    def handle_set_auto_mode(self, command):
        self.auto_enabled = bool(command.get('enabled'))
        if self.auto_enabled:
            # Plannings des taches dues : verification de plage horaire
            # avant toute reprise post-pluie en mode auto.
            self.auto_schedules = {s.get('id'): s
                                   for s in command.get('schedules', [])
                                   if s.get('id')}
            self.auto_log('mode automatique arme')
            # Verifie tout de suite (pas besoin d attendre 60 s).
            self.auto_tick()
        else:
            self.auto_log('mode automatique desarme')

    # ------------------------------------------------------------- boucle

    def auto_tick(self):
        if not self.auto_enabled or self.paused:
            # Pause operateur : sacree, le mode auto n y touche pas.
            return
        if self.rtk_hold:
            return  # fige par perte de fix RTK
        if self.activity in ('work', 'transit', 'resume', 'to_station',
                             'charging', 'final_return'):
            return  # deja occupe
        try:
            reason = self.auto_block_reason()
        except Exception as e:  # la boucle ne doit jamais mourir
            self.get_logger().error(f'[auto] erreur : {e}')
            return
        if reason:
            self.auto_log(f'depart refuse : {reason}')
            return
        self.auto_start_mission()

    def auto_block_reason(self):
        """Raison du refus de depart (None = depart autorise)."""
        weather = getattr(self, 'weather', None)
        if weather is not None:
            snapshot = weather.snapshot()
            if snapshot.get('condition') == 'rain':
                return 'pluie detectee (meteo)'
        if self.rain_wait_active():
            return 'delai post-pluie en cours'
        if self.battery < self.robot_config['batteryMin']:
            return ('batterie %.1f %% < seuil %.1f %%'
                    % (self.battery, self.robot_config['batteryMin']))
        rtk = self.rtk_state()
        if not rtk['fix'] and not rtk['underShelter']:
            return 'pas de fix RTK'
        if not self.station_m:
            return 'station de recharge non definie'
        if not self.tasks:
            return 'aucune mission'
        if all(t.get('status') == 'completed' for t in self.tasks):
            return 'mission terminee'
        return None

    def auto_start_mission(self):
        # Meme logique que start_all_tasks : saute les taches terminees,
        # transit vers la premiere a faire.
        self.paused = False
        self.current_task_idx = next(
            (i for i, t in enumerate(self.tasks)
             if t.get('status') != 'completed'), 0)
        self.task_phase = 'transit'
        self.current_wp_idx = 0
        self.activity = 'transit'
        self.robot_status = 'working'
        self.auto_log('depart automatique de la mission')
