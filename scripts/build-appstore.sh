#!/usr/bin/env bash
# Compila, firma y empaqueta Notely para la Mac App Store.
#
# Requisitos (una sola vez):
#   1. Apple Developer Program activo.
#   2. En https://developer.apple.com/account/resources/identifiers:
#      registra un App ID con el identifier de src-tauri/tauri.conf.json.
#   3. Certificados instalados en el llavero:
#        - "Apple Distribution: Tu Nombre (TEAMID)"
#        - "3rd Party Mac Developer Installer: Tu Nombre (TEAMID)"
#   4. Provisioning profile de tipo "Mac App Store" para ese App ID,
#      descargado en el disco.
#   5. La app creada en https://appstoreconnect.apple.com.
#
# Uso:
#   export APPLE_TEAM_ID="ABCDE12345"
#   export APPLE_SIGNING_IDENTITY="Apple Distribution: Tu Nombre (ABCDE12345)"
#   export APPLE_INSTALLER_IDENTITY="3rd Party Mac Developer Installer: Tu Nombre (ABCDE12345)"
#   export APPLE_PROVISIONING_PROFILE="$HOME/Downloads/Notely_MacAppStore.provisionprofile"
#   ./scripts/build-appstore.sh
#
# El resultado es target/appstore/Notely.pkg, listo para subir con la app
# Transporter (https://apps.apple.com/app/transporter/id1450874784).

set -euo pipefail
cd "$(dirname "$0")/.."

for var in APPLE_TEAM_ID APPLE_SIGNING_IDENTITY APPLE_INSTALLER_IDENTITY APPLE_PROVISIONING_PROFILE; do
  if [[ -z "${!var:-}" ]]; then
    echo "error: falta la variable de entorno $var (mira la cabecera de este script)" >&2
    exit 1
  fi
done

if [[ ! -f "$APPLE_PROVISIONING_PROFILE" ]]; then
  echo "error: no existe el provisioning profile: $APPLE_PROVISIONING_PROFILE" >&2
  exit 1
fi

IDENTIFIER=$(node -p "require('./src-tauri/tauri.conf.json').identifier")
PRODUCT_NAME=$(node -p "require('./src-tauri/tauri.conf.json').productName")
echo "==> App: $PRODUCT_NAME ($IDENTIFIER) · Team: $APPLE_TEAM_ID"

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
