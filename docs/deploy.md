# Deploy: navi-vokabeltrainer

## Infrastruktur

Diese Deploy-Doku beschreibt die Vorgehensweise generisch - die
konkreten Zielhost-Details (Hostname/IP, Netzwerksegment, Zugangsdaten)
sind bewusst **nicht** Teil dieses öffentlichen Repos, sondern liegen in
der jeweiligen internen Betriebsdokumentation. Referenz-Setup:

- Kleine Linux-VM/-Container (getestet: Debian 12), 2 Cores / 2 GB RAM /
  12 GB Disk reichen für den aktuellen Funktionsumfang.
- SSH-Zugriff per Public-Key-Auth (kein Passwort-Login).
- Läuft idealerweise in einem eigenen, vom übrigen Netz isolierten Segment
  (z.B. eigenes VLAN/eigene DMZ), da die App öffentlich über das Internet
  erreichbar ist.

`DEPLOY_HOST` (Format `user@host`) für `deploy/deploy.sh` entweder als
Umgebungsvariable setzen oder in `deploy/deploy.local.env` ablegen (per
`.gitignore` bewusst nie Teil des Repos - siehe Kommentar im Skript).

## SSH-Zugriff

Falls der Zielhost in einem separaten/isolierten Netzwerksegment liegt,
kann der SSH-Handshake spürbar länger dauern als im lokalen Netz üblich -
dann bei SSH-Befehlen ein grosszügiges `ConnectTimeout` (z.B. 35s)
verwenden, nicht nach wenigen Sekunden abbrechen. Kein Grund, das
vorschnell als Firewall-/Fail2ban-Problem zu deuten.

## Node.js-Version: 20 LTS, offizielles Binary (kein apt/NodeSource)

Debian 12s Repo-Node (18.x) wurde durch ein offizielles Node-20-LTS-Binary
von nodejs.org ersetzt - notwendig, weil Node 18s TLS/HTTP-Stack von
Cloudflare (das vor der Fwew-API steht, siehe `lib/fwew.js`) konsequent
geblockt wurde (403 auf jeden Request, unabhängig vom User-Agent), waehrend
Node 20 vom selben Host aus anstandslos durchkam. Root-Ursache: unterschiedliches
TLS-Fingerprinting je nach Node/OpenSSL-Version, nicht die IP.

Installiert unter `/opt/nodejs-v20.20.2` (offizielles Tarball, kein
Drittanbieter-Apt-Repo), `node`/`npm`/`npx`/`corepack` via
`/usr/local/bin/*`-Symlinks systemweit verfügbar gemacht, die alten
Debian-Pakete (`nodejs`, `npm`) entfernt - damit läuft die ganze Maschine
konsistent auf einer Node-Version, kein Nebeneinander zweier Installationen.
Bei einer Neuinstallation dieser LXC entsprechend nachbauen:

```bash
cd /tmp
curl -fsSL https://nodejs.org/dist/v20.20.2/node-v20.20.2-linux-x64.tar.xz -o node20.tar.xz
mkdir -p /opt/nodejs-v20.20.2
tar -xJf node20.tar.xz -C /opt/nodejs-v20.20.2 --strip-components=1
ln -sf /opt/nodejs-v20.20.2/bin/node /usr/local/bin/node
ln -sf /opt/nodejs-v20.20.2/bin/npm /usr/local/bin/npm
ln -sf /opt/nodejs-v20.20.2/bin/npx /usr/local/bin/npx
ln -sf /opt/nodejs-v20.20.2/bin/corepack /usr/local/bin/corepack
```

`deploy/navi-vokabeltrainer.service` zeigt entsprechend auf
`/usr/local/bin/node`, nicht `/usr/bin/node`.

## Erstinstallation

