# Essai F2C GUI — génération et validation graphique de lignes de guidage

Nouvel essai autonome : une interface web minimaliste qui pilote le **pipeline
canonique fields2cover 2.1.0** (validé sur le banc vierge, sept. 2026) pour
générer des lignes de guidage, les prévisualiser, puis les **valider
graphiquement** (verrouillage dans un fichier JSON hors navigateur).

**Volontairement séparé** du frontend React et de ROS : aucun code artisanal,
aucune dépendance web — Python stdlib + fields2cover uniquement.

## Contenu

```
f2c_gui/
├── f2c_pipeline.py     # Pipeline canonique F2C (headlands -> swaths -> route -> path)
├── server.py           # Serveur HTTP stdlib + API /api/generate et /api/validate
├── static/             # Interface (HTML/CSS/JS, dessin de parcelle au clic)
└── validated_plan.json # Créé à la validation (persistance hors navigateur)
```

## Déploiement WSL + VS Code

1. **WSL 2 (Ubuntu 22.04)** — récupérer la branche :

```bash
cd ~ && git clone -b feat/f2c-gui git@github.com:Xav2000/AgriRobot.git f2c_gui_ws
# ou, dans un clone existant : git fetch && git checkout feat/f2c-gui
```

2. **Environnement Python** — réutiliser l'env du banc si fields2cover est déjà
installé, sinon :

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install fields2cover==2.1.0
```

3. **VS Code** : ouvrir le dossier depuis Windows avec l'extension
**Remote – WSL** (`code .` depuis le terminal WSL) — interpréteur Python
sélectionnable en bas à droite (`.venv`).

4. **Lancer** :

```bash
python server.py            # http://localhost:8080 (F2C_GUI_PORT pour changer)
```

5. **Utiliser** : cliquer sur la carte pour poser la parcelle (ou « Parcelle
test 10×10 »), régler les options, **Générer**, vérifier le tracé (passes
vertes, virages orange), ajuster, puis **Valider** → le plan est verrouillé
dans `validated_plan.json`.

## Options exposées

| Option | Rôle |
|---|---|
| Largeur de travail (m) | espacement des passes (l'outil couvre w) |
| Contours (headlands) | 0 = plein champ ; n = anneaux périphériques |
| Angle des passes | orientation des allers-retours (deg) |
| Ordre des passes | base / boustrophedon / serpent / spirale |
| Virages | Reeds-Shepp (reste dans la parcelle)… Dubins (déborde, marche avant seule) |
| Rayon de giration (m) | contrainte des virages |

## Limites assumées (v1 de l'essai)

- Zones d'exclusion non gérées (étape suivante : soustraction F2C + marge de sécurité).
- Parcelles convexes dessinées à la souris ; `plan.states` peut être illisible
  selon la version SWIG — la route reste alors affichée en trait simple.
- `dubins` (marche avant seule) déborde physiquement de la parcelle :
  comportement attendu, pas un bug.
