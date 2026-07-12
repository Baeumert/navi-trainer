# navi-lernwebseite

Na'vi-Lernplattform mit zwei unabhängigen Modulen:

1. **Vokabeltrainer** - Karteikarten (Leitner-System) auf Basis der live
   von der [Fwew-API](https://tirea.learnnavi.org/api) geladenen
   Na'vi-Wörterbuch-Daten.
2. **Grammatik-Baukasten** (Conlang-Trainer) - regelbasierte Übungen zu
   Infix-Platzierung, Ergativ/Akkusativ-Suffixen und Lenisierung, mit
   Vier-Augen-Freigabe-Workflow. **NON-AI-POLICY**: keine generative KI
   beteiligt, alle Inhalte kommen von menschlichen Creators, die Auswertung
   läuft ausschließlich über deterministische String-Algorithmen.

Live-Referenzinstanz: **https://navi.diy-ehome.de/**

> Dies ist ein automatisch synchronisierter, öffentlicher Spiegel der
> eigentlichen Anwendung (Node.js/Express-App, ohne interne Betriebs-/
> Infrastruktur-Dokumentation und ohne die urheberrechtlich nicht klar
> lizenzierten Design-Referenzbilder aus dem privaten Arbeitsrepo). Lizenz:
> siehe [`LICENSE`](LICENSE) (AGPL-3.0).

## Demo-Zugänge (Live-Referenzinstanz)

Zum Ausprobieren auf https://navi.diy-ehome.de/ ohne eigene Registrierung
(Selbstregistrierung ist dort nach dem ersten Admin geschlossen) gibt es
drei öffentliche Preview-Konten, eines pro Rolle:

| Rolle | E-Mail | Passwort |
|---|---|---|
| Lernende(r) | `demo-lerner@navi.diy-ehome.de` | `lerner123` |
| Creator ("Lehrer", legt Grammatik-Übungen an) | `demo-lehrer@navi.diy-ehome.de` | `lehrer123` |
| Reviewer (gibt Übungen frei) | `demo-reviewer@navi.diy-ehome.de` | `reviewer123` |

**Alle Eingaben dieser drei Konten werden automatisch 120 Minuten nach der
letzten Änderung wieder gelöscht** (`scripts/cleanup_demo_users.js`, per
Cron alle 10 Minuten) - die Demo-Umgebung setzt sich also von selbst
zurück. Name, Passwort, Rollen und Welcome-Tour-Status werden bei jedem
Lauf ebenfalls auf den hier dokumentierten Zustand zurückgesetzt - die
interaktive Welcome-Tour startet also für jeden neuen Demo-Besuch wieder
automatisch. Bei eigenem Deployment dieses
Codes existieren diese Konten nicht automatisch - das Skript legt nur
bereits vorhandene Konten mit diesen E-Mail-Adressen fest, siehe
Skript-Kommentar.

## Vokabeltrainer

- Vokabeln (Na'vi-Wort + alle verfügbaren Übersetzungen) werden **nicht
  lokal gespeichert** - ein serverseitiger In-Memory-Cache
  (`lib/fwew.js`) lädt sie live von der Fwew-API, beim Start und danach
  alle 6h neu. Lokale Tabellen (`progress`, `activation`, `vocab_priority`)
  referenzieren nur die Fwew-Wort-ID.
- Leitner-Karteikartensystem (10 Boxen), zwei Richtungen (Na'vi→Zielsprache
  und umgekehrt) unabhängig verfolgt. Trainer bietet zwei Modi: fällige
  Karten (Standard) oder Wiederholung des gesamten aktivierten Wortschatzes,
  plus Live-Zähler "X heute fällig". Wörter müssen vorher durch exaktes
  Abschreiben aktiviert werden (`#/activate`).
- Priorisierung (welche Wörter der Trainer zuerst zeigt) läuft über
  `vocab_priority` (nur Fwew-ID + Datum, kein Wortinhalt), verwaltet im
  Admin-Panel.
- Der frühere lokale Vokabel-Editor (eigene `vocab`-Tabelle, CSV-Import)
  ist **pausiert, nicht gelöscht** - Route/Code bleiben im Repo, sind aber
  nicht gemountet/verlinkt (siehe `docs/deploy.md`).

## Grammatik-Baukasten

- **Modul A - Infix-Platzierung**: Creator definiert Stammwort + zwei
  Lücken-Positionen + korrekte Lücke; Lernende ziehen das Infix per
  Drag-and-Drop (Pointer Events, funktioniert auf Maus und Touch) in die
  richtige Lücke.
- **Modul B - Ergativ/Akkusativ**: Creator gibt einen vollständigen Satz
  plus Stamm/Suffix-Paare an, das System generiert daraus automatisch den
  Lückensatz für Lernende.
- **Modul C - Lenisierung**: feste Konsonanten-Tabelle im Code (p→f, t→s,
  k→h, ts→s, kx→k, px→p, tx→t, '→entfällt). Präfix-Lautformen vor
  Lenisierung (z.B. "ay+"→"a+") sind Creator-Eingabe pro Übung, nicht
  hartcodiert.
- **Rollen**: `is_creator` (legt Übungen an) und `is_reviewer` (gibt frei/
  lehnt ab) als zusätzliche Flags neben `is_admin` - mehrere Rollen pro
  User möglich, Admin hat automatisch alle Rechte. Vergabe im Admin-Panel.
- **Workflow**: neue Übungen starten als `pending` (unsichtbar für
  Lernende) → Reviewer gibt frei (`active`) oder lehnt ab (`rejected`, mit
  Hinweistext, vom Creator überarbeitbar).

## Weitere Features

- **15 Sprachen** (DE, EN, ES, ET, FR, HU, IT, KO, NL, PL, PT, RU, SV, TR,
  UK) - deckungsgleich mit Fwews Übersetzungssprachen; die gewählte
  UI-Sprache bestimmt auch, welche Fwew-Übersetzung im Trainer angezeigt
  wird. Impressum/Datenschutzerklärung bleiben bewusst nur auf Deutsch
  (rechtlich maßgeblich für die Live-Referenzinstanz - bei eigenem Betrieb
  bitte durch eigene, rechtlich korrekte Angaben ersetzen).
- **Profil** (`#/profil`): Name/Passwort ändern, optionaler zweiter
  Na'vi-Name mit wählbarer Anzeigeform in den Danksagungen,
  Fortschrittsbalken für Vokabeltrainer und Grammatik-Baukasten (mit
  "Details"-Link), Welcome-Tour erneut starten, Datenexport und
  Konto-Löschung (siehe Datenschutz unten).
- **Responsive Design**: Nav klappt unterhalb ~880px in ein
  Hamburger-Menü um (Klick-Toggle, kein Hover - Touch-Geräte kennen
  `:hover` nicht); Karten, Hero, Flashcards, Grammatik-Übungen und
  Tour-Tooltips skalieren auf schmalen Bildschirmen, Tabellen scrollen
  horizontal statt umzubrechen.
- **Interaktive Welcome-Tour**: läuft automatisch beim ersten Login,
  erklärt die wichtigsten Funktionen per Spotlight-Tooltips auf den echten
  Nav-Elementen (öffnet dafür bei Bedarf automatisch das mobile
  Hamburger-Menü).
- **Echter Opt-in-Cookie-Banner**: einziges Cookie ist das technisch
  notwendige Session-Cookie; Login/Registrierung sind erst nach expliziter
  Zustimmung nutzbar.
- Impressum, Datenschutzerklärung, Quellen, Danksagung - alle auch ohne
  Login erreichbar (`#/impressum`, `#/datenschutz`, `#/quellen`,
  `#/danksagung`).

## Datenschutz: Löschung, Auskunft, Community-Credits

- **Konto-Löschung** (Art. 17 DSGVO): sowohl selbst im Profil
  (`DELETE /api/auth/me`, verlangt aktuelles Passwort) als auch durch einen
  Admin (`DELETE /api/admin/users/:id`). Löscht Login-/Lerndaten
  vollständig (`progress`, `activation`, `grammar_attempts` per
  `ON DELETE CASCADE`), lässt aber bereits erstellte oder gereviewte
  Grammatik-Übungen als Community-Inhalt bestehen -
  `grammar_exercises.creator_id`/`reviewer_id` werden dabei auf `NULL`
  gesetzt statt die Übung zu löschen (`lib/userDeletion.js`). Der letzte
  verbleibende Admin kann sich nicht selbst löschen.
- **Auskunftsrecht** (Art. 15 DSGVO): `GET /api/auth/me/export.json` bzw.
  `.csv` liefert alle über den Nutzer gespeicherten Daten (Account,
  Vokabel-Fortschritt, Grammatik-Antworten, eigene und gereviewte
  Übungen) als Download - erreichbar über das Profil.
- **Community-Credits**: wird eine Grammatik-Übung erfolgreich freigegeben,
  bekommt der/die Creator einmalig (nicht pro Übung) einen Eintrag in
  `grammar_credits` und erscheint auf der Danksagungen-Seite
  (`GET /api/grammar/credits`, öffentlich, kein Login nötig) - bewusst
  ohne Fremdschlüssel auf `users`, damit der Eintrag eine spätere
  Konto-Löschung übersteht.

## Struktur

```
lib/                   DB-Setup, Fwew-API-Client, Grammatik-Rule-Engines,
                        Konto-Löschung (userDeletion.js)
  grammar/              infix.js, lenition.js, suffix.js (pure Funktionen)
routes/                 auth, admin, trainer, activation, fwew, grammar, vocab (pausiert)
middleware/             Auth-Guards (requireAuth/Admin/Creator/Reviewer)
public/                 Vanilla-JS-Frontend, kein Build-Step
  js/app.js              SPA-Router + alle render*()-Funktionen
  i18n/<code>/           eine translation.json pro Sprache (15x)
db/                     einmalige Migrations-/Import-Scripts
deploy/                 systemd-Unit, nginx-Config, deploy.sh
docs/deploy.md          Architektur, Datenmodell, Betriebsdetails (generisch)
```

## Eigenes Deployment

Siehe [`docs/deploy.md`](docs/deploy.md) für Architektur, Datenmodell,
Node-Version-Besonderheiten und den vollständigen Deploy-Ablauf.
Kurzfassung:

```bash
export DEPLOY_HOST=user@your-server.example
rsync -az --delete --exclude node_modules --exclude data --exclude deploy \
  --exclude session.env \
  ./ "$DEPLOY_HOST":/opt/navi-vokabeltrainer/
ssh "$DEPLOY_HOST" "systemctl restart navi-vokabeltrainer"
```

Node.js 20 LTS wird benötigt (siehe `docs/deploy.md` für den Grund).

## Sicherheit

`npm audit`: 0 Vulnerabilities (Stand des letzten internen Checks).
Passwort-Hashing über Node-Builtin `crypto.scrypt`, eigener
SQLite-Session-Store (kein `connect-sqlite3` wegen bekannter CVEs),
systemd-Hardening (dedizierter unprivilegierter User, `NoNewPrivileges`,
`ProtectSystem=strict`).

## Lizenz

AGPL-3.0, siehe [`LICENSE`](LICENSE). Wer eine modifizierte Version dieser
Anwendung öffentlich betreibt (auch als reiner Server-Betrieb, nicht nur
Weitergabe des Codes), muss den angepassten Quellcode ebenfalls unter
derselben Lizenz offenlegen.
