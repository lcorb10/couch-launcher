// ============================================================
//  Couch Launcher - proceso principal (main process)
//  El menu/teclado/ajustes viven en la ventana (index.html).
//  Cada servicio de streaming se muestra con un WebContentsView
//  (vista nativa de Chromium), que reemplaza al viejo <webview>:
//  este ultimo tenia bugs conocidos de render (mitad negra / pagina
//  en blanco hasta redimensionar). Electron recomienda WebContentsView.
// ============================================================

const { app, BrowserWindow, WebContentsView, ipcMain, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");
const CDP = require("chrome-remote-interface");

const CDP_PORT = 9333; // puerto de depuracion del Chrome externo (DRM)

// --- Widevine / DRM (opcional) -------------------------------
// Si instalaste el fork de castlabs (ver README > DRM), este
// bloque activa Widevine para que Netflix/Disney+/Prime reproduzcan.
// Con el Electron normal simplemente se ignora sin romper nada.
let widevineComponents = null;
try {
  widevineComponents = require("electron").components;
} catch (_) {
  widevineComponents = null;
}

const SERVICE_PRELOAD = path.join(__dirname, "service-preload.js");
const MAX_OPEN = 2; // servicios vivos a la vez (LRU: el 3ro cierra el mas viejo)

let mainWindow = null;

// --- Estado del gestor de servicios ---
const views = {}; // id -> WebContentsView
const order = []; // ids del mas antiguo -> mas reciente
let activeId = null;
let insets = { top: 0, bottom: 0 }; // espacio reservado para barra/teclado
let fsOverride = false; // true mientras un video esta en fullscreen HTML5
let zoomFactor = 1;

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    backgroundColor: "#080B14",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload-host.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // el preload lee config.json con fs/path
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("resize", () => layoutActiveView());
  mainWindow.on("enter-full-screen", () => layoutActiveView());
  mainWindow.on("leave-full-screen", () => layoutActiveView());

  // Al cerrar el launcher, cerrar tambien el teclado y las conexiones CDP;
  // si no, la ventana-teclado impediria que la app termine.
  mainWindow.on("closed", () => {
    cleanupKeyboardAndCdp();
    mainWindow = null;
  });

  // F11 alterna pantalla completa; F12 abre DevTools del launcher.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    } else if (input.key === "F12") {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

// ============================================================
//  Gestor de servicios (WebContentsView)
// ============================================================
function contentSize() {
  const [w, h] = mainWindow.getContentSize();
  return { w, h };
}

// Coloca la vista activa respetando la barra superior y el teclado.
function layoutActiveView() {
  if (!mainWindow || !activeId) return;
  const view = views[activeId];
  if (!view) return;
  const { w, h } = contentSize();
  if (fsOverride) {
    // Video en pantalla completa: ocupa TODO (tapa la barra superior).
    view.setBounds({ x: 0, y: 0, width: w, height: h });
    return;
  }
  const top = Math.min(insets.top, h);
  const bottom = Math.min(insets.bottom, h - top);
  view.setBounds({
    x: 0,
    y: top,
    width: w,
    height: Math.max(0, h - top - bottom),
  });
}

function freeze(view) {
  if (!view) return;
  const wc = view.webContents;
  try {
    wc.setAudioMuted(true);
  } catch (_) {}
  try {
    wc.executeJavaScript(
      "document.querySelectorAll('video,audio').forEach(function(m){try{m.pause()}catch(e){}});"
    ).catch(() => {});
  } catch (_) {}
}

function destroyService(id) {
  const view = views[id];
  if (view) {
    try {
      mainWindow.contentView.removeChildView(view);
    } catch (_) {}
    try {
      view.webContents.close();
    } catch (_) {}
  }
  delete views[id];
  const i = order.indexOf(id);
  if (i !== -1) order.splice(i, 1);
  if (activeId === id) activeId = null;
}

function createService(appInfo) {
  const view = new WebContentsView({
    webPreferences: {
      preload: SERVICE_PRELOAD,
      partition: "persist:" + appInfo.id, // sesion persistente (login)
      contextIsolation: true,
      sandbox: true,
      // Evita que el fullscreen HTML5 saque a la ventana de pantalla completa.
      disableHtmlFullscreenWindowResize: true,
      backgroundThrottling: false,
    },
  });
  // WebContentsView nace con fondo blanco; lo ponemos transparente/oscuro.
  try {
    view.setBackgroundColor("#00000000");
  } catch (_) {}

  const wc = view.webContents;

  // El preload del servicio avisa al main cuando el usuario entra/sale de
  // un campo de texto; lo reenviamos al launcher para mostrar el teclado.
  // (se maneja global por ipcMain mas abajo, filtrando por sender)

  // Fullscreen HTML5 (p.ej. video en YouTube): expandir la vista a toda la
  // pantalla mientras dure, y restaurar el layout al salir.
  wc.on("enter-html-full-screen", () => {
    fsOverride = true;
    layoutActiveView();
  });
  wc.on("leave-html-full-screen", () => {
    fsOverride = false;
    layoutActiveView();
  });

  // Abrir popups (logins de Google, etc.) en la misma vista.
  wc.setWindowOpenHandler(({ url }) => {
    wc.loadURL(url);
    return { action: "deny" };
  });

  wc.loadURL(appInfo.url);
  try {
    wc.setZoomFactor(zoomFactor);
  } catch (_) {}
  return view;
}

function openService(appInfo) {
  if (!mainWindow) return;
  let view = views[appInfo.id];
  if (!view) {
    view = createService(appInfo);
    views[appInfo.id] = view;
  }

  // Marcar como reciente y aplicar limite LRU.
  const i = order.indexOf(appInfo.id);
  if (i !== -1) order.splice(i, 1);
  order.push(appInfo.id);
  while (Object.keys(views).length > MAX_OPEN) {
    const victim = order.find((id) => id !== appInfo.id);
    if (!victim) break;
    destroyService(victim);
  }

  // Congelar los demas (corta su audio) y quitarlos de pantalla.
  Object.entries(views).forEach(([id, v]) => {
    if (id !== appInfo.id) {
      freeze(v);
      try {
        mainWindow.contentView.removeChildView(v);
      } catch (_) {}
    }
  });

  // Mostrar este arriba de todo.
  mainWindow.contentView.addChildView(view);
  activeId = appInfo.id;
  fsOverride = false;
  try {
    view.webContents.setAudioMuted(false);
  } catch (_) {}
  try {
    view.webContents.setZoomFactor(zoomFactor);
  } catch (_) {}
  layoutActiveView();
}

function closeService() {
  if (!activeId) return;
  const view = views[activeId];
  if (view) {
    freeze(view);
    try {
      mainWindow.contentView.removeChildView(view);
    } catch (_) {}
  }
  activeId = null;
  fsOverride = false;
}

// ============================================================
//  Servicios con DRM -> navegador externo (Chrome/Edge)
//  Netflix/Disney+/Prime/HBO/Paramount/AppleTV exigen VMP y solo
//  reproducen en un navegador certificado por Google. En vez de VMP-firmar
//  la app, lanzamos el Chrome (o Edge) del usuario en modo app a pantalla
//  completa: su Widevine ya esta certificado, asi que reproducen sin mas.
// ============================================================
// ============================================================
//  Raton emulado con el stick del mando (cursor REAL de Windows)
//  Electron no mueve el cursor del SO, asi que lanzamos un proceso
//  auxiliar de PowerShell que hace P/Invoke a user32 (SetCursorPos /
//  mouse_event) y recibe ordenes por stdin. Al mover el cursor REAL,
//  funciona igual sobre el launcher, los servicios embebidos y el
//  Chrome externo de los DRM, e integra el hover/click ya existentes.
//  Protocolo (una linea por orden): "M dx dy" mueve relativo, "L"/"R"
//  click izq/der, "W delta" rueda, "Q" salir.
// ============================================================
const MOUSE_PS1 = `$src = @'
using System;
using System.Runtime.InteropServices;
public class Mou {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int data, int extra);
}
'@
Add-Type -TypeDefinition $src
while(($line = [Console]::In.ReadLine()) -ne $null){
  if($line.Length -eq 0){ continue }
  $a = $line.Split(' ')
  switch($a[0]){
    'M' {
      $p = New-Object Mou+POINT
      [void][Mou]::GetCursorPos([ref]$p)
      [void][Mou]::SetCursorPos($p.X + [int]$a[1], $p.Y + [int]$a[2])
    }
    'L' { [Mou]::mouse_event(0x02,0,0,0,0); [Mou]::mouse_event(0x04,0,0,0,0) }
    'R' { [Mou]::mouse_event(0x08,0,0,0,0); [Mou]::mouse_event(0x10,0,0,0,0) }
    'W' { [Mou]::mouse_event(0x0800,0,0,[int]$a[1],0) }
    'Q' { break }
  }
}
`;

let mouseHelper = null;
function ensureMouseHelper() {
  if (mouseHelper) return mouseHelper;
  const ps1 = path.join(app.getPath("userData"), "mouse-helper.ps1");
  try {
    fs.writeFileSync(ps1, MOUSE_PS1, "utf8");
    mouseHelper = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", ps1],
      { stdio: ["pipe", "ignore", "ignore"], windowsHide: true }
    );
    mouseHelper.on("error", (e) => {
      console.warn("[mouse] error:", e.message);
      mouseHelper = null;
    });
    mouseHelper.on("exit", () => (mouseHelper = null));
  } catch (e) {
    console.warn("[mouse] no se pudo lanzar:", e.message);
    mouseHelper = null;
  }
  return mouseHelper;
}
function mouseCmd(line) {
  const h = ensureMouseHelper();
  if (!h || !h.stdin || !h.stdin.writable) return;
  try {
    h.stdin.write(line + "\n");
  } catch (_) {}
}
function stopMouseHelper() {
  if (!mouseHelper) return;
  try {
    mouseHelper.stdin.write("Q\n");
  } catch (_) {}
  try {
    mouseHelper.kill();
  } catch (_) {}
  mouseHelper = null;
}

