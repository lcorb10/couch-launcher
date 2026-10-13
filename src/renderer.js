// ============================================================
//  Couch Launcher — renderer (logica de la interfaz)
//  Maneja: navegacion con mouse/mando, apertura de servicios,
//  y el teclado en pantalla que aparece/desaparece solo.
// ============================================================

const cfg = window.launcher.getConfig();
const APPS = cfg.apps || [];

// Estado global: 'launcher' | 'app' | 'keyboard'
let mode = "launcher";
let focusIndex = 0; // tarjeta enfocada dentro de la lista filtrada
let zone = "dock"; // 'dock' | 'tabs' (dentro del launcher)
let filter = "all"; // categoria activa
let tabIndex = 0; // pestana enfocada
let currentList = []; // apps visibles segun la categoria

// --- Elementos DOM ---
const rail = document.getElementById("rail");
const tabsEl = document.getElementById("tabs");
const launcherScreen = document.getElementById("launcher");
const appScreen = document.getElementById("app-view");
const backHint = document.getElementById("back-hint");
const keyboardEl = document.getElementById("keyboard");
const kbGrid = document.getElementById("kb-grid");
const kbPreview = document.getElementById("kb-preview");
const heroBg = document.getElementById("hero-bg");
const heroArt = document.getElementById("hero-art");
const heroLogo = document.getElementById("hero-logo");
const heroTitle = document.getElementById("hero-title");
const heroDesc = document.getElementById("hero-desc");
const heroOpen = document.getElementById("hero-open");

// ============================================================
//  1) CATEGORIAS, TABS, TARJETAS Y HERO
// ============================================================
const CAT_LABELS = {
  all: "Todo",
  video: "Video",
  music: "Música",
  live: "En vivo",
  apps: "Apps",
};

function remoteFavicon(app) {
  try {
    const host = new URL(app.url).hostname;
    return `https://www.google.com/s2/favicons?sz=128&domain=${host}`;
  } catch (_) {
    return "";
  }
}

// Cadena de respaldo del logo: local -> favicon remoto -> letra.
function wireLogoFallback(imgEl, letterEl, app) {
  let triedRemote = false;
  imgEl.addEventListener("error", () => {
    const fb = remoteFavicon(app);
    if (!triedRemote && fb && imgEl.getAttribute("src") !== fb) {
      triedRemote = true;
      imgEl.setAttribute("src", fb);
      return;
    }
    imgEl.hidden = true;
    if (letterEl) letterEl.hidden = false;
  });
}

function categories() {
  const present = [];
  ["video", "music", "live", "apps"].forEach((c) => {
    if (APPS.some((a) => a.category === c)) present.push(c);
  });
  return ["all", ...present];
}

function buildTabs() {
  tabsEl.innerHTML = "";
  categories().forEach((cat, i) => {
    const t = document.createElement("div");
    t.className = "tab" + (cat === filter ? " is-active" : "");
    t.textContent = CAT_LABELS[cat] || cat;
    t.dataset.cat = cat;
    t.dataset.index = i;
    t.addEventListener("click", () => setTab(i));
    t.addEventListener("mouseenter", () => {
      if (zone === "tabs") setTabFocus(i);
    });
    tabsEl.appendChild(t);
  });
}

function applyFilter() {
  currentList = APPS.filter((a) => filter === "all" || a.category === filter);
}

function buildCards() {
  applyFilter();
  rail.innerHTML = "";
  currentList.forEach((app, i) => {
    const cell = document.createElement("div");
    cell.className = "card-cell" + (app.wip ? " is-wip" : "");
    cell.style.setProperty("--tile-color", app.color || "#4fe3d8");
    const primary = app.logo || remoteFavicon(app);
    cell.innerHTML = `
      <div class="card">
        <img class="logo" alt="" src="${primary}" />
        <span class="letter" hidden>${(app.name || "?").charAt(0)}</span>
        ${app.wip ? '<span class="wip-badge">En desarrollo</span>' : ""}
      </div>
      <span class="card-name">${app.name || ""}</span>
    `;
    wireLogoFallback(
      cell.querySelector(".logo"),
      cell.querySelector(".letter"),
      app
    );
    cell.addEventListener("mouseenter", () => {
      zone = "dock";
      setFocus(i);
    });
    cell.addEventListener("click", () => openApp(app));
    rail.appendChild(cell);
  });
  if (focusIndex >= currentList.length) focusIndex = 0;
  setFocus(focusIndex);
}

