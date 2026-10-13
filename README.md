# Couch Launcher

Un launcher tipo **Smart TV / Apple TV / Google TV** para tu PC. Pantalla de
inicio con un **hero** grande que muestra el arte de la serie/artista de cada
servicio, **pestañas de categoría** y un **dock de apps** navegable con
**mouse o mando**. Los servicios sin DRM se ven **embebidos** (con teclado en
pantalla propio); Netflix/Disney+/etc. se abren en **Chrome** (Widevine) con
nuestro teclado inyectado por CDP y **auto-cierre** al salir de pantalla
completa. Incluye reloj/fecha, "Continuar" (última app usada), zoom,
temporizador de apagado y auto-inicio con Windows.

---

## Requisitos

- Windows 10/11 (también corre en Linux).
- [Node.js](https://nodejs.org) 18 o superior.

## Instalación

### Fácil (recomendada, Windows)

1. Instala [Node.js](https://nodejs.org) (18 o superior) si no lo tienes.
2. Copia esta carpeta a tu PC y haz **doble clic en `instalar.bat`**.
   Instala las dependencias y crea el acceso directo **"Couch Launcher"** en tu
   escritorio. Listo: doble clic ahí para abrir.

> Para pasarla a otro equipo puedes comprimir la carpeta **sin** `node_modules`
> (lo baja el instalador solo) y correr `instalar.bat` en el destino.

### Manual

```bash
cd couch-launcher
npm install
npm start
```

Se abre en pantalla completa. Para salir: botón ✕, `Alt+F4`, o `F11` para
alternar pantalla completa.

## Configuración (⚙) — Sistema

- **Abrir al encender el PC**: interruptor que registra la app en el arranque
  de Windows (clave `Run` del registro), para que se abra sola al iniciar sesión.
- **Apagar el PC en…**: temporizador de apagado (Nunca / 30 min / 1 h / 2 h /
  3 h). Programa un apagado del sistema; sirve para dormir viendo algo. Se apaga
  aunque cierres el launcher; elige **Nunca** para cancelarlo.

---

## Controles

Compatible con mando estilo **Xbox** y **DualShock 4 (DS4)**. En el DS4 los
botones equivalen así: **✕ = A**, **○ = B**. Funciona nativo por cable o
Bluetooth (sin DS4Windows ni Steam); si algún día usas DS4Windows también sirve.

| Acción                    | Xbox / DS4        | Mouse / Teclado        |
| ------------------------- | ----------------- | ---------------------- |
| Mover el cursor (ratón)   | **Stick izquierdo** | Mover el mouse       |
| Abrir / confirmar         | **✕ / A**         | Click / Enter          |
| Click izquierdo           | **RT/R2 · L3**    | Click izquierdo        |
| Click derecho             | **LT/L2**         | Click derecho          |
| Rueda / scroll            | **Stick derecho** | Rueda del mouse        |
| Moverse entre servicios   | D-Pad             | Mover mouse / ← →      |
| Volver al inicio          | **B / ○**         | `Esc`                  |
| Navegar dentro del servicio | D-Pad           | Mouse normal           |
| Cambiar de categoría      | **LB/RB · L1/R1** | Click en la pestaña    |
| Ir a "Continuar"          | **Y / △**         | —                      |
| Abrir Configuración       | **☰ / Options**   | Botón ⚙                |
| Volver al inicio (directo)| **Guide / PS**    | `Esc`                  |
| Escribir                  | El teclado sale solo → navégalo con D-Pad, **A/✕** para pulsar (□/L1 borra, △ shift, R1 espacio) | Click en las teclas |
| Cerrar teclado            | **B / ○**         | `Esc` / tecla ✕        |

**Ratón con el stick**: el stick izquierdo mueve el **cursor real de Windows**,
así que funciona igual sobre el launcher, los servicios embebidos y el Chrome de
los DRM. Lo aplica un pequeño auxiliar de Windows que se lanza solo cuando usas
el stick. Puedes abrir de dos formas indistintas: con el **D-Pad** enfocas una
tarjeta y **✕** la abre; o mueves el cursor con el stick (al pasar por una
tarjeta se enfoca sola) y **✕** la abre igual. **R2 / L3** son un click
izquierdo dedicado (útil dentro de las webs); **L2** click derecho.

**Pantalla completa**: cuando pones un video a pantalla completa el foco pasa al
servicio, así que el mando se lee **desde la superficie que tiene el foco** (el
servicio embebido, o el Chrome de los DRM) y **nunca dos a la vez** — por eso ✕
ya no reabre otra pestaña. Todo sigue funcionando (cursor, click, ▶/⏸ con □,
flechas para avanzar/volumen). Para **salir**: **○** sale de la pantalla completa
(en los DRM llama a `exitFullscreen`, que un Escape normal no logra), y **○** otra
vez o **PS** vuelve al inicio.

El teclado en pantalla aparece automáticamente al enfocar cualquier campo de
texto dentro de un servicio, y se cierra solo al salir del campo o al pulsar
Enter / ✕.

---

## Agregar o quitar servicios

Edita `config.json`. Cada servicio es un objeto:

```json
{
  "id": "youtube",
  "name": "YouTube",
  "url": "https://www.youtube.com/tv",
  "logo": "../assets/logos/youtube.png",
  "desc": "Videos, música y directos",
  "category": "video",
  "color": "#FF0033",
  "drm": false
}
```

- `color` tiñe la tarjeta, el hero y la luz ambiental.
- `logo` es el logo local (respaldo: favicon en línea → letra).
- `desc` es la frase que aparece en el hero bajo el nombre.
- `category` agrupa en las pestañas: `video`, `music` o `live`.
- `drm: true` + `external: true` → se abre en Chrome (ver abajo).

No hace falta tocar código: guarda y reinicia.

## Pantalla de inicio (estilo Smart TV)

- **Hero** grande arriba: arte con el color de marca del servicio enfocado,
  su logo, nombre, descripción y botón **▶ Abrir**.
- **Pestañas** de categoría (Todo / Video / Música / En vivo). Con mando:
  **Arriba** entra a las pestañas, **←/→** cambian de categoría, **Abajo** vuelve
  a las apps.
- **Dock** de apps: tarjetas con el logo sobre un degradado de marca; la
  enfocada crece y brilla.
- **Reloj, fecha y saludo** arriba a la izquierda.
- **Continuar**: recuerda la última app abierta y la deja enfocada al arrancar.

---

## DRM (Netflix, Disney+, Prime, HBO Max, Paramount+, Apple TV+)

Estos servicios exigen una verificación **VMP (Verified Media Path)** de Widevine
que un Electron sin certificar no pasa (da el error tipo `M7121-1331`). En vez de
firmar la app con VMP (que obliga a empaquetar + cuenta castlabs), el launcher
hace algo más simple: **abre estos servicios en tu navegador (Chrome o Edge)**,
que ya tiene Widevine certificado por Google y **sí reproduce**.

- Al pulsar un tile con DRM, se lanza **Chrome** (o Edge si no hay Chrome) en
  modo app a **pantalla completa**, con un perfil propio (`ext-browser`) para no
  mezclarse con tu Chrome normal. Inicias sesión una vez y queda recordada.
- Para volver al launcher: cierra la ventana del navegador (`Alt+F4`), o
  simplemente **sal de pantalla completa** (`F11`) — la ventana se cierra sola
  y vuelves al launcher (ver "Auto-cierre" abajo).
- Cuáles van por navegador se define con `"external": true` en `config.json`.
- **Auto-cierre**: si sales de pantalla completa **estando en el menú** del
  servicio, la ventana de Chrome se cierra sola y regresas al launcher (un paso
  menos). Se detecta por CDP el cambio de estado de la ventana. Salir del
  fullscreen de un **video** no cierra nada (la ventana sigue en pantalla
  completa por debajo), así que **viendo una serie no te expulsa**.
- **Teclado en pantalla**: aunque el servicio corre en Chrome, aparece
  **nuestro teclado** automáticamente al enfocar un campo de texto. Se logra
  conectando a Chrome por CDP (Chrome DevTools Protocol): el launcher abre Chrome
  con un puerto de depuración, detecta el foco en campos e inyecta lo que
  escribes con `Input.insertText`. El teclado es una ventana propia
  always-on-top que no roba el foco. Se puede desactivar en ⚙, y hay un teclado
  de Windows (`osk.exe`) como respaldo manual.
  - Nota: abrir ese puerto de depuración permite, en teoría, que otro programa
    local controle esa ventana de Chrome. En un PC personal es un riesgo bajo.

Servicios **sin DRM** (YouTube, Twitch, Spotify) siguen **embebidos** dentro del
launcher, con teclado en pantalla y navegación por mando.

> Nota: incluso en Chrome, algunos servicios limitan la resolución (p. ej. 720p)
> fuera de sus apps certificadas. Es una restricción del servicio, no del launcher.

> Alternativa avanzada: si prefieres reproducir DRM **embebido**, hay que
> empaquetar la app y firmarla con VMP vía el servicio gratuito EVS de castlabs
> (ver `https://github.com/castlabs/electron-releases/wiki/EVS`).

---

## Comportamiento de los servicios

- Al volver al inicio el servicio se **congela**: se silencia y se pausa el
  video (no sigue sonando de fondo), pero conserva tu sesión y posición.
- Se mantienen **hasta 2 servicios cargados** a la vez para retomarlos rápido.
  Al abrir un tercero distinto, el más antiguo se cierra del todo (libera RAM).
- Cada tile muestra el **logo real** del servicio (bundleado en `assets/logos/`,
  funciona sin internet). Si faltara, cae al favicon en línea y luego a la letra.
- Dentro de un servicio, el botón **← Volver al inicio** (arriba a la izquierda)
  cierra la vista con el mouse; equivale a `B` / `Esc`.

## Menú de configuración (⚙)

Botón de engranaje arriba a la derecha. Permite:

- **Pantalla completa / Ventana**, con tamaño manual (ancho × alto) y presets
  (1280×720, 1600×900, 1920×1080).
- **Zoom del contenido** de los servicios (50%–150%), se recuerda entre sesiones.
- **Re-ajustar pantalla del servicio**: si un servicio se ve solo en una franja
  con el resto negro, este botón fuerza el recálculo del tamaño. Alternativa
  infalible: cambiar a **Ventana** y volver a **Pantalla completa** (eso hace un
  redimensionamiento real que corrige el render).

## Arquitectura (nota técnica)

Cada servicio se dibuja con un **`WebContentsView`** (vista nativa de Chromium)
gestionado en el proceso principal (`main.js`), **no** con la etiqueta
`<webview>`. Electron desaconseja `<webview>` por bugs de render (mitad negra /
página en blanco hasta redimensionar), justo los que aparecían antes. El
launcher (menú, teclado, ajustes) vive en la ventana y habla con el `main` por
IPC. La vista del servicio se coloca debajo de una barra superior de 52 px con
el botón **Volver**, y se encoge sola cuando aparece el teclado en pantalla.

## Limitaciones conocidas

- La capa de símbolos (`123`) aún no está implementada; el teclado cubre
  letras, números y los símbolos más comunes.
- Soporta mando Xbox y DualShock 4 (capa adaptativa que cubre el DS4 tanto en
  modo "standard" como nativo "raw", con el D-pad por hat). Otros mandos pueden
  tener otro mapeo de botones (se ajusta en `renderer.js`, sección "Gamepad").
- El mando controla también los servicios con DRM (Netflix, Disney+…) aunque
  corran en el Chrome externo: el launcher inyecta por CDP un lector de gamepad
  dentro de Chrome que traduce los botones a teclas reales (D-pad→flechas,
  ✕→Enter, ○→Escape, □→espacio play/pausa, △→F, PS→volver al launcher) y, con un
  campo de texto enfocado, navega el teclado en pantalla. La navegación se apoya
  en las flechas/Enter que cada web soporta; en sitios muy "de ratón" puede no
  llegar a todos los elementos (YouTube `/tv` y los players van finos).

## Ideas para siguientes versiones

- Capa de símbolos y acentos en el teclado.
- Recordar el último servicio abierto.
- Fila de "Continuar viendo" / accesos recientes.
- Soporte para lanzar apps de escritorio (no solo web).
