#!/usr/bin/env python3
"""
Weather monitoring for AgriRobot (etape 6.10a - mode automatique).

Sources, par priorite :
  1. override manuel (developpement) - commande set_weather_override
  2. service en ligne Open-Meteo (precipitation courante)
Plus tard : capteur de pluie du tunnel via Home Assistant / MQTT.

L'override n'est PAS persiste : un redemarrage du noeud revient au
service reel.
"""

import json
import os
import threading
import urllib.request

POLL_INTERVAL_S = 300.0
WEATHER_FILE = os.path.expanduser('~/.agrirobot/weather.json')


class WeatherMonitor:
    """Etat meteorologique thread-safe (condition + source)."""

    def __init__(self, interval_s=POLL_INTERVAL_S):
        self._lock = threading.Lock()
        self._override = None            # None | 'sun' | 'rain'
        self._service = 'sun'            # dernier etat du service
        self._service_ok = False         # service joignable ?
        self._lat = float(os.environ.get('AGRIROBOT_LAT', '48.85'))
        self._lng = float(os.environ.get('AGRIROBOT_LNG', '2.35'))
        self._interval = interval_s
        self._timer = None
        self._load_location()

    # ---- dev override (prioritaire, non persiste) ----
    def set_override(self, condition):
        """condition : 'sun' | 'rain' | None (retire le forcage)."""
        with self._lock:
            self._override = condition if condition in ('sun', 'rain') else None

    def toggle(self):
        """Bascule dev : si force -> retire ; sinon force l'inverse."""
        with self._lock:
            if self._override is not None:
                self._override = None
            else:
                self._override = 'rain' if self._service == 'sun' else 'sun'

    # ---- localisation (station de recharge, persistee) ----
    def set_location(self, lat, lng):
        """Position meteorologique de reference (la station)."""
        try:
            lat = float(lat)
            lng = float(lng)
        except (TypeError, ValueError):
            return
        with self._lock:
            self._lat = lat
            self._lng = lng
        try:
            os.makedirs(os.path.dirname(WEATHER_FILE), exist_ok=True)
            with open(WEATHER_FILE, 'w', encoding='utf-8') as f:
                json.dump({'lat': lat, 'lng': lng}, f)
        except OSError:
            pass

    def _load_location(self):
        try:
            with open(WEATHER_FILE, encoding='utf-8') as f:
                data = json.load(f)
            with self._lock:
                self._lat = float(data.get('lat', self._lat))
                self._lng = float(data.get('lng', self._lng))
        except (OSError, ValueError, TypeError):
            pass

    # ---- etat expose dans /robot/status ----
    def snapshot(self):
        with self._lock:
            if self._override is not None:
                return {'condition': self._override, 'source': 'override'}
            return {'condition': self._service,
                    'source': 'service' if self._service_ok else 'unknown'}

    # ---- polling Open-Meteo ----
    def start(self):
        thread = threading.Thread(target=self._run, daemon=True)
        thread.start()

    def stop(self):
        if self._timer is not None:
            self._timer.cancel()

    def _run(self):
        self._poll()
        while True:
            self._timer = threading.Timer(self._interval, self._poll)
            self._timer.daemon = True
            self._timer.start()
            self._timer.join()

    def _poll(self):
        try:
            url = ('https://api.open-meteo.com/v1/forecast'
                   '?latitude=%s&longitude=%s&current=precipitation'
                   % (self._lat, self._lng))
            with urllib.request.urlopen(url, timeout=10) as r:
                data = json.loads(r.read().decode('utf-8'))
            rain = (data.get('current', {}).get('precipitation', 0) or 0) > 0
            with self._lock:
                self._service = 'rain' if rain else 'sun'
                self._service_ok = True
        except Exception:
            with self._lock:
                self._service_ok = False


def main():
    m = WeatherMonitor()
    m.start()
    print(m.snapshot())


if __name__ == '__main__':
    main()