function findBrowser() {
  const pf = process.env["ProgramFiles"] || "C:\\Program Files";
  const pf86 =
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const local = process.env["LOCALAPPDATA"] || "";
  const candidates = [
    path.join(pf, "Google\\Chrome\\Application\\chrome.exe"),
    path.join(pf86, "Google\\Chrome\\Application\\chrome.exe"),
    local && path.join(local, "Google\\Chrome\\Application\\chrome.exe"),
    path.join(pf86, "Microsoft\\Edge\\Application\\msedge.exe"),
    path.join(pf, "Microsoft\\Edge\\Application\\msedge.exe"),
  ].filter(Boolean);
  return candidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch (_) {
      return false;
    }
  });
}

function launchExternal(url, opts = {}) {
  const browser = findBrowser();
  if (!browser) return { ok: false, error: "no-browser" };
  // Perfil dedicado: mantiene tus logins de streaming aparte de tu Chrome
  // normal y evita chocar con una instancia ya abierta.
  const dataDir = path.join(app.getPath("userData"), "ext-browser");
  let args;
  if (opts.browser) {
    // Modo navegador (tile "Google Chrome"): ventana normal de Chrome con su
    // barra de direcciones y pestanas, maximizada. Sin --app ni auto-cierre.
    args = [
      url,
      "--start-maximized",
      `--user-data-dir=${dataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
    ];
  } else {
    args = [
      `--app=${url}`,
      "--start-fullscreen",
      "--start-maximized",
      `--user-data-dir=${dataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      // Puerto de depuracion para que nuestro teclado (CDP) detecte el foco
      // en campos de texto e inyecte lo que escribes. remote-allow-origins es
      // obligatorio desde Chrome 111 para que un cliente CDP pueda conectarse.
      `--remote-debugging-port=${CDP_PORT}`,
      "--remote-allow-origins=*",
    ];
  }
  try {
    const child = spawn(browser, args, { detached: true, stdio: "ignore" });
    // spawn emite los errores de forma ASINCRONA como evento 'error'; sin
    // este handler, un fallo tumbaria todo el proceso principal.
    child.on("error", (e) => console.warn("[external] error:", e.message));
    child.unref();
    return { ok: true, browser };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Teclado en pantalla de Windows (osk.exe). Escribe en la ventana que
// tenga el foco (Chrome) y se maneja con el mouse.
// IMPORTANTE: osk.exe es una app de accesibilidad protegida (uiAccess) y
// NO se puede lanzar con spawn/CreateProcess directo (da EACCES / "Acceso
// denegado"). Hay que lanzarla por el shell de Windows (ShellExecute), que
// es justo lo que hace PowerShell Start-Process.
function launchOsk() {
  const win = process.env["WINDIR"] || "C:\\Windows";
  const osk = path.join(win, "System32", "osk.exe");
  try {
    if (!fs.existsSync(osk)) return { ok: false, error: "no-osk" };
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-WindowStyle",
        "Hidden",
        "-Command",
        "Start-Process '" + osk + "'",
      ],
      { detached: true, stdio: "ignore", windowsHide: true }
    );
    child.on("error", (e) => console.warn("[osk] error:", e.message));
    child.unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================
//  Teclado propio dentro de Chrome (via CDP)
//  Conecta al Chrome externo por su puerto de depuracion, inyecta un
//  detector de foco en campos de texto, y muestra NUESTRO teclado (una
//  ventana always-on-top). Cada tecla se inyecta con Input.insertText /
//  Input.dispatchKeyEvent en la pestana que tiene el foco.
// ============================================================
let kbWindow = null; // ventana-teclado (BrowserWindow)
const cdpClients = {}; // targetId -> client CDP
let activeCdp = null; // cliente donde ocurrio el ultimo foco (donde escribir)
let cdpPollTimer = null;
let kbEnabled = true; // mostrar el teclado propio al enfocar (ajuste ⚙)

// Script que se inyecta en cada pagina de Chrome: avisa cuando el foco
// entra/sale de un campo editable, llamando al binding __couchKb.
const FOCUS_SCRIPT = `
(function(){
  if (window.__couchKbInstalled) return;
  window.__couchKbInstalled = true;
  function editable(el){
    if(!el) return false;
    var tag = el.tagName ? el.tagName.toLowerCase() : "";
    if(tag === "textarea") return true;
    if(el.isContentEditable) return true;
    if(tag === "input"){
      var t = (el.getAttribute("type")||"text").toLowerCase();
      return ["button","submit","reset","checkbox","radio","range","color","file","image","hidden"].indexOf(t) === -1;
    }
    return false;
  }
  document.addEventListener("focusin", function(e){
    if(editable(e.target)){
      window.__couchField = true; // el lector de mando entra en modo teclado
      if(window.__couchKb) window.__couchKb("show");
    }
  }, true);
  document.addEventListener("focusout", function(e){
    if(editable(e.target)) setTimeout(function(){
      if(!editable(document.activeElement)){
        window.__couchField = false;
        if(window.__couchKb) window.__couchKb("hide");
      }
    }, 80);
  }, true);
})();
`;

// Script que se inyecta en cada pagina de Chrome (DRM): lee el MANDO desde
// dentro de Chrome (que es la ventana con foco, asi que la Gamepad API si
// entrega eventos) y avisa al main via el binding __couchPad. El main
// traduce cada accion a teclas reales por CDP, que Netflix/Disney obedecen.
// Con un campo de texto enfocado (window.__couchField) cambia a "modo
// teclado" y las acciones navegan el teclado en pantalla en vez de la pagina.
const PAD_SCRIPT = `
(function(){
  if(window.top !== window) return; // solo el frame superior (evita duplicados)
  if(window.__couchPadInstalled) return;
  window.__couchPadInstalled = true;
  var prev = {}, heldDir = null, nextRep = 0;
  function isSony(gp){ var id=(gp.id||"").toLowerCase();
    return /054c|0ce6|sony|dualshock|dual shock|dualsense|wireless controller/.test(id); }
  function map(gp){
    if(isSony(gp) && gp.mapping!=="standard")
      return {confirm:1,back:2,square:0,triangle:3,l1:4,r1:5,l2:6,r2:7,l3:10,options:9,ps:12,touchpad:13,up:null,down:null,left:null,right:null};
    return {confirm:0,back:1,square:2,triangle:3,l1:4,r1:5,l2:6,r2:7,l3:10,options:9,ps:16,touchpad:17,up:12,down:13,left:14,right:15};
  }
  function down(gp,i){ if(i==null) return false; var b=gp.buttons[i]; return !!(b&&b.pressed); }
  function edge(gp,i){ if(i==null) return false; var now=down(gp,i); var was=prev[i]||false; prev[i]=now; return now&&!was; }
  function hat(v){ if(v==null||v<-1.05||v>1.05) return null;
    var idx=Math.round((v+1)*3.5); return ({0:"Up",2:"Right",4:"Down",6:"Left"})[idx]||null; }
  // Direccion discreta: solo D-pad o hat. El stick izquierdo es el raton.
  function dirNow(gp,M){
    if(M.up!=null){ if(down(gp,M.up))return"Up"; if(down(gp,M.down))return"Down";
      if(down(gp,M.left))return"Left"; if(down(gp,M.right))return"Right"; return null; }
    return hat(gp.axes[9]);
  }
  function send(a){ try{ if(window.__couchPad) window.__couchPad(a); }catch(e){} }
  function loop(ts){
    // Solo actuar si ESTA pagina (Chrome) tiene el foco; si esta de fondo
    // manda el launcher. Evita que dos superficies lean el mando a la vez.
    if(!document.hasFocus()){ requestAnimationFrame(loop); return; }
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var gp=null; for(var i=0;i<pads.length;i++){ if(pads[i]){gp=pads[i];break;} }
    if(gp){
      var M=map(gp);
      var field = !!window.__couchField;
      var pre = field ? "kb" : "";
      var d = dirNow(gp,M);
      if(d){ if(d!==heldDir){ heldDir=d; nextRep=ts+380; send(pre+d); }
             else if(ts>nextRep){ nextRep=ts+140; send(pre+d); } }
      else heldDir=null;
      // Raton: stick izquierdo mueve el cursor real (via el auxiliar del main).
      var mx=gp.axes[0]||0, my=gp.axes[1]||0, mmag=Math.sqrt(mx*mx+my*my);
      if(mmag>0.15){ var scl=Math.pow((mmag-0.15)/0.85,1.6), kk=(scl/mmag)*22;
        send("M "+Math.round(mx*kk)+" "+Math.round(my*kk)); }
      // Stick derecho: rueda (DS4 raw usa axes[5]; standard axes[3]).
      var ry=(gp.mapping==="standard")?(gp.axes[3]||0):(gp.axes[5]||0);
      if(Math.abs(ry)>0.25) send("W "+Math.round(-ry*24));
      // Clicks: R2 / L3 = izquierdo, L2 = derecho.
      if(edge(gp,M.r2)||edge(gp,M.l3)) send("L");
      if(edge(gp,M.l2)) send("R");
      if(edge(gp,M.confirm)||edge(gp,M.touchpad)) send(field?"kbPress":"L");
      if(edge(gp,M.back)) send(field?"kbClose":"Esc");
      if(edge(gp,M.square)) send(field?"kbBack":"Space");
      if(edge(gp,M.triangle)) send(field?"kbShift":"KeyF");
      if(edge(gp,M.l1) && field) send("kbBack");
      if(edge(gp,M.r1) && field) send("kbSpace");
      if(edge(gp,M.options)) send(field?"kbClose":"Esc");
      if(edge(gp,M.ps)) send("Home");
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
`;

// Teclas reales que enviamos a Chrome por CDP segun la accion del mando.
const PAD_KEYS = {
  Up: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  Down: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  Left: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  Right: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 }, // play/pausa
  KeyF: { key: "f", code: "KeyF", windowsVirtualKeyCode: 70 }, // pantalla completa
};

function createKeyboardWindow() {
  if (kbWindow && !kbWindow.isDestroyed()) return kbWindow;
  const { width, height } = screen.getPrimaryDisplay().size;
  // Alto suficiente para el teclado COMPLETO: preview + 5 filas + margenes
  // (~446px de contenido fijo). Con 340px se cortaban las filas de arriba en
  // los servicios DRM. Es alto fijo (las teclas no escalan), limitado al alto
  // de la pantalla por si acaso.
  const kbH = Math.min(height, 480);
  kbWindow = new BrowserWindow({
    width,
    height: kbH,
    x: 0,
    y: height - kbH,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false, // NO roba el foco: Chrome mantiene el campo enfocado
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "keyboard-preload.js"),
      contextIsolation: true,
      sandbox: false,
    },
  });
  kbWindow.setAlwaysOnTop(true, "screen-saver");
  kbWindow.loadFile(path.join(__dirname, "keyboard-window.html"));
  kbWindow.on("closed", () => (kbWindow = null));
  return kbWindow;
}

