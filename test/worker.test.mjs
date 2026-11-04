// Tests locaux du serveur MCP, avec des réponses Hub'Eau et OFEV simulées.
// Lancer :  npm test   (ou  node test/worker.test.mjs)
import worker from "../worker.js";
import assert from "node:assert/strict";

const calls = [];
const NOW = Date.now();
const iso = (t) => new Date(t).toISOString().slice(0, 19) + "Z";

function obsSeries(code, g, from, to, stepMin, f) {
  const out = [];
  for (let t = Math.ceil(from / (stepMin * 60000)) * stepMin * 60000; t <= to; t += stepMin * 60000) {
    out.push({ code_station: code, grandeur_hydro: g, date_obs: iso(t), resultat_obs: Math.round(f(t)), libelle_qualification_obs: "Non qualifiée" });
  }
  return out;
}

globalThis.fetch = async (url) => {
  const u = new URL(url);
  calls.push(url);
  const p = u.searchParams;
  let body;
  if (u.pathname.endsWith("/referentiel/stations")) {
    if (p.get("code_departement") === "74") {
      body = { count: 3, data: [
        { code_station: "V020542201", libelle_station: "L'Arve à Bonneville", libelle_cours_eau: "L'Arve", libelle_commune: "BONNEVILLE", code_departement: "74" },
        { code_station: "V020501002", libelle_station: "Le Bronze à Bonneville - Pont", libelle_cours_eau: "Le Bronze", libelle_commune: "BONNEVILLE", code_departement: "74" },
        { code_station: "V125501001", libelle_station: "Le Chéran à Allèves [La Charniaz]", libelle_cours_eau: "Le Chéran", libelle_commune: "ALLEVES", code_departement: "74" },
      ] };
    } else if (p.get("code_station")) {
      body = { count: 1, data: p.get("code_station").split(",").map((c) => ({ code_station: c, libelle_station: "Station inconnue test " + c })) };
    } else {
      body = { count: 0, data: [] };
    }
  } else if (u.pathname.endsWith("/observations_tr")) {
    const codes = p.get("code_entite").split(",");
    const from = Date.parse(p.get("date_debut_obs"));
    const lastObs = NOW - 20 * 60000;
    let data = [];
    if (p.get("timestep") === "60") {
      const g = p.get("grandeur_hydro");
      data = obsSeries(codes[0], g, from, lastObs, 60, (t) => (g === "Q" ? 15000 + 5000 * Math.sin((t - from) / 86400000 * Math.PI) : 150 + 20 * Math.sin((t - from) / 86400000 * Math.PI)));
      data.sort(() => Math.random() - 0.5); // Hub'Eau renvoie un ordre non chronologique avec timestep
    } else {
      for (const c of codes) {
        if (c === "V032501001") continue; // station muette
        // débit en hausse : 15 m³/s il y a 4 h -> ~19,3 m³/s, avec bruit
        data.push(...obsSeries(c, "H", from, lastObs, 5, (t) => 140 + 21 * (t - from) / (lastObs - from)));
        if (c !== "V003201001") data.push(...obsSeries(c, "Q", from, lastObs, 5, (t) => 15000 + 4300 * (t - from) / (lastObs - from) + (Math.random() - 0.5) * 800));
      }
      data.sort((a, b) => (a.date_obs < b.date_obs ? 1 : -1));
      if (codes.includes("V033401001")) data.find((d) => d.code_station === "V033401001" && d.grandeur_hydro === "Q").libelle_qualification_obs = "Douteuse";
    }
    body = { count: data.length, data };
  } else if (u.pathname.endsWith("/obs_elab")) {
    const d0 = Date.parse(p.get("date_debut_obs_elab"));
    const d1 = Date.parse(p.get("date_fin_obs_elab"));
    const data = [];
    for (let t = d0; t <= d1 - 5 * 86400000; t += 86400000) {
      data.push({ code_station: p.get("code_entite"), date_obs_elab: new Date(t).toISOString().slice(0, 10), resultat_obs_elab: 20000 + (t % 7) * 1000, libelle_statut: "Donnée pré-validée" });
    }
    data.reverse();
    body = { count: data.length, data };
  } else if (u.hostname === "api.existenz.ch" && u.pathname.endsWith("/locations")) {
    body = { source: "BAFU", payload: {
      2170: { id: 1, name: "Genève, Bout du Monde", details: { id: "2170", name: "Genève, Bout du Monde", "water-body-name": "Arve", "water-body-type": "river" } },
      2053: { id: 2, name: "Martigny, Pont de Rossettan", details: { id: "2053", name: "Martigny, Pont de Rossettan", "water-body-name": "Drance", "water-body-type": "river" } },
      2117: { id: 3, name: "Le Châble, Villette", details: { id: "2117", name: "Le Châble, Villette", "water-body-name": "Drance de Bagnes", "water-body-type": "river" } },
      2208: { id: 4, name: "Genève, Lac Léman", details: { id: "2208", name: "Genève", "water-body-name": "Lac Léman", "water-body-type": "lake" } },
      2999: { id: 5, name: "Station test", details: { id: "2999", name: "Station test", "water-body-name": "Testbach", "water-body-type": "river" } },
    } };
  } else if (u.hostname === "api.existenz.ch" && u.pathname.endsWith("/daterange")) {
    assert.equal(p.get("app"), "vigicrues-mcp");
    const locs = p.get("locations").split(",");
    const pars = p.get("parameters").split(",");
    const m = /^-(\d+) (hours|days)$/.exec(p.get("startdate"));
    assert.ok(m, "startdate relative attendue, reçu " + p.get("startdate"));
    const span = Number(m[1]) * (m[2] === "hours" ? 3600e3 : 86400e3);
    const end = Math.floor((NOW - 10 * 60e3) / 600e3) * 600e3;
    const payload = [];
    for (const loc of locs) {
      if (loc === "2117") continue; // station muette
      for (const par of pars) {
        if (loc === "2606" && par !== "temperature") continue; // Genève Halle de l'Île : température seule
        for (let t = end - span; t <= end; t += 600e3) {
          const x = (t - (end - span)) / span; // 0 → 1
          const val = par === "flow" ? 15 + 4 * x : par === "height" ? 378.5 + 0.3 * x : 8.2 - 0.6 * x;
          payload.push({ timestamp: t / 1000, loc, par, val: Math.round(val * 100) / 100 });
        }
      }
    }
    body = { source: "BAFU", payload };
  } else {
    return new Response("not found", { status: 404 });
  }
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};

