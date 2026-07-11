#!/usr/bin/env bash
# Deploy-Skript fuer navi-vokabeltrainer.
# Voraussetzung: SSH-Key-Zugriff auf den Zielhost (DEPLOY_HOST) funktioniert
# (siehe docs/deploy.md).
#
# DEPLOY_HOST (Format user@host) wird entweder als Umgebungsvariable
# gesetzt oder aus deploy/deploy.local.env gelesen (gitignored, siehe
# .gitignore "# Env / secrets" - dort liegt der tatsaechliche interne
# Zielhost, damit er nicht im (potenziell oeffentlich gespiegelten) Repo
# landet).
#
# Usage: ./deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/deploy.local.env" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/deploy.local.env"
fi
HOST="${DEPLOY_HOST:?DEPLOY_HOST nicht gesetzt - siehe Kommentar oben (env var oder deploy/deploy.local.env)}"
REMOTE_DIR="/opt/navi-vokabeltrainer"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Erstinstallation (nur beim allerersten Deploy noetig):"
echo "    - Node.js aus dem Debian-12-Repo installieren (kein NodeSource)"
echo "    - dedizierten User 'navivoktrainer' anlegen (ohne Login-Shell)"
echo "    - /opt/navi-vokabeltrainer anlegen, Owner navivoktrainer"
echo "    - nginx installieren, deploy/nginx-navi-vokabeltrainer.conf einspielen"
echo "    - deploy/navi-vokabeltrainer.service nach /etc/systemd/system/ kopieren"
echo ""

echo "==> rsync App-Code (ohne node_modules/data/session.env - werden remote neu gebaut/behalten)"
# session.env existiert nur remote (einmalig bei der Erstinstallation
# generiertes SESSION_SECRET, nie im Repo) - ohne diesen Exclude loescht
# --delete die Datei bei jedem Deploy, weil sie lokal nicht existiert. Genau
# das ist am 2026-07-11 beim navi-name-Feature-Deploy passiert: Service
# ging in eine Crash-Restart-Schleife ("Failed to load environment files"),
# Seite war kurz per 502 nicht erreichbar, bis session.env manuell neu
# generiert wurde (kostete alle eingeloggten Nutzer ihre Session, aber
# keine Daten).
rsync -az --delete \
  --exclude 'node_modules' \
  --exclude 'data' \
  --exclude 'deploy' \
  --exclude 'session.env' \
  "$LOCAL_DIR"/ "$HOST:$REMOTE_DIR/"

echo "==> npm install --omit=dev (remote, als root, danach chown)"
ssh "$HOST" "cd $REMOTE_DIR && npm install --omit=dev && chown -R navivoktrainer:navivoktrainer $REMOTE_DIR"

echo "==> systemd reload + restart"
ssh "$HOST" "systemctl daemon-reload && systemctl enable --now navi-vokabeltrainer && systemctl restart navi-vokabeltrainer"

echo "==> Status:"
ssh "$HOST" "systemctl --no-pager status navi-vokabeltrainer | head -10"