function showKeyboardWindow() {
  const w = createKeyboardWindow();
  if (w.webContents.isLoading()) {
    w.webContents.once("did-finish-load", () => reallyShow(w));
  } else {
    reallyShow(w);
  }
}
function reallyShow(w) {
  try {
    w.webContents.send("kbwin:reset");
  } catch (_) {}
  w.showInactive(); // mostrar sin robar el foco de Chrome
  w.setAlwaysOnTop(true, "screen-saver");
}
function hideKeyboardWindow() {
  if (kbWindow && !kbWindow.isDestroyed() && kbWindow.isVisible()) {
    kbWindow.hide();
  }
}

// Cierra la ventana-teclado y todas las conexiones CDP. Necesario para que
// la app pueda terminar (una ventana-teclado abierta bloquea el cierre).
function cleanupKeyboardAndCdp() {
  clearInterval(cdpPollTimer);
  Object.values(cdpClients).forEach((c) => {
    try {
      c.close();
    } catch (_) {}
  });
  for (const id of Object.keys(cdpClients)) delete cdpClients[id];
  activeCdp = null;
  if (kbWindow && !kbWindow.isDestroyed()) {
    kbWindow.destroy();
  }
  kbWindow = null;
}

// Conecta (o reintenta) al Chrome externo por CDP y engancha el teclado.
function startCdp() {
  let attempts = 0;
  createKeyboardWindow(); // precargar la ventana-teclado (aparece al instante)
  clearInterval(cdpPollTimer);
  const tryConnect = async () => {
    attempts++;
    let targets = [];
    try {
      targets = await CDP.List({ port: CDP_PORT });
    } catch (_) {
      if (attempts > 40) clearInterval(cdpPollTimer); // ~20s sin Chrome
      return;
    }
    for (const t of targets) {
      if (t.type !== "page" || cdpClients[t.id]) continue;
      attachTarget(t);
    }
  };
  cdpPollTimer = setInterval(tryConnect, 500);
  tryConnect();
}

