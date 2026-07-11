const path = require('path');
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const helmet = require('helmet');

const SqliteSessionStore = require('./lib/sqliteSessionStore');
const fwew = require('./lib/fwew');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
// Vokabel-Editor bewusst NICHT geloescht, nur pausiert (siehe unten) - der
// Live-Fwew-Modus (lib/fwew.js) ersetzt seine Aufgabe, die Route bleibt
// aber vollstaendig funktionsfaehig fuer den Fall, dass sie reaktiviert wird.
const vocabRoutes = require('./routes/vocab');
const trainerRoutes = require('./routes/trainer');
const activationRoutes = require('./routes/activation');
const fwewRoutes = require('./routes/fwew');
const grammarRoutes = require('./routes/grammar');

const app = express();
const PORT = process.env.PORT || 3700;

// Session-Secret: aus Env-Var, sonst zur Laufzeit generiert (dann invalidieren
// Neustarts alle Sessions - fuer den Produktivbetrieb sollte SESSION_SECRET
// per systemd-Unit/EnvironmentFile gesetzt werden, siehe deploy/README).
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.disable('x-powered-by');
// Laeuft immer hinter mind. einem Reverse-Proxy (lokales nginx, dahinter
// der externe Nginx Proxy Manager) - noetig, damit req.secure / die
// X-Forwarded-*-Header korrekt ausgewertet werden.
app.set('trust proxy', 1);
// Security-Header (HSTS, X-Frame-Options, X-Content-Type-Options,
// Referrer-Policy, CSP). style-src erlaubt 'unsafe-inline', weil das
// Vanilla-JS-Frontend (public/js/app.js) Inline-style-Attribute setzt statt
// eines Build-Steps mit Nonces - alles andere bleibt auf 'self' beschraenkt.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
    },
  })
);
app.use(express.json());
app.use(
  session({
    store: new SqliteSessionStore(),
    secret: SESSION_SECRET,
    name: 'connect.sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 Tage
      httpOnly: true,
      sameSite: 'lax',
      // Sicherer Default: nur explizites COOKIE_SECURE=false (z.B. lokale
      // Entwicklung ohne TLS) schaltet das secure-Flag ab - vorher war es
      // umgekehrt und eine fehlende/verrutschte Env-Konfiguration liess
      // das Cookie standardmaessig UNSICHER laufen.
      secure: process.env.COOKIE_SECURE !== 'false',
    },
  })
);

// CSRF-Defense-in-Depth: der Schutz stuetzte sich bisher ausschliesslich
// auf SameSite=lax + JSON-Content-Type (CORS-Preflight). Zusaetzlich
// werden zustandsaendernde API-Requests mit einem gesetzten Origin-Header
// abgelehnt, wenn der Origin nicht zum eigenen Host passt - Requests OHNE
// Origin-Header (z.B. curl, manche Same-Origin-Faelle) werden bewusst
// NICHT geblockt, da dessen Fehlen kein verlaessliches Cross-Site-Signal ist.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }
  const origin = req.get('origin');
  if (!origin) return next();
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch (e) {
    return res.status(403).json({ error: 'invalid_origin' });
  }
  if (originHost !== req.get('host')) {
    return res.status(403).json({ error: 'cross_origin_forbidden' });
  }
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
// Vokabel-Editor auf Eis gelegt (Umstellung auf Live-Fwew-API, siehe
// lib/fwew.js) - Route/Code bewusst nicht geloescht, nur nicht mehr
// gemountet. Bei Bedarf einfach die folgende Zeile wieder einkommentieren.
// app.use('/api/vocab', vocabRoutes);
app.use('/api/trainer', trainerRoutes);
app.use('/api/activation', activationRoutes);
app.use('/api/fwew', fwewRoutes);
app.use('/api/grammar', grammarRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

fwew.startAutoRefresh();

app.listen(PORT, '127.0.0.1', () => {
  console.log(`navi-vokabeltrainer listening on 127.0.0.1:${PORT}`);
});
