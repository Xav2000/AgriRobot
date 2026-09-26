"""Serveur de l'essai F2C GUI - Python stdlib uniquement (aucune dependance web).

Endpoints :
  GET  /              -> interface statique (dossier static/)
  POST /api/generate  -> genere les lignes de guidage (corps : JSON du formulaire)
  POST /api/validate  -> verrouille le dernier plan genere dans validated_plan.json
"""
import json
import os
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from f2c_pipeline import generate

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
VALIDATED_FILE = os.path.join(ROOT, "validated_plan.json")

_last_plan = None  # dernier plan genere (memoire du serveur)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=STATIC, **kw)

    def _send_json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        global _last_plan
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception as e:
            return self._send_json({"ok": False, "error": "payload invalide : %s" % e}, 400)

        if self.path == "/api/generate":
            coords = payload.get("field")
            if not coords or len(coords) < 3:
                return self._send_json(
                    {"ok": False, "error": "parcelle invalide : au moins 3 sommets"}, 400)
            try:
                plan = generate(coords, payload.get("options", {}))
                _last_plan = plan
                return self._send_json({"ok": True, "plan": plan})
            except Exception as e:
                traceback.print_exc()
                return self._send_json({"ok": False, "error": str(e)}, 500)

        if self.path == "/api/validate":
            if _last_plan is None:
                return self._send_json(
                    {"ok": False, "error": "rien a valider : generer d'abord un plan"}, 400)
            try:
                with open(VALIDATED_FILE, "w", encoding="utf-8") as f:
                    json.dump(_last_plan, f, indent=2, ensure_ascii=False)
                return self._send_json({"ok": True, "file": VALIDATED_FILE})
            except Exception as e:
                return self._send_json({"ok": False, "error": str(e)}, 500)

        return self._send_json({"ok": False, "error": "endpoint inconnu"}, 404)


if __name__ == "__main__":
    port = int(os.environ.get("F2C_GUI_PORT", "8080"))
    print("F2C GUI sur http://localhost:%d (Ctrl+C pour arreter)" % port)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