async function attachTarget(target) {
  let client;
  try {
    client = await CDP({ port: CDP_PORT, target });
  } catch (_) {
    return;
  }
  cdpClients[target.id] = client;
  const { Page, Runtime } = client;
  try {
    await Runtime.enable();
    await Page.enable();
    await Runtime.addBinding({ name: "__couchKb" });
    await Runtime.addBinding({ name: "__couchPad" });
    await Page.addScriptToEvaluateOnNewDocument({ source: FOCUS_SCRIPT });
    await Page.addScriptToEvaluateOnNewDocument({ source: PAD_SCRIPT });
    await Runtime.evaluate({ expression: FOCUS_SCRIPT }); // pagina ya cargada
    await Runtime.evaluate({ expression: PAD_SCRIPT });
  } catch (_) {}

  Runtime.on("bindingCalled", (ev) => {
    if (ev.name === "__couchKb") {
      activeCdp = client;
      if (ev.payload === "show") {
        if (kbEnabled) showKeyboardWindow();
      } else if (ev.payload === "hide") {
        hideKeyboardWindow();
      }
      return;
    }
    if (ev.name === "__couchPad") {
      activeCdp = client; // el tab con foco es donde escribimos/tecleamos
      handlePadAction(client, target.id, ev.payload);
      return;
    }
  });

  // --- Auto-cierre al salir de pantalla completa (estando en el menu) ---
  // Sondeamos el estado de la VENTANA de Chrome. Si pasa de 'fullscreen' a
  // una ventana normal/maximizada, el usuario salio de pantalla completa a
  // proposito (desde el menu) -> cerramos y volvemos al launcher.
  // Salir del fullscreen de un VIDEO no cambia el estado de la ventana (la
  // ventana sigue en --start-fullscreen), asi que viendo una serie NO cierra.
  let winId = null;
  try {
    const r = await client.Browser.getWindowForTarget({ targetId: target.id });
    winId = r.windowId;
  } catch (_) {}
  let prevState = null;
  const stateTimer = setInterval(async () => {
    if (!winId) return;
    let st;
    try {
      const b = await client.Browser.getWindowBounds({ windowId: winId });
      st = b.bounds.windowState;
    } catch (_) {
      clearInterval(stateTimer);
      return;
    }
    if (prevState === "fullscreen" && (st === "normal" || st === "maximized")) {
      clearInterval(stateTimer);
      autoCloseChrome(client, target.id);
    }
    prevState = st;
  }, 500);

  client.on("disconnect", () => {
    clearInterval(stateTimer);
    delete cdpClients[target.id];
    if (activeCdp === client) activeCdp = null;
    if (Object.keys(cdpClients).length === 0) {
      // Chrome cerrado: recoger el teclado y dejar de reintentar.
      clearInterval(cdpPollTimer);
      hideKeyboardWindow();
    }
  });
}