function setFocus(i) {
  if (currentList.length === 0) return;
  focusIndex = Math.max(0, Math.min(i, currentList.length - 1));
  const cells = rail.querySelectorAll(".card-cell");
  cells.forEach((c, idx) =>
    c.classList.toggle("is-focused", idx === focusIndex && zone === "dock")
  );
  updateHero(currentList[focusIndex]);

  // Centrar la tarjeta enfocada en el riel.
  const cell = cells[focusIndex];
  if (cell) {
    const wrapW = rail.parentElement.getBoundingClientRect().width;
    const center = cell.offsetLeft + cell.offsetWidth / 2;
    const shift = wrapW / 2 - center;
    rail.style.transform = `translateX(${Math.min(0, shift)}px)`;
  }
}

const heroEl = document.getElementById("hero");
const heroPhoto = document.getElementById("hero-photo");

function updateHero(app) {
  if (!app) return;
  const color = app.color || "#4fe3d8";
  document.documentElement.style.setProperty("--accent", color);
  heroTitle.textContent = app.name || "";
  heroDesc.textContent = app.artTitle || app.desc || "";
  // Boton del hero: "En desarrollo" (deshabilitado) para apps wip.
  if (app.wip) {
    heroOpen.innerHTML = "🚧 En desarrollo";
    heroOpen.classList.add("is-disabled");
  } else {
    heroOpen.innerHTML = '<span class="play">▶</span> Abrir';
    heroOpen.classList.remove("is-disabled");
  }
  const src = app.logo || remoteFavicon(app);
  heroLogo.src = src;
  heroLogo.style.display = "";
  heroArt.src = src;

  // Foto de la serie/pelicula caracteristica (config "art"), si existe.
  // Se precarga: solo se muestra si carga bien; si falta/falla, se queda el
  // gradiente de marca (nunca se ve roto).
  heroEl.classList.remove("has-art", "art-portrait");
  heroPhoto.style.backgroundImage = "";
  if (app.art) {
    const probe = new Image();
    probe.onload = () => {
      if (currentList[focusIndex] === app) {
        heroPhoto.style.backgroundImage = `url("${app.art}")`;
        heroEl.classList.add("has-art");
        if (app.artStyle === "portrait") heroEl.classList.add("art-portrait");
      }
    };
    probe.src = app.art;
  }
}

function setTabFocus(i) {
  tabIndex = Math.max(0, Math.min(i, tabsEl.children.length - 1));
  [...tabsEl.children].forEach((t, idx) =>
    t.classList.toggle("is-focused", idx === tabIndex && zone === "tabs")
  );
}

function setTab(i) {
  const cats = categories();
  tabIndex = Math.max(0, Math.min(i, cats.length - 1));
  filter = cats[tabIndex];
  [...tabsEl.children].forEach((t, idx) => {
    t.classList.toggle("is-active", idx === tabIndex);
  });
  focusIndex = 0;
  buildCards();
}

function enterDock() {
  zone = "dock";
  setTabFocus(tabIndex); // limpia el foco visual de tabs
  setFocus(focusIndex);
}
function enterTabs() {
  zone = "tabs";
  setTabFocus(tabIndex);
}

// ============================================================
//  2) ABRIR / CERRAR SERVICIOS
//  El contenido lo dibuja el proceso principal con un WebContentsView
//  (vista nativa, sin los bugs de render del viejo <webview>). Aqui
//  solo enviamos ordenes por IPC y controlamos las franjas que la
//  vista debe dejar libres: la barra superior y, si aparece, el teclado.
//  El limite de 2 servicios y el freeze de audio se manejan en main.js.
// ============================================================
const SERVICE_BAR_H = 52; // alto de la barra superior con "Volver"
const serviceNameEl = document.getElementById("service-name");
let serviceActive = false;

function openFocused() {
  if (zone === "tabs") {
    enterDock();
    return;
  }
  const app = currentList[focusIndex];
  if (app) openApp(app);
}

