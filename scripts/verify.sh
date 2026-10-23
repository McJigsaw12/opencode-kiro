#!/usr/bin/env bash
# Comprueba el servicio de OpenCode y el flujo de pairing que usa la extensión.
set -euo pipefail

FILE="${XDG_STATE_HOME:-$HOME/.local/state}/opencode/service.json"

if [ ! -f "$FILE" ]; then
  echo "❌ No existe $FILE"
  echo "   Arranca OpenCode con: opencode service start"
  exit 1
fi

read -r URL PASSWORD < <(python3 - "$FILE" <<'PY'
import json, sys
info = json.load(open(sys.argv[1]))
print(info["url"], info["password"])
PY
)

AUTH=$(printf 'opencode:%s' "$PASSWORD" | base64 | tr -d '\n')
echo "==> Servicio: $URL"

INFO=$(curl -fsS "$URL/api/info" -H "authorization: Basic $AUTH")
echo "==> /api/info: $INFO"

CODE=$(curl -fsS -X POST "$URL/api/pair" -H "authorization: Basic $AUTH" | python3 -c "import json,sys;print(json.load(sys.stdin)['code'])")
TOKEN=$(curl -fsS "$URL/auth/connect/$CODE" -H "accept: application/json" -H "authorization: Basic $AUTH" | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
ENCODED=$(printf 'opencode:%s' "$TOKEN" | base64 | tr -d '\n')

echo "==> Pairing: OK (token de ${#TOKEN} caracteres)"
echo "==> URL de la UI: $URL/?auth_token=$ENCODED"
echo "✅ La extensión debería conectar sin problemas."
