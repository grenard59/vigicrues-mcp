/**
 * Vigicrues MCP — hauteurs, débits et températures des rivières (France + Suisse)
 *
 * Serveur MCP (transport « Streamable HTTP », sans état, sans dépendance)
 * à déployer tel quel sur Cloudflare Workers.
 *
 *   Point d'accès du connecteur :  https://<ton-worker>.workers.dev/mcp
 *
 * Données :
 *  - France : API Hub'Eau Hydrométrie v2 (plateforme PHyC opérée par le
 *    Service Central Vigicrues), Licence Ouverte Etalab. Aucune clé requise.
 *  - Suisse : mesures de l'Office fédéral de l'environnement (OFEV/BAFU,
 *    hydrodaten.admin.ch), lues via api.existenz.ch, API non officielle et
 *    gratuite pour un usage non commercial. L'OFEV demande à être cité.
 *    Si cette passerelle disparaissait, les mêmes données sont publiées
 *    officiellement par l'OFEV sur LINDAS (lindas.admin.ch, SPARQL).
 *
 * Protection facultative : définis une variable « CLE » dans les réglages du
 * Worker ; l'URL du connecteur devient alors  .../mcp?cle=<ta-valeur>.
 */

const HUBEAU = "https://hubeau.eaufrance.fr/api/v2/hydrometrie";
const EXISTENZ = "https://api.existenz.ch/apiv1/hydro";
const SOURCE_OFEV = "Source : OFEV (BAFU), hydrodaten.admin.ch, via api.existenz.ch.";
const SERVER_INFO = { name: "vigicrues-hubeau", title: "Vigicrues (Hub'Eau + OFEV)", version: "1.2.0" };
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const TZ = "Europe/Paris";

// ---------------------------------------------------------------------------
// Stations de référence (modifiable). H = hauteur, Q = débit.
// Disponibilité des mesures vérifiée le 04/11/2026.
// ---------------------------------------------------------------------------
const FAVORIS = [
  { riviere: "Dranse", code: "V033401001", nom: "La Dranse à Reyvroz [Bioge]", mesures: "H+Q" },
  { riviere: "Dranse", code: "V031401002", nom: "La Dranse (d'Abondance) à Vacheresse", mesures: "H+Q" },
  { riviere: "Arve", code: "V000201001", nom: "L'Arve à Chamonix [Pont des Favrands]", mesures: "H+Q" },
  { riviere: "Arve", code: "V003201001", nom: "L'Arve à Sallanches", mesures: "H" },
  { riviere: "Arve", code: "V020542201", nom: "L'Arve à Bonneville", mesures: "H+Q" },
  { riviere: "Arve", code: "V022000201", nom: "L'Arve à Reignier-Ésery [Arthaz]", mesures: "H+Q" },
  { riviere: "Giffre", code: "V012000202", nom: "Le Giffre à Samoëns", mesures: "H" },
  { riviere: "Giffre", code: "V014000202", nom: "Le Giffre à Mieussy", mesures: "H" },
  { riviere: "Giffre", code: "V015401001", nom: "Le Giffre à Marignier [Plan Séraphin]", mesures: "H+Q" },
  { riviere: "Fier", code: "V121401001", nom: "Le Fier à Dingy-Saint-Clair", mesures: "H+Q" },
  { riviere: "Chéran", code: "V125501001", nom: "Le Chéran à Allèves [La Charniaz]", mesures: "H+Q" },
  { riviere: "Isère", code: "W004000201", nom: "L'Isère à Bourg-Saint-Maurice", mesures: "H" },
  { riviere: "Isère", code: "W010000101", nom: "L'Isère à Landry", mesures: "H+Q" },
  { riviere: "Isère", code: "W011001001", nom: "L'Isère à Moûtiers [Pont Neuf]", mesures: "H+Q" },
  { riviere: "Isère", code: "W011001101", nom: "L'Isère à Albertville [Conflans]", mesures: "H+Q" },
  { riviere: "Durance", code: "X001001002", nom: "La Durance à Val-des-Prés [Les Alberts]", mesures: "H+Q" },
  { riviere: "Durance", code: "X013001001", nom: "La Durance à L'Argentière-la-Bessée", mesures: "H" },
  { riviere: "Guil", code: "X023000202", nom: "Le Guil à Château-Ville-Vieille [Pont de la Chapelue]", mesures: "H" },
  { riviere: "Ubaye", code: "X043401001", nom: "L'Ubaye à Barcelonnette", mesures: "H+Q" },
  { riviere: "Ubaye", code: "X045401001", nom: "L'Ubaye au Lauzet-Ubaye [Roche-Rousse]", mesures: "H+Q" },
];

// Stations suisses de référence (numéros OFEV). Modifiable.
const SUISSE_FAVORIS = [
  { riviere: "Arve", id: "2170", nom: "L'Arve à Genève, Bout du Monde" },
  { riviere: "Rhône", id: "2606", nom: "Le Rhône à Genève, Halle de l'Île" },
  { riviere: "Rhône", id: "2174", nom: "Le Rhône à Chancy, Aux Ripes" },
  { riviere: "Rhône", id: "2009", nom: "Le Rhône à la Porte du Scex" },
  { riviere: "Drance", id: "2053", nom: "La Drance à Martigny, Pont de Rossettan" },
  { riviere: "Drance de Bagnes", id: "2117", nom: "La Drance de Bagnes au Châble, Villette" },
  { riviere: "Sarine", id: "2160", nom: "La Sarine à Broc, Château d'en bas" },
  { riviere: "Simme", id: "2151", nom: "La Simme à Oberwil" },
  { riviere: "Lütschine", id: "2109", nom: "La Lütschine à Gsteig" },
  { riviere: "Vorderrhein", id: "2033", nom: "Le Rhin antérieur à Ilanz" },
  { riviere: "Inn", id: "2265", nom: "L'Inn à Tarasp" },
  { riviere: "Verzasca", id: "2605", nom: "La Verzasca à Lavertezzo, Campiöi" },
];