async function openApp(app) {
  if (!app) return;

  // Apps en desarrollo (placeholder): no abren, solo avisan.
  if (app.wip) {
    showToast(`${app.name} — En desarrollo 🚧`);
    return;
  }

  rememberLast(app.id); // "Continuar": recordar la ultima usada

  // Servicios con DRM (Netflix, Disney+, ...): se abren en el navegador
  // externo (Chrome/Edge), que tiene Widevine certificado y SI reproduce.
  // No cambiamos de pantalla: el launcher se queda en el menu.
  if (app.external) {
    showToast(`Abriendo ${app.name} en tu navegador…`);
    try {
      const res = await window.launcher.openExternal({
        id: app.id,
        url: app.url,
        keyboard: extKeyboard, // teclado propio (CDP) junto al navegador
        browser: !!app.browser, // Chrome como navegador normal (con barra)
      });
      if (!res || !res.ok) {
        showToast(
          "No encontré Chrome ni Edge instalado para abrir " + app.name,
          true
        );
      }
    } catch (_) {
      showToast("No se pudo abrir " + app.name, true);
    }
    return;
  }

  // Servicios sin DRM: se muestran embebidos (WebContentsView).
  serviceNameEl.textContent = app.name || "";
  mode = "app";
  serviceActive = true;
  launcherScreen.classList.remove("is-active");
  appScreen.classList.add("is-active");
  // Reservar la barra superior; nada reservado abajo hasta que salga el teclado.
  window.launcher.setInsets(SERVICE_BAR_H, 0);
  window.launcher.openService({ id: app.id, url: app.url });
}

// Aviso transitorio abajo del launcher.
let toastTimer = null;
function showToast(text, isError) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.toggle("is-error", !!isError);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function backToLauncher() {
  hideKeyboard();
  window.launcher.closeService(); // congela (mute+pausa) y quita de pantalla
  serviceActive = false;
  mode = "launcher";
  appScreen.classList.remove("is-active");
  launcherScreen.classList.add("is-active");
}

// Boton/atajo unico para "volver": si el teclado esta abierto lo cierra
// primero (igual que B/Esc), si no, sale del servicio al inicio.
function handleBackAction() {
  if (mode === "keyboard") hideKeyboard();
  else if (mode === "app") backToLauncher();
}

// ============================================================
//  3) TECLADO EN PANTALLA
// ============================================================
const KB_LAYOUT = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "ñ"],
  ["shift", "z", "x", "c", "v", "b", "n", "m", "back"],
  ["123", "@", "space", ".", "enter", "close"],
];

let kbFocus = { row: 1, col: 0 };
let shiftOn = false;
let buffer = "";

function buildKeyboard() {
  kbGrid.innerHTML = "";
  KB_LAYOUT.forEach((row, r) => {
    const rowEl = document.createElement("div");
    rowEl.className = "kb-row";
    row.forEach((key, c) => {
      const k = document.createElement("div");
      k.className = "key";
      k.dataset.row = r;
      k.dataset.col = c;
      k.dataset.key = key;
      k.innerHTML = keyLabel(key);
      if (key === "space") k.classList.add("xwide");
      if (["shift", "back", "enter", "123", "close"].includes(key))
        k.classList.add("wide");
      k.addEventListener("mouseenter", () => setKbFocus(r, c));
      k.addEventListener("click", () => pressKey(key));
      rowEl.appendChild(k);
    });
    kbGrid.appendChild(rowEl);
  });
  renderKbFocus();
}

function keyLabel(key) {
  switch (key) {
    case "space":
      return "espacio";
    case "back":
      return "⌫";
    case "enter":
      return "↵";
    case "shift":
      return shiftOn ? "⇧ ON" : "⇧";
    case "close":
      return "✕";
    case "123":
      return "123";
    default:
      return shiftOn && key.length === 1 ? key.toUpperCase() : key;
  }
}

function refreshKeyLabels() {
  kbGrid.querySelectorAll(".key").forEach((k) => {
    k.innerHTML = keyLabel(k.dataset.key);
  });
}

function setKbFocus(r, c) {
  kbFocus = { row: r, col: c };
  renderKbFocus();
}

function renderKbFocus() {
  kbGrid.querySelectorAll(".key").forEach((k) => {
    const on =
      +k.dataset.row === kbFocus.row && +k.dataset.col === kbFocus.col;
    k.classList.toggle("is-focused", on);
  });
}

