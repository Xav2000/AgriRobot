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
"""

import json
import os
from datetime import datetime, timezone

AUTO_INTERVAL_S = 60.0
RTK_POLL_S = 1.0
CONFIG_FILE = os.path.expanduser('~/.agrirobot/automation.json')
DEFAULT_CONFIG = {'batteryMin': 80.0, 'batteryFull': 100.0}
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

    # ------------------------------------------------------------ config

    def _load_config(self):
        try:
            with open(CONFIG_FILE, encoding='utf-8') as f:
                data = json.load(f)
            for key in DEFAULT_CONFIG:
                if key in data:
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
        for key in ('batteryMin', 'batteryFull'):
            if key in cfg:
                try:
                    value = float(cfg[key])
                except (TypeError, ValueError):
                    continue
                self.robot_config[key] = max(0.0, min(100.0, value))
        self._save_config()
        self.get_logger().info(
            'Config robot : batterie min %.1f %% / pleine %.1f %%'
            % (self.robot_config['batteryMin'],
               self.robot_config['batteryFull']))

    def handle_set_auto_mode(self, command):
        self.auto_enabled = bool(command.get('enabled'))
        if self.auto_enabled:
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