```bash
apt-get update && apt-get install -y nginx
# Node.js: siehe Abschnitt oben (offizielles Binary, kein apt-Paket)

# dedizierter unprivilegierter User, kein Login-Shell
useradd --system --home /opt/navi-vokabeltrainer --shell /usr/sbin/nologin navivoktrainer
mkdir -p /opt/navi-vokabeltrainer/data
chown -R navivoktrainer:navivoktrainer /opt/navi-vokabeltrainer

# SESSION_SECRET generieren (32 Byte hex), NICHT ins Repo committen
echo "SESSION_SECRET=$(openssl rand -hex 32)" > /opt/navi-vokabeltrainer/session.env
chmod 600 /opt/navi-vokabeltrainer/session.env
chown navivoktrainer:navivoktrainer /opt/navi-vokabeltrainer/session.env

cp deploy/navi-vokabeltrainer.service /etc/systemd/system/
cp deploy/nginx-navi-vokabeltrainer.conf /etc/nginx/sites-available/navi-vokabeltrainer
ln -s /etc/nginx/sites-available/navi-vokabeltrainer /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Danach mit gesetztem `DEPLOY_HOST` (siehe "Infrastruktur" oben)
`./deploy/deploy.sh` von einer Maschine mit SSH-Zugriff auf den Zielhost
ausführen (rsync + npm install + systemd restart).

## Öffentlicher Zugriff

Die App selbst hört nur auf `127.0.0.1:3700` (siehe
`deploy/navi-vokabeltrainer.service`). Für den öffentlichen Zugriff einen
Reverse Proxy davorsetzen, der auf diesen Port zeigt und die eigene Domain
terminiert (Beispielkonfiguration: `deploy/nginx-navi-vokabeltrainer.conf`).
Egal ob lokales nginx direkt mit TLS, oder ein vorgeschalteter externer
Reverse Proxy (z.B. Nginx Proxy Manager, Caddy, Traefik) der nur HTTP an
diese Ebene weiterreicht - wichtig ist nur, dass `X-Forwarded-Proto`
korrekt gesetzt wird (siehe Kommentar in der nginx-Config), sonst hält
Express (`trust proxy`) HTTPS-Requests fälschlich für unverschlüsselt.

## Erster Admin-User

Kein Seed-Admin wird automatisch angelegt. Die **erste Person, die sich über
`/#/` registriert, wird automatisch Admin** (Bootstrap-Regel in
`routes/auth.js`, greift nur wenn die `users`-Tabelle leer ist). Ronny sollte
sich also direkt nach dem ersten Start als Erstes registrieren.

## Datenmodell (Live-Fwew-Modus, seit der Umstellung)

