// ============================================================
//  fetch-art.js — baja los backdrops de las series/pelis mas
//  caracteristicas de cada servicio desde TMDB y actualiza config.json.
//
//  Uso:
//    node fetch-art.js TU_API_KEY_DE_TMDB
//  (o)  TMDB_KEY=... node fetch-art.js
//
//  La API key gratuita se saca en https://www.themoviedb.org/settings/api
//  (registrate gratis -> API -> "Create" -> copia la "API Key (v3 auth)").
// ============================================================

const fs = require("fs");
const path = require("path");
const https = require("https");

const KEY = process.argv[2] || process.env.TMDB_KEY;
if (!KEY) {
  console.error(
    "Falta la API key. Uso: node fetch-art.js TU_API_KEY  (o TMDB_KEY=... node fetch-art.js)"
  );
  process.exit(1);
}

// Titulo caracteristico por servicio (id de config -> {tipo, titulo}).
const PICKS = {
  netflix: { type: "tv", title: "Stranger Things" },
  disney: { type: "tv", title: "The Mandalorian" },
  prime: { type: "tv", title: "The Boys" },
  max: { type: "tv", title: "House of the Dragon" },
  paramount: { type: "tv", title: "Star Trek: Strange New Worlds" },
  appletv: { type: "tv", title: "Severance" },
  crunchyroll: { type: "tv", title: "Demon Slayer: Kimetsu no Yaiba" },
};

const IMG_BASE = "https://image.tmdb.org/t/p/original";
const ART_DIR = path.join(__dirname, "assets", "art");

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error("HTTP " + res.statusCode));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
      })
      .on("error", (e) => {
        fs.unlink(dest, () => {});
        reject(e);
      });
  });
}

async function main() {
  fs.mkdirSync(ART_DIR, { recursive: true });
  const cfgPath = path.join(__dirname, "config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));

  for (const app of cfg.apps) {
    const pick = PICKS[app.id];
    if (!pick) continue;
    try {
      const q = encodeURIComponent(pick.title);
      const search = await getJSON(
        `https://api.themoviedb.org/3/search/${pick.type}?api_key=${KEY}&query=${q}`
      );
      const hit = (search.results || [])[0];
      if (!hit || !hit.backdrop_path) {
        console.warn(`  ${app.id}: sin backdrop para "${pick.title}"`);
        continue;
      }
      const url = IMG_BASE + hit.backdrop_path;
      const dest = path.join(ART_DIR, app.id + ".jpg");
      await download(url, dest);
      app.art = "../assets/art/" + app.id + ".jpg";
      app.artTitle = hit.name || hit.title || pick.title;
      console.log(`  ${app.id}: OK -> ${app.artTitle}`);
    } catch (e) {
      console.warn(`  ${app.id}: error (${e.message})`);
    }
  }

  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  console.log("Listo. config.json actualizado con el arte descargado.");
}

main();