async function showKeyboard() {
  if (mode !== "app") return;
  mode = "keyboard";
  // Leer el valor actual del campo (via main) para la vista previa.
  buffer = "";
  try {
    buffer = (await window.launcher.svcGetActiveValue()) || "";
  } catch (_) {}
  updatePreview();
  keyboardEl.classList.add("show");
  keyboardEl.setAttribute("aria-hidden", "false");
  setKbFocus(1, 0);
  // Encoger la vista del servicio para que el teclado no la tape.
  const kbH = keyboardEl.offsetHeight + 26 /*margen*/ + 16 /*aire*/;
  window.launcher.setInsets(SERVICE_BAR_H, kbH);
}

function hideKeyboard() {
  keyboardEl.classList.remove("show");
  keyboardEl.setAttribute("aria-hidden", "true");
  if (mode === "keyboard") mode = "app";
  // Devolver a la vista todo el alto (menos la barra superior).
  if (serviceActive) window.launcher.setInsets(SERVICE_BAR_H, 0);
}

function updatePreview() {
  kbPreview.textContent = buffer || "";
}

function sendChar(ch) {
  window.launcher.svcSendChar(ch);
  buffer += ch;
  updatePreview();
}

function sendSpecial(keyCode) {
  window.launcher.svcSendKey(keyCode);
}

function pressKey(key) {
  switch (key) {
    case "shift":
      shiftOn = !shiftOn;
      refreshKeyLabels();
      break;
    case "space":
      sendChar(" ");
      break;
    case "back":
      sendSpecial("Backspace");
      buffer = buffer.slice(0, -1);
      updatePreview();
      break;
    case "enter":
      sendSpecial("Return");
      hideKeyboard();
      break;
    case "close":
      // Quita el foco del campo dentro del servicio y cierra el teclado.
      window.launcher.svcBlur();
      hideKeyboard();
      break;
    case "123":
      // Reservado para una capa de simbolos (mejora futura).
      break;
    default:
      sendChar(shiftOn ? key.toUpperCase() : key);
      if (shiftOn) {
        shiftOn = false;
        refreshKeyLabels();
      }
  }
}

// ============================================================
//  4) NAVEGACION CON MANDO (Gamepad API)
// ============================================================
// Soporta mando estilo Xbox y DualShock 4 (DS4) mediante una capa
// adaptativa. Hay tres casos que normalizar a las mismas acciones:
//   - Xbox / mapeo "standard": ✕/A=0, ○/B=1, D-pad=botones 12–15.
//   - DS4 en modo "standard" (lo habitual por BT/USB en Chromium): igual
//     que Xbox, asi que ✕=confirmar y ○=volver ya calzan.
//   - DS4 nativo "raw"/DirectInput (gp.mapping===""): los botones de cara
//     se reordenan (□=0, ✕=1, ○=2, △=3) y el D-pad viaja por el "hat"
//     en axes[9]. Este es el caso que antes no respondia.
const prevButtons = {};
let prevHat = null; // ultima direccion del hat (para el flanco del D-pad DS4)
let scrollCooldown = 0; // ritmo de la rueda con el stick derecho

// Perfil del mando conectado: ¿es Sony? ¿usa el mapeo "standard"?
function padProfile(gp) {
  const id = (gp.id || "").toLowerCase();
  const isSony =
    /054c|0ce6|sony|dualshock|dual shock|dualsense|wireless controller/.test(id);
  return { isSony, standard: gp.mapping === "standard" };
}

// Indices de boton segun el perfil. Solo el DS4 "raw" reordena la cara y
// manda el D-pad por el hat (up/down/... = null -> se lee de axes[9]).
function buttonMap(prof) {
  if (prof.isSony && !prof.standard) {
    return {
      confirm: 1, back: 2, square: 0, triangle: 3,
      l1: 4, r1: 5, l2: 6, r2: 7, l3: 10, options: 9, ps: 12, touchpad: 13,
      up: null, down: null, left: null, right: null,
    };
  }
  // "standard" (Xbox o DS4 mapeado) y respaldo generico.
  return {
    confirm: 0, back: 1, square: 2, triangle: 3,
    l1: 4, r1: 5, l2: 6, r2: 7, l3: 10, options: 9, ps: 16, touchpad: 17,
    up: 12, down: 13, left: 14, right: 15,
  };
}