// Cierra la ventana de Chrome del servicio y trae el launcher al frente.
async function autoCloseChrome(client, targetId) {
  try {
    await client.Target.closeTarget({ targetId });
  } catch (_) {
    try {
      await client.Page.close();
    } catch (__) {}
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setFullScreen(true);
      mainWindow.show();
      mainWindow.focus();
    } catch (_) {}
  }
}

// Inyecta caracteres / teclas especiales en la pestana con foco.
async function cdpType(ch) {
  if (!activeCdp) return;
  try {
    await activeCdp.Input.insertText({ text: ch });
  } catch (_) {}
}
async function cdpKey(code) {
  if (!activeCdp) return;
  const map = {
    Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
    Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  };
  const k = map[code];
  if (!k) return;
  try {
    await activeCdp.Input.dispatchKeyEvent({ type: "keyDown", ...k });
    await activeCdp.Input.dispatchKeyEvent({ type: "keyUp", ...k });
  } catch (_) {}
}

// ============================================================
//  Mando dentro de Chrome (DRM). El script inyectado (PAD_SCRIPT) lee el
//  gamepad y llama al binding __couchPad con una accion; aqui la ejecutamos.
// ============================================================
async function cdpSendKey(client, k) {
  if (!client || !k) return;
  try {
    await client.Input.dispatchKeyEvent({ type: "keyDown", ...k });
    await client.Input.dispatchKeyEvent({ type: "keyUp", ...k });
  } catch (_) {}
}