async function rpc(payload, env = {}, path = "/mcp") {
  const res = await worker.fetch(new Request("https://vigicrues.example.workers.dev" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  }), env);
  const text = await res.text();
  const type = res.headers.get("content-type") || "";
  return { status: res.status, type, body: text && type.includes("json") ? JSON.parse(text) : text || null };
}
const call = async (name, args) => (await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } })).body.result;

// 1. Protocole
let r = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
assert.equal(r.status, 200);
assert.match(r.type, /application\/json/);
assert.equal(r.body.result.protocolVersion, "2025-06-18");
assert.ok(r.body.result.capabilities.tools);
r = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
assert.equal(r.body.result.protocolVersion, "2025-11-25");
r = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
assert.equal(r.status, 202);
assert.equal(r.body, null);
r = await rpc({ jsonrpc: "2.0", id: 2, method: "ping" });
assert.deepEqual(r.body.result, {});
r = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" });
const names = r.body.result.tools.map((t) => t.name);
assert.deepEqual(names, [
  "chercher_stations", "niveau_actuel", "historique", "debits_journaliers",
  "suisse_chercher_stations", "suisse_niveau_actuel", "suisse_historique",
]);
for (const t of r.body.result.tools) {
  assert.equal(t.inputSchema.type, "object");
  assert.equal(typeof t.description, "string");
  assert.ok(!("run" in t));
}
r = await rpc({ jsonrpc: "2.0", id: 4, method: "resources/list" });
assert.equal(r.body.error.code, -32601);
r = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "inconnu", arguments: {} } });
assert.equal(r.body.error.code, -32602);
r = await rpc("{pas du json");
assert.equal(r.status, 400);
assert.equal(r.body.error.code, -32700);
r = await rpc([{ jsonrpc: "2.0", id: 6, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }]);
assert.ok(Array.isArray(r.body) && r.body.length === 1);

const get = await worker.fetch(new Request("https://x.workers.dev/mcp"), {});
assert.equal(get.status, 405);
const opt = await worker.fetch(new Request("https://x.workers.dev/mcp", { method: "OPTIONS" }), {});
assert.equal(opt.status, 204);
const root = await worker.fetch(new Request("https://x.workers.dev/"), {});
assert.match(await root.text(), /\/mcp/);
// clé facultative
r = await rpc({ jsonrpc: "2.0", id: 7, method: "ping" }, { CLE: "secret" });
assert.equal(r.status, 403);
r = await rpc({ jsonrpc: "2.0", id: 7, method: "ping" }, { CLE: "secret" }, "/mcp?cle=secret");
assert.equal(r.status, 200);
console.log("✓ protocole MCP");

// 2. Outils
let out = await call("chercher_stations", {});
assert.match(out.content[0].text, /V033401001/);
console.log("\n--- chercher_stations (favoris) ---\n" + out.content[0].text.split("\n").slice(0, 5).join("\n") + "\n…");

out = await call("chercher_stations", { departement: "74", riviere: "arve" });
console.log("\n--- chercher_stations 74 / arve ---\n" + out.content[0].text);
assert.match(out.content[0].text, /V020542201/);
assert.doesNotMatch(out.content[0].text, /Bronze/);

out = await call("chercher_stations", { riviere: "Loire" });
assert.equal(out.isError, true);

calls.length = 0;
out = await call("niveau_actuel", { riviere: "Dranse" });
console.log("\n--- niveau_actuel Dranse ---\n" + out.content[0].text);
assert.match(out.content[0].text, /Débit : 19,\d m³\/s/);
assert.match(out.content[0].text, /douteuse/);
assert.match(out.content[0].text, /hausse/);
console.log("URL appelée :", calls[0]);
assert.match(calls[0], /code_entite=V033401001,V031401002&/);
assert.match(calls[0], /fields=code_station,grandeur_hydro,date_obs,resultat_obs,libelle_qualification_obs/);

