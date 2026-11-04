# vigicrues-mcp

Serveur MCP qui donne à Claude les hauteurs, débits et températures des rivières :

- **France** : réseau Vigicrues, via l'API [Hub'Eau Hydrométrie](https://hubeau.eaufrance.fr/page/api-hydrometrie) (Licence Ouverte Etalab).
- **Suisse** : réseau de l'[OFEV](https://www.hydrodaten.admin.ch/fr), via la passerelle non officielle [api.existenz.ch](https://api.existenz.ch). Source des données : OFEV (BAFU).

Un seul fichier (`worker.js`), sans dépendance, déployé sur Cloudflare Workers.
Point d'accès du connecteur : `https://vigicrues.gui-renard.workers.dev/mcp`.

## Outils

| Outil | Ce qu'il fait |
|---|---|
| `chercher_stations` | Stations françaises : favoris, ou recherche par département, rivière, commune ou coordonnées |
| `niveau_actuel` | Hauteur et débit actuels (France), évolution sur 1 h / 3 h et tendance |
| `historique` | Jusqu'à 29 jours, pas horaire (France) |
| `debits_journaliers` | Débit moyen, débit max ou hauteur max par jour, sur n'importe quelle période passée (France) |
| `dernier_debit_eleve` | Dernier passage au-dessus du débit de base (lâchers de barrage), épisodes récents, heures et jours habituels (France et Suisse) |
| `prochain_lacher` | Probabilité de lâcher aujourd'hui et les jours suivants, fenêtre horaire probable (France et Suisse) |
| `prevision` | Débit moyen journalier prévu jusqu'à 10 jours (tendance GloFAS appliquée au débit mesuré), pluie et neige, fiabilité du modèle sur la station (France et Suisse) |
| `suisse_chercher_stations` | Stations OFEV : favoris, ou recherche par rivière ou lieu |
| `suisse_niveau_actuel` | Débit, hauteur et température de l'eau actuels (Suisse), évolution et tendance |
| `suisse_historique` | Jusqu'à 31 jours (Suisse) |

Les stations favorites sont dans les tableaux `FAVORIS` et `SUISSE_FAVORIS` en haut de `worker.js`.

## Limites

- France : pas de température de l'eau en temps réel. Le réseau Hub'Eau « Température des cours d'eau » publie avec des mois, voire des années de retard.
- Les hauteurs françaises sont lues sur l'échelle propre à chaque station ; les hauteurs suisses sont des altitudes. Seules leurs variations sont parlantes.
- Pas de données pour la Slovénie (Soča) ni l'Italie.
- `prochain_lacher` est une estimation statistique (fréquence par jour de la semaine sur le dernier mois, ajustée selon les 7 derniers jours) : les exploitants ne publient pas leurs lâchers.
- `prevision` s'appuie sur GloFAS (maille de 5 km, moyennes journalières) : fiable sur les rivières naturelles moyennes à grandes, pas sur les petits bassins ni les rivières à éclusées. L'outil affiche à chaque appel la corrélation modèle/mesures du dernier mois.
- api.existenz.ch est un service communautaire sans garantie. Si elle disparaissait, l'OFEV publie les mêmes mesures sur [LINDAS](https://lindas.admin.ch) (SPARQL).

## Déploiement

Le Worker Cloudflare `vigicrues` est relié à ce dépôt : chaque push sur `main` est déployé automatiquement.
Pour vérifier la version en ligne, ouvre https://vigicrues.gui-renard.workers.dev/ : la page affiche le numéro de version de `worker.js`.

Protection facultative : ajoute une variable secrète `CLE` dans les réglages du Worker, puis utilise l'URL `.../mcp?cle=<valeur>` dans le connecteur.

## Tests

```
npm test
```

Les tests simulent Hub'Eau et l'OFEV : ils vérifient le protocole MCP, les conversions d'unités, les tendances et la gestion des erreurs.
