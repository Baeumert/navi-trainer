#!/usr/bin/env bash
# navi-trainer - Erstinstallation auf einem frischen Debian 12 Host (root).
# Getestet 2026-07-13 auf einem frischen Debian-12-Container, 2 Cores/2GB/12GB.
#
# Verwendung:
#   curl -fsSL https://raw.githubusercontent.com/Baeumert/navi-trainer/main/deploy/install.sh | bash
# oder lokal nach dem Klonen:
#   ./deploy/install.sh
set -euo pipefail

REPO_URL="https://github.com/Baeumert/navi-trainer.git"
APP_DIR="/opt/navi-vokabeltrainer"
SVC_USER="navivoktrainer"
NODE_VERSION="20.20.2"

if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte als root ausfuehren." >&2
  exit 1
fi

echo "==> Basis-Pakete installieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# git/curl/rsync/nginx sind auf einem frischen Debian-12-Minimal-Image NICHT
# vorinstalliert (rsync fehlt selbst auf einer sonst recht vollstaendigen
# Standard-LXC-Vorlage) - alle vier hier explizit installieren, nicht
# stillschweigend voraussetzen.
apt-get install -y -qq git curl ca-certificates rsync nginx build-essential

echo "==> Node.js ${NODE_VERSION} LTS installieren (offizielles Binary, kein apt/NodeSource)"
# Grund: Node 18 (Debian-Repo-Version) wird von Cloudflare vor der Fwew-API
# per TLS-Fingerprinting geblockt (403 auf jeden Request) - siehe docs/deploy.md.
if ! command -v node >/dev/null || [ "$(node -v)" != "v${NODE_VERSION}" ]; then
  tmpfile=$(mktemp)
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o "$tmpfile"
  mkdir -p "/opt/nodejs-v${NODE_VERSION}"
  tar -xJf "$tmpfile" -C "/opt/nodejs-v${NODE_VERSION}" --strip-components=1
  rm -f "$tmpfile"
  for b in node npm npx corepack; do
    ln -sf "/opt/nodejs-v${NODE_VERSION}/bin/$b" "/usr/local/bin/$b"
  done
fi
node -v
npm -v

echo "==> Anwendung holen"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  rm -rf "$APP_DIR"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi

echo "==> Dedizierten Service-User anlegen"
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$SVC_USER"
mkdir -p "$APP_DIR/data"
chown -R "$SVC_USER:$SVC_USER" "$APP_DIR"

echo "==> SESSION_SECRET generieren (falls noch nicht vorhanden)"
if [ ! -f "$APP_DIR/session.env" ]; then
  echo "SESSION_SECRET=$(openssl rand -hex 32)" > "$APP_DIR/session.env"
  chmod 600 "$APP_DIR/session.env"
  chown "$SVC_USER:$SVC_USER" "$APP_DIR/session.env"
fi

echo "==> Dependencies installieren (als Service-User, kein sudo noetig - manche Minimal-Images haben keins)"
su -s /bin/sh "$SVC_USER" -c "cd '$APP_DIR' && /usr/local/bin/npm ci --omit=dev"

echo "==> systemd-Unit + nginx-Reverse-Proxy einrichten"
cp "$APP_DIR/deploy/navi-vokabeltrainer.service" /etc/systemd/system/
cp "$APP_DIR/deploy/nginx-navi-vokabeltrainer.conf" /etc/nginx/sites-available/navi-vokabeltrainer
ln -sf /etc/nginx/sites-available/navi-vokabeltrainer /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
systemctl daemon-reload
systemctl enable --now navi-vokabeltrainer

sleep 2
echo "==> Smoke-Test"
if curl -fs -o /dev/null http://127.0.0.1:3700/; then
  echo "App antwortet auf Port 3700."
else
  echo "WARNUNG: App antwortet nicht - 'systemctl status navi-vokabeltrainer' und 'journalctl -u navi-vokabeltrainer' pruefen." >&2
fi

cat <<'EOF'

Fertig. Naechste Schritte:
  1. Ueber den konfigurierten Host (nginx auf Port 80, oder direkt Port 3700)
     im Browser oeffnen und die ERSTE Registrierung durchfuehren - dieses
     Konto wird automatisch Admin (kein Seed-Admin vorhanden).
  2. Optional Prioritaets-Vokabular importieren:
     su -s /bin/sh navivoktrainer -c "cd /opt/navi-vokabeltrainer && npm run import-priority-vocab-fwew"
  3. Fuer echten oeffentlichen Betrieb: eigene Domain in
     /etc/nginx/sites-available/navi-vokabeltrainer eintragen, TLS
     (eigenes nginx oder vorgeschalteter Reverse Proxy) einrichten,
     Impressum/Datenschutz im Code an die eigene Rechtslage anpassen -
     siehe docs/deploy.md und README.md ("Eigenes Deployment").
EOF