out = await call("niveau_actuel", { stations: ["v032501001", "V003201001", "Y999999999"] });
console.log("\n--- niveau_actuel codes libres ---\n" + out.content[0].text);
assert.match(out.content[0].text, /Aucune mesure/);
assert.match(out.content[0].text, /Station inconnue test Y999999999/);

out = await call("niveau_actuel", {});
assert.equal((out.content[0].text.match(/\(V|\(W|\(X/g) || []).length, 20);

out = await call("niveau_actuel", { stations: ["pas-un-code"] });
assert.equal(out.isError, true);

calls.length = 0;
out = await call("historique", { station: "V020542201", jours: 3 });
console.log("\n--- historique Arve Bonneville 3 j ---\n" + out.content[0].text);
assert.match(out.content[0].text, /Par jour/);
assert.match(calls.find((c) => c.includes("grandeur_hydro=Q")), /timestep=60/);

out = await call("debits_journaliers", { station: "V033401001", date_debut: "2026-05-01", date_fin: "2026-05-20" });
console.log("\n--- debits_journaliers Dranse mai 2026 ---\n" + out.content[0].text);
assert.match(out.content[0].text, /01\/05\/2026/);

out = await call("debits_journaliers", { station: "V033401001", date_debut: "2025-06-01", date_fin: "2026-06-01" });
assert.match(out.content[0].text, /moyenne/);
console.log("\n--- debits_journaliers 1 an (extrait) ---\n" + out.content[0].text.split("\n").slice(0, 6).join("\n") + "\n…");

out = await call("debits_journaliers", { station: "V033401001", date_debut: "2020-01-01", date_fin: "2026-01-01" });
assert.equal(out.isError, true);
out = await call("debits_journaliers", { station: "V033401001", date_debut: "01/05/2026" });
assert.equal(out.isError, true);

// 3. Suisse (OFEV)
out = await call("suisse_chercher_stations", {});
assert.match(out.content[0].text, /2170 — L'Arve à Genève/);
assert.match(out.content[0].text, /OFEV/);

out = await call("suisse_chercher_stations", { riviere: "drance" });
console.log("\n--- suisse_chercher_stations drance ---\n" + out.content[0].text);
assert.match(out.content[0].text, /2053/);
assert.match(out.content[0].text, /2117/);
assert.doesNotMatch(out.content[0].text, /2170/);

calls.length = 0;
out = await call("suisse_niveau_actuel", { riviere: "Arve" });
console.log("\n--- suisse_niveau_actuel Arve ---\n" + out.content[0].text);
assert.match(out.content[0].text, /Débit : 19,0 m³\/s/);
assert.match(out.content[0].text, /Hauteur : 378,80 m/);
assert.match(out.content[0].text, /Température de l'eau : 7,6 °C/);
assert.match(out.content[0].text, /−0,\d °C/);
assert.match(out.content[0].text, /Source : OFEV/);
assert.match(calls[0], /locations=2170&parameters=flow,height,temperature&startdate=-4%20hours&enddate=now&app=vigicrues-mcp/);

out = await call("suisse_niveau_actuel", { stations: ["2606", "2117", "2999"] });
console.log("\n--- suisse_niveau_actuel codes libres ---\n" + out.content[0].text);
assert.match(out.content[0].text, /Le Rhône à Genève, Halle de l'Île \(2606\)\n  Température/);
assert.match(out.content[0].text, /Aucune mesure/);
assert.match(out.content[0].text, /Station test \(2999\)/);

out = await call("suisse_niveau_actuel", {});
assert.equal((out.content[0].text.match(/\(\d{4}\)\n/g) || []).length, 12);

out = await call("suisse_niveau_actuel", { stations: ["21"] });
assert.equal(out.isError, true);
out = await call("suisse_niveau_actuel", { riviere: "Doubs" });
assert.equal(out.isError, true);

out = await call("suisse_historique", { station: "2170", jours: 2 });
console.log("\n--- suisse_historique Arve Genève 2 j ---\n" + out.content[0].text);
assert.match(out.content[0].text, /Débit — actuel 19,0 m³\/s/);
assert.match(out.content[0].text, /Température de l'eau — actuel/);
assert.match(out.content[0].text, /Dernières 24 h \(toutes les 2 h\) : (\d\d:\d\d [^·]+ · ){12}\d\d:\d\d/);

out = await call("suisse_historique", { station: "2170", jours: 31, grandeur: "temperature" });
assert.doesNotMatch(out.content[0].text, /Débit/);
assert.match(out.content[0].text, /Température de l'eau — actuel/);

// 4. Erreur Hub'Eau propagée proprement
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response("Service indisponible", { status: 503 });
out = await call("niveau_actuel", { riviere: "Arve" });
assert.equal(out.isError, true);
assert.match(out.content[0].text, /503/);
globalThis.fetch = realFetch;

console.log("\n✓ tous les tests passent");