// Con un campo enfocado en Chrome, el mando navega el teclado en pantalla:
// enrutamos sus ordenes a la ventana-teclado (que ya escribe por CDP).
function routeKbAction(action) {
  if (!kbWindow || kbWindow.isDestroyed()) return;
  if (action === "kbPress") return void kbWindow.webContents.send("kbwin:press");
  if (action === "kbClose") {
    hideKeyboardWindow();
    if (activeCdp) {
      activeCdp.Runtime.evaluate({
        expression: "document.activeElement && document.activeElement.blur()",
      }).catch(() => {});
    }
    return;
  }
  if (action === "kbBack") return void kbWindow.webContents.send("kbwin:special", "back");
  if (action === "kbShift") return void kbWindow.webContents.send("kbwin:special", "shift");
  if (action === "kbSpace") return void kbWindow.webContents.send("kbwin:special", "space");
  // kbUp / kbDown / kbLeft / kbRight -> mover el cursor del teclado.
  kbWindow.webContents.send("kbwin:nav", action.slice(2).toLowerCase());
}

function handlePadAction(client, targetId, action) {
  if (!action) return;
  if (action === "Home") return autoCloseChrome(client, targetId); // PS -> launcher
  if (action.indexOf("kb") === 0) return routeKbAction(action);
  // Raton emulado dentro de Chrome: mueve el cursor real y hace click/rueda.
  if (action === "L" || action === "R" || action[0] === "M" || action[0] === "W") {
    return mouseCmd(action);
  }
  // ○ = salir: un Escape sintetico NO saca de la pantalla completa HTML5 (eso
  // lo maneja el navegador, no la pagina), asi que llamamos a exitFullscreen()
  // y ademas mandamos Escape para el "atras" propio del servicio.
  if (action === "Esc") {
    try {
      client.Runtime.evaluate({
        expression:
          "document.fullscreenElement && document.exitFullscreen && document.exitFullscreen()",
      }).catch(() => {});
    } catch (_) {}
    return cdpSendKey(client, PAD_KEYS.Escape);
  }
  const k = PAD_KEYS[action];
  if (k) cdpSendKey(client, k);
}