// ---------------------------------------------------------------------------
// Point d'entrée du Worker
// ---------------------------------------------------------------------------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(
        `Serveur MCP Vigicrues (Hub'Eau + OFEV) v${SERVER_INFO.version} en ligne.\nURL du connecteur : ${url.origin}/mcp\n`,
        { headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    }
    if (url.pathname !== "/mcp" && url.pathname !== "/mcp/") {
      return new Response("Introuvable", { status: 404 });
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (env && env.CLE && url.searchParams.get("cle") !== env.CLE) {
      return new Response("Accès refusé", { status: 403, headers: CORS });
    }
    if (request.method !== "POST") {
      // Serveur sans état : pas de flux SSE ouvert par GET, pas de session à fermer.
      return new Response("Méthode non autorisée", { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(rpcError(null, -32700, "JSON invalide"), 400);
    }

    const batch = Array.isArray(body);
    const messages = batch ? body : [body];
    const replies = [];
    for (const msg of messages) {
      const reply = await handleMessage(msg);
      if (reply) replies.push(reply);
    }
    if (replies.length === 0) return new Response(null, { status: 202, headers: CORS });
    return json(batch ? replies : replies[0]);
  },
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handleMessage(msg) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    // Réponse du client (sans « method ») ou message invalide : rien à renvoyer si pas d'id.
    if (msg && typeof msg === "object" && "id" in msg && !("result" in msg) && !("error" in msg)) {
      return rpcError(msg.id, -32600, "Requête invalide");
    }
    return null;
  }
  const isNotification = !("id" in msg);
  if (isNotification) return null; // notifications/initialized, notifications/cancelled…

  const { id, method, params = {} } = msg;
  switch (method) {
    case "initialize": {
      const asked = params.protocolVersion;
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS.map(({ run, ...definition }) => definition) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return rpcError(id, -32602, `Outil inconnu : ${params.name}`);
      try {
        const text = await tool.run(params.arguments || {});
        return rpcResult(id, { content: [{ type: "text", text }] });
      } catch (err) {
        return rpcResult(id, { content: [{ type: "text", text: `Erreur : ${err.message}` }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Méthode non prise en charge : ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------
const INSTRUCTIONS =
  "Mesures hydrométriques officielles. France : réseau Vigicrues via Hub'Eau (outils sans préfixe : " +
  "hauteur et débit, pas de température de l'eau en temps réel). Suisse : réseau OFEV (outils « suisse_… » : " +
  "débit, hauteur et température de l'eau). Pour une rivière des favoris, appelle directement " +
  "niveau_actuel ou suisse_niveau_actuel avec « riviere » ; sinon, cherche d'abord le code de la station. " +
  "Les heures renvoyées sont en heure de Paris (identique à l'heure suisse).";

const NOTE_HAUTEUR =
  "La hauteur est lue sur l'échelle propre à chaque station (elle peut être négative) : " +
  "elle ne se compare qu'à elle-même, pas d'une station à l'autre.";

const TOOLS = [
  {
    name: "chercher_stations",
    title: "Chercher des stations",
    description:
      "Trouve des stations hydrométriques françaises en service et leur code (10 caractères, ex. V020542201). " +
      "Sans argument : renvoie les stations favorites (Dranse, Arve, Giffre, Fier, Chéran, Isère, Durance, Guil, Ubaye). " +
      "Pour une autre rivière, donne le département (ex. « 74 ») et filtre par rivière ou commune, " +
      "ou donne des coordonnées GPS avec un rayon.",
    inputSchema: {
      type: "object",
      properties: {
        departement: { type: "string", description: "Numéro de département, ex. « 74 », « 05 », « 2A »." },
        riviere: { type: "string", description: "Filtre sur le nom de la rivière (accents et casse ignorés), ex. « Arve »." },
        commune: { type: "string", description: "Filtre sur le nom de la commune, ex. « Bonneville »." },
        latitude: { type: "number", description: "Latitude WGS84 pour une recherche par rayon." },
        longitude: { type: "number", description: "Longitude WGS84 pour une recherche par rayon." },
        rayon_km: { type: "number", description: "Rayon de recherche en km (défaut 15)." },
      },
    },
    run: chercherStations,
  },
  {
    name: "niveau_actuel",
    title: "Niveau actuel",
    description:
      "Dernière hauteur (m) et dernier débit (m³/s) mesurés, avec l'évolution sur 1 h et 3 h et une tendance " +
      "(stable, hausse, baisse). Sans argument : toutes les stations favorites. " + NOTE_HAUTEUR,
    inputSchema: {
      type: "object",
      properties: {
        stations: {
          type: "array",
          items: { type: "string" },
          maxItems: 20,
          description: "Codes station Hub'Eau (ex. [\"V020542201\"]). Prioritaire sur « riviere ».",
        },
        riviere: { type: "string", description: "Nom d'une rivière des favoris, ex. « Dranse »." },
      },
    },
    run: niveauActuel,
  },
  {
    name: "historique",
    title: "Historique récent",
    description:
      "Évolution heure par heure d'une station sur les derniers jours (29 jours maximum) : minimum, maximum, " +
      "résumé jour par jour et dernières 24 h. Pour des dates plus anciennes, utilise debits_journaliers.",
    inputSchema: {
      type: "object",
      properties: {
        station: { type: "string", description: "Code station Hub'Eau, ex. « V033401001 »." },
        jours: { type: "integer", minimum: 1, maximum: 29, description: "Nombre de jours (défaut 3)." },
        grandeur: { type: "string", enum: ["debit", "hauteur", "les_deux"], description: "Défaut : les_deux." },
      },
      required: ["station"],
    },
    run: historique,
  },
  {
    name: "debits_journaliers",
    title: "Débits journaliers passés",
    description:
      "Valeurs journalières consolidées sur n'importe quelle période passée (historique depuis plusieurs " +
      "décennies selon les stations) : débit moyen, débit maximal ou hauteur maximale du jour. Utile pour " +
      "retrouver le niveau d'une sortie passée. Les derniers jours peuvent manquer (mise à jour différée).",
    inputSchema: {
      type: "object",
      properties: {
        station: { type: "string", description: "Code station Hub'Eau." },
        date_debut: { type: "string", description: "AAAA-MM-JJ (défaut : 30 jours avant date_fin)." },
        date_fin: { type: "string", description: "AAAA-MM-JJ (défaut : aujourd'hui)." },
        mesure: {
          type: "string",
          enum: ["debit_moyen", "debit_max", "hauteur_max"],
          description: "Défaut : debit_moyen.",
        },
      },
      required: ["station"],
    },
    run: debitsJournaliers,
  },
  {
    name: "dernier_debit_eleve",
    title: "Dernier débit élevé (lâchers)",
    description:
      "Dit quand le débit d'une station a été au-dessus de la normale pour la dernière fois, avec la durée et le pic, " +
      "et liste les épisodes récents. Pensé pour les rivières régulées par barrage (lâchers, éclusées) : la « normale » " +
      "est le débit de base, c'est-à-dire la médiane des débits du dernier mois. Donne aussi les heures et jours où les " +
      "lâchers démarrent le plus souvent. Fonctionne en France (code Hub'Eau à 10 caractères, 29 jours de détail puis " +
      "maximums journaliers sur un an) et en Suisse (numéro OFEV à 4 caractères, 31 jours).",
    inputSchema: {
      type: "object",
      properties: {
        station: { type: "string", description: "Code Hub'Eau (ex. « V033401001 ») ou numéro OFEV (ex. « 2174 »)." },
        seuil_m3s: { type: "number", description: "Seuil en m³/s à la place de la normale (ex. ton débit minimum navigable)." },
        facteur: { type: "number", description: "Seuil = facteur × débit de base (défaut 1,5). Ignoré si seuil_m3s est donné." },
      },
      required: ["station"],
    },
    run: dernierDebitEleve,
  },
  {
    name: "suisse_chercher_stations",
    title: "Chercher des stations suisses",
    description:
      "Trouve des stations hydrologiques suisses de l'OFEV et leur numéro (4 caractères, ex. 2170). " +
      "Sans argument : renvoie les stations favorites (Arve et Rhône à Genève, Valais, Oberland, Grisons, Tessin). " +
      "Sinon, filtre par rivière ou par nom de lieu.",
    inputSchema: {
      type: "object",
      properties: {
        riviere: { type: "string", description: "Nom de la rivière, ex. « Drance », « Inn » (accents et casse ignorés)." },
        lieu: { type: "string", description: "Nom de la station ou du lieu, ex. « Martigny »." },
      },
    },
    run: suisseChercherStations,
  },
  {
    name: "suisse_niveau_actuel",
    title: "Niveau actuel (Suisse)",
    description:
      "Dernières mesures des stations suisses de l'OFEV (toutes les 10 min) : débit (m³/s), hauteur (altitude " +
      "du plan d'eau en m) et température de l'eau (°C), avec l'évolution sur 1 h et 3 h. Toutes les stations ne " +
      "mesurent pas les trois. Sans argument : toutes les stations suisses favorites.",
    inputSchema: {
      type: "object",
      properties: {
        stations: {
          type: "array",
          items: { type: "string" },
          maxItems: 20,
          description: "Numéros de station OFEV, ex. [\"2170\"]. Prioritaire sur « riviere ».",
        },
        riviere: { type: "string", description: "Nom d'une rivière des favoris suisses, ex. « Arve », « Drance »." },
      },
    },
    run: suisseNiveauActuel,
  },
  {
    name: "suisse_historique",
    title: "Historique récent (Suisse)",
    description:
      "Évolution d'une station suisse sur les derniers jours (31 jours maximum) : minimum, maximum, " +
      "résumé jour par jour et dernières 24 h, pour le débit, la hauteur et la température de l'eau.",
    inputSchema: {
      type: "object",
      properties: {
        station: { type: "string", description: "Numéro de station OFEV, ex. « 2170 »." },
        jours: { type: "integer", minimum: 1, maximum: 31, description: "Nombre de jours (défaut 3)." },
        grandeur: {
          type: "string",
          enum: ["debit", "hauteur", "temperature", "tout"],
          description: "Défaut : tout.",
        },
      },
      required: ["station"],
    },
    run: suisseHistorique,
  },
];

// --- chercher_stations ------------------------------------------------------
async function chercherStations(args) {
  const riviere = clean(args.riviere);
  const commune = clean(args.commune);
  const dep = clean(String(args.departement ?? ""));
  const lat = Number(args.latitude);
  const lon = Number(args.longitude);
  const rayon = Number(args.rayon_km);
  const hasCoords = args.latitude != null && args.longitude != null && Number.isFinite(lat) && Number.isFinite(lon);

  if (!dep && !hasCoords) {
    let favs = FAVORIS;
    if (riviere) favs = favs.filter((f) => norm(f.riviere + " " + f.nom).includes(norm(riviere)));
    if (commune) favs = favs.filter((f) => norm(f.nom).includes(norm(commune)));
    if (favs.length === 0) {
      throw new Error(
        "Aucune station favorite ne correspond. Indique le département (ex. « 74 ») ou des coordonnées GPS pour chercher dans tout le réseau.",
      );
    }
    return (
      "Stations favorites (H = hauteur, Q = débit) :\n" +
      favs.map((f) => `- ${f.code} — ${f.nom} [${f.mesures}]`).join("\n") +
      "\n\nPour une autre station, précise le département."
    );
  }

  const params = {
    en_service: "true",
    size: 2000,
    fields: "code_station,libelle_station,libelle_cours_eau,libelle_commune,code_departement",
  };
  if (dep) {
    if (!/^(\d{2}|2A|2B|97\d)$/i.test(dep)) throw new Error(`Département invalide : « ${dep} ».`);
    params.code_departement = dep.toUpperCase();
  }
  if (hasCoords) {
    params.latitude = lat;
    params.longitude = lon;
    params.distance = Number.isFinite(rayon) && rayon > 0 ? Math.min(rayon, 100) : 15;
  }

  const data = await hubeau("/referentiel/stations", params);
  let stations = data.data || [];
  if (riviere) {
    stations = stations.filter((s) => norm(`${s.libelle_cours_eau || ""} ${s.libelle_station || ""}`).includes(norm(riviere)));
  }
  if (commune) stations = stations.filter((s) => norm(s.libelle_commune || "").includes(norm(commune)));

  if (stations.length === 0) return "Aucune station en service ne correspond à cette recherche.";

  const MAX = 60;
  const lines = stations
    .slice(0, MAX)
    .map((s) => `- ${s.code_station} — ${s.libelle_station} (${s.libelle_cours_eau || "cours d'eau non renseigné"}, ${titleCase(s.libelle_commune)})`);
  let out = `${stations.length} station(s) en service :\n${lines.join("\n")}`;
  if (stations.length > MAX) out += `\n… et ${stations.length - MAX} autres : affine avec « riviere » ou « commune ».`;
  out += "\n\nToutes ne mesurent pas le débit : niveau_actuel indique ce que chaque station fournit.";
  return out;
}

// --- niveau_actuel ----------------------------------------------------------
async function niveauActuel(args) {
  let codes;
  if (Array.isArray(args.stations) && args.stations.length > 0) {
    codes = [...new Set(args.stations.map(checkCode))];
    if (codes.length > 20) throw new Error("20 stations maximum par appel.");
  } else if (clean(args.riviere)) {
    const r = norm(args.riviere);
    codes = FAVORIS.filter((f) => norm(f.riviere + " " + f.nom).includes(r)).map((f) => f.code);
    if (codes.length === 0) {
      throw new Error(`« ${args.riviere} » n'est pas dans les favoris : cherche son code avec chercher_stations.`);
    }
  } else {
    codes = FAVORIS.map((f) => f.code);
  }

  const now = Date.now();
  const since = new Date(now - 4 * HOUR).toISOString().slice(0, 19) + "Z";
  const unknown = codes.filter((c) => !isFavori(c));

  const [obs, names] = await Promise.all([
    hubeau("/observations_tr", {
      code_entite: codes,
      date_debut_obs: since,
      size: 20000,
      fields: "code_station,grandeur_hydro,date_obs,resultat_obs,libelle_qualification_obs",
    }),
    stationNames(unknown),
  ]);

  const series = groupSeries(obs.data || []);
  const blocks = codes.map((code) => {
    const nom = FAVORIS.find((f) => f.code === code)?.nom || names[code] || "Station";
    const lines = [];
    for (const g of ["Q", "H"]) {
      const s = series.get(`${code}|${g}`);
      if (s && s.length) lines.push("  " + describeLatest(g, s, now));
    }
    if (lines.length === 0) lines.push("  Aucune mesure sur les 4 dernières heures.");
    return `${nom} (${code})\n${lines.join("\n")}`;
  });

  return `Mesures Hub'Eau, heure de Paris (consultées le ${fmtDateTime(now)}) :\n\n${blocks.join("\n\n")}`;
}

function describeLatest(g, s, now) {
  const last = s[s.length - 1];
  const current = meanAround(s, last.t, 10 * MIN, "before") ?? last.v;
  const h1 = meanAround(s, last.t - HOUR, 10 * MIN);
  const h3 = meanAround(s, last.t - 3 * HOUR, 15 * MIN);

  const parts = [`${LABELS[g]} : ${FORMATS[g](last.v)} (${fmtTime(last.t)})`];
  if (h1 != null) parts.push(`sur 1 h : ${fmtDelta(g, current, h1)}`);
  if (h3 != null) parts.push(`sur 3 h : ${fmtDelta(g, current, h3)}`);
  const ref = h3 ?? h1;
  let line = parts.join(" · ");
  if (ref != null) line += ` → ${trend(g, current, ref)}`;
  if (/douteuse/i.test(last.q || "")) line += " [donnée signalée douteuse]";
  const ageH = (now - last.t) / HOUR;
  if (ageH > 3) line += ` ⚠ dernière mesure il y a ${Math.round(ageH)} h`;
  return line;
}

// --- historique -------------------------------------------------------------
async function historique(args) {
  const code = checkCode(args.station);
  const jours = Math.min(29, Math.max(1, Math.round(Number(args.jours) || 3)));
  const grandeurs = args.grandeur === "debit" ? ["Q"] : args.grandeur === "hauteur" ? ["H"] : ["Q", "H"];
  const now = Date.now();
  const since = new Date(now - jours * DAY).toISOString().slice(0, 19) + "Z";

  const [names, ...results] = await Promise.all([
    stationNames(isFavori(code) ? [] : [code]),
    ...grandeurs.map((g) =>
      hubeau("/observations_tr", {
        code_entite: code,
        grandeur_hydro: g,
        timestep: 60,
        date_debut_obs: since,
        fields: "code_station,grandeur_hydro,date_obs,resultat_obs",
      }),
    ),
  ]);

  const nom = FAVORIS.find((f) => f.code === code)?.nom || names[code] || "Station";
  const sections = grandeurs.map((g, i) => summarizeSeries(g, groupSeries(results[i].data || []).get(`${code}|${g}`) || []));

  let out = `${nom} (${code}) — ${jours} dernier(s) jour(s), pas horaire, heure de Paris\n\n${sections.join("\n\n")}`;
  if (grandeurs.includes("H")) out += `\n\n${NOTE_HAUTEUR}`;
  return out;
}

/** Résumé d'une série : actuel, min, max, min → max par jour, valeurs des dernières 24 h toutes les 2 h. */
function summarizeSeries(g, s) {
  const label = LABELS[g];
  const fmt = FORMATS[g];
  if (s.length === 0) return `${label} : aucune mesure sur la période.`;
  const min = s.reduce((a, b) => (b.v < a.v ? b : a));
  const max = s.reduce((a, b) => (b.v > a.v ? b : a));
  const last = s[s.length - 1];

  const days = new Map();
  for (const p of s) {
    const k = dayKey(p.t);
    const d = days.get(k) || { t: p.t, min: p.v, max: p.v };
    d.min = Math.min(d.min, p.v);
    d.max = Math.max(d.max, p.v);
    days.set(k, d);
  }
  const perDay = [...days.values()].map((d) => `  ${fmtDay(d.t)} : ${fmt(d.min)} → ${fmt(d.max)}`);

  // Un point toutes les 2 h en remontant depuis la dernière mesure, quel que soit le pas des données.
  const picks = [];
  for (let target = last.t; target >= last.t - DAY; target -= 2 * HOUR) {
    const p = nearest(s, target, 20 * MIN);
    if (p && !picks.includes(p)) picks.unshift(p);
  }
  const recentLine = picks.map((p) => `${fmtTime(p.t)} ${fmt(p.v)}`).join(" · ");

  return [
    `${label} — actuel ${fmt(last.v)} (${fmtDateTime(last.t)}), min ${fmt(min.v)} (${fmtDateTime(min.t)}), max ${fmt(max.v)} (${fmtDateTime(max.t)})`,
    `Par jour (min → max) :`,
    ...perDay,
    `Dernières 24 h (toutes les 2 h) : ${recentLine}`,
  ].join("\n");
}

function nearest(s, target, tolerance) {
  let best = null;
  for (const p of s) {
    const d = Math.abs(p.t - target);
    if (d <= tolerance && (!best || d < Math.abs(best.t - target))) best = p;
  }
  return best;
}

// --- debits_journaliers -----------------------------------------------------
const ELAB = {
  debit_moyen: { code: "QmnJ", label: "Débit moyen journalier", fmt: (v) => fmtQ(v) },
  debit_max: { code: "QIXnJ", label: "Débit instantané maximal du jour", fmt: (v) => fmtQ(v) },
  hauteur_max: { code: "HIXnJ", label: "Hauteur instantanée maximale du jour", fmt: (v) => fmtH(v) },
};

async function debitsJournaliers(args) {
  const code = checkCode(args.station);
  const mesure = ELAB[args.mesure] ? args.mesure : "debit_moyen";
  const { code: grandeur, label, fmt } = ELAB[mesure];

  const fin = args.date_fin ? checkDate(args.date_fin) : dayKey(Date.now());
  const debut = args.date_debut ? checkDate(args.date_debut) : shiftDay(fin, -30);
  const span = (Date.parse(fin) - Date.parse(debut)) / DAY;
  if (span < 0) throw new Error("date_debut doit précéder date_fin.");
  if (span > 400) throw new Error("Période limitée à 400 jours par appel.");

  const [names, res] = await Promise.all([
    stationNames(isFavori(code) ? [] : [code]),
    hubeau("/obs_elab", {
      code_entite: code,
      grandeur_hydro_elab: grandeur,
      date_debut_obs_elab: debut,
      date_fin_obs_elab: fin,
      size: 1000,
      fields: "code_station,date_obs_elab,resultat_obs_elab,libelle_statut",
    }),
  ]);
  const nom = FAVORIS.find((f) => f.code === code)?.nom || names[code] || "Station";
  const rows = (res.data || [])
    .filter((r) => r.resultat_obs_elab != null)
    .sort((a, b) => (a.date_obs_elab < b.date_obs_elab ? -1 : 1));

  const head = `${nom} (${code}) — ${label}, du ${frDate(debut)} au ${frDate(fin)}`;
  if (rows.length === 0) {
    return `${head}\nAucune donnée : la station ne publie peut-être pas cette grandeur, ou la période n'est pas encore consolidée.`;
  }

  const values = rows.map((r) => r.resultat_obs_elab);
  const min = rows[values.indexOf(Math.min(...values))];
  const max = rows[values.indexOf(Math.max(...values))];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const summary =
    `Moyenne ${fmt(mean)} · min ${fmt(min.resultat_obs_elab)} le ${frDate(min.date_obs_elab)} · ` +
    `max ${fmt(max.resultat_obs_elab)} le ${frDate(max.date_obs_elab)}`;

  let body;
  if (rows.length <= 62) {
    body = rows.map((r) => `  ${frDate(r.date_obs_elab)} : ${fmt(r.resultat_obs_elab)}`).join("\n");
  } else {
    const months = new Map();
    for (const r of rows) {
      const k = r.date_obs_elab.slice(0, 7);
      const m = months.get(k) || [];
      m.push(r.resultat_obs_elab);
      months.set(k, m);
    }
    body = [...months.entries()]
      .map(([k, v]) => {
        const avg = v.reduce((a, b) => a + b, 0) / v.length;
        return `  ${k.slice(5)}/${k.slice(0, 4)} : moyenne ${fmt(avg)}, min ${fmt(Math.min(...v))}, max ${fmt(Math.max(...v))}`;
      })
      .join("\n");
  }

  const lastDate = rows[rows.length - 1].date_obs_elab.slice(0, 10);
  const lag = (Date.parse(fin) - Date.parse(lastDate)) / DAY;
  const note = lag > 2 ? `\n\nDonnées consolidées disponibles jusqu'au ${frDate(lastDate)} seulement.` : "";
  const hNote = mesure === "hauteur_max" ? `\n\n${NOTE_HAUTEUR}` : "";
  return `${head}\n${summary}\n\n${body}${note}${hNote}`;
}

// --- dernier_debit_eleve ----------------------------------------------------
async function dernierDebitEleve(args) {
  const raw = String(args.station || "").trim().toUpperCase();
  const suisse = /^[A-Z0-9]{4}$/.test(raw);
  const id = suisse ? checkSwissId(raw) : checkCode(raw);
  const seuilFixe = Number(args.seuil_m3s) > 0 ? Number(args.seuil_m3s) * 1000 : null; // l/s
  const facteur = Number(args.facteur) >= 1.05 ? Math.min(Number(args.facteur), 20) : 1.5;
  const now = Date.now();

  let s;
  let nom;
  let jours;
  if (suisse) {
    jours = 31;
    const [data, locations] = await Promise.all([
      existenz("/daterange", { locations: id, parameters: "flow", startdate: "-31 days", enddate: "now" }),
      SUISSE_FAVORIS.some((f) => f.id === id) ? {} : suisseLocations().catch(() => ({})),
    ]);
    s = swissSeries(data.payload || []).get(`${id}|Q`) || [];
    nom = SUISSE_FAVORIS.find((f) => f.id === id)?.nom || locations[id]?.name || "Station";
  } else {
    jours = 29;
    const [obs, names] = await Promise.all([
      hubeau("/observations_tr", {
        code_entite: id,
        grandeur_hydro: "Q",
        timestep: 15,
        date_debut_obs: new Date(now - jours * DAY).toISOString().slice(0, 19) + "Z",
        fields: "code_station,grandeur_hydro,date_obs,resultat_obs",
      }),
      stationNames(isFavori(id) ? [] : [id]),
    ]);
    s = groupSeries(obs.data || []).get(`${id}|Q`) || [];
    nom = FAVORIS.find((f) => f.code === id)?.nom || names[id] || "Station";
  }
  if (s.length < 20) {
    throw new Error(`Pas assez de mesures de débit pour ${id} sur le dernier mois (la station ne mesure peut-être que la hauteur).`);
  }

  const base = median(s.map((p) => p.v));
  const seuil = seuilFixe ?? Math.max(base * facteur, base + 300); // +0,3 m³/s minimum contre le bruit
  const step = median(s.slice(1).map((p, i) => p.t - s[i].t)) || 15 * MIN;
  const episodes = findEpisodes(s, seuil, Math.max(3 * step, 45 * MIN), step);
  const last = s[s.length - 1];

  const lines = [
    `${nom} (${id}) — débits des ${jours} derniers jours, heure de Paris`,
    "",
    seuilFixe
      ? `Débit de base : ${fmtQ(base)} (médiane de la période) · seuil demandé : ${fmtQ(seuil)}`
      : `Débit de base : ${fmtQ(base)} (médiane de la période) · seuil : ${fmtQ(seuil)} (${fmtNum(seuil / base, 1)} × la base)`,
  ];

  const current = episodes.length && episodes[episodes.length - 1].end === last.t ? episodes[episodes.length - 1] : null;
  lines.push(
    current
      ? `Maintenant : ${fmtQ(last.v)} (${fmtDateTime(last.t)}), au-dessus du seuil depuis ${fmtDayTime(current.start)}.`
      : `Maintenant : ${fmtQ(last.v)} (${fmtDateTime(last.t)}), sous le seuil.`,
  );
  lines.push("");

  if (episodes.length === 0) {
    lines.push(`Aucun passage au-dessus du seuil sur les ${jours} derniers jours.`);
    if (!suisse) lines.push(await lastHighDay(id, seuil, now - jours * DAY));
  } else {
    const done = current ? episodes.slice(0, -1) : episodes;
    const ref = done[done.length - 1];
    if (ref) {
      lines.push(
        `Dernière fois au-dessus du seuil : ${fmtDay(ref.start)}, de ${fmtTime(ref.start)} à ${fmtTime(ref.end)} ` +
          `(${fmtDuration(ref.duration)}), pic ${fmtQ(ref.peak.v)} à ${fmtTime(ref.peak.t)}.`,
      );
    }
    lines.push("");
    lines.push(
      `${episodes.length} épisode(s) en ${jours} jours · durée médiane ${fmtDuration(median(episodes.map((e) => e.duration)))} · ` +
        `pic médian ${fmtQ(median(episodes.map((e) => e.peak.v)))}`,
    );
    lines.push("Derniers épisodes :");
    for (const e of episodes.slice(-6).reverse()) {
      lines.push(`  - ${fmtDay(e.start)} ${fmtTime(e.start)} → ${fmtTime(e.end)} (${fmtDuration(e.duration)}), pic ${fmtQ(e.peak.v)}`);
    }
    if (episodes.length >= 4) {
      const hours = countBy(episodes, (e) => Number(hourFmt.formatToParts(e.start).find((x) => x.type === "hour").value));
      const topHours = [...hours.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      lines.push(`Heures de début les plus fréquentes : ${topHours.map(([h, n]) => `${h} h (${n} fois)`).join(", ")}`);
      const days = countBy(episodes, (e) => weekdayFmt.format(e.start));
      lines.push(`Par jour de la semaine : ${WEEKDAYS.map((d) => `${d} ${days.get(d) || 0}`).join(" · ")}`);
      lines.push("Ces régularités ne garantissent pas les prochains lâchers : les horaires dépendent de l'exploitant.");
    }
  }
  if (suisse) lines.push("", SOURCE_OFEV);
  return lines.join("\n");
}

/** Épisodes consécutifs au-dessus du seuil ; les trous de mesure courts ne coupent pas un épisode. */
function findEpisodes(s, seuil, maxGap, step) {
  const episodes = [];
  let cur = null;
  let prev = null;
  for (const p of s) {
    if (p.v > seuil) {
      if (cur && p.t - prev.t <= maxGap) {
        cur.end = p.t;
        if (p.v > cur.peak.v) cur.peak = p;
      } else {
        if (cur) episodes.push(cur);
        cur = { start: p.t, end: p.t, peak: p };
      }
      prev = p;
    } else if (cur) {
      episodes.push(cur);
      cur = null;
    }
  }
  if (cur) episodes.push(cur);
  for (const e of episodes) e.duration = e.end - e.start + step;
  return episodes;
}

/** Au-delà de la fenêtre détaillée : dernier jour dont le débit maximal a dépassé le seuil (France, un an). */
async function lastHighDay(code, seuil, before) {
  const fin = dayKey(before);
  const debut = shiftDay(fin, -365);
  try {
    const res = await hubeau("/obs_elab", {
      code_entite: code,
      grandeur_hydro_elab: "QIXnJ",
      date_debut_obs_elab: debut,
      date_fin_obs_elab: fin,
      size: 1000,
      fields: "date_obs_elab,resultat_obs_elab",
    });
    const hits = (res.data || [])
      .filter((r) => r.resultat_obs_elab > seuil)
      .sort((a, b) => (a.date_obs_elab < b.date_obs_elab ? -1 : 1));
    if (hits.length === 0) return `Aucun maximum journalier au-dessus du seuil sur l'année précédente non plus.`;
    const h = hits[hits.length - 1];
    return `Avant cela, dernier jour avec un pic au-dessus du seuil : ${frDate(h.date_obs_elab)} (maximum ${fmtQ(h.resultat_obs_elab)}).`;
  } catch {
    return "Historique journalier indisponible pour remonter plus loin.";
  }
}

function median(values) {
  if (!values.length) return 0;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function countBy(items, key) {
  const m = new Map();
  for (const it of items) m.set(key(it), (m.get(key(it)) || 0) + 1);
  return m;
}
function fmtDuration(ms) {
  const totalMin = Math.round(ms / MIN);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? (m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`) : `${m} min`;
}
const fmtDayTime = (t) => `${fmtDay(t)} ${fmtTime(t)}`;

// --- suisse_chercher_stations ----------------------------------------------
async function suisseChercherStations(args) {
  const riviere = clean(args.riviere);
  const lieu = clean(args.lieu);

  if (!riviere && !lieu) {
    return (
      "Stations suisses favorites :\n" +
      SUISSE_FAVORIS.map((f) => `- ${f.id} — ${f.nom}`).join("\n") +
      "\n\nPour une autre station, filtre par rivière ou par lieu.\n" + SOURCE_OFEV
    );
  }

  const stations = Object.entries(await suisseLocations()).map(([id, s]) => ({
    id,
    nom: s.name || s.details?.name || "",
    eau: s.details?.["water-body-name"] || "",
    type: s.details?.["water-body-type"] === "lake" ? "lac" : "rivière",
  }));
  let found = stations;
  if (riviere) found = found.filter((s) => norm(s.eau).includes(norm(riviere)));
  if (lieu) found = found.filter((s) => norm(s.nom).includes(norm(lieu)));
  if (found.length === 0) return "Aucune station suisse ne correspond à cette recherche.\n" + SOURCE_OFEV;

  const MAX = 60;
  let out =
    `${found.length} station(s) :\n` +
    found.slice(0, MAX).map((s) => `- ${s.id} — ${s.nom} (${s.eau || "?"}, ${s.type})`).join("\n");
  if (found.length > MAX) out += `\n… et ${found.length - MAX} autres : affine la recherche.`;
  return `${out}\n\n${SOURCE_OFEV}`;
}

// --- suisse_niveau_actuel ---------------------------------------------------
async function suisseNiveauActuel(args) {
  let ids;
  if (Array.isArray(args.stations) && args.stations.length > 0) {
    ids = [...new Set(args.stations.map(checkSwissId))];
    if (ids.length > 20) throw new Error("20 stations maximum par appel.");
  } else if (clean(args.riviere)) {
    const r = norm(args.riviere);
    ids = SUISSE_FAVORIS.filter((f) => norm(f.riviere + " " + f.nom).includes(r)).map((f) => f.id);
    if (ids.length === 0) {
      throw new Error(`« ${args.riviere} » n'est pas dans les favoris suisses : cherche la station avec suisse_chercher_stations.`);
    }
  } else {
    ids = SUISSE_FAVORIS.map((f) => f.id);
  }

  const now = Date.now();
  const unknown = ids.filter((id) => !SUISSE_FAVORIS.some((f) => f.id === id));
  const [data, locations] = await Promise.all([
    existenz("/daterange", { locations: ids, parameters: "flow,height,temperature", startdate: "-4 hours", enddate: "now" }),
    unknown.length ? suisseLocations().catch(() => ({})) : {},
  ]);

  const series = swissSeries(data.payload || []);
  const blocks = ids.map((id) => {
    const nom = SUISSE_FAVORIS.find((f) => f.id === id)?.nom || locations[id]?.name || "Station";
    const lines = [];
    for (const g of ["Q", "H", "T"]) {
      const s = series.get(`${id}|${g}`);
      if (s && s.length) lines.push("  " + describeLatest(g, s, now));
    }
    if (lines.length === 0) lines.push("  Aucune mesure sur les 4 dernières heures (numéro inconnu ou station muette).");
    return `${nom} (${id})\n${lines.join("\n")}`;
  });

  return (
    `Mesures OFEV, heure de Paris (consultées le ${fmtDateTime(now)}) :\n\n${blocks.join("\n\n")}\n\n` +
    `En Suisse, la hauteur est l'altitude du plan d'eau (m) : seules ses variations comptent.\n${SOURCE_OFEV}`
  );
}

// --- suisse_historique ------------------------------------------------------
const SWISS_PARAMS = { debit: ["flow"], hauteur: ["height"], temperature: ["temperature"], tout: ["flow", "height", "temperature"] };

async function suisseHistorique(args) {
  const id = checkSwissId(args.station);
  const jours = Math.min(31, Math.max(1, Math.round(Number(args.jours) || 3)));
  const params = SWISS_PARAMS[args.grandeur] || SWISS_PARAMS.tout;

  const [data, locations] = await Promise.all([
    existenz("/daterange", { locations: id, parameters: params.join(","), startdate: `-${jours} days`, enddate: "now" }),
    SUISSE_FAVORIS.some((f) => f.id === id) ? {} : suisseLocations().catch(() => ({})),
  ]);
  const nom = SUISSE_FAVORIS.find((f) => f.id === id)?.nom || locations[id]?.name || "Station";
  const series = swissSeries(data.payload || []);
  const sections = params.map((p) => summarizeSeries(SWISS_PAR[p], series.get(`${id}|${SWISS_PAR[p]}`) || []));

  return (
    `${nom} (${id}) — ${jours} dernier(s) jour(s), heure de Paris\n\n${sections.join("\n\n")}\n\n` +
    (params.includes("height") ? "La hauteur est l'altitude du plan d'eau (m) : seules ses variations comptent.\n" : "") +
    SOURCE_OFEV
  );
}

// Paramètre OFEV → grandeur interne. Les valeurs sont converties dans les unités
// Hub'Eau (l/s et mm) pour réutiliser les mêmes calculs et la même mise en forme.
const SWISS_PAR = { flow: "Q", height: "H", temperature: "T" };
const SWISS_FACTOR = { Q: 1000, H: 1000, T: 1 };

function swissSeries(payload) {
  const map = new Map();
  for (const r of payload) {
    const g = SWISS_PAR[r.par];
    if (!g || typeof r.val !== "number" || !r.timestamp) continue;
    const key = `${r.loc}|${g}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ t: r.timestamp * 1000, v: r.val * SWISS_FACTOR[g] });
  }
  for (const s of map.values()) s.sort((a, b) => a.t - b.t);
  return map;
}

// ---------------------------------------------------------------------------
// Accès à api.existenz.ch (OFEV)
// ---------------------------------------------------------------------------
async function existenz(path, params) {
  const query = Object.entries({ ...params, app: "vigicrues-mcp", version: SERVER_INFO.version })
    .map(([k, v]) => `${k}=${(Array.isArray(v) ? v.join(",") : String(v)).split(",").map(encodeURIComponent).join(",")}`)
    .join("&");
  const res = await fetch(`${EXISTENZ}${path}?${query}`, {
    headers: { Accept: "application/json", "User-Agent": "vigicrues-mcp/1.1 (Cloudflare Worker)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`api.existenz.ch a répondu ${res.status}${detail ? ` : ${detail}` : ""}`);
  }
  return res.json();
}

// La liste des stations change rarement : on la garde 24 h en mémoire du Worker.
let locationsCache = { at: 0, data: null };
async function suisseLocations() {
  if (locationsCache.data && Date.now() - locationsCache.at < DAY) return locationsCache.data;
  const res = await existenz("/locations", {});
  locationsCache = { at: Date.now(), data: res.payload || {} };
  return locationsCache.data;
}

function checkSwissId(id) {
  const c = String(id || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(c)) throw new Error(`Numéro de station suisse invalide : « ${id} » (attendu : 4 caractères, ex. 2170).`);
  return c;
}

// ---------------------------------------------------------------------------
// Accès à Hub'Eau
// ---------------------------------------------------------------------------
async function hubeau(path, params) {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => {
      const value = Array.isArray(v) ? v.map((x) => encodeURIComponent(x)).join(",") : encodeURIComponent(v);
      return `${k}=${value.replace(/%2C/gi, ",").replace(/%3A/gi, ":")}`;
    })
    .join("&");
  const res = await fetch(`${HUBEAU}${path}?${query}`, {
    headers: { Accept: "application/json", "User-Agent": "vigicrues-mcp/1.0 (Cloudflare Worker)" },
    signal: AbortSignal.timeout(20000),
  });
  // 200 = complet, 206 = résultats partiels (pagination)
  if (res.status !== 200 && res.status !== 206) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`Hub'Eau a répondu ${res.status}${detail ? ` : ${detail}` : ""}`);
  }
  return res.json();
}

async function stationNames(codes) {
  if (!codes.length) return {};
  try {
    const data = await hubeau("/referentiel/stations", {
      code_station: codes,
      size: codes.length,
      fields: "code_station,libelle_station",
    });
    return Object.fromEntries((data.data || []).map((s) => [s.code_station, s.libelle_station]));
  } catch {
    return {}; // le nom est un confort : on ne bloque pas la réponse pour ça
  }
}

// ---------------------------------------------------------------------------
// Calculs et mise en forme
// ---------------------------------------------------------------------------
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Regroupe les observations par station et grandeur, triées par date croissante. */
function groupSeries(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.resultat_obs == null || !r.date_obs) continue;
    const key = `${r.code_station}|${r.grandeur_hydro}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ t: Date.parse(r.date_obs), v: r.resultat_obs, q: r.libelle_qualification_obs });
  }
  for (const s of map.values()) s.sort((a, b) => a.t - b.t);
  return map;
}

/** Moyenne des points autour d'un instant, pour lisser le bruit des mesures toutes les 5 min. */
function meanAround(s, center, halfWindow, mode = "both") {
  const pts = s.filter((p) => (mode === "before" ? p.t <= center && p.t >= center - halfWindow : Math.abs(p.t - center) <= halfWindow));
  return pts.length ? pts.reduce((a, p) => a + p.v, 0) / pts.length : null;
}

function fmtDelta(g, now, past) {
  // Arrondi d'abord, signe ensuite : évite les « −0 % ».
  const signed = (x, digits) => {
    const r = Number(x.toFixed(digits));
    return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${fmtNum(Math.abs(r), digits)}`;
  };
  if (g === "Q") {
    if (past <= 0) return "n.d.";
    return `${signed(((now - past) / past) * 100, 0)} %`;
  }
  if (g === "T") return `${signed(now - past, 1)} °C`;
  return `${signed((now - past) / 10, 0)} cm`;
}

function trend(g, now, past) {
  let x;
  let th;
  if (g === "Q") {
    if (past <= 0) return "tendance n.d.";
    x = (now - past) / past; // relatif
    th = [0.05, 0.2, 0.5];
  } else if (g === "T") {
    x = now - past; // °C
    th = [0.3, 1, 3];
  } else {
    x = (now - past) / 1000; // mètres
    th = [0.02, 0.1, 0.3];
  }
  const a = Math.abs(x);
  if (a < th[0]) return "stable";
  const dir = x > 0 ? "hausse" : "baisse";
  if (a < th[1]) return `légère ${dir}`;
  if (a < th[2]) return dir;
  return `forte ${dir}`;
}

function fmtNum(v, digits) {
  return v.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtQ(ls) {
  const m3 = ls / 1000;
  return `${fmtNum(m3, m3 < 10 ? 2 : m3 < 100 ? 1 : 0)} m³/s`;
}
function fmtH(mm) {
  return `${fmtNum(mm / 1000, 2)} m`;
}
function fmtT(c) {
  return `${fmtNum(c, 1)} °C`;
}
const LABELS = { Q: "Débit", H: "Hauteur", T: "Température de l'eau" };
const FORMATS = { Q: fmtQ, H: fmtH, T: fmtT };

const timeFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });
const keyFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "numeric", hourCycle: "h23" });
const weekdayFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "short" });
const WEEKDAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

const fmtTime = (t) => timeFmt.format(t);
const fmtDateTime = (t) => dateTimeFmt.format(t).replace(",", "");
const fmtDay = (t) => dayFmt.format(t);
const dayKey = (t) => keyFmt.format(t); // AAAA-MM-JJ, heure de Paris
const frDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const shiftDay = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

function isFavori(code) {
  return FAVORIS.some((f) => f.code === code);
}
function checkCode(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{8,10}$/.test(c)) throw new Error(`Code station invalide : « ${code} » (attendu : 10 caractères, ex. V020542201).`);
  return c;
}
function checkDate(d) {
  const s = String(d).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Error(`Date invalide : « ${d} » (format AAAA-MM-JJ).`);
  return s;
}
function clean(v) {
  return typeof v === "string" ? v.trim() : "";
}
function norm(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
function titleCase(s) {
  return String(s || "").toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, p, l) => p + l.toUpperCase());
}
