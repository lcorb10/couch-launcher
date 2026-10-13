// Preload de la ventana-teclado. Expone el envio de teclas al main,
// que las inyecta en Chrome via CDP.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kb", {
  char: (ch) => ipcRenderer.send("kbwin:char", ch),
  key: (code) => ipcRenderer.send("kbwin:key", code),
  hide: () => ipcRenderer.send("kbwin:hide"),
  // El main puede pedir limpiar el buffer al mostrarse en un campo nuevo.
  onReset: (cb) => ipcRenderer.on("kbwin:reset", () => cb()),
  // Navegacion con mando (DS4/Xbox) enrutada desde el Chrome externo.
  onNav: (cb) => ipcRenderer.on("kbwin:nav", (_e, dir) => cb(dir)),
  onPress: (cb) => ipcRenderer.on("kbwin:press", () => cb()),
  onSpecial: (cb) => ipcRenderer.on("kbwin:special", (_e, s) => cb(s)),
});
