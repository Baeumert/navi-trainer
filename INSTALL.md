# Installation

Getestet 2026-07-13 mit einem **frischen** Debian-12-Container (2 Cores,
2 GB RAM, 12 GB Disk), komplett von null bis laufender Instanz per
[`deploy/install.sh`](deploy/install.sh) - Skript und diese Anleitung
beschreiben exakt den Ablauf, der dabei tatsächlich funktioniert hat, nicht
nur die theoretische Vorgehensweise aus `docs/deploy.md`.

## Schnellstart

Als `root` auf einem frischen Debian 12 Host:

```bash
curl -fsSL https://raw.githubusercontent.com/Baeumert/navi-trainer/main/deploy/install.sh | bash
```

Oder nach manuellem Klonen:

```bash
git clone https://github.com/Baeumert/navi-trainer.git
cd navi-trainer
./deploy/install.sh
```

Das Skript ist idempotent - ein erneuter Lauf auf einem bereits
installierten Host aktualisiert Code (`git pull`) und Dependencies, ohne
`session.env` oder die SQLite-Datenbank anzufassen.

## Was das Skript macht

1. Basis-Pakete installieren: `git curl ca-certificates rsync nginx build-essential`.
2. Node.js 20 LTS als offizielles Binary unter `/opt/nodejs-v20.20.2`
   installieren, `node`/`npm`/`npx`/`corepack` nach `/usr/local/bin`
   verlinken (kein apt/NodeSource-Paket - Grund siehe unten).
3. Repo nach `/opt/navi-vokabeltrainer` klonen.
4. Dedizierten, unprivilegierten Service-User `navivoktrainer` anlegen.
5. `session.env` mit einem frisch generierten `SESSION_SECRET` anlegen
   (nur beim ersten Lauf).
6. `npm ci --omit=dev` als Service-User ausführen.
7. systemd-Unit und nginx-Reverse-Proxy-Config aus `deploy/` einspielen,
   Dienst aktivieren und starten.
8. Smoke-Test gegen `http://127.0.0.1:3700/`.

## Danach

1. Im Browser öffnen (über nginx auf Port 80, oder testweise direkt Port
   3700) und die **erste Registrierung** durchführen - dieses Konto wird
   automatisch Admin (kein Seed-Admin, Bootstrap-Regel in `routes/auth.js`,
   greift nur bei leerer `users`-Tabelle).
2. Optional Prioritäts-Vokabular importieren:
   ```bash
   su -s /bin/sh navivoktrainer -c "cd /opt/navi-vokabeltrainer && npm run import-priority-vocab-fwew"
   ```
3. Für echten öffentlichen Betrieb: eigene Domain in
   `/etc/nginx/sites-available/navi-vokabeltrainer` eintragen, TLS
   einrichten (eigenes nginx oder vorgeschalteter Reverse Proxy),
   Impressum/Datenschutz im Code an die eigene Rechtslage anpassen (siehe
   `docs/deploy.md`, Abschnitt "Öffentlicher Zugriff").

## Erkenntnisse aus dem Testlauf (Stolperfallen für Nachbauer)

Diese vier Punkte standen so nicht explizit in der bisherigen
`docs/deploy.md` und haben den ersten unbeaufsichtigten Lauf gebrochen -
`install.sh` deckt sie jetzt automatisch ab, wer manuell installiert sollte
sie kennen:

- **`rsync` ist auf einem frischen Debian-12-Image nicht vorinstalliert**,
  obwohl `deploy/deploy.sh` (für Updates von einer Entwicklungsmaschine
  aus) es voraussetzt und man naiv annehmen könnte, es sei Teil des
  Basissystems. Explizit mit installieren.
- **Kein `sudo` auf einem minimalen Image.** Kommandos, die als
  `navivoktrainer` statt `root` laufen sollen (`npm ci`, `npm run ...`),
  über `su -s /bin/sh navivoktrainer -c "..."` ausführen statt `sudo -u`.
- **`apt-get install` ohne `DEBIAN_FRONTEND=noninteractive`** wirft in
  einer Nicht-TTY-Session (z.B. über ein Deploy-Skript oder CI)
  harmlose, aber verwirrende `debconf: unable to initialize frontend`-
  Warnungen aus - unterdrückt durch das Setzen der Variable, kein
  eigentlicher Fehler.
- **`better-sqlite3` braucht i.d.R. keinen lokalen Compiler** - es lädt
  beim `npm ci` ein vorkompiliertes Binary (`prebuild-install`) passend zu
  Node-Version/Architektur nach. `build-essential` wird trotzdem
  mitinstalliert als Fallback für den Fall, dass für eine bestimmte
  Node-/CPU-Kombination kein vorkompiliertes Binary existiert und lokal
  gebaut werden muss.

## Bekannte, bereits dokumentierte Besonderheiten

Siehe `docs/deploy.md` für Details, hier nur die Kurzfassung:

- **Node 18 funktioniert nicht** - wird von Cloudflare vor der Fwew-API per
  TLS-Fingerprinting mit 403 geblockt. Node 20 LTS ist Pflicht, nicht nur
  Empfehlung.
- Die App selbst hört nur auf `127.0.0.1:3700` - für echten Zugriff von
  außen muss ein Reverse Proxy davor (nginx-Config liegt bei).
- `SESSION_SECRET` liegt ausschließlich remote in `session.env`, nie im
  Repo - bei eigenen Updates/Sync-Skripten unbedingt von destruktiven
  Sync-Befehlen (`rsync --delete` o.ä.) ausschließen.
