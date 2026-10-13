// ============================================================
//  Preload del launcher (ventana principal).
//  Expone de forma segura la config y el control de servicios/ventana.
//  El contenido de los servicios lo dibuja el proceso principal con
//  WebContentsView; aqui solo enviamos ordenes por IPC.
// ============================================================

const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

function loadConfig() {
  const configPath = path.join(__dirname, "..", "config.json");
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    console.error("No se pudo leer config.json:", e.message);
    return { apps: [] };
  }
}

contextBridge.exposeInMainWorld("launcher", {
  getConfig: () => loadConfig(),

  // --- Servicios (WebContentsView en el main) ---
  openService: (appInfo) => ipcRenderer.invoke("svc:open", appInfo),
  // Servicios con DRM: se abren en el navegador externo (Chrome/Edge).
  openExternal: (appInfo) => ipcRenderer.invoke("svc:openExternal", appInfo),
  // Teclado en pantalla de Windows (osk.exe) para el navegador externo.
  openSystemKeyboard: () => ipcRenderer.invoke("sys:openKeyboard"),

  // Sistema: auto-inicio y temporizador de apagado.
  getAutostart: () => ipcRenderer.invoke("sys:getAutostart"),
  setAutostart: (on) => ipcRenderer.invoke("sys:setAutostart", on),
  scheduleShutdown: (minutes) =>
    ipcRenderer.invoke("sys:scheduleShutdown", minutes),
  closeService: () => ipcRenderer.invoke("svc:close"),
  setInsets: (top, bottom) => ipcRenderer.invoke("svc:setInsets", top, bottom),
  refitService: () => ipcRenderer.invoke("svc:refit"),
  svcSendChar: (ch) => ipcRenderer.invoke("svc:sendChar", ch),
  svcSendKey: (keyCode) => ipcRenderer.invoke("svc:sendKey", keyCode),
  // Scroll del contenido (stick derecho del mando) dentro de un servicio.
  svcScroll: (dy) => ipcRenderer.invoke("svc:scroll", dy),

  // --- Raton emulado con el stick (mueve el cursor real de Windows) ---
  mouseMove: (dx, dy) => ipcRenderer.send("mouse:move", dx, dy),
  mouseClick: (btn) => ipcRenderer.send("mouse:click", btn),
  mouseScroll: (dy) => ipcRenderer.send("mouse:scroll", dy),
  svcGetActiveValue: () => ipcRenderer.invoke("svc:getActiveValue"),
  svcBlur: () => ipcRenderer.invoke("svc:blur"),
  setZoom: (factor) => ipcRenderer.invoke("svc:setZoom", factor),

  // El main avisa cuando un servicio enfoca/desenfoca un campo de texto.
  onKeyboard: (cb) => {
    ipcRenderer.on("kb:show", () => cb(true));
    ipcRenderer.on("kb:hide", () => cb(false));
  },
  // El mando dentro de un servicio pidio volver al inicio (○ / PS).
  onPadBack: (cb) => ipcRenderer.on("pad:back", () => cb()),

  // --- Control de ventana para el menu de Configuracion ---
  getWindowState: () => ipcRenderer.invoke("win:getState"),
  setFullScreen: (flag) => ipcRenderer.invoke("win:setFullScreen", flag),
  setWindowSize: (w, h) => ipcRenderer.invoke("win:setSize", w, h),
});