Vokabeln (Na'vi-Wort + Übersetzungen) werden **nicht mehr lokal
gespeichert**. Stattdessen laedt `lib/fwew.js` beim Serverstart (und danach
periodisch) das komplette Woerterbuch live von der Fwew-API
(`tirea.learnnavi.org/api`) in einen Prozess-Cache; DB-Tabellen
referenzieren nur noch die dortige Wort-ID.

- `users` (id, name, email, password_hash, is_admin, is_creator,
  is_reviewer, welcome_seen)
- `progress` (user_id, vocab_id **TEXT**, direction, level, due_at,
  correct_count, wrong_count, last_seen) - `vocab_id` ist die Fwew-ID.
- `activation` (user_id, vocab_id **TEXT**, activated_at)
- `vocab_priority` (fwew_id, priority_date) - Priorisierungsquelle,
  bewusst nur ID + Datum, kein Wortinhalt.
- `vocab` sowie `progress_legacy`/`activation_legacy` (alte INTEGER-Form)
  bleiben aus der Migration erhalten, werden aber vom Live-Modus nicht mehr
  gelesen - siehe "Vokabel-Editor" unten.
- `grammar_exercises`, `grammar_attempts` - siehe "Grammatik-Baukasten"
  unten, unabhängig vom Vokabeltrainer-Datenmodell. `creator_id`/
  `reviewer_id` sind nullable (rename-copy-drop-Migration in `lib/db.js`) -
  eine Konto-Löschung setzt sie auf `NULL` statt die Übung zu löschen,
  siehe "Datenschutz" unten.
- `grammar_credits` (id, user_id **nullable, kein Fremdschlüssel**,
  display_name, exercise_count, modules JSON, created_at, updated_at) -
  einmaliger Danksagungs-Eintrag pro Person bei erster erfolgreicher
  Übungs-Freigabe, bewusst ohne FK auf `users`, damit der Eintrag eine
  spätere Konto-Löschung übersteht (siehe "Datenschutz" unten).

## Vokabel-Editor (pausiert)

Der frühere lokale Vokabel-Editor (`routes/vocab.js`, `vocab`-Tabelle,
CSV-Import) ist **nicht gelöscht, aber deaktiviert** (Mount in `server.js`
auskommentiert, Nav-Link ausgeblendet) - ersetzt durch den Live-Fwew-Modus.
Die dazugehörigen Wörterbuch-CSV-Exports (`sources/*/dict-navi*.csv`,
`vokabelliste-anfaenger-reyknap*.csv`) wurden bei der Umstellung bewusst aus
dem Repo entfernt, damit keine Vokabeldaten mehr im Projekt selbst liegen.
Reaktivierung des Editors braucht daher: die CSVs manuell wieder unter
`sources/` ablegen, Mount-Zeile in `server.js` einkommentieren, Nav-Link in
`public/index.html` wieder sichtbar machen.

## Priorisierung im Live-Modus

`vocab_priority` wird aus `app/db/priority-seed.json` befüllt - einer reinen
Fwew-ID+Datum-Liste (kein Wortinhalt), einmalig aus der (inzwischen
entfernten) Reyknap-Liste erzeugt:

```bash
cd app
npm run import-priority-vocab-fwew
```

Weitere Priorisierungen laufen über die Admin-UI (`#/admin`, Abschnitt
"Priorisierung") bzw. `POST/DELETE /api/admin/priority`.

## Migration bestehender Lernstände (einmalig, beim Umstieg auf Live-Fwew)

Vor dem ersten Deploy dieser Umstellung auf eine Instanz mit bereits
vorhandenen Nutzerdaten:

```bash
cd app
cp data/navi-vokabeltrainer.db data/navi-vokabeltrainer.db.bak-pre-fwew-migration
npm run migrate-progress-to-fwew
npm run import-priority-vocab-fwew
```

`migrate-progress-to-fwew.js` übernimmt Lernstände/Aktivierungen aus den
automatisch angelegten `*_legacy`-Tabellen (Na'vi-Text-Match gegen den
Fwew-Cache) und meldet nicht zuordenbare Wörter statt sie stillschweigend zu
verwerfen.

## Oberfläche / Mehrsprachigkeit (15 Sprachen)

Kein Build-Step, Vanilla-JS-SPA (`public/js/app.js` + `public/js/i18n.js`,
Hash-Routing über `route()`). UI-Sprachen: DE, EN, ES, ET, FR, HU, IT, KO,
NL, PL, PT, RU, SV, TR, UK - bewusst deckungsgleich mit den von Fwew
gelieferten Übersetzungssprachen (`lib/fwew.js` `LANGUAGE_FIELDS`), da die
gewählte UI-Sprache auch bestimmt, welche Fwew-Übersetzung im Trainer
angezeigt wird (`currentLang.toUpperCase()` als Fwew-Sprachcode).

Jede Sprache hat eine eigene Datei `public/i18n/<code>/translation.json`
(async per `fetch` geladen, `i18n.js` `loadTranslations()`), aktuell 242
Keys pro Sprache. **Bei jeder neuen UI-Zeichenkette müssen alle 15 Dateien
ergänzt werden** - sonst fällt `t()` beim Rendern auf Englisch, dann auf
den rohen Key-Namen zurück (`I18N_CACHE[currentLang]` → `I18N_CACHE.en` →
Key selbst). Konsistenz-Check:

```bash
cd app/public/i18n
for f in */translation.json; do python3 -c "import json; print('$f', len(json.load(open('$f'))))"; done
```

Impressum/Datenschutzerklärung sind bewusst **nur auf Deutsch** hartcodiert
in `app.js` (`renderImpressum`/`renderDatenschutz`), nicht über i18n -
rechtliche Pflichtangaben sollen nicht automatisiert übersetzt werden
können. Quellen/Danksagung (`renderQuellen`/`renderDanksagung`) sind normal
über i18n in allen 15 Sprachen.

## Grammatik-Baukasten (Conlang-Trainer)

Zweites, unabhängiges Lernmodul (`#/grammatik`) neben dem Vokabeltrainer -
regelbasierte Übungen zu Infix-Platzierung, Ergativ/Akkusativ-Suffixen und
Lenisierung. **NON-AI-POLICY**: keine generative KI beteiligt, Inhalte
kommen von Menschen, Auswertung läuft ausschließlich über die reinen
Funktionen in `app/lib/grammar/{infix,lenition,suffix}.js`.

- Rollen `users.is_creator` / `users.is_reviewer` (zusätzliche Flags neben
  `is_admin`, mehrere Rollen kombinierbar) - Vergabe über `#/admin`.
  `middleware/guards.js` `requireCreator`/`requireReviewer` lassen
  `req.session.isAdmin` immer durch (Admin hat implizit alle Rechte, keine
  eigenen Flags nötig).
- Workflow: `POST /api/grammar/exercises` legt eine Übung mit
  `status='pending'` an (für Lernende unsichtbar) → Reviewer gibt über
  `POST /api/grammar/exercises/:id/review` frei (`active`) oder lehnt ab
  (`rejected`, mit `review_note`) → Creator kann abgelehnte/ausstehende
  Übungen per `PATCH` überarbeiten (setzt Status zurück auf `pending`).
- `GET /api/grammar/exercises?module=` liefert nur `active`-Übungen und
  filtert je Modul die korrekte Antwort heraus (`learnerView()` in
  `routes/grammar.js`) - die Lösung ist erst nach `POST .../attempt`
  sichtbar.
- Modul C (Lenisierung): die Konsonanten-Tabelle (p→f, t→s, k→h, ts→s,
  kx→k, px→p, tx→t, '→entfällt) ist im Code fest hinterlegt
  (`lib/grammar/lenition.js`). Präfix-Lautformen vor Lenisierung (z.B.
  "ay+"→"a+") sind dagegen **Creator-Eingabe pro Übung**
  (`prefix_realization`-Feld), nicht hartcodiert.

## Datenschutz: Löschung, Auskunft, Community-Credits

- **Konto-Löschung** (Art. 17 DSGVO): `DELETE /api/auth/me` (self, verlangt
  aktuelles Passwort im Body) und `DELETE /api/admin/users/:id` (Admin)
  laufen beide über `lib/userDeletion.js` `anonymizeAndDeleteUser()`. Diese
  löscht die `users`-Zeile (Cascade räumt `progress`/`activation`/
  `grammar_attempts` automatisch mit ab), setzt aber
  `grammar_exercises.creator_id`/`reviewer_id` nur auf `NULL` statt die
  Übung zu löschen - Community-Inhalt bleibt bestehen. Letzter
  verbleibender Admin kann sich nicht selbst löschen (`cannot_delete_last_admin`,
  gleicher Schutz wie beim Admin-Demote).
- **Auskunftsrecht** (Art. 15 DSGVO): `GET /api/auth/me/export.json`/`.csv`
  (`routes/auth.js` `gatherUserData()`/`toCsv()`) liefern Account, Vokabel-
  Fortschritt/Aktivierung, Grammatik-Antworten sowie eigene und gereviewte
  Übungen. Beide Formate nutzen dieselbe Datenquelle, damit sie garantiert
  deckungsgleich bleiben.
- **Community-Credits**: `routes/grammar.js` `creditCreatorForApproval()`
  läuft nur im `approve`-Zweig von `POST /exercises/:id/review`, upsertet
  einen `grammar_credits`-Eintrag (erstes Approval legt an, weitere
  erhöhen `exercise_count` und mergen `modules`). `GET /api/grammar/credits`
  ist bewusst **vor** `router.use(requireAuth)` gemountet (öffentlich, die
  Danksagungen-Seite ist auch ohne Login erreichbar).

## Responsive Design

Kein separates Mobile-Markup - dieselbe SPA passt sich per CSS-Breakpoints
in `public/css/style.css` an (kein Framework, reines CSS):

- **≤880px** (Tablet): Nav klappt in ein Hamburger-Menü (`#navToggle`,
  Klasse `.nav-open` auf `#topnav`) statt der Desktop-Hover-Dropdowns -
  Touch-Geräte kennen kein `:hover`. Die Untermenüs (Vokabeltrainer/
  Grammatik) bleiben darin permanent aufgeklappt sichtbar. Tabellen
  scrollen horizontal (`table { display:block; overflow-x:auto }`).
- **≤560px** (Smartphone): weitere Verkleinerung von Schrift/Padding bei
  Hero, Karten, Flashcards, Grammatik-Übungen, Tour-Tooltips.
- Grid-Layouts (`.grid-2`, `.vocab-form-grid`) brauchten keine eigenen
  Breakpoints - `grid-template-columns: repeat(auto-fit, minmax(...))`
  bricht auf schmalen Viewports automatisch auf eine Spalte um.
- Die Welcome-Tour (`drawTourStep()` in `app.js`) öffnet das mobile Menü
  automatisch, wenn der aktuelle Tour-Schritt auf ein Nav-Element zielt
  (sonst wäre `getBoundingClientRect()` auf dem unsichtbaren Element 0),
  und schließt es beim Beenden (`finishTour()`) wieder.

## Bekannte Stolperfallen (aus echten Vorfällen, 2026-07-10)

- **rsync mit `--delete` niemals aus dem falschen Verzeichnis ausführen.**
  `cd app && rsync ... ./ root@.../opt/navi-vokabeltrainer/` ist korrekt.
  Aus dem Repo-Root ausgeführt (`navi-lernwebseite/` statt
  `navi-lernwebseite/app/`) kopiert derselbe Befehl die falsche
  Verzeichnisstruktur (README.md, `docs/`, `src/`, `sources/`, `.git/`
  landen auf oberster Ebene) und **löscht wegen `--delete` gleichzeitig
  den kompletten laufenden App-Code**, inklusive `node_modules` (das nicht
  explizit ausgeschlossen war, weil es im Quellverzeichnis `app/` gar nicht
  existiert - `npm install` läuft separat). Live passiert, während dieses
  Vorfalls. Merksatz: **vor jedem Deploy mit `--delete` erst `pwd`
  prüfen.**
  - Noch gefährlicher: rsync mit `--delete` von einem Unterordner in sein
    **eigenes Elternverzeichnis** (`app/` → `./` wenn `./` bereits `app/`
    enthält) lässt Quelle und Ziel überlappen - rsync kann dann Dateien im
    Quellverzeichnis löschen, während es noch versucht, sie zu lesen
    (`file has vanished`-Fehler). Deshalb beim Reparieren **nie** mit
    `--delete` aus einem Verzeichnis heraus synchronisieren, das die Quelle
    selbst enthält.
  - Wiederherstellung im konkreten Fall: vollständiger, nicht-destruktiver
    rsync (ohne `--delete`) von einer sauberen lokalen Kopie aus `app/` auf
    das Zielverzeichnis, danach `npm ci --omit=dev` für `node_modules` und
    `systemctl restart`. Die SQLite-DB (`data/`) war die ganze Zeit sicher,
    da sie im Deploy-Befehl immer `--exclude data` bekommt.
- **`[hidden]`-Attribut kann von eigenem CSS überstimmt werden.** Die
  UA-Stylesheet-Regel `[hidden] { display: none }` verliert laut
  CSS-Kaskade gegen JEDE Autor-Regel mit `display`-Eigenschaft auf
  demselben Element, unabhängig von der Spezifität (Origin-Priorität
  schlägt Spezifität) - z.B. `.topnav { display: flex; }` unconditional
  gesetzt. Das betraf `#topnav`/`#navToggle` (Nav-Sichtbarkeit bei Logout),
  war aber unentdeckt, weil dieses Verhalten bisher nur per curl/API,
  nie visuell in einem echten Browser getestet wurde. Fix: genereller
  Reset `[hidden] { display: none !important; }` ganz am Anfang von
  `style.css` - garantiert, dass das `hidden`-Attribut immer greift, egal
  welche Klasse sonst noch `display` auf demselben Element setzt.

- **`rsync --delete` loescht remote-only Dateien, die nicht explizit
  excluded sind - traf `session.env`.** Analog zum `data`-Ordner ist
  `session.env` (das bei der Erstinstallation einmalig generierte
  `SESSION_SECRET`) eine reine Remote-Datei, die nie im Repo liegt. Der
  urspruengliche `deploy.sh`-Exclude-Filter deckte `node_modules`/`data`/
  `deploy` ab, aber nicht `session.env` - beim navi-name-Feature-Deploy
  (2026-07-11) loeschte `rsync --delete` die Datei dadurch live mit,
  `navi-vokabeltrainer.service` ging in eine Crash-Restart-Schleife
  ("Failed to load environment files"), die Seite war kurz per 502 nicht
  erreichbar. Fix im Skript: `--exclude 'session.env'` ergaenzt. Akute
  Wiederherstellung: neues `SESSION_SECRET` generiert (gleicher Befehl wie
  bei der Erstinstallation oben) - kostet alle aktuell eingeloggten Nutzer
  ihre Session (muessen sich neu einloggen), aber keine Daten gehen
  verloren. **Lehre fuer kuenftige neue Remote-only-Dateien** (z.B. weitere
  `.env`-Secrets): sofort im `deploy.sh`-Exclude-Filter ergaenzen, bevor
  sie überhaupt remote angelegt werden.

## Sicherheit

- `npm audit`: 0 Vulnerabilities (lokal geprüft, siehe oben - Re-Check nach
  jedem Dependency-Update empfohlen, insbesondere vor Go-Live auf dem
  Zielsystem). Der Grammatik-Baukasten führt keine neuen Abhängigkeiten
  ein.
- Passwort-Hashing: Node-Builtin `crypto.scrypt`, kein Zusatzpaket.
- Sessions: eigener SQLite-Store (`lib/sqliteSessionStore.js`), kein
  `connect-sqlite3` (bekannte CVEs in dessen Abhängigkeiten).
- systemd-Hardening: `NoNewPrivileges`, `ProtectSystem=strict`,
  `ProtectHome`, `PrivateTmp`, dedizierter unprivilegierter User.
- Cookie-Consent: einziges gesetztes Cookie ist das technisch notwendige
  Session-Cookie. Echtes Opt-in (`localStorage.cookie_consent`) - Login/
  Registrierung sind erst nach explizitem "Akzeptieren" nutzbar, nicht nur
  wenn (noch) nicht aktiv abgelehnt wurde.