// ============================================================
//  IPC: launcher (renderer) -> main
// ============================================================
ipcMain.handle("svc:openExternal", (_e, info) => {
  const res = launchExternal(info.url, { browser: info.browser });
  // El modo navegador usa Chrome normal (con barra): sin CDP ni teclado.
  if (res.ok && !info.browser) {
    // Conectar SIEMPRE por CDP: sirve para dos cosas, el teclado propio
    // (si esta activado) y el auto-cierre al salir de pantalla completa.
    kbEnabled = info.keyboard !== false;
    setTimeout(startCdp, 1200); // dar tiempo a que Chrome abra el puerto
  }
  return res;
});
// Teclado de respaldo (osk de Windows), por si se quiere manualmente.
ipcMain.handle("sys:openKeyboard", () => launchOsk());

// --- Auto-inicio: abrir la app al encender/iniciar sesion en el PC ---
// app.setLoginItemSettings no funciona bien con Electron sin empaquetar, asi
// que escribimos directo la clave Run del registro de Windows con reg.exe.
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_NAME = "CouchLauncher";
function autostartValue() {
  return `"${process.execPath}" "${app.getAppPath()}"`;
}
function autostartEnabled() {
  try {
    const r = spawnSync("reg", ["query", RUN_KEY, "/v", RUN_NAME], {
      windowsHide: true,
    });
    return r.status === 0;
  } catch (_) {
    return false;
  }
}
ipcMain.handle("sys:getAutostart", () => autostartEnabled());
ipcMain.handle("sys:setAutostart", (_e, on) => {
  try {
    if (on) {
      spawnSync(
        "reg",
        ["add", RUN_KEY, "/v", RUN_NAME, "/t", "REG_SZ", "/d", autostartValue(), "/f"],
        { windowsHide: true }
      );
    } else {
      spawnSync("reg", ["delete", RUN_KEY, "/v", RUN_NAME, "/f"], {
        windowsHide: true,
      });
    }
    return autostartEnabled();
  } catch (e) {
    return { error: e.message };
  }
});

