# vigicrues-mcp : consignes pour Claude Code

Ce dépôt contient un serveur MCP (`worker.js`) qui donne à Claude les débits et hauteurs des rivières françaises (Hub'Eau) et suisses (OFEV). Il est déployé sur Cloudflare Workers. Le chantier en cours est un **site web pour le club de kayak** qui répond à la question : **« Quand et où pagayer ? »**

Tout est en français : interface, messages, commentaires du code, messages de commit.

## Objectif du site (décidé)

- **Page d'accueil : un planning sur 7 jours.** Pour chaque jour, chaque parcours du club est classé **« ça passe »**, **« limite »**, **« trop bas »** ou **« trop haut »**.
- Le classement croise le **débit mesuré**, la **prévision de débit**, la **probabilité de lâcher**, la **pluie sur le bassin** et la **météo**.
- La **carte** et les **fiches station** passent au second plan, comme détail.
- Les membres consultent surtout sur **téléphone** : mobile d'abord, lisible d'un coup d'œil, sans couleur seule pour porter l'information (toujours le mot avec la couleur).
- Chaque chiffre prévu est une **estimation** : afficher sa fiabilité, ne jamais présenter une prévision comme une certitude.

### La donnée du club : `parcours.json`

C'est la seule donnée introuvable en ligne : pour chaque parcours, la **station de référence** et la **plage de navigation** (`min`, `ideal_min`, `ideal_max`, `max`). Sans elle, le site montre des débits mais ne dit pas où aller.

- Le fichier est rempli à la main par le club. Ne pas inventer de plages : une plage `null` s'affiche « plage à définir », avec la mesure brute.
- `unite` vaut `m3/s` (station qui mesure le débit) ou `cm` (station qui ne mesure que la hauteur, lue sur l'échelle Vigicrues de la station).
- `regule: true` signale des lâchers ou éclusées : le débit varie fortement dans la journée.
- `releves` reprend les sorties du carnet du club : ce sont des relevés **ponctuels**, pas des moyennes journalières.
- `verification` dit comment la station a été confirmée en comparant le carnet aux mesures Hub'Eau (le 04/11/2026).
- `type` : `journee` (sortie à la journée) ou `sejour` (week-end, stage) ; le planning peut les séparer.

## Règles de classement (proposition, à valider avec le club)

Zones de la plage : `< min` trop bas · `min–ideal_min` limite · `ideal_min–ideal_max` ça passe · `ideal_max–max` limite · `> max` trop haut.

Valeur retenue pour chaque jour :

1. **Aujourd'hui** : la dernière mesure, avec sa tendance. Si `regule` et qu'un lâcher est probable, montrer aussi le pic attendu et sa fenêtre horaire.
2. **J+1 à J+6, rivière naturelle, fiabilité GloFAS bonne ou moyenne** : la prévision ancrée (logique de `prevision`) et sa fourchette p25–p75. Si la fourchette chevauche une limite de zone, classer « limite ».
3. **Fiabilité faible** : persistance du niveau actuel, corrigée qualitativement par la pluie prévue (`rainEffect`). Afficher « incertain ».
4. **Rivière régulée** : deux scénarios, sans lâcher (débit de base) et avec lâcher (pic médian). Exemple : « ça passe si lâcher (60 %), plutôt 13 h–17 h ». Appeler la logique de `prochain_lacher` avec `seuil_m3s = plage.min` : la probabilité devient directement « probabilité que ça passe ».
5. **Station en hauteur seule** (Giffre à Samoëns, Guil) : pas de prévision chiffrée. Classer aujourd'hui sur la hauteur ; pour les jours suivants, donner la tendance (débit d'une station voisine dans `autres_stations`, pluie).
6. **Météo** : elle ne change pas la zone, elle ajoute des alertes : orage, vent fort, froid, isotherme 0 °C bas. Une pluie classée « forte hausse probable » pousse vers « trop haut / prudence ».

## Architecture actuelle

- **Un seul fichier, `worker.js`, sans dépendance.** Worker Cloudflare `vigicrues` (voir `wrangler.jsonc`).
- `GET /` renvoie une ligne de texte avec la version : c'est ainsi qu'on vérifie le déploiement. `POST /mcp` reçoit du JSON-RPC MCP, sans état (pas de SSE ni de session). La variable secrète facultative `CLE` protège `/mcp?cle=…`.
- Ordre du fichier : constantes et tableaux `FAVORIS`, `SUISSE_FAVORIS`, `BASSINS`, `BASSINS_CH` → point d'entrée `fetch` → `handleMessage` → tableau `TOOLS` (définition et fonction `run` de chaque outil) → fonctions des outils → accès réseau (`hubeau`, `existenz`, `openMeteo`) → calculs et mise en forme.
- Briques réutilisables pour le site :
  - `loadFlow(station)` : série de débit du dernier mois (France : 29 jours au pas de 15 min ; Suisse : 31 jours), nom et coordonnées.
  - `baseEtSeuil`, `findEpisodes` : débit de base (médiane) et épisodes au-dessus d'un seuil.
  - `prochainLacher` : probabilité de lâcher par jour, fenêtre horaire, pic médian.
  - `prevision` : GloFAS (Open-Meteo Flood API) recalé sur le débit mesuré, avec la corrélation log modèle/mesures comme fiabilité.
  - `pluieBassin`, `basinPoints` : pluie, neige et isotherme moyennés sur les points du bassin ; repères tirés des pluies du dernier mois.
- **Ces fonctions renvoient du texte** pour Claude. Le site a besoin d'objets : voir ci-dessous.
- Versions : `SERVER_INFO.version` dans `worker.js` et `version` dans `package.json` vont ensemble (1.4.0 actuellement).

## Architecture proposée pour le site (à confirmer avant de coder)

- **Même Worker, même dépôt.** Les fichiers statiques (`public/index.html`, CSS, JS) sont servis par Workers Static Assets (`"assets": { "directory": "./public" }` dans `wrangler.jsonc`). Le Worker garde `/mcp` et ajoute `/api/planning` (JSON).
  - Si `public/index.html` prend `/`, déplacer l'affichage de version (pied de page ou `/version`) et mettre le README à jour.
- **Séparer calcul et mise en forme**, étape par étape : chaque outil devient `donneesX()`, qui renvoie un objet, plus `texteX()`, qui le met en forme. Les outils MCP doivent rester identiques : les tests existants le garantissent.
- **`parcours.json` dans le Worker** : `import parcours from "./parcours.json" with { type: "json" };`. Node exige l'attribut `with` ; vérifier que Wrangler le bundle (`npx wrangler deploy --dry-run`).
- **Limiter les appels réseau.** Un planning de 17 parcours ferait des dizaines de requêtes Hub'Eau et Open-Meteo. En offre gratuite, un Worker a droit à 50 sous-requêtes par requête et à 10 ms de CPU (à vérifier dans le tableau de bord du compte). Pistes :
  - dédoublonner les stations (Bioge sert à deux parcours, Samoëns à deux, le Lauzet à deux, Château-Ville-Vieille à deux) ;
  - grouper : `observations_tr` accepte une liste de `code_entite`, Open-Meteo une liste de coordonnées séparées par des virgules ;
  - de préférence, calculer le planning par un **Cron Trigger** (toutes les 15 à 30 min), le stocker en KV ou dans le Cache API, et ne servir que le résultat.

## Pièges connus

**Données Hub'Eau**
- Unités : débit en **l/s**, hauteur en **mm**. Les mesures OFEV (m³/s, m) sont converties ×1000 pour réutiliser les mêmes calculs (`SWISS_FACTOR`).
- `observations_tr` avec `timestep` renvoie les points **dans le désordre** : toujours trier (`groupSeries` le fait).
- Statut **206** = résultat partiel (pagination), accepté par `hubeau()`, mais **la pagination n'est pas implémentée** : 29 jours au pas de 15 min ≈ 2 800 points par station, donc une requête groupée sur plusieurs stations peut dépasser `size` et être tronquée sans bruit.
- Les virgules et les deux-points ne doivent pas être encodés dans les listes et les dates : `hubeau()` les rétablit.
- `observations_tr` couvre environ 30 jours (on en prend 29). Au-delà, `obs_elab` (journalier) ; ses derniers jours manquent souvent (consolidation différée).
- Certaines stations ne mesurent **que la hauteur** (Samoëns, Mieussy, Sallanches, Bourg-Saint-Maurice, L'Argentière, Château-Ville-Vieille) : `loadFlow` échoue, donc pas de `prevision` ni de `prochain_lacher`.
- Les hauteurs françaises sont lues sur l'échelle propre à chaque station (parfois négative) ; les hauteurs suisses sont des altitudes. Elles ne se comparent qu'à elles-mêmes.
- Des mesures arrivent marquées « Douteuse » (`libelle_qualification_obs`) : le signaler, ne pas les cacher.

**Débits et lâchers**
- **La moyenne journalière trompe sur les rivières régulées.** Dranse à Bioge, le 29/08/2026 : moyenne 5,5 m³/s, maximum 19,8, carnet 10 (sortie pendant le lâcher). Classer sur le pic attendu pendant la fenêtre de lâcher, jamais sur la moyenne. Pour la même raison, GloFAS (moyennes journalières) ne voit pas les lâchers.
- **L'Arve varie fortement dans la journée** (14 → 40 m³/s à Bonneville le 03/11/2026) : une seule valeur par jour induit en erreur ; montrer une fourchette ou un créneau.
- Les relevés du carnet sont ponctuels. Pour les comparer à l'historique, encadrer avec `QmnJ` (moyenne) et `QIXnJ` (maximum).
- GloFAS a une maille de 5 km : correct sur les rivières naturelles moyennes à grandes, faible sur les petits bassins et les rivières régulées. La fiabilité se recalcule à chaque appel.

**Divers**
- Tous les jours sont en heure de Paris : `dayKey` passe par le format `sv-SE`, `shiftDay` travaille sur des dates ISO.
- Open-Meteo renvoie un **tableau** pour plusieurs points et un objet pour un seul (`pluieBassin` gère les deux).
- `BASSINS` liste les points de pluie par rivière. Une rivière absente (Sémine par exemple) retombe sur 5 points autour de la station : ajouter son bassin.
- api.existenz.ch est un service communautaire sans garantie ; repli possible : LINDAS (SPARQL, OFEV).
- France : pas de température de l'eau en temps réel.

## Tests

```bash
npm test
```

- `test/worker.test.mjs` remplace `globalThis.fetch` par des réponses simulées (Hub'Eau, OFEV, Open-Meteo). **Toute nouvelle API appelée doit y être simulée**, sinon les tests partent sur le réseau et échouent.
- Les tests doivent passer avant chaque push. Ajouter des tests pour le classement (valeurs aux frontières des zones, plage `null`, rivière régulée, station en hauteur seule).

## Déploiement et dépôt

- **Chaque push sur `main` est déployé en production** par Cloudflare. Travailler sur une branche ; fusionner quand les tests passent ; vérifier la version en ligne.
- **Le dépôt est public** : aucune donnée personnelle (noms des membres, récits du carnet, adresses e-mail, liens vers les documents privés du club).

## Environnement Claude Code (cloud)

- La politique réseau par défaut **bloque** `hubeau.eaufrance.fr`, `api.open-meteo.com`, `flood-api.open-meteo.com`, `api.existenz.ch` et `vigicrues.gui-renard.workers.dev` (CONNECT 403). Pour tester sur les vraies données avec `npx wrangler dev` ou `curl`, ajouter ces domaines dans les réglages de l'environnement : Network access, Allowed domains.
- En attendant, le **connecteur MCP Vigicrues** (outils `mcp__Vigicrues_CF__*`) interroge la version déployée, et donc les vraies données : c'est le moyen de vérifier une station ou un ordre de grandeur.
- Le carnet du club est le tableur Google « Journal de bord kayak » (connecteur Google Drive/Sheets). Il sert à compléter les `releves`.
