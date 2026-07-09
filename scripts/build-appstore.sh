#!/usr/bin/env bash
# Compila, firma y empaqueta Notely para la Mac App Store.
#
# Requisitos (una sola vez):
#   1. Apple Developer Program activo.
#   2. En https://developer.apple.com/account/resources/identifiers:
#      registra el App ID "com.ale24dev.notely" (el identifier de
#      src-tauri/tauri.conf.json).
#   3. Certificados instalados en el llavero (Xcode → Settings → Accounts →
#      Manage Certificates → +):
#        - "Apple Distribution: Ale Díaz (9FU3PGG489)"
#        - "3rd Party Mac Developer Installer: Ale Díaz (9FU3PGG489)"
#      (el nombre exacto puede variar; el script los detecta solo)
#   4. Provisioning profile de tipo "Mac App Store" para ese App ID,
#      descargado en ~/Downloads (o exporta APPLE_PROVISIONING_PROFILE).
#   5. La app creada en https://appstoreconnect.apple.com.
#
# Uso normal (detecta certificados y profile automáticamente):
#   ./scripts/build-appstore.sh
#
# Todo es configurable por entorno: APPLE_TEAM_ID, APPLE_SIGNING_IDENTITY,
# APPLE_INSTALLER_IDENTITY, APPLE_PROVISIONING_PROFILE.
#
# El resultado es src-tauri/target/appstore/Notely.pkg, listo para subir con
# la app Transporter (https://apps.apple.com/app/transporter/id1450874784).

set -euo pipefail
cd "$(dirname "$0")/.."

APPLE_TEAM_ID="${APPLE_TEAM_ID:-9FU3PGG489}"

# Busca en el llavero una identidad de firma válida que case con el patrón.
find_identity() {
  local pattern="$1" policy identity
  for policy in macappstore basic codesigning; do
    identity=$(security find-identity -v -p "$policy" 2>/dev/null |
      sed -n "s/.*\"\(${pattern}[^\"]*(${APPLE_TEAM_ID})\)\".*/\1/p" | head -1)
    if [[ -n "$identity" ]]; then
      echo "$identity"
      return
    fi
  done
}

if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  APPLE_SIGNING_IDENTITY=$(find_identity "Apple Distribution: ")
fi
if [[ -z "${APPLE_INSTALLER_IDENTITY:-}" ]]; then
  APPLE_INSTALLER_IDENTITY=$(find_identity "3rd Party Mac Developer Installer: ")
fi

if [[ -z "$APPLE_SIGNING_IDENTITY" ]]; then
  echo "error: no se encontró el certificado 'Apple Distribution' del equipo $APPLE_TEAM_ID en el llavero." >&2
  echo "  Instálalo desde Xcode → Settings → Accounts → Manage Certificates → +," >&2
  echo "  o comprueba los disponibles con: security find-identity -v -p macappstore" >&2
  exit 1
fi
if [[ -z "$APPLE_INSTALLER_IDENTITY" ]]; then
  echo "error: no se encontró el certificado '3rd Party Mac Developer Installer' del equipo $APPLE_TEAM_ID." >&2
  echo "  Créalo en https://developer.apple.com/account/resources/certificates (tipo Mac Installer Distribution)." >&2
  exit 1
fi

# Provisioning profile: variable de entorno o el más reciente de ~/Downloads.
if [[ -z "${APPLE_PROVISIONING_PROFILE:-}" ]]; then
  APPLE_PROVISIONING_PROFILE=$(ls -t "$HOME"/Downloads/*.provisionprofile 2>/dev/null | head -1 || true)
fi
if [[ -z "$APPLE_PROVISIONING_PROFILE" || ! -f "$APPLE_PROVISIONING_PROFILE" ]]; then
  echo "error: no se encontró ningún provisioning profile (.provisionprofile)." >&2
  echo "  Descarga uno de tipo 'Mac App Store' desde" >&2
  echo "  https://developer.apple.com/account/resources/profiles" >&2
  echo "  o indica su ruta: export APPLE_PROVISIONING_PROFILE=/ruta/al/perfil.provisionprofile" >&2
  exit 1
fi

IDENTIFIER=$(node -p "require('./src-tauri/tauri.conf.json').identifier")
PRODUCT_NAME=$(node -p "require('./src-tauri/tauri.conf.json').productName")

echo "==> App:        $PRODUCT_NAME ($IDENTIFIER)"
echo "==> Team:       $APPLE_TEAM_ID"
echo "==> Firma app:  $APPLE_SIGNING_IDENTITY"
echo "==> Firma pkg:  $APPLE_INSTALLER_IDENTITY"
echo "==> Profile:    $APPLE_PROVISIONING_PROFILE"

echo "==> Generando entitlements"
sed -e "s/__TEAM_ID__/$APPLE_TEAM_ID/g" -e "s/__IDENTIFIER__/$IDENTIFIER/g" \
  src-tauri/entitlements/appstore.entitlements.in \
  > src-tauri/entitlements/appstore.entitlements

echo "==> Incrustando provisioning profile"
cp "$APPLE_PROVISIONING_PROFILE" src-tauri/embedded.provisionprofile

echo "==> Asegurando targets de Rust (binario universal)"
rustup target add aarch64-apple-darwin x86_64-apple-darwin

echo "==> Compilando y firmando (tauri build)"
# APPLE_SIGNING_IDENTITY la usa el bundler de Tauri para firmar la .app
# con los entitlements del overlay tauri.appstore.conf.json.
export APPLE_SIGNING_IDENTITY
npm run tauri build -- \
  --target universal-apple-darwin \
  --config src-tauri/tauri.appstore.conf.json

APP="src-tauri/target/universal-apple-darwin/release/bundle/macos/$PRODUCT_NAME.app"
if [[ ! -d "$APP" ]]; then
  echo "error: no se encontró $APP" >&2
  exit 1
fi

echo "==> Creando el paquete de instalación firmado"
mkdir -p src-tauri/target/appstore
PKG="src-tauri/target/appstore/$PRODUCT_NAME.pkg"
xcrun productbuild \
  --sign "$APPLE_INSTALLER_IDENTITY" \
  --component "$APP" /Applications \
  "$PKG"

echo
echo "✅ Listo: $PKG"
echo
echo "Siguiente paso — subirlo a App Store Connect:"
echo "  · Abre la app Transporter, inicia sesión con tu Apple ID y arrastra el .pkg."
echo "  · O por línea de comandos (necesita una API key de App Store Connect):"
echo "      xcrun altool --upload-app --type macos --file \"$PKG\" \\"
echo "        --apiKey <KEY_ID> --apiIssuer <ISSUER_ID>"
echo
echo "Después, en appstoreconnect.apple.com: selecciona el build, completa la"
echo "ficha (capturas, descripción, privacidad) y envía a revisión."
