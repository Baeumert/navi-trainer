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

# Selbstsigniertes TLS-Zertifikat + HTTPS-Server-Block ergaenzen. Grund: viele
# Browser stufen Subresource-Requests (CSS/JS) eigenstaendig auf HTTPS hoch
# ("Always use secure connections"-Einstellung bzw. diverse Extensions),
# selbst wenn die Seite selbst ganz normal per HTTP aufgerufen wurde - ohne
# einen funktionierenden HTTPS-Listener bricht das mit ERR_CONNECTION_REFUSED
# und einer komplett unstylten Seite (beobachtet+reproduziert 2026-07-13 bei
# einem echten Testinstall). Ein per Reverse-Proxy/eigener Domain mit echtem
# Zertifikat betriebenes Setup (siehe docs/deploy.md, "Oeffentlicher
# Zugriff") ersetzt diesen Block ohnehin durch die eigene TLS-Terminierung -
# dieses selbstsignierte Zertifikat ist nur eine sofort funktionierende
# Grundabsicherung fuer den direkten Erstzugriff per IP.
if [ ! -f /etc/nginx/ssl/navi-vokabeltrainer.crt ]; then
  mkdir -p /etc/nginx/ssl
  HOST_IP=$(hostname -I | awk '{print $1}')
  openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/navi-vokabeltrainer.key \
    -out /etc/nginx/ssl/navi-vokabeltrainer.crt \
    -subj "/CN=${HOST_IP:-localhost}" \
    -addext "subjectAltName=IP:${HOST_IP:-127.0.0.1}" >/dev/null 2>&1
fi
cat >> /etc/nginx/sites-available/navi-vokabeltrainer <<'NGINXEOF'

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name navi.diy-ehome.de _;
    server_tokens off;

    ssl_certificate /etc/nginx/ssl/navi-vokabeltrainer.crt;
    ssl_certificate_key /etc/nginx/ssl/navi-vokabeltrainer.key;

    location / {
        proxy_pass http://127.0.0.1:3700;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $navi_forwarded_proto;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINXEOF

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
if curl -fsk -o /dev/null https://127.0.0.1/; then
  echo "nginx antwortet auf Port 443 (selbstsigniertes Zertifikat)."
else
  echo "WARNUNG: HTTPS antwortet nicht - 'nginx -t' und 'journalctl -u nginx' pruefen." >&2
fi

cat <<EOF

Fertig. Naechste Schritte:
  1. Im Browser oeffnen unter http://${HOST_IP:-<Server-IP>}/ oder
     https://${HOST_IP:-<Server-IP>}/ und die ERSTE Registrierung
     durchfuehren - dieses Konto wird automatisch Admin (kein Seed-Admin
     vorhanden). Bei HTTPS zeigt der Browser wegen des selbstsignierten
     Zertifikats einmalig eine Warnung ("Erweitert" -> "Trotzdem
     fortfahren") - das ist erwartet, kein Fehler.
  2. Optional Prioritaets-Vokabular importieren:
     su -s /bin/sh navivoktrainer -c "cd /opt/navi-vokabeltrainer && npm run import-priority-vocab-fwew"
  3. Fuer echten oeffentlichen Betrieb: eigene Domain in
     /etc/nginx/sites-available/navi-vokabeltrainer eintragen, echtes
     Zertifikat (z.B. Let's Encrypt/certbot) statt des selbstsignierten
     einrichten, Impressum/Datenschutz im Code an die eigene Rechtslage
     anpassen - siehe docs/deploy.md und README.md ("Eigenes Deployment").
EOF
