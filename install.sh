#!/usr/bin/env bash
# Instala OpenCode for Kiro.
#
# Uso:
#   ./install.sh                      # empaqueta el VSIX y lo instala
#   ./install.sh archivo.vsix         # instala un VSIX ya descargado
#   ./install.sh https://...vsix      # descarga e instala un VSIX
#
# Variables opcionales:
#   KIRO_APP  Ruta de la instalación de Kiro
#   KIRO_BIN  Binario de Kiro
#   KIRO_CLI  Ruta de resources/app/out/cli.js
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

VSIX="${1:-}"
TMP_DIR=""
TMP_DOWNLOAD=""
TMP_EXTRACT=""

cleanup() {
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR"
  [ -n "$TMP_EXTRACT" ] && rm -rf "$TMP_EXTRACT"
}
trap cleanup EXIT

if [ -z "$VSIX" ]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "❌ Falta python3 para empaquetar el VSIX." >&2
    echo "   Instala Python 3 o descarga el VSIX desde GitHub Releases:" >&2
    echo "   https://github.com/McJigsaw12/opencode-kiro/releases/latest" >&2
    exit 1
  fi
  echo "==> Empaquetando extensión"
  VSIX=$(python3 scripts/package.py)
elif [[ "$VSIX" == http://* || "$VSIX" == https://* ]]; then
  if ! command -v curl >/dev/null 2>&1; then
    echo "❌ Falta curl para descargar el VSIX." >&2
    exit 1
  fi
  TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/opencode-kiro-XXXXXX")
  TMP_DOWNLOAD="$TMP_DIR/opencode-kiro.vsix"
  echo "==> Descargando $VSIX"
  curl -fL "$VSIX" -o "$TMP_DOWNLOAD"
  VSIX="$TMP_DOWNLOAD"
fi

if [ ! -f "$VSIX" ]; then
  echo "❌ No existe el archivo: $VSIX" >&2
  exit 1
fi

echo "==> VSIX: $VSIX"

# Detección del CLI de Kiro. El binario del escritorio lanza la GUI si se
# ejecuta directamente; el CLI real es resources/app/out/cli.js con
# ELECTRON_RUN_AS_NODE=1.
if [ -z "${KIRO_BIN:-}" ] || [ -z "${KIRO_CLI:-}" ]; then
  candidates=()
  if [ -n "${KIRO_APP:-}" ]; then
    candidates+=("$KIRO_APP")
  fi
  candidates+=("$HOME/.local/share/kiro")
  candidates+=("/Applications/Kiro.app/Contents/Resources/app")
  candidates+=("/usr/share/kiro")
  for app in "${candidates[@]}"; do
    if [ -f "$app/resources/app/out/cli.js" ]; then
      KIRO_APP="$app"
      KIRO_BIN="${KIRO_BIN:-$app/kiro}"
      KIRO_CLI="${KIRO_CLI:-$app/resources/app/out/cli.js}"
      break
    fi
    if [ -f "$app/out/cli.js" ]; then
      KIRO_APP="${app%/Contents/Resources/app}"
      KIRO_BIN="${KIRO_BIN:-$KIRO_APP/Contents/MacOS/Kiro}"
      [ -x "$KIRO_BIN" ] || KIRO_BIN="$KIRO_APP/Contents/MacOS/Electron"
      KIRO_CLI="${KIRO_CLI:-$app/out/cli.js}"
      break
    fi
  done
fi

run_with_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "${KIRO_TIMEOUT:-120}" "$@"
  else
    "$@"
  fi
}

kiro_cli() {
  if [ -n "${KIRO_CLI:-}" ] && [ -n "${KIRO_BIN:-}" ] && [ -f "$KIRO_CLI" ] && [ -x "$KIRO_BIN" ]; then
    run_with_timeout env ELECTRON_RUN_AS_NODE=1 "$KIRO_BIN" "$KIRO_CLI" "$@"
  elif command -v kiro >/dev/null 2>&1; then
    run_with_timeout kiro "$@"
  else
    return 127
  fi
}

installed=0
echo "==> Instalando extensión"
if kiro_cli --install-extension "$VSIX" --force; then
  installed=1
fi

if [ "$installed" -eq 0 ]; then
  echo "==> No se encontró el CLI de Kiro; se intentará la instalación manual."
  if command -v python3 >/dev/null 2>&1; then
    read -r PUBLISHER NAME VERSION < <(python3 - "$VSIX" <<'PY'
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    pkg = json.loads(archive.read("extension/package.json"))
print(pkg["publisher"], pkg["name"], pkg["version"])
PY
)
    target="$HOME/.kiro/extensions/${PUBLISHER}.${NAME}-${VERSION}"
    echo "==> Copiando a $target"
    rm -rf "$target"
    TMP_EXTRACT=$(mktemp -d)
    python3 - "$VSIX" "$TMP_EXTRACT" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    archive.extractall(sys.argv[2])
PY
    mkdir -p "$(dirname "$target")"
    cp -a "$TMP_EXTRACT/extension" "$target"
    echo "==> Reinicia Kiro para cargar la extensión."
  else
    echo "❌ No se pudo instalar automáticamente." >&2
    echo "   Abre Kiro → Extensiones → '...' → Install from VSIX..." >&2
    echo "   y selecciona: $VSIX" >&2
    exit 1
  fi
fi

if command -v kiro >/dev/null 2>&1 || [ -n "${KIRO_CLI:-}" ]; then
  if kiro_cli --list-extensions 2>/dev/null | grep -qx "sst-dev.opencode"; then
    echo "==> Desinstalando la extensión anterior (sst-dev.opencode)"
    kiro_cli --uninstall-extension sst-dev.opencode || true
  fi
fi

echo "✅ Listo."
echo "   Si Kiro ya estaba abierto: Ctrl+Shift+P → 'Developer: Reload Window'."
echo "   Atajo: Ctrl+Alt+Shift+O (Cmd+Alt+Shift+O en macOS) o el botón OpenCode de la barra de estado."