// Flanco de subida de un boton por indice (una accion por pulsacion).
function edge(gp, idx) {
  if (idx == null) return false;
  const b = gp.buttons[idx];
  const now = !!(b && b.pressed);
  const was = prevButtons[idx] || false;
  prevButtons[idx] = now;
  return now && !was;
}

// Decodifica el hat/POV del DS4 raw (axes[9]) a una direccion cardinal.
// En reposo el DS4 reporta un valor fuera de [-1,1] (~1.29), asi que un
// stick centrado (0) nunca se confunde con "abajo". Las diagonales se
// ignoran (solo cardinales), que es lo natural navegando una rejilla.
function hatToDir(v) {
  if (v == null || v < -1.05 || v > 1.05) return null;
  const idx = Math.round((v + 1) * 3.5); // 0..7 (8 posiciones del hat)
  return { 0: "up", 2: "right", 4: "down", 6: "left" }[idx] || null;
}

function pollGamepad(ts) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = [...pads].find((p) => p);
  if (gp) handlePad(gp, ts);
  requestAnimationFrame(pollGamepad);
}

// Raton emulado: el stick izquierdo mueve el cursor REAL de Windows (el main
// lo aplica con un auxiliar). Zona muerta + curva de precision para apuntar
// fino cerca del centro y rapido al fondo. Se ejecuta en cualquier modo.
const MOUSE_DZ = 0.15; // zona muerta del stick
const MOUSE_SPEED = 22; // px por frame a tope de stick (ajustable)
function driveMouse(gp) {
  const x = gp.axes[0] || 0;
  const y = gp.axes[1] || 0;
  const mag = Math.hypot(x, y);
  if (mag < MOUSE_DZ) return;
  const scaled = Math.pow((mag - MOUSE_DZ) / (1 - MOUSE_DZ), 1.6);
  const k = (scaled / mag) * MOUSE_SPEED;
  window.launcher.mouseMove(Math.round(x * k), Math.round(y * k));
}

function handlePad(gp, ts) {
  // Si el launcher NO tiene el foco, NO procesar el mando: significa que hay un
  // servicio embebido enfocado (p. ej. un video en pantalla completa) o el
  // Chrome de un DRM en primer plano, y de eso se encarga SU propio lector.
  // Sin esto, el launcher tambien leia el mando y ✕ reabria el servicio
  // (otra pestana de Netflix) ademas de duplicar el cursor. hasFocus() lo evita.
  if (!document.hasFocus()) return;

  const prof = padProfile(gp);
  const M = buttonMap(prof);

  // --- Raton: stick izquierdo (cursor), clicks, y rueda (stick derecho) ---
  // Van siempre, en cualquier modo (incluida Configuracion): el cursor es el
  // real del SO, asi que integra hover/click de tarjetas, ajustes y servicios.
  driveMouse(gp);
  // Gatillos = click de raton dedicado (siempre al cursor).
  const confirmEdge = edge(gp, M.confirm) || edge(gp, M.touchpad);
  if (edge(gp, M.r2) || edge(gp, M.l3)) window.launcher.mouseClick("left");
  if (edge(gp, M.l2)) window.launcher.mouseClick("right");
  if (ts > scrollCooldown) {
    const ry = prof.standard ? gp.axes[3] || 0 : gp.axes[5] || 0;
    if (Math.abs(ry) > 0.25) {
      window.launcher.mouseScroll(Math.round(-ry * 24)); // stick abajo = scroll abajo
      scrollCooldown = ts + 30;
    }
  }

  // Con Configuracion abierta, el D-pad no navega el menu (usa el cursor);
  // ✕ hace click en los controles, ○ / Options la cierran.
  if (settingsEl.classList.contains("show")) {
    if (confirmEdge) window.launcher.mouseClick("left");
    if (edge(gp, M.back) || edge(gp, M.options)) closeSettings();
    return;
  }

  // --- Direccion discreta: solo D-pad o hat (el stick es el raton) ---
  let dir = null;
  if (M.up != null) {
    if (edge(gp, M.up)) dir = "up";
    else if (edge(gp, M.down)) dir = "down";
    else if (edge(gp, M.left)) dir = "left";
    else if (edge(gp, M.right)) dir = "right";
  } else if (prof.isSony) {
    const d = hatToDir(gp.axes[9]); // DS4 raw: D-pad por hat
    if (d && d !== prevHat) dir = d;
    prevHat = d;
  }
  if (dir) navigate(dir);

  // --- Botones de accion (mismos para Xbox y DS4) ---
  // ✕ segun contexto: abre la tarjeta ENFOCADA en el inicio (sirve igual con
  // D-pad o con el stick, porque al pasar el cursor por una tarjeta se enfoca),
  // pulsa la tecla en el teclado, y hace click en un servicio embebido.
  if (confirmEdge) {
    if (mode === "launcher") openFocused();
    else if (mode === "keyboard") action("A");
    else if (mode === "app") window.launcher.mouseClick("left");
  }
  if (edge(gp, M.back)) action("B"); // ○ / B
  if (edge(gp, M.ps)) padHome(); // boton PS -> inicio
  if (edge(gp, M.options)) padOptions(); // Options -> ⚙
  if (edge(gp, M.l1)) padShoulder("L");
  if (edge(gp, M.r1)) padShoulder("R");
  if (edge(gp, M.square)) padSquare(); // □
  if (edge(gp, M.triangle)) padTriangle(); // △
}

