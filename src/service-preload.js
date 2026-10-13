// ============================================================
//  Preload inyectado DENTRO de cada servicio (Netflix, YouTube...).
//  Corre en el WebContentsView del servicio. Su tarea: avisar al
//  proceso principal cuando el usuario entra o sale de un campo de
//  texto, para que el launcher muestre/oculte el teclado en pantalla.
// ============================================================

const { ipcRenderer } = require("electron");

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName ? el.tagName.toLowerCase() : "";
  if (tag === "textarea") return true;
  if (el.isContentEditable) return true;
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    const noKeyboard = [
      "button",
      "submit",
      "reset",
      "checkbox",
      "radio",
      "range",
      "color",
      "file",
      "image",
      "hidden",
    ];
    return !noKeyboard.includes(type);
  }
  return false;
}

// focusin/focusout burbujean (a diferencia de focus/blur), asi que un
// solo listener en document captura todos los campos de la pagina.
document.addEventListener("focusin", (e) => {
  if (isEditable(e.target)) {
    ipcRenderer.send("host:keyboard", true);
  }
});

document.addEventListener("focusout", (e) => {
  if (isEditable(e.target)) {
    // Pequeno retraso: si el foco salta a otro campo, se cancela.
    setTimeout(() => {
      if (!isEditable(document.activeElement)) {
        ipcRenderer.send("host:keyboard", false);
      }
    }, 60);
  }
});

// ============================================================
//  Lector de mando DENTRO del servicio embebido.
//  Cuando el foco esta en el servicio (p. ej. un video en PANTALLA COMPLETA),
//  el launcher deja de recibir la Gamepad API; este lector, que corre en el
//  contexto del servicio, mantiene el mando vivo: mueve el cursor real (via
//  el auxiliar del main), hace click/rueda, navega el video con el D-pad y
//  permite salir con ○/PS. Mismo mapeo adaptativo Xbox / DS4 (standard/raw).
// ============================================================
(function () {
  var prev = {}, prevHat = null;
  function isSony(gp) {
    var id = (gp.id || "").toLowerCase();
    return /054c|0ce6|sony|dualshock|dual shock|dualsense|wireless controller/.test(id);
  }
  function map(gp) {
    if (isSony(gp) && gp.mapping !== "standard")
      return { confirm: 1, back: 2, square: 0, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, l3: 10, options: 9, ps: 12, touchpad: 13, up: null, down: null, left: null, right: null };
    return { confirm: 0, back: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, l3: 10, options: 9, ps: 16, touchpad: 17, up: 12, down: 13, left: 14, right: 15 };
  }
  function isDown(gp, i) { if (i == null) return false; var b = gp.buttons[i]; return !!(b && b.pressed); }
  function edge(gp, i) { if (i == null) return false; var now = isDown(gp, i); var was = prev[i] || false; prev[i] = now; return now && !was; }
  function hat(v) { if (v == null || v < -1.05 || v > 1.05) return null; var idx = Math.round((v + 1) * 3.5); return ({ 0: "Up", 2: "Right", 4: "Down", 6: "Left" })[idx] || null; }
  function loop() {
    // Solo actuar si el servicio tiene el foco (p. ej. video en pantalla
    // completa); si el foco esta en el launcher, manda su lector. Asi nunca
    // hay dos superficies leyendo el mando a la vez (evita duplicar el click).
    if (!document.hasFocus()) { requestAnimationFrame(loop); return; }
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var gp = null;
    for (var i = 0; i < pads.length; i++) { if (pads[i]) { gp = pads[i]; break; } }
    if (gp) {
      var M = map(gp);
      // Cursor real con el stick izquierdo.
      var mx = gp.axes[0] || 0, my = gp.axes[1] || 0, mmag = Math.sqrt(mx * mx + my * my);
      if (mmag > 0.15) { var scl = Math.pow((mmag - 0.15) / 0.85, 1.6), kk = (scl / mmag) * 22; ipcRenderer.send("mouse:move", Math.round(mx * kk), Math.round(my * kk)); }
      // Rueda con el stick derecho.
      var ry = (gp.mapping === "standard") ? (gp.axes[3] || 0) : (gp.axes[5] || 0);
      if (Math.abs(ry) > 0.25) ipcRenderer.send("mouse:scroll", Math.round(-ry * 24));
      // ✕ / touchpad / R2 / L3 = click izq ; L2 = click der.
      if (edge(gp, M.confirm) || edge(gp, M.touchpad) || edge(gp, M.r2) || edge(gp, M.l3)) ipcRenderer.send("mouse:click", "left");
      if (edge(gp, M.l2)) ipcRenderer.send("mouse:click", "right");
      // D-pad = flechas dentro del video (seek/volumen) ; □ = play/pausa.
      var d = null;
      if (M.up != null) { if (edge(gp, M.up)) d = "Up"; else if (edge(gp, M.down)) d = "Down"; else if (edge(gp, M.left)) d = "Left"; else if (edge(gp, M.right)) d = "Right"; }
      else { var h = hat(gp.axes[9]); if (h && h !== prevHat) d = h; prevHat = h; }
      if (d) ipcRenderer.send("svc:padNav", d);
      if (edge(gp, M.square)) ipcRenderer.send("svc:padNav", "Space");
      // ○ = salir de pantalla completa / volver ; PS = volver al inicio.
      if (edge(gp, M.back)) ipcRenderer.send("svc:padExit");
      if (edge(gp, M.ps)) ipcRenderer.send("svc:padHome");
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
