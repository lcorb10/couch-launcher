// ============================================================
//  Ventana-teclado (aparece sobre Chrome). Cada tecla se manda al
//  proceso principal, que la inyecta en Chrome via CDP (Input.insertText /
//  dispatchKeyEvent). Mantiene un buffer local solo para la vista previa.
// ============================================================
const KB_LAYOUT = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "ñ"],
  ["shift", "z", "x", "c", "v", "b", "n", "m", "back"],
  ["@", "space", ".", "enter", "close"],
];

const grid = document.getElementById("kb-grid");
const preview = document.getElementById("kb-preview");
let shiftOn = false;
let buffer = "";
let focus = { r: 1, c: 0 }; // tecla enfocada al navegar con mando

function label(key) {
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
    default:
      return shiftOn && key.length === 1 ? key.toUpperCase() : key;
  }
}

function build() {
  grid.innerHTML = "";
  KB_LAYOUT.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "kb-row";
    row.forEach((key) => {
      const k = document.createElement("div");
      k.className = "key";
      k.textContent = label(key);
      if (key === "space") k.classList.add("xwide");
      if (["shift", "back", "enter", "close"].includes(key))
        k.classList.add("wide");
      // mousedown en vez de click: no roba el foco del campo en Chrome.
      k.addEventListener("mousedown", (e) => {
        e.preventDefault();
        press(key);
      });
      rowEl.appendChild(k);
    });
    grid.appendChild(rowEl);
  });
  renderFocus();
}

// --- Navegacion con mando (llega por CDP desde el Chrome externo) ---
// El main enruta las direcciones/pulsaciones del mando a esta ventana
// cuando hay un campo de texto enfocado en Chrome.
function renderFocus() {
  const rows = grid.querySelectorAll(".kb-row");
  rows.forEach((rowEl, r) => {
    rowEl.querySelectorAll(".key").forEach((k, c) => {
      k.classList.toggle("is-focused", r === focus.r && c === focus.c);
    });
  });
}

function moveFocus(dir) {
  let { r, c } = focus;
  if (dir === "up") r = Math.max(0, r - 1);
  if (dir === "down") r = Math.min(KB_LAYOUT.length - 1, r + 1);
  if (dir === "left") c = Math.max(0, c - 1);
  if (dir === "right") c = Math.min(KB_LAYOUT[r].length - 1, c + 1);
  c = Math.min(c, KB_LAYOUT[r].length - 1); // ajustar si la fila es mas corta
  focus = { r, c };
  renderFocus();
}

function pressFocused() {
  press(KB_LAYOUT[focus.r][focus.c]);
}

function refreshLabels() {
  const keys = grid.querySelectorAll(".key");
  let i = 0;
  KB_LAYOUT.forEach((row) => row.forEach((key) => (keys[i++].textContent = label(key))));
}

function updatePreview() {
  preview.textContent = buffer;
}

function press(key) {
  switch (key) {
    case "shift":
      shiftOn = !shiftOn;
      refreshLabels();
      break;
    case "space":
      window.kb.char(" ");
      buffer += " ";
      updatePreview();
      break;
    case "back":
      window.kb.key("Backspace");
      buffer = buffer.slice(0, -1);
      updatePreview();
      break;
    case "enter":
      window.kb.key("Enter");
      buffer = "";
      updatePreview();
      break;
    case "close":
      window.kb.hide();
      break;
    default: {
      const ch = shiftOn ? key.toUpperCase() : key;
      window.kb.char(ch);
      buffer += ch;
      updatePreview();
      if (shiftOn) {
        shiftOn = false;
        refreshLabels();
      }
    }
  }
}

window.kb.onReset(() => {
  buffer = "";
  shiftOn = false;
  focus = { r: 1, c: 0 };
  refreshLabels();
  renderFocus();
  updatePreview();
});

// Ordenes del mando enrutadas por el main.
window.kb.onNav((dir) => moveFocus(dir));
window.kb.onPress(() => pressFocused());
window.kb.onSpecial((s) => press(s)); // "back" | "shift" | "space"

build();