function navigate(dir) {
  if (mode === "launcher") {
    navLauncher(dir);
  } else if (mode === "keyboard") {
    moveKbFocus(dir);
  } else if (mode === "app") {
    // Dentro del servicio, traducir a flechas del teclado.
    const map = { up: "Up", down: "Down", left: "Left", right: "Right" };
    sendSpecial(map[dir]);
  }
}

// Navegacion del launcher por zonas: dock (tarjetas) y tabs (categorias).
function navLauncher(dir) {
  if (zone === "tabs") {
    if (dir === "left" && tabIndex > 0) {
      setTab(tabIndex - 1);
      setTabFocus(tabIndex);
    } else if (dir === "right" && tabIndex < tabsEl.children.length - 1) {
      setTab(tabIndex + 1);
      setTabFocus(tabIndex);
    } else if (dir === "down") {
      enterDock();
    }
  } else {
    if (dir === "left") setFocus(focusIndex - 1);
    else if (dir === "right") setFocus(focusIndex + 1);
    else if (dir === "up") enterTabs();
  }
}

function moveKbFocus(dir) {
  let { row, col } = kbFocus;
  if (dir === "up") row = Math.max(0, row - 1);
  if (dir === "down") row = Math.min(KB_LAYOUT.length - 1, row + 1);
  if (dir === "left") col = Math.max(0, col - 1);
  if (dir === "right") col = Math.min(KB_LAYOUT[row].length - 1, col + 1);
  // Ajustar col si la fila nueva es mas corta.
  col = Math.min(col, KB_LAYOUT[row].length - 1);
  setKbFocus(row, col);
}

// ✕/A = confirmar/abrir/enter ; ○/B = volver/atras (segun contexto).
function action(btn) {
  if (btn === "A") {
    if (mode === "launcher") openFocused();
    else if (mode === "keyboard")
      pressKey(KB_LAYOUT[kbFocus.row][kbFocus.col]);
    else if (mode === "app") sendSpecial("Return");
  } else if (btn === "B") {
    if (mode === "launcher" && zone === "tabs") enterDock();
    else handleBackAction();
  }
}

// Boton PS: ir al inicio desde un servicio embebido o el teclado.
function padHome() {
  if (mode === "keyboard" || mode === "app") backToLauncher();
}

// Options: abrir/cerrar Configuracion. Solo en el inicio, porque la vista
// nativa del servicio taparia el panel (es DOM de la ventana launcher).
function padOptions() {
  if (mode !== "launcher") return;
  if (settingsEl.classList.contains("show")) closeSettings();
  else openSettings();
}

// L1 / R1: en el inicio cambian de categoria; en el teclado son atajos
// comodos (L1 borra, R1 espacio) para escribir mas rapido.
function padShoulder(side) {
  if (mode === "launcher") {
    const last = categories().length - 1;
    if (side === "L" && tabIndex > 0) {
      setTab(tabIndex - 1);
      if (zone === "tabs") setTabFocus(tabIndex);
    } else if (side === "R" && tabIndex < last) {
      setTab(tabIndex + 1);
      if (zone === "tabs") setTabFocus(tabIndex);
    }
  } else if (mode === "keyboard") {
    if (side === "R") pressKey("space");
    else pressKey("back");
  }
}

