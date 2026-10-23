# OpenCode for Kiro

[![Release](https://img.shields.io/github/v/release/McJigsaw12/opencode-kiro?display_name=tag&sort=semver)](https://github.com/McJigsaw12/opencode-kiro/releases/latest)
[![CI](https://github.com/McJigsaw12/opencode-kiro/actions/workflows/ci.yml/badge.svg)](https://github.com/McJigsaw12/opencode-kiro/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Integra la interfaz web de **OpenCode** dentro de **Kiro**, sin abrir una terminal
ni salir del editor. La UI vive en la barra lateral derecha y comparte ese espacio
con el chat de Kiro, así que puedes alternar entre ambos con el botón de la barra
de estado o con un atajo.

> Proyecto no oficial. No está afiliado a Kiro ni a OpenCode.

## Características

- **Barra lateral derecha**: la UI de OpenCode ocupa la barra secundaria. La barra
  izquierda (Explorer) no se mueve.
- **Alternancia con el chat de Kiro**: el botón `OpenCode` de la barra de estado
  muestra OpenCode si está oculto, y devuelve la barra al chat de Kiro si OpenCode
  está visible. También funciona con `Ctrl+Alt+Shift+O`
  (`Cmd+Alt+Shift+O` en macOS).
- **Pestaña del editor**: comando `OpenCode: Abrir en pestaña del editor`, por
  defecto en el grupo de editores de la izquierda.
- **Servicio automático**: si el servicio local de OpenCode no está en marcha, la
  extensión ejecuta `opencode service start` (y `restart` si hace falta).
- **Pairing automático**: crea un token efímero con `POST /api/pair` y lo canjea
  con `GET /auth/connect/<code>`. No guarda cookies ni pide contraseña.
- **Workspace automático**: al abrir la UI se enlaza al chat más reciente del
  directorio abierto en Kiro (o crea una sesión si no hay ninguna), en vez de
  quedarse en el directorio por defecto del servicio.
- **Contexto desde Kiro**: `OpenCode: Enviar archivo/selección como contexto`
  adjunta el archivo activo y el fragmento seleccionado al chat que tengas abierto
  en OpenCode, y lo enfoca. Si la sesión está ocupada, el mensaje queda en cola.
- **Referencias**: `OpenCode: Copiar referencia del archivo/selección` copia
  `@ruta/archivo:N-M` al portapapeles para pegarlo en el chat.

## Requisitos

### Para instalar el VSIX

- **Kiro** 1.94 o superior.
- **OpenCode v2** instalado y funcionando en la misma máquina:
  - El ejecutable debe estar en el `PATH` como `opencode`, o en
    `~/.opencode/bin/opencode`. También puedes indicar otra ruta con el ajuste
    `opencode.path`.
  - Comprueba que arranca el servicio:
    ```sh
    opencode service start
    opencode service status
    ```
  - La extensión lee el servicio de
    `${XDG_STATE_HOME:-$HOME/.local/state}/opencode/service.json`.
- **Sistemas**: Linux es el entorno probado. macOS debería funcionar si OpenCode
  usa la misma ruta de estado; instala el VSIX desde la UI de Kiro. Windows aún
  no está soportado (la extensión y los scripts asumen rutas Unix).

No necesitas Node, npm ni Bun para instalar el VSIX.

### Para compilar desde el código fuente

- Python 3.8 o superior (solo para empaquetar el VSIX).
- `git` y `bash`.

## Instalación rápida desde GitHub

1. Abre la última release:
   **https://github.com/McJigsaw12/opencode-kiro/releases/latest**
2. Descarga `opencode-kiro.vsix`.
3. En Kiro, abre la vista **Extensiones**, pulsa el menú `...` y elige
   **Install from VSIX...**. Selecciona el archivo descargado.
4. Recarga Kiro: `Ctrl+Shift+P` → **Developer: Reload Window**.
5. Abre OpenCode con el botón de la barra de estado o con `Ctrl+Alt+Shift+O`.

También puedes instalar por CLI si el comando `kiro` está disponible:

```sh
kiro --install-extension opencode-kiro.vsix
```

El enlace directo al VSIX de la última release es:

```text
https://github.com/McJigsaw12/opencode-kiro/releases/latest/download/opencode-kiro.vsix
```

## Instalación desde el código fuente

```sh
git clone https://github.com/McJigsaw12/opencode-kiro.git
cd opencode-kiro
./install.sh
```

El script empaqueta el VSIX con Python y lo instala con el CLI de Kiro. Si no
encuentra el CLI, muestra cómo instalarlo manualmente desde la UI de Kiro.

También puedes empaquetar sin instalar:

```sh
python3 scripts/package.py
# genera fghernandez.opencode-kiro-<versión>.vsix
```

Y instalar el archivo generado:

```sh
kiro --install-extension fghernandez.opencode-kiro-*.vsix
```

Si el comando `kiro` no está en el `PATH`, usa **Install from VSIX...** en Kiro o
indica las rutas del CLI:

```sh
KIRO_APP="$HOME/.local/share/kiro" \
KIRO_BIN="$KIRO_APP/kiro" \
KIRO_CLI="$KIRO_APP/resources/app/out/cli.js" \
./install.sh
```

## Uso

### Abrir y alternar

- Pulsa el botón **OpenCode** de la barra de estado.
- O usa `Ctrl+Alt+Shift+O` (`Cmd+Alt+Shift+O` en macOS).
- `OpenCode: Alternar OpenCode / chat de Kiro` hace lo mismo desde la paleta.
- `OpenCode: Abrir en pestaña del editor` abre la UI como editor normal.

### Enviar contexto desde Kiro

1. Abre un archivo y, si quieres, selecciona un fragmento.
2. Haz clic derecho en el editor y elige
   **OpenCode: Enviar archivo/selección como contexto**, o búscalo en la paleta
   de comandos.
3. La extensión:
   - busca el chat que tengas abierto en OpenCode (el último chat visto en ese
     workspace),
   - adjunta el archivo completo,
   - añade la referencia `@archivo:línea-inicio-línea-fin` y el texto
     seleccionado,
   - abre ese chat en la barra lateral.

El comando envía un mensaje real a la sesión. OpenCode no expone una API para
solo prellenar el campo de texto; si la sesión está trabajando, el mensaje queda
en cola.

### Workspace automático

Al abrir la UI, la extensión busca la sesión principal más reciente del
directorio abierto en Kiro y la abre. Si no existe ninguna, crea una. Esto hace
que OpenCode trabaje sobre el mismo proyecto que Kiro sin tener que seleccionarlo
a mano.

## Ajustes

| Ajuste | Por defecto | Descripción |
| --- | --- | --- |
| `opencode.path` | `opencode` | Ruta al ejecutable de OpenCode. Si se deja como `opencode`, se busca en el `PATH` y en `~/.opencode/bin`. |
| `opencode.autoStart` | `true` | Arrancar el servicio (`opencode service start`) si no está en marcha al abrir el panel. |
| `opencode.openInEditorColumn` | `left` | `left` grupo izquierdo, `right` grupo nuevo a la derecha, `active` grupo activo. |

## Comandos

| Comando | Descripción |
| --- | --- |
| `OpenCode: Abrir en pestaña del editor` | Abre la UI en un editor (según `opencode.openInEditorColumn`). |
| `OpenCode: Abrir en la barra derecha` | Muestra la UI en la barra lateral secundaria. |
| `OpenCode: Alternar OpenCode / chat de Kiro` | Si OpenCode está visible, muestra el chat de Kiro; si no, muestra OpenCode. Es lo que hace el botón de la barra de estado. |
| `OpenCode: Mostrar chat de Kiro` | Devuelve la barra derecha al chat de Kiro. |
| `OpenCode: Recargar` | Regenera el pairing y recarga el webview. |
| `OpenCode: Reiniciar servicio` | Ejecuta `opencode service restart` y recarga. |
| `OpenCode: Copiar referencia del archivo/selección` | Copia `@archivo:línea`. |
| `OpenCode: Enviar archivo/selección como contexto` | Adjunta el archivo y la selección al chat abierto y lo enfoca. |

## Cómo funciona

```text
Kiro (webview) ──iframe──▶ http://127.0.0.1:<puerto>/server/<clave>/session/<id>?auth_token=...
                                   ▲
                                   │ Basic opencode:<password>
                              ~/.local/state/opencode/service.json
```

- El webview solo contiene un `iframe` a pantalla completa. La CSP limita
  `frame-src` al origen local de OpenCode.
- El token de la UI se genera en cada carga con el flujo de pairing y caduca con
  el servidor. No se guarda en disco.
- `<clave>` es el base64url de la URL del servicio y `<id>` es la sesión del
  workspace de Kiro.
- La extensión reutiliza el servicio que ya esté corriendo; si no existe, lo
  arranca con `opencode service start`.

## Solución de problemas

- **“No se pudo abrir OpenCode”**: revisa **Ver → Resultados → OpenCode**
  (Output → OpenCode). Ahí aparecen el servicio detectado, el pairing y los
  errores.
- **`opencode` no encontrado**: instala OpenCode o configura `opencode.path` con
  la ruta absoluta del ejecutable.
- **El servicio no arranca**: ejecuta `opencode service start` en una terminal y
  comprueba `opencode service status`. En Linux/macOS el archivo de estado debe
  estar en `~/.local/state/opencode/service.json`.
- **No aparece el botón OpenCode**: recarga Kiro después de instalar el VSIX.
- **La UI queda en “Conectando…”**: ejecuta `./scripts/verify.sh` para probar el
  servicio y el pairing, o usa `opencode api get /api/info`.
- **El comando de contexto abre otra conversación**: abre el chat que quieras en
  OpenCode; la extensión usa el último chat visto en el workspace. Si el chat
  está corriendo, espera a que termine o envíalo después.

## Desarrollo y releases

El proyecto no tiene dependencias de npm. Para generar el VSIX:

```sh
python3 scripts/package.py
```

Para publicar una nueva versión:

1. Actualiza `version` en `package.json` y los textos de versión si hace falta.
2. Haz commit y push a `main`.
3. Crea y sube un tag:
   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. El workflow `.github/workflows/release.yml` construye el VSIX y crea la
   release con dos assets: el archivo versionado y `opencode-kiro.vsix` (nombre
   estable para el enlace `releases/latest/download/opencode-kiro.vsix`).

También puedes crear la release manualmente:

```sh
gh release create v0.2.0 \
  fghernandez.opencode-kiro-0.2.0.vsix \
  --title "OpenCode for Kiro 0.2.0" \
  --generate-notes
```

## Estructura

```text
extension.js              Lógica de la extensión (servicio, pairing, webview)
package.json              Manifest de la extensión
media/activity.svg        Icono de la barra lateral
scripts/package.py        Empaquetador VSIX sin dependencias
scripts/verify.sh         Diagnóstico del servicio y pairing
install.sh                Empaqueta e instala el VSIX
.github/workflows/       CI de releases
```

## Licencia

[MIT](LICENSE)