// --- Temporizador de apagado del PC (sleep timer) ---
// Programa un apagado del sistema tras X minutos. Es a nivel de Windows,
// asi que se apaga aunque cierres el launcher (util para dormir viendo algo).
ipcMain.handle("sys:scheduleShutdown", (_e, minutes) => {
  const win = process.env["WINDIR"] || "C:\\Windows";
  const sd = path.join(win, "System32", "shutdown.exe");
  // Cancelar cualquier apagado ya programado (sincronico y rapido).
  try {
    spawnSync(sd, ["/a"], { windowsHide: true });
  } catch (_) {}
  if (!minutes) return { ok: true, cancelled: true };
  const secs = Math.max(1, Math.round(minutes * 60));
  try {
    const c = spawn(
      sd,
      ["/s", "/t", String(secs), "/c", "Couch Launcher: apagado programado"],
      { windowsHide: true, detached: true }
    );
    c.on("error", (e) => console.warn("[shutdown] error:", e.message));
    c.unref();
    return { ok: true, minutes };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
// La ventana-teclado envia las teclas -> inyectar en Chrome via CDP.
ipcMain.on("kbwin:char", (_e, ch) => cdpType(ch));
ipcMain.on("kbwin:key", (_e, code) => cdpKey(code));
ipcMain.on("kbwin:hide", () => {
  hideKeyboardWindow();
  // Quitar el foco del campo en Chrome para que no reaparezca enseguida.
  if (activeCdp) {
    activeCdp.Runtime.evaluate({
      expression: "document.activeElement && document.activeElement.blur()",
    }).catch(() => {});
  }
});
ipcMain.handle("svc:open", (_e, appInfo) => {
  openService(appInfo);
});
ipcMain.handle("svc:close", () => closeService());
ipcMain.handle("svc:setInsets", (_e, top, bottom) => {
  insets = { top: Math.round(top) || 0, bottom: Math.round(bottom) || 0 };
  layoutActiveView();
});
ipcMain.handle("svc:refit", () => layoutActiveView());
ipcMain.handle("svc:sendChar", (_e, ch) => {
  const v = activeId && views[activeId];
  if (v) v.webContents.sendInputEvent({ type: "char", keyCode: ch });
});
ipcMain.handle("svc:sendKey", (_e, keyCode) => {
  const v = activeId && views[activeId];
  if (v) {
    v.webContents.sendInputEvent({ type: "keyDown", keyCode });
    v.webContents.sendInputEvent({ type: "keyUp", keyCode });
  }
});
// --- Raton emulado (stick del mando) desde el launcher/servicios embebidos ---
// El renderer envia desplazamientos/clicks; los pasamos al auxiliar que mueve
// el cursor REAL de Windows (ver seccion "Raton emulado").
ipcMain.on("mouse:move", (_e, dx, dy) => mouseCmd(`M ${dx | 0} ${dy | 0}`));
ipcMain.on("mouse:click", (_e, btn) => mouseCmd(btn === "right" ? "R" : "L"));
ipcMain.on("mouse:scroll", (_e, dy) => mouseCmd(`W ${dy | 0}`));

// --- Mando desde DENTRO de un servicio embebido (lector de service-preload) ---
// D-pad/□ -> teclas dentro del video del servicio activo.
ipcMain.on("svc:padNav", (_e, key) => {
  const v = activeId && views[activeId];
  if (!v) return;
  try {
    v.webContents.sendInputEvent({ type: "keyDown", keyCode: key });
    v.webContents.sendInputEvent({ type: "keyUp", keyCode: key });
  } catch (_) {}
});
// ○: primero sale de la pantalla completa del video; si no hay, vuelve al inicio.
ipcMain.on("svc:padExit", () => {
  if (fsOverride) {
    const v = activeId && views[activeId];
    if (v)
      v.webContents
        .executeJavaScript("document.exitFullscreen && document.exitFullscreen()")
        .catch(() => {});
    return;
  }
  padBackToLauncher();
});
// PS: volver al inicio siempre (saliendo antes de la pantalla completa).
ipcMain.on("svc:padHome", () => {
  const v = activeId && views[activeId];
  if (fsOverride && v)
    v.webContents
      .executeJavaScript("document.exitFullscreen && document.exitFullscreen()")
      .catch(() => {});
  padBackToLauncher();
});
function padBackToLauncher() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("pad:back"); // el renderer hace backToLauncher
  try {
    mainWindow.focus();
    mainWindow.webContents.focus(); // devolver el foco al launcher (mando vivo)
  } catch (_) {}
}

// Scroll del contenido con el stick derecho del mando. dy>0 (stick abajo)
// desplaza hacia abajo. El signo/factor es facil de ajustar si hiciera falta.
ipcMain.handle("svc:scroll", (_e, dy) => {
  const v = activeId && views[activeId];
  if (!v) return;
  try {
    v.webContents.sendInputEvent({
      type: "mouseWheel",
      x: 20,
      y: 20,
      deltaX: 0,
      deltaY: -(Math.round(dy) || 0),
      canScroll: true,
    });
  } catch (_) {}
});
ipcMain.handle("svc:getActiveValue", async () => {
  const v = activeId && views[activeId];
  if (!v) return "";
  try {
    return (
      (await v.webContents.executeJavaScript(
        "(document.activeElement && document.activeElement.value) || ''"
      )) || ""
    );
  } catch (_) {
    return "";
  }
});
ipcMain.handle("svc:blur", () => {
  const v = activeId && views[activeId];
  if (v)
    v.webContents
      .executeJavaScript(
        "document.activeElement && document.activeElement.blur()"
      )
      .catch(() => {});
});
ipcMain.handle("svc:setZoom", (_e, factor) => {
  zoomFactor = Math.min(1.5, Math.max(0.5, Number(factor) || 1));
  Object.values(views).forEach((v) => {
    try {
      v.webContents.setZoomFactor(zoomFactor);
    } catch (_) {}
  });
});

// El preload del servicio manda "host:keyboard" (true/false) cuando el
// foco entra/sale de un campo de texto -> avisar al launcher.
ipcMain.on("host:keyboard", (_e, show) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(show ? "kb:show" : "kb:hide");
  }
});

// --- Control de ventana desde Configuracion ---
ipcMain.handle("win:getState", () => {
  if (!mainWindow) return { fullscreen: true, size: [0, 0] };
  return { fullscreen: mainWindow.isFullScreen(), size: mainWindow.getSize() };
});
ipcMain.handle("win:setFullScreen", (_e, flag) => {
  if (!mainWindow) return null;
  mainWindow.setFullScreen(!!flag);
  if (flag) mainWindow.setResizable(true);
  layoutActiveView();
  return { fullscreen: mainWindow.isFullScreen(), size: mainWindow.getSize() };
});
ipcMain.handle("win:setSize", (_e, w, h) => {
  if (!mainWindow) return null;
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  mainWindow.setResizable(true);
  const width = Math.max(640, Math.round(w) || 1280);
  const height = Math.max(480, Math.round(h) || 720);
  mainWindow.setSize(width, height);
  mainWindow.center();
  layoutActiveView();
  return { fullscreen: false, size: mainWindow.getSize() };
});

// Algunos servicios validan el user-agent. Fingir un Chrome de escritorio
// evita pantallas de "navegador no soportado".
app.userAgentFallback = app.userAgentFallback.replace(/Electron\/[\d.]+ /, "");

async function boot() {
  if (widevineComponents) {
    try {
      await widevineComponents.whenReady();
      console.log("[widevine] listo");
    } catch (e) {
      console.warn("[widevine] no se pudo inicializar:", e.message);
    }
  }
  createWindow();
}

app.whenReady().then(boot);

app.on("before-quit", () => {
  cleanupKeyboardAndCdp();
  stopMouseHelper();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