// □ (Square): borrar en el teclado; play/pausa dentro de un servicio.
function padSquare() {
  if (mode === "keyboard") pressKey("back");
  else if (mode === "app") sendSpecial("Space");
}

// △ (Triangle): mayuscula en el teclado; en el inicio salta a "Continuar".
function padTriangle() {
  if (mode === "keyboard") pressKey("shift");
  else if (mode === "launcher") focusLastUsed();
}

// ============================================================
//  5) TECLADO FISICO (respaldo para probar sin mando)
// ============================================================
document.addEventListener("keydown", (e) => {
  // El panel de Configuracion tiene prioridad: Esc lo cierra.
  if (settingsEl.classList.contains("show")) {
    if (e.key === "Escape") closeSettings();
    return;
  }
  if (mode === "app" || mode === "keyboard") {
    if (e.key === "Escape") handleBackAction();
  }
  if (mode === "launcher") {
    if (e.key === "ArrowLeft") navLauncher("left");
    else if (e.key === "ArrowRight") navLauncher("right");
    else if (e.key === "ArrowUp") navLauncher("up");
    else if (e.key === "ArrowDown") navLauncher("down");
    else if (e.key === "Enter") openFocused();
  }
});

// ============================================================
//  6) RELOJ + SALUDO
// ============================================================
function tick() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  document.getElementById("clock").textContent = `${hh}:${mm}`;
  const ds = now.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  document.getElementById("date").textContent =
    ds.charAt(0).toUpperCase() + ds.slice(1); // solo la 1ra letra en mayúscula
  const h = now.getHours();
  const greet =
    h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
  document.getElementById("greeting").textContent = greet;
}

// --- "Continuar": recordar y priorizar la ultima app usada ---
function rememberLast(id) {
  try {
    localStorage.setItem("lastApp", id);
  } catch (_) {}
}
function focusLastUsed() {
  const id = localStorage.getItem("lastApp");
  if (!id) return;
  const idx = currentList.findIndex((a) => a.id === id);
  if (idx >= 0) setFocus(idx);
}

document.getElementById("quit-btn").addEventListener("click", () =>
  window.close()
);
backHint.addEventListener("click", () => handleBackAction());
heroOpen.addEventListener("click", () => openFocused());

// El main avisa cuando un servicio enfoca/desenfoca un campo de texto.
window.launcher.onKeyboard((show) => {
  if (show) showKeyboard();
  else hideKeyboard();
});

// El mando dentro de un servicio (○ / PS) pidio volver al inicio.
window.launcher.onPadBack(() => {
  if (serviceActive) backToLauncher();
});

// ============================================================
//  7) ZOOM DEL CONTENIDO
//  El zoom real lo aplica el main a las vistas nativas; aqui solo
//  guardamos la preferencia y se la mandamos.
// ============================================================
let zoomFactor = parseFloat(localStorage.getItem("zoomFactor")) || 1;

// Teclado de Windows para servicios DRM (navegador externo). Por defecto ON.
let extKeyboard = localStorage.getItem("extKeyboard") !== "0";

function setExtKeyboard(on) {
  extKeyboard = !!on;
  localStorage.setItem("extKeyboard", on ? "1" : "0");
}

function setZoom(percent) {
  zoomFactor = Math.min(1.5, Math.max(0.5, percent / 100));
  localStorage.setItem("zoomFactor", String(zoomFactor));
  window.launcher.setZoom(zoomFactor);
}

// ============================================================
//  8) MENU DE CONFIGURACION
// ============================================================
const settingsEl = document.getElementById("settings");
const segMode = document.getElementById("seg-mode");
const winW = document.getElementById("win-w");
const winH = document.getElementById("win-h");
const zoomInput = document.getElementById("zoom");
const zoomVal = document.getElementById("zoom-val");

function openSettings() {
  settingsEl.classList.add("show");
  settingsEl.setAttribute("aria-hidden", "false");
  syncSettings();
}
function closeSettings() {
  settingsEl.classList.remove("show");
  settingsEl.setAttribute("aria-hidden", "true");
}

async function syncSettings() {
  // Reflejar el estado real de la ventana y el zoom guardado.
  const pct = Math.round(zoomFactor * 100);
  zoomInput.value = pct;
  zoomVal.textContent = pct + "%";
  document.getElementById("ext-kb").checked = extKeyboard;
  try {
    autostartInput.checked = !!(await window.launcher.getAutostart());
  } catch (_) {}
  try {
    const st = await window.launcher.getWindowState();
    setModeUI(st.fullscreen ? "full" : "window");
    if (st.size && st.size.length === 2) {
      winW.value = st.size[0];
      winH.value = st.size[1];
    }
  } catch (_) {}
}

