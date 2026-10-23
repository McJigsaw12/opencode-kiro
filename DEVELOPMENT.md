# Desarrollo y publicación

Documentación para mantener y publicar **OpenCode for Kiro**. La guía de
instalación y uso está en [README.md](README.md).

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
- Antes de conectar comprueba que `/api/info` reporte una versión `2.x`.

## Estructura

```text
extension.js              Lógica de la extensión (servicio, pairing, webview)
package.json              Manifest de la extensión
media/activity.svg        Icono de la barra lateral
media/icon.png            Icono de la extensión (128x128)
docs/screenshot.png       Captura de la integración en Kiro
scripts/package.py        Empaquetador VSIX sin dependencias
scripts/test.js           Pruebas de ejecución, sesiones y parser SSE
scripts/verify.sh         Diagnóstico del servicio y pairing
install.sh                Empaqueta e instala el VSIX
.github/workflows/        CI, releases y publicación en Open VSX
```

## Compilar el VSIX

El proyecto no tiene dependencias de npm. Para generar el VSIX:

```sh
python3 scripts/package.py
```

El resultado es `fghernandez.opencode-kiro-<versión>.vsix`.

## Pruebas

```sh
node --check extension.js
node scripts/test.js
```

## Instalar desde el código fuente

```sh
git clone https://github.com/McJigsaw12/opencode-kiro.git
cd opencode-kiro
./install.sh
```

El script empaqueta el VSIX con Python y lo instala con el CLI de Kiro. Si no
encuentra el CLI, muestra cómo instalarlo manualmente desde la UI de Kiro.
`install.sh` es para Linux/macOS; en Windows usa Open VSX o el VSIX.

También puedes empaquetar sin instalar:

```sh
python3 scripts/package.py
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

## Publicar una release

1. Actualiza `version` en `package.json`.
2. Haz commit y push a `main`.
3. Crea y sube un tag:
   ```sh
   git tag v0.2.4
   git push origin v0.2.4
   ```
4. El workflow `.github/workflows/release.yml` construye el VSIX y crea la
   release con dos assets: el archivo versionado y `opencode-kiro.vsix` (nombre
   estable para el enlace `releases/latest/download/opencode-kiro.vsix`).

También puedes crear la release manualmente:

```sh
gh release create v0.2.4 \
  fghernandez.opencode-kiro-0.2.4.vsix \
  --title "OpenCode for Kiro 0.2.4" \
  --generate-notes
```

## Publicar en Open VSX

Kiro usa **Open VSX** como registro de extensiones. Para publicar una versión:

1. Crea una cuenta en https://open-vsx.org con GitHub.
2. Crea el namespace `fghernandez` (debe coincidir con `publisher` en
   `package.json`).
3. Genera un token en https://open-vsx.org/user-settings/tokens.
4. Guarda el token como secret del repo:
   ```sh
   gh secret set OPEN_VSX_TOKEN --repo McJigsaw12/opencode-kiro
   ```
5. Ejecuta el workflow con el tag que quieras publicar:
   ```sh
   gh workflow run publish-openvsx.yml -f ref=v0.2.4
   ```

El workflow construye el VSIX y lo publica con `ovsx`. Comprueba que el tag
coincida con la versión de `package.json` y puede crear el namespace si no
existe. La página pública es
https://open-vsx.org/extension/fghernandez/opencode-kiro.

No compartas el token de Open VSX. Si se filtra, revócalo en
https://open-vsx.org/user-settings/tokens y actualiza el secret
`OPEN_VSX_TOKEN`.