function setModeUI(mode) {
  settingsEl.setAttribute("data-mode", mode);
  segMode.querySelectorAll(".seg-btn").forEach((b) => {
    b.classList.toggle("is-on", b.dataset.mode === mode);
  });
}

// Abrir / cerrar
document.getElementById("settings-btn").addEventListener("click", openSettings);
document
  .getElementById("settings-close")
  .addEventListener("click", closeSettings);
settingsEl.addEventListener("click", (e) => {
  if (e.target === settingsEl) closeSettings(); // click fuera del panel
});

// Modo pantalla completa / ventana
segMode.querySelectorAll(".seg-btn").forEach((b) => {
  b.addEventListener("click", async () => {
    const mode = b.dataset.mode;
    setModeUI(mode);
    if (mode === "full") {
      await window.launcher.setFullScreen(true);
    } else {
      await window.launcher.setWindowSize(
        parseInt(winW.value, 10),
        parseInt(winH.value, 10)
      );
    }
    window.launcher.refitService();
  });
});

// Aplicar tamano manual
document.getElementById("apply-size").addEventListener("click", async () => {
  setModeUI("window");
  await window.launcher.setWindowSize(
    parseInt(winW.value, 10),
    parseInt(winH.value, 10)
  );
  window.launcher.refitService();
});

// Presets de tamano
settingsEl.querySelectorAll(".chip").forEach((c) => {
  c.addEventListener("click", async () => {
    winW.value = c.dataset.w;
    winH.value = c.dataset.h;
    setModeUI("window");
    await window.launcher.setWindowSize(+c.dataset.w, +c.dataset.h);
    window.launcher.refitService();
  });
});

// Zoom
zoomInput.addEventListener("input", () => {
  zoomVal.textContent = zoomInput.value + "%";
  setZoom(parseInt(zoomInput.value, 10));
});

// Re-ajustar servicio: reaplica el tamano de la vista nativa.
document.getElementById("refit-btn").addEventListener("click", () => {
  window.launcher.refitService();
  closeSettings();
});

// Teclado de Windows para servicios DRM
const extKbInput = document.getElementById("ext-kb");
extKbInput.addEventListener("change", () => setExtKeyboard(extKbInput.checked));

// Mostrar el teclado de Windows ahora mismo
document.getElementById("osk-btn").addEventListener("click", async () => {
  const res = await window.launcher.openSystemKeyboard();
  if (!res || !res.ok) showToast("No se pudo abrir el teclado de Windows", true);
});

// --- Sistema: auto-inicio ---
const autostartInput = document.getElementById("autostart");
autostartInput.addEventListener("change", async () => {
  await window.launcher.setAutostart(autostartInput.checked);
  showToast(
    autostartInput.checked
      ? "Se abrirá al encender el PC"
      : "Ya no se abrirá al encender"
  );
});

// --- Sistema: temporizador de apagado ---
const shutdownOpts = document.getElementById("shutdown-opts");
shutdownOpts.querySelectorAll(".chip").forEach((c) => {
  c.addEventListener("click", async () => {
    const min = parseInt(c.dataset.min, 10);
    shutdownOpts
      .querySelectorAll(".chip")
      .forEach((x) => x.classList.toggle("is-on", x === c));
    const res = await window.launcher.scheduleShutdown(min);
    if (!res || res.ok === false) {
      showToast("No se pudo programar el apagado", true);
    } else if (min === 0) {
      showToast("Apagado automático cancelado");
    } else {
      const txt = min >= 60 ? min / 60 + " h" : min + " min";
      showToast(`El PC se apagará en ${txt} 💤`);
    }
  });
});

// ============================================================
//  ARRANQUE
// ============================================================
buildTabs();
buildCards();
focusLastUsed(); // priorizar la ultima app usada ("Continuar")
buildKeyboard();
tick();
setInterval(tick, 15000);
requestAnimationFrame(pollGamepad);

// Aplicar el zoom guardado a las vistas de servicio.
window.launcher.setZoom(zoomFactor);
