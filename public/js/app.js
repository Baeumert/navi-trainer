const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c === null || c === undefined) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
};

let CURRENT_USER = null;
let REGISTRATION_OPEN = false;

// Die Vokabeldaten in der navi-Spalte enthalten (aus dem CSV-Import)
// gezielt <u>...</u> zur Betonungs-Unterstreichung. Da vocab nur von
// Admins gepflegt wird, ist das Feld vertrauenswuerdig - trotzdem wird
// hier NICHT blind innerHTML gesetzt: alles wird escaped, danach werden
// ausschliesslich exakte <u>/</u>-Tags wieder freigegeben. Andere Spalten
// (de/en/notes) laufen weiterhin ausschliesslich als Text durch el().
function naviHtml(str) {
  const escaped = String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/&lt;u&gt;/g, '<u>').replace(/&lt;\/u&gt;/g, '</u>');
}

// Reduziert den innerHTML eines contenteditable-Feldes (siehe naviEditable
// im Vokabel-Editor) auf reinen Text mit ausschliesslich <u></u>-Markierung
// fuer die Betonung - alles andere, was Browser beim Tippen/Einfuegen sonst
// noch reinstreuen (b/i/span/div/br von execCommand oder Copy-Paste), wird
// verworfen. So bleibt navi in der DB garantiert "Text + optional <u>",
// unabhaengig vom WYSIWYG-Rohoutput.
function sanitizeNaviEditableHtml(container) {
  let out = '';
  function isUnderlined(node) {
    if (!node || node.nodeType !== 1) return false;
    const tag = node.tagName.toLowerCase();
    if (tag === 'u' || tag === 'ins') return true;
    return /text-decoration\s*:\s*underline/i.test(node.getAttribute('style') || '');
  }
  function walk(node, underlined) {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        const text = child.textContent;
        out += underlined ? `<u>${text}</u>` : text;
      } else if (child.nodeType === 1) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'br') { /* Zeilenumbrueche im einzeiligen Feld ignorieren */ return; }
        walk(child, underlined || isUnderlined(child));
      }
    });
  }
  walk(container, false);
  // Aufeinanderfolgende </u><u> (aus verschachtelten/getrennten Spans)
  // zusammenfassen, damit der Abschreib-Vergleich nicht an Kleinigkeiten
  // wie doppelten Tag-Grenzen scheitert.
  return out.replace(/<\/u><u>/g, '');
}

// Uebersetzung fuer die aktuell gewaehlte UI-Sprache (globale Sprachauswahl
// oben rechts, siehe i18n.js currentLang/LANGUAGES) - word.translations
// kommt vom Server als [{lang, text}, ...] (siehe lib/fwew.js
// translationsOf), zeigt aber bewusst nur die eine passende, nicht alle
// verfuegbaren Sprachen. UI-Sprachcodes (klein) entsprechen 1:1 Fwews
// Sprachcodes (gross, z.B. "es" -> "ES") - daher reicht toUpperCase().
// Faellt auf EN, dann die erste verfuegbare Uebersetzung zurueck, falls die
// gewaehlte Sprache bei einem Wort fehlen sollte.
function primaryTranslation(word) {
  const translations = (word && word.translations) || [];
  const wanted = currentLang.toUpperCase();
  const hit = translations.find((tr) => tr.lang === wanted)
    || translations.find((tr) => tr.lang === 'EN')
    || translations[0];
  return hit ? hit.text : '';
}

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'request_failed');
    err.code = data && data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

async function loadMe() {
  try {
    CURRENT_USER = await api('/auth/me');
  } catch (e) {
    CURRENT_USER = null;
  }
  updateNav();
}

async function loadRegistrationStatus() {
  try {
    const status = await api('/auth/status');
    REGISTRATION_OPEN = !!status.registration_open;
  } catch (e) {
    REGISTRATION_OPEN = false;
  }
}

function updateNav() {
  const topnav = document.getElementById('topnav');
  const navToggle = document.getElementById('navToggle');
  const navAdmin = document.getElementById('navAdmin');
  const navGrammarCreate = document.getElementById('navGrammarCreate');
  const navGrammarReview = document.getElementById('navGrammarReview');
  if (CURRENT_USER) {
    topnav.hidden = false;
    navToggle.hidden = false;
    navAdmin.hidden = !CURRENT_USER.is_admin;
    navGrammarCreate.hidden = !CURRENT_USER.is_admin && !CURRENT_USER.is_creator;
    navGrammarReview.hidden = !CURRENT_USER.is_admin && !CURRENT_USER.is_reviewer;
  } else {
    topnav.hidden = true;
    navToggle.hidden = true;
    topnav.classList.remove('nav-open');
    navToggle.setAttribute('aria-expanded', 'false');
  }
}

// Mobile Hamburger-Menue: unterhalb der Tablet-Breakpoint-Grenze (siehe
// style.css) wird die Nav per Klasse ein-/ausgeblendet statt per :hover,
// da Touch-Geraete kein Hover kennen.
document.getElementById('navToggle').addEventListener('click', () => {
  const topnav = document.getElementById('topnav');
  const navToggle = document.getElementById('navToggle');
  const isOpen = topnav.classList.toggle('nav-open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
});
document.getElementById('topnav').addEventListener('click', (e) => {
  if (e.target.tagName === 'A') {
    document.getElementById('topnav').classList.remove('nav-open');
    document.getElementById('navToggle').setAttribute('aria-expanded', 'false');
    // Der Klick fokussiert den Link, und die Desktop-Dropdowns oeffnen sich
    // auch ueber :focus-within (nicht nur :hover, wegen Tastatur-Bedienbarkeit) -
    // ohne das Blur bliebe das Menue nach dem Klick offen, bis der Fokus
    // durch irgendeine andere Aktion woanders hin wandert.
    e.target.blur();
  }
});

document.getElementById('btnLogout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  CURRENT_USER = null;
  updateNav();
  navigate('#/');
});

function navigate(hash) {
  window.location.hash = hash;
}

function onLangChange() {
  renderCookieBanner();
  route();
}

// Merkt beim Backend (und lokal an CURRENT_USER), dass die Willkommens-Tour
// als gesehen gilt - sowohl wenn sie tatsaechlich durchlaufen (finishTour())
// als auch wenn sie auf der Willkommens-Seite explizit uebersprungen wird
// ("Weiter zum Trainer" ohne Tour).
async function markWelcomeSeen() {
  try { await api('/auth/me/welcome-seen', { method: 'POST' }); } catch (e) { /* ignore */ }
  if (CURRENT_USER) CURRENT_USER.welcome_seen = true;
}

window.addEventListener('hashchange', route);
document.addEventListener('DOMContentLoaded', async () => {
  // I18N_READY (i18n.js) laedt die aktuelle Sprachdatei - abwarten, damit
  // die erste Seite nicht kurz mit rohen i18n-Keys statt Text aufblitzt.
  await I18N_READY;
  renderCookieBanner();
  await Promise.all([loadMe(), loadRegistrationStatus()]);
  route();
});

async function route() {
  const hash = window.location.hash || '#/';
  const app = document.getElementById('app');
  app.innerHTML = '';

  // Rechtliche Seiten und die Willkommens-Seite sind bewusst immer
  // erreichbar, auch ohne Login und ohne akzeptiertes Cookie-Banner
  // (Impressumspflicht gilt unabhaengig davon) - deshalb vor dem
  // Login-Gate geprueft. "#/" ist nur ein Alias auf "#/willkommen" (auch
  // der Marken-Link oben links zeigt direkt dorthin), damit es EINE
  // durchgaengige Landingpage gibt statt zwei verschiedener Startpunkte.
  if (hash === '#/impressum') return renderImpressum(app);
  if (hash === '#/datenschutz') return renderDatenschutz(app);
  if (hash === '#/quellen') return renderQuellen(app);
  if (hash === '#/danksagung') return renderDanksagung(app);
  if (hash === '#/willkommen') return renderWillkommen(app);
  if (hash === '#/') return navigate('#/willkommen');

  if (!CURRENT_USER) {
    return renderLogin(app);
  }

  if (hash === '#/activate') return renderActivate(app);
  if (hash === '#/trainer') return renderTrainer(app);
  if (hash === '#/vocab') return renderVocab(app);
  if (hash === '#/progress') return renderProgress(app);
  if (hash === '#/grammatik') return renderGrammatikHub(app);
  if (hash === '#/grammatik/erstellen') return renderGrammatikErstellen(app);
  if (hash === '#/grammatik/review') return renderGrammatikReview(app);
  if (hash === '#/grammatik/fortschritt') return renderGrammatikFortschritt(app);
  if (hash === '#/profil') return renderProfil(app);
  if (hash === '#/admin') return renderAdmin(app);

  return renderWillkommen(app);
}

// ---------- Willkommen / Home / Login ----------

// Willkommens-/Landingpage: einzige gemeinsame Startseite fuer "#/" und den
// Marken-Link oben links, unabhaengig vom Login-Status. Stellt die
// Plattform kurz vor und betont bewusst den Community-Gedanken (die
// Grammatik-Uebungen kommen von Menschen aus der Community, nicht von
// generativer KI, siehe NON-AI-POLICY). Fuer ausgeloggte Besucher haengt
// direkt das Login/Registrieren-Formular dran; eingeloggte Nutzer sehen
// stattdessen Weiter-Buttons (und bei noch nicht gesehener Tour einen
// deutlich hervorgehobenen Tour-Start).
function renderWillkommen(app) {
  const hero = el('div', { class: 'hero' }, [
    el('div', { class: 'hero-content' }, [
      el('h1', {}, t('willkommen_title')),
      el('p', {}, t('willkommen_subtitle')),
    ]),
  ]);
  app.appendChild(hero);

  app.appendChild(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, t('willkommen_intro_heading')),
    el('p', {}, t('willkommen_intro_text')),
  ]));

  app.appendChild(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, t('willkommen_community_heading')),
    el('p', {}, t('willkommen_community_text')),
    el('a', { href: '#/danksagung', class: 'btn btn-secondary' }, t('willkommen_community_cta')),
  ]));

  if (CURRENT_USER) {
    const ctaCard = el('div', { class: 'card' });
    ctaCard.appendChild(el('div', { class: 'row-actions' }, [
      !CURRENT_USER.welcome_seen
        ? el('button', { class: 'btn', onclick: () => startWelcomeTour() }, t('willkommen_cta_tour'))
        : el('button', { class: 'btn btn-secondary', onclick: () => startWelcomeTour() }, t('profile_restart_tour')),
      el('button', {
        class: 'btn btn-secondary',
        onclick: async () => { await markWelcomeSeen(); navigate('#/trainer'); },
      }, t('willkommen_cta_continue')),
    ]));
    app.appendChild(ctaCard);
  } else {
    const cta = el('div', { class: 'login-wrap' });
    app.appendChild(cta);
    renderLoginForm(cta);
  }
}

function renderLogin(app) {
  const hero = el('div', { class: 'hero' }, [
    el('div', { class: 'hero-content' }, [
      el('h1', {}, t('login_title')),
      el('p', {}, t('login_subtitle')),
    ]),
  ]);
  app.appendChild(hero);
  const wrap = el('div', { class: 'login-wrap' });
  app.appendChild(wrap);
  renderLoginForm(wrap);
}

function renderLoginForm(container) {
  // Echtes Opt-in: Login/Registrierung nur anbieten, wenn explizit
  // "Akzeptieren" geklickt wurde - nicht nur, wenn noch nicht abgelehnt
  // wurde. Das Session-Cookie ist zwingend fuer beides erforderlich.
  const consent = cookieConsent();
  if (consent !== 'accepted') {
    container.appendChild(el('div', { class: 'card' }, [
      el('p', {}, consent === 'declined' ? t('cookie_declined_notice') : t('cookie_text')),
      consent === 'declined' ? el('button', { class: 'btn', onclick: () => setCookieConsent(null) }, t('cookie_change_choice')) : null,
    ]));
    return;
  }

  let mode = 'login';
  const card = el('div', { class: 'card' });
  container.appendChild(card);

  function draw() {
    card.innerHTML = '';
    const tabButtons = [
      el('button', { class: mode === 'login' ? 'active' : '', onclick: () => { mode = 'login'; draw(); } }, t('tab_login')),
    ];
    // Registrieren-Tab nur anzeigen, solange die Selbstregistrierung offen
    // ist (nur vor dem allerersten Bootstrap-Admin) - danach legt ein Admin
    // neue Nutzer im Admin-Panel an.
    if (REGISTRATION_OPEN) {
      tabButtons.push(
        el('button', { class: mode === 'register' ? 'active' : '', onclick: () => { mode = 'register'; draw(); } }, t('tab_register'))
      );
    } else if (mode === 'register') {
      mode = 'login';
    }
    const tabs = el('div', { class: 'tabs' }, tabButtons);
    card.appendChild(tabs);

    if (!REGISTRATION_OPEN) {
      card.appendChild(el('p', { class: 'hint-text' }, t('registration_closed_hint')));
    }

    const errBox = el('div', { class: 'error-msg', style: 'display:none' });
    const nameInput = el('input', { type: 'text', placeholder: t('field_name') });
    const emailInput = el('input', { type: 'email', placeholder: t('field_email') });
    const passInput = el('input', { type: 'password', placeholder: t('field_password') });

    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        errBox.style.display = 'none';
        try {
          if (mode === 'register') {
            CURRENT_USER = await api('/auth/register', {
              method: 'POST',
              body: { name: nameInput.value, email: emailInput.value, password: passInput.value },
            });
          } else {
            CURRENT_USER = await api('/auth/login', {
              method: 'POST',
              body: { email: emailInput.value, password: passInput.value },
            });
          }
          updateNav();
          // Nach dem ersten Login/Registrieren erst die Willkommens-Seite
          // (Community-Vorstellung, optionaler Tour-Start) - danach reicht
          // ein direkter Sprung zum Trainer.
          navigate(CURRENT_USER.welcome_seen ? '#/trainer' : '#/willkommen');
        } catch (err) {
          errBox.textContent = t('err_' + err.code) !== ('err_' + err.code) ? t('err_' + err.code) : t('err_generic');
          errBox.style.display = 'block';
        }
      },
    });

    if (mode === 'register') {
      form.appendChild(el('label', {}, t('field_name')));
      form.appendChild(nameInput);
    }
    form.appendChild(el('label', {}, t('field_email')));
    form.appendChild(emailInput);
    form.appendChild(el('label', {}, t('field_password')));
    form.appendChild(passInput);
    form.appendChild(errBox);
    form.appendChild(el('button', { class: 'btn', type: 'submit' }, mode === 'register' ? t('btn_register') : t('btn_login')));

    card.appendChild(form);
  }

  draw();
}

// ---------- Aktivieren (Abschreiben, vor dem Karteikarten-Trainer) ----------

async function renderActivate(app) {
  const hero = el('div', { class: 'hero' }, [
    el('div', { class: 'hero-content' }, [
      el('h1', {}, t('activate_title')),
      el('p', {}, t('activate_subtitle')),
    ]),
  ]);
  app.appendChild(hero);

  const statusBar = el('div', { class: 'filters' });
  app.appendChild(statusBar);

  const cardWrap = el('div', { class: 'flashcard' });
  app.appendChild(cardWrap);

  let queue = [];
  let idx = 0;

  async function loadStatus() {
    const status = await api('/activation/status');
    statusBar.innerHTML = '';
    statusBar.appendChild(el('div', {}, tFormat('activate_progress', { activated: status.activated, total: status.total })));
  }

  async function loadQueue() {
    queue = await api('/activation/next?limit=10');
    idx = 0;
    await loadStatus();
    drawCard();
  }

  function drawCard() {
    cardWrap.innerHTML = '';
    if (!queue.length) {
      cardWrap.appendChild(el('div', { class: 'empty-state' }, t('activate_done')));
      return;
    }
    if (idx >= queue.length) {
      cardWrap.appendChild(el('div', { class: 'empty-state' }, [
        el('p', {}, '✓'),
        el('button', { class: 'btn', onclick: loadQueue }, t('activate_more')),
      ]));
      return;
    }
    const word = queue[idx];

    cardWrap.appendChild(el('div', { class: 'flashcard-word', html: naviHtml(word.navi) }));
    cardWrap.appendChild(el('div', { class: 'flashcard-hint' }, primaryTranslation(word)));

    const errBox = el('div', { class: 'error-msg', style: 'display:none' }, t('activate_mismatch'));
    const okBox = el('div', { class: 'ok-msg', style: 'display:none' }, '✓');
    const input = el('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', placeholder: t('activate_input_placeholder') });

    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        errBox.style.display = 'none';
        try {
          await api('/activation/activate', { method: 'POST', body: { vocab_id: word.id, input: input.value } });
          okBox.style.display = 'block';
          setTimeout(() => {
            idx += 1;
            drawCard();
          }, 400);
        } catch (err) {
          errBox.style.display = 'block';
          input.select();
        }
      },
    });
    form.appendChild(input);
    form.appendChild(errBox);
    form.appendChild(okBox);
    form.appendChild(el('button', { class: 'btn', type: 'submit' }, t('activate_submit')));
    cardWrap.appendChild(form);
    input.focus();
  }

  await loadQueue();
}

// ---------- Trainer ----------

async function renderTrainer(app) {
  const hero = el('div', { class: 'hero' }, [
    el('div', { class: 'hero-content' }, [el('h1', {}, t('trainer_title'))]),
  ]);
  app.appendChild(hero);

  const statusBar = el('div', { class: 'filters' });
  app.appendChild(statusBar);

  const cardWrap = el('div', { class: 'flashcard' });
  app.appendChild(cardWrap);

  let queue = [];
  let idx = 0;
  let showBack = false;
  let cardDirection = 'navi_to_target';
  let mode = 'due';

  async function loadDueCount() {
    try {
      const { due } = await api('/trainer/due-count');
      return due;
    } catch (e) {
      return null;
    }
  }

  async function renderStatusBar() {
    statusBar.innerHTML = '';
    const due = await loadDueCount();
    if (due !== null) {
      statusBar.appendChild(el('div', { class: 'tag' }, tFormat('trainer_due_count', { count: due })));
    }
    statusBar.appendChild(el('button', {
      class: mode === 'due' ? 'btn' : 'btn btn-secondary',
      onclick: () => { mode = 'due'; loadQueue(); },
    }, t('trainer_mode_due')));
    statusBar.appendChild(el('button', {
      class: mode === 'all' ? 'btn' : 'btn btn-secondary',
      onclick: () => { mode = 'all'; loadQueue(); },
    }, t('trainer_mode_all')));
  }

  async function loadQueue() {
    // Beide Richtungen unabhaengig laden und mischen (analog jMemorize
    // SIDES_BOTH/SIDES_RANDOM), damit eine Session beide Boxen bedient.
    // mode=all laedt den kompletten aktivierten Bestand statt nur der
    // faelligen/neuen Karten - zum bewussten Wiederholen von allem.
    const params = new URLSearchParams();
    params.set('mode', mode);
    if (mode === 'due') params.set('limit', '8');
    const [naviToTarget, targetToNavi] = await Promise.all([
      api('/trainer/next?' + params.toString() + '&direction=navi_to_target'),
      api('/trainer/next?' + params.toString() + '&direction=target_to_navi'),
    ]);
    queue = [
      ...naviToTarget.map((w) => ({ word: w, direction: 'navi_to_target' })),
      ...targetToNavi.map((w) => ({ word: w, direction: 'target_to_navi' })),
    ];
    // Fisher-Yates-Mischung
    for (let i = queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    idx = 0;
    showBack = false;
    await renderStatusBar();
    drawCard();
  }

  // Kleine Zusatzinfos zum Na'vi-Wort (IPA-Lautschrift, Silbentrennung,
  // Infix-Einfuegestellen) - nur wenn Fwew sie fuer dieses Wort liefert,
  // nur auf der Na'vi-Seite der Karte relevant.
  function naviMetaLine(word) {
    const parts = [];
    if (word.ipa) parts.push(`[${word.ipa}]`);
    if (word.syllables) parts.push(word.syllables);
    if (word.infixDots) parts.push(`${t('trainer_infix_label')}: ${word.infixDots}`);
    if (!parts.length) return null;
    return el('div', { class: 'flashcard-meta' }, parts.join('  ·  '));
  }

  function directionLabel(direction) {
    const targetLangLabel = currentLang.toUpperCase();
    return direction === 'navi_to_target'
      ? tFormat('trainer_direction_navi_to_target', { lang: targetLangLabel })
      : tFormat('trainer_direction_target_to_navi', { lang: targetLangLabel });
  }

  function drawCard() {
    cardWrap.innerHTML = '';
    if (!queue.length) {
      cardWrap.appendChild(el('div', { class: 'empty-state' }, t('trainer_empty')));
      return;
    }
    if (idx >= queue.length) {
      cardWrap.appendChild(el('div', { class: 'empty-state' }, [
        el('p', {}, '✓'),
        el('button', { class: 'btn', onclick: loadQueue }, t('trainer_next')),
      ]));
      return;
    }
    const { word, direction } = queue[idx];
    cardDirection = direction;

    cardWrap.appendChild(el('div', { class: 'tag' }, directionLabel(direction)));

    // Karte zeigt vorne/hinten je nach Richtung Na'vi-Wort oder Uebersetzung
    // in der aktuell gewaehlten UI-Sprache (oben rechts) - eine einzelne
    // Uebersetzung, nicht alle verfuegbaren.
    const naviSide = { html: naviHtml(word.navi) };
    const targetSide = primaryTranslation(word);
    const front = direction === 'navi_to_target' ? naviSide : targetSide;
    const back = direction === 'navi_to_target' ? targetSide : naviSide;

    const shown = showBack ? back : front;
    const wordBoxAttrs = { class: 'flashcard-word', onclick: () => { showBack = !showBack; drawCard(); } };
    if (typeof shown === 'object') wordBoxAttrs.html = shown.html;
    const wordBox = el('div', wordBoxAttrs, typeof shown === 'object' ? [] : shown);

    cardWrap.appendChild(wordBox);
    if (typeof shown === 'object') {
      const meta = naviMetaLine(word);
      if (meta) cardWrap.appendChild(meta);
    }
    cardWrap.appendChild(el('div', { class: 'flashcard-hint' }, t('trainer_flip_hint')));

    const actions = el('div', { class: 'flashcard-actions' }, [
      el('button', { class: 'btn btn-secondary', onclick: () => answer(word, false) }, '✗ ' + t('trainer_wrong')),
      el('button', { class: 'btn', onclick: () => answer(word, true) }, '✓ ' + t('trainer_correct')),
    ]);
    cardWrap.appendChild(actions);
  }

  async function answer(word, correct) {
    try {
      await api('/trainer/answer', { method: 'POST', body: { vocab_id: word.id, direction: cardDirection, correct } });
    } catch (e) { /* ignore */ }
    idx += 1;
    showBack = false;
    // Faellig-Zaehler live nachziehen (eine falsche Antwort faellt sofort
    // wieder auf faellig zurueck, eine richtige kann ihn verringern).
    renderStatusBar();
    drawCard();
  }

  await loadQueue();
}

// ---------- Vocab (Admin CRUD, read for all) - auf Eis, siehe server.js ----------

async function renderVocab(app) {
  app.appendChild(el('h2', { class: 'section-title' }, t('vocab_title')));

  const isAdmin = CURRENT_USER && CURRENT_USER.is_admin;
  const listCard = el('div', { class: 'card' });
  app.appendChild(listCard);

  let editingId = null;
  let formCard = null;
  let categories = [];

  async function refreshCategories() {
    try { categories = await api('/vocab/categories'); } catch (e) { categories = []; }
  }

  async function loadList() {
    const words = await api('/vocab');
    listCard.innerHTML = '';
    if (!words.length) {
      listCard.appendChild(el('div', { class: 'empty-state' }, t('vocab_empty')));
      return;
    }
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, t('vocab_navi')),
      el('th', {}, t('vocab_de')),
      el('th', {}, t('vocab_en')),
      el('th', {}, t('vocab_category')),
      isAdmin ? el('th', {}, '') : null,
    ])));
    const tbody = el('tbody');
    words.forEach((w) => {
      tbody.appendChild(el('tr', {}, [
        el('td', { html: naviHtml(w.navi) }),
        el('td', {}, w.de),
        el('td', {}, w.en),
        el('td', {}, w.category ? el('span', { class: 'tag' }, w.category) : ''),
        isAdmin ? el('td', {}, el('div', { class: 'row-actions' }, [
          el('button', { onclick: () => openForm(w) }, t('vocab_edit')),
          el('button', { class: 'danger', onclick: () => removeWord(w.id) }, t('vocab_delete')),
        ])) : null,
      ]));
    });
    table.appendChild(tbody);
    listCard.appendChild(table);
  }

  async function removeWord(id) {
    if (!confirm(t('confirm_delete'))) return;
    await api('/vocab/' + id, { method: 'DELETE' });
    await loadList();
  }

  function openForm(word) {
    editingId = word ? word.id : null;
    if (formCard) formCard.remove();
    formCard = el('div', { class: 'card' });
    formCard.appendChild(el('h3', { class: 'section-title', style: 'margin-top:0' }, word ? t('vocab_edit_title') : t('vocab_add')));

    // ---- Inschrift-Panel: das Na'vi-Wort als kleiner WYSIWYG-Editor -----
    // Statt rohe <u>-Tags im Text zu tippen, markiert man die betonte Silbe
    // und klickt "U" - man sieht die Betonung sofort so, wie sie spaeter im
    // Trainer/Aktivieren-Tab erscheint. Beim Speichern wird der Rohoutput
    // auf Text + <u> reduziert (sanitizeNaviEditableHtml).
    const naviEditable = el('div', {
      class: 'navi-editable',
      contenteditable: 'true',
      'data-placeholder': t('vocab_navi_placeholder'),
      html: naviHtml(word ? word.navi : ''),
    });
    naviEditable.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
    naviEditable.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    const underlineBtn = el('button', {
      type: 'button',
      class: 'navi-toolbar-btn',
      title: t('vocab_underline_hint'),
      onmousedown: (e) => e.preventDefault(), // Fokus/Selektion im Editable nicht verlieren
      onclick: () => {
        naviEditable.focus();
        document.execCommand('underline');
      },
    }, 'U');

    const naviPanel = el('div', { class: 'navi-panel' }, [
      el('div', { class: 'navi-toolbar' }, [underlineBtn]),
      naviEditable,
    ]);

    // ---- Details -----------------------------------------------------
    const deInput = el('input', { value: word ? word.de : '', placeholder: t('vocab_navi_ph_de') });
    const enInput = el('input', { value: word ? word.en : '', placeholder: t('vocab_navi_ph_en') });
    const transInput = el('input', { value: word && word.transitivity ? word.transitivity : '', placeholder: t('vocab_transitivity_ph') });

    // Kategorie als Dropdown der bereits vorhandenen Kategorien, plus Option
    // fuer eine neue (dann erscheint ein Freitextfeld) - verhindert Tipp-
    // fehler/Varianten der immer gleichen ~30 Wortart-/Themen-Labels.
    const currentCategory = word && word.category ? word.category : '';
    const knownCategory = currentCategory && categories.includes(currentCategory);
    const catSelect = el('select', {}, [
      el('option', { value: '' }, t('vocab_category_none')),
      ...categories.map((c) => el('option', { value: c, selected: c === currentCategory ? 'selected' : false }, c)),
      el('option', { value: '__new__', selected: currentCategory && !knownCategory ? 'selected' : false }, t('vocab_category_new')),
    ]);
    const catNewInput = el('input', {
      value: currentCategory && !knownCategory ? currentCategory : '',
      placeholder: t('vocab_category_new_placeholder'),
      style: currentCategory && !knownCategory ? '' : 'display:none',
    });
    catSelect.addEventListener('change', () => {
      catNewInput.style.display = catSelect.value === '__new__' ? '' : 'none';
      if (catSelect.value === '__new__') catNewInput.focus();
    });

    const notesInput = el('textarea', { placeholder: t('vocab_notes_ph'), rows: 2 }, word && word.notes ? word.notes : '');

    const errBox = el('div', { class: 'error-msg', style: 'display:none' });

    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        errBox.style.display = 'none';
        const payload = {
          navi: sanitizeNaviEditableHtml(naviEditable),
          de: deInput.value,
          en: enInput.value,
          transitivity: transInput.value,
          category: catSelect.value === '__new__' ? catNewInput.value : catSelect.value,
          notes: notesInput.value,
        };
        try {
          if (editingId) {
            await api('/vocab/' + editingId, { method: 'PUT', body: payload });
          } else {
            await api('/vocab', { method: 'POST', body: payload });
          }
          formCard.remove();
          formCard = null;
          await refreshCategories();
          await loadList();
        } catch (err) {
          errBox.textContent = t('err_generic');
          errBox.style.display = 'block';
        }
      },
    });

    form.appendChild(el('div', { class: 'vocab-form-eyebrow' }, t('vocab_section_navi')));
    form.appendChild(naviPanel);
    form.appendChild(el('div', { class: 'navi-panel-hint' }, t('vocab_navi_hint')));

    form.appendChild(el('div', { class: 'vocab-form-eyebrow' }, t('vocab_section_translations')));
    form.appendChild(el('div', { class: 'vocab-form-grid' }, [
      el('div', {}, [el('label', {}, t('vocab_de')), deInput]),
      el('div', {}, [el('label', {}, t('vocab_en')), enInput]),
    ]));

    form.appendChild(el('div', { class: 'vocab-form-eyebrow' }, t('vocab_section_details')));
    form.appendChild(el('div', { class: 'vocab-form-grid' }, [
      el('div', {}, [el('label', {}, t('vocab_category')), catSelect, catNewInput]),
      el('div', {}, [el('label', {}, t('vocab_transitivity')), transInput]),
    ]));
    form.appendChild(el('label', {}, t('vocab_notes')));
    form.appendChild(notesInput);

    form.appendChild(errBox);
    const btnRow = el('div', { class: 'row-actions' }, [
      el('button', { class: 'btn', type: 'submit' }, t('vocab_save')),
      el('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { formCard.remove(); formCard = null; } }, t('vocab_cancel')),
    ]);
    form.appendChild(btnRow);
    formCard.appendChild(form);
    app.insertBefore(formCard, listCard);
  }

  if (isAdmin) {
    await refreshCategories();
    app.insertBefore(el('button', { class: 'btn', onclick: () => openForm(null) }, t('vocab_add')), listCard);
  }

  await loadList();
}

// ---------- Progress ----------

async function renderProgress(app) {
  app.appendChild(el('h2', { class: 'section-title' }, t('progress_title')));
  const data = await api('/trainer/progress');
  const { summary, directions, words } = data;

  const summaryCard = el('div', { class: 'grid grid-2' }, [
    statTile(t('progress_total'), summary.total),
    statTile(t('progress_seen'), summary.seen),
    statTile(t('progress_mastered'), summary.mastered),
  ]);
  app.appendChild(summaryCard);

  const targetLangLabel = currentLang.toUpperCase();
  const directionMeta = [
    { key: 'navi_to_target', label: tFormat('trainer_direction_navi_to_target', { lang: targetLangLabel }) },
    { key: 'target_to_navi', label: tFormat('trainer_direction_target_to_navi', { lang: targetLangLabel }) },
  ];

  const boxesCard = el('div', { class: 'card' }, [el('h3', {}, t('progress_boxes'))]);
  directionMeta.forEach(({ key, label }) => {
    const d = directions[key];
    if (!d) return;
    const maxCount = Math.max(1, d.not_started, ...d.levels);
    boxesCard.appendChild(el('div', { style: 'margin-top:16px' }, [
      el('div', { style: 'font-weight:600;margin-bottom:8px' }, `${label} — ${d.due} ${t('progress_due_today')}`),
      el('div', {}, [
        el('span', { style: 'font-size:0.8rem;color:var(--text-dim)' }, `${t('progress_not_started')}: ${d.not_started}`),
        el('div', { class: 'progress-bar-wrap', style: 'height:16px' }, [
          el('div', { class: 'progress-bar', style: `width:${Math.round((100 * d.not_started) / maxCount)}%` }),
        ]),
      ]),
      ...d.levels.map((count, level) => el('div', {}, [
        el('span', { style: 'font-size:0.8rem;color:var(--text-dim)' }, `${t('progress_box')} ${level}: ${count} ${t('progress_words')}`),
        el('div', { class: 'progress-bar-wrap', style: 'height:16px' }, [
          el('div', { class: 'progress-bar', style: `width:${Math.round((100 * count) / maxCount)}%` }),
        ]),
      ])),
    ]));
  });
  app.appendChild(boxesCard);

  const listCard = el('div', { class: 'card' });
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', {}, t('vocab_navi')),
    el('th', {}, t('vocab_section_translations')),
    el('th', {}, directionMeta[0].label),
    el('th', {}, directionMeta[1].label),
  ])));
  const tbody = el('tbody');
  words.forEach((w) => {
    tbody.appendChild(el('tr', {}, [
      el('td', { html: naviHtml(w.navi) }),
      el('td', {}, primaryTranslation(w)),
      el('td', {}, w.level_navi_to_target === null ? '—' : String(w.level_navi_to_target)),
      el('td', {}, w.level_target_to_navi === null ? '—' : String(w.level_target_to_navi)),
    ]));
  });
  table.appendChild(tbody);
  listCard.appendChild(table);
  app.appendChild(listCard);
}

function statTile(label, value) {
  return el('div', { class: 'card' }, [
    el('div', { style: 'font-size:2rem;font-weight:700' }, String(value)),
    el('div', { style: 'color:var(--text-dim);font-size:0.85rem' }, label),
  ]);
}

// ---------- Admin ----------

async function renderAdmin(app) {
  if (!CURRENT_USER || !CURRENT_USER.is_admin) {
    app.appendChild(el('div', { class: 'empty-state' }, 'Forbidden'));
    return;
  }
  app.appendChild(el('h2', { class: 'section-title' }, t('admin_title')));

  const formCard = el('div', { class: 'card' });
  const nameInput = el('input', { placeholder: t('admin_name') });
  const emailInput = el('input', { type: 'email', placeholder: t('admin_email') });
  const passInput = el('input', { type: 'password', placeholder: t('admin_password') });
  const adminCheck = el('input', { type: 'checkbox', style: 'width:auto;display:inline-block;margin-right:8px' });
  const creatorCheck = el('input', { type: 'checkbox', style: 'width:auto;display:inline-block;margin-right:8px' });
  const reviewerCheck = el('input', { type: 'checkbox', style: 'width:auto;display:inline-block;margin-right:8px' });
  const errBox = el('div', { class: 'error-msg', style: 'display:none' });

  const listCard = el('div', { class: 'card' });

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      errBox.style.display = 'none';
      try {
        await api('/admin/users', {
          method: 'POST',
          body: {
            name: nameInput.value,
            email: emailInput.value,
            password: passInput.value,
            is_admin: adminCheck.checked,
            is_creator: creatorCheck.checked,
            is_reviewer: reviewerCheck.checked,
          },
        });
        nameInput.value = ''; emailInput.value = ''; passInput.value = '';
        adminCheck.checked = false; creatorCheck.checked = false; reviewerCheck.checked = false;
        await loadUsers();
      } catch (err) {
        errBox.textContent = t('err_' + err.code) !== ('err_' + err.code) ? t('err_' + err.code) : t('err_generic');
        errBox.style.display = 'block';
      }
    },
  });
  form.appendChild(el('label', {}, t('admin_name')));
  form.appendChild(nameInput);
  form.appendChild(el('label', {}, t('admin_email')));
  form.appendChild(emailInput);
  form.appendChild(el('label', {}, t('admin_password')));
  form.appendChild(passInput);
  form.appendChild(el('label', { style: 'display:flex;align-items:center;font-size:0.9rem;color:var(--text)' }, [adminCheck, t('admin_is_admin')]));
  form.appendChild(el('label', { style: 'display:flex;align-items:center;font-size:0.9rem;color:var(--text)' }, [creatorCheck, t('role_creator')]));
  form.appendChild(el('label', { style: 'display:flex;align-items:center;font-size:0.9rem;color:var(--text)' }, [reviewerCheck, t('role_reviewer')]));
  form.appendChild(errBox);
  form.appendChild(el('button', { class: 'btn', type: 'submit' }, t('admin_create')));
  formCard.appendChild(el('h3', {}, t('admin_add')));
  formCard.appendChild(form);

  app.appendChild(formCard);
  app.appendChild(listCard);

  async function loadUsers() {
    const users = await api('/admin/users');
    listCard.innerHTML = '';
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, t('admin_name')),
      el('th', {}, t('admin_email')),
      el('th', {}, ''),
      el('th', {}, ''),
    ])));
    const tbody = el('tbody');
    users.forEach((u) => {
      const actions = el('div', { class: 'row-actions' }, [
        el('button', {
          onclick: async () => {
            try {
              await api('/admin/users/' + u.id, { method: 'PATCH', body: { is_admin: !u.is_admin } });
              await loadUsers();
            } catch (err) { alert(t('admin_cannot_delete_last_admin')); }
          },
        }, u.is_admin ? t('admin_revoke_admin') : t('admin_make_admin')),
        el('button', {
          onclick: async () => {
            await api('/admin/users/' + u.id, { method: 'PATCH', body: { is_creator: !u.is_creator } });
            await loadUsers();
          },
        }, u.is_creator ? t('admin_revoke_creator') : t('admin_make_creator')),
        el('button', {
          onclick: async () => {
            await api('/admin/users/' + u.id, { method: 'PATCH', body: { is_reviewer: !u.is_reviewer } });
            await loadUsers();
          },
        }, u.is_reviewer ? t('admin_revoke_reviewer') : t('admin_make_reviewer')),
        el('button', {
          class: 'danger',
          onclick: async () => {
            if (!confirm(t('confirm_delete'))) return;
            try {
              await api('/admin/users/' + u.id, { method: 'DELETE' });
              await loadUsers();
            } catch (err) {
              alert(err.code === 'cannot_delete_last_admin' ? t('admin_cannot_delete_last_admin') : t('admin_cannot_delete_self'));
            }
          },
        }, t('admin_delete')),
      ]);
      const roleTags = [
        u.is_admin ? el('span', { class: 'tag admin' }, 'Admin') : null,
        u.is_creator ? el('span', { class: 'tag' }, t('role_creator')) : null,
        u.is_reviewer ? el('span', { class: 'tag' }, t('role_reviewer')) : null,
      ].filter(Boolean);
      tbody.appendChild(el('tr', {}, [
        el('td', {}, u.name),
        el('td', {}, u.email),
        el('td', {}, roleTags),
        el('td', {}, actions),
      ]));
    });
    table.appendChild(tbody);
    listCard.appendChild(table);
  }

  await loadUsers();
  await renderPrioritySection(app);
}

// ---------- Grammatik-Baukasten (Learner-Uebungsflow) ----------
// NON-AI-POLICY: alle Uebungsinhalte kommen von menschlichen Creators,
// die Auswertung laeuft ausschliesslich ueber die deterministischen
// Funktionen in lib/grammar/*.js (server.js) - siehe routes/grammar.js.

const GRAMMAR_MODULES = ['infix', 'suffix', 'lenition'];

function formatExpectedText(module, expected) {
  if (module === 'infix') return expected.result;
  if (module === 'suffix') return expected.suffixes.join(', ');
  if (module === 'lenition') return expected.result;
  return '';
}

// Modul A: Wort mit zwei sichtbaren Luecken, ein Infix-Tile zum Ziehen.
// Nutzt Pointer Events statt der nativen HTML5-Drag-API, da diese auf
// Touch-Geraeten nicht funktioniert - so laeuft das Ziehen identisch auf
// Maus und Touch.
function drawInfixExercise(container, exercise, onSubmit) {
  const { stammwort, bedeutung, infix, gaps } = exercise;
  container.appendChild(el('div', { class: 'tag' }, t('grammar_module_infix')));
  container.appendChild(el('div', { class: 'flashcard-hint' }, bedeutung));

  const positions = [
    { key: 'pos1', index: gaps.pos1 },
    { key: 'pos2', index: gaps.pos2 },
  ].sort((a, b) => a.index - b.index);

  const wordRow = el('div', { class: 'infix-word' });
  let cursor = 0;
  positions.forEach((p) => {
    wordRow.appendChild(el('span', {}, stammwort.slice(cursor, p.index)));
    wordRow.appendChild(el('span', { class: 'infix-gap', 'data-gap': p.key }, ''));
    cursor = p.index;
  });
  wordRow.appendChild(el('span', {}, stammwort.slice(cursor)));
  container.appendChild(wordRow);

  container.appendChild(el('div', { class: 'flashcard-hint' }, t('grammar_infix_drag_hint')));

  const tile = el('div', { class: 'infix-tile' }, infix);
  container.appendChild(el('div', { class: 'infix-tile-row' }, [tile]));

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  tile.addEventListener('pointerdown', (e) => {
    dragging = true;
    tile.setPointerCapture(e.pointerId);
    tile.classList.add('dragging');
    const rect = tile.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    tile.style.position = 'fixed';
    tile.style.left = `${rect.left}px`;
    tile.style.top = `${rect.top}px`;
  });

  tile.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    tile.style.left = `${e.clientX - offsetX}px`;
    tile.style.top = `${e.clientY - offsetY}px`;
  });

  tile.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    tile.classList.remove('dragging');
    tile.style.visibility = 'hidden';
    const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
    tile.style.visibility = '';
    tile.style.position = '';
    tile.style.left = '';
    tile.style.top = '';
    const gapEl = dropTarget && dropTarget.closest('.infix-gap');
    if (gapEl) {
      onSubmit({ gap: gapEl.dataset.gap });
    }
  });
}

// Modul B: Luecken-Satz aus dem servergenerierten Template ("___0___" je
// Luecke) - Dropdown wenn die Uebung Optionen definiert, sonst Freitext.
function drawSuffixExercise(container, exercise, onSubmit) {
  const { template, translation, gaps } = exercise;
  container.appendChild(el('div', { class: 'tag' }, t('grammar_module_suffix')));
  container.appendChild(el('div', { class: 'flashcard-hint' }, translation));

  const sentenceEl = el('div', { class: 'suffix-sentence' });
  const inputs = {};
  const parts = template.split(/___(\d+)___/);
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      if (part) sentenceEl.appendChild(document.createTextNode(part));
      return;
    }
    const gapIndex = Number(part);
    const gapDef = gaps.find((g) => g.index === gapIndex);
    const inputEl = gapDef && gapDef.options
      ? el('select', {}, [el('option', { value: '' }, '—'), ...gapDef.options.map((o) => el('option', { value: o }, o))])
      : el('input', { class: 'suffix-input' });
    inputs[gapIndex] = inputEl;
    sentenceEl.appendChild(inputEl);
  });
  container.appendChild(sentenceEl);

  container.appendChild(el('button', {
    class: 'btn',
    onclick: () => {
      const answers = Object.entries(inputs).map(([index, inputEl]) => ({ index: Number(index), value: inputEl.value }));
      onSubmit({ answers });
    },
  }, t('activate_submit')));
}

// Modul C: Praefix + Grundwort angezeigt, Freitext fuer die lenisierte Form.
function drawLenitionExercise(container, exercise, onSubmit) {
  const { prefix, base_word } = exercise;
  container.appendChild(el('div', { class: 'tag' }, t('grammar_module_lenition')));
  container.appendChild(el('div', { class: 'flashcard-hint' }, tFormat('grammar_lenition_prompt', { prefix, base_word })));

  const input = el('input', { placeholder: t('grammar_lenition_answer_ph') });
  container.appendChild(input);
  container.appendChild(el('button', { class: 'btn', onclick: () => onSubmit({ answer: input.value }) }, t('activate_submit')));
}

async function renderGrammatikHub(app) {
  app.appendChild(el('h2', { class: 'section-title' }, t('grammar_title')));

  let activeModule = 'infix';
  const tabButtons = {};
  const filterRow = el('div', { class: 'filters' });
  GRAMMAR_MODULES.forEach((m) => {
    const btn = el('button', { class: 'btn btn-secondary', onclick: () => { activeModule = m; updateTabs(); loadQueue(); } }, t('grammar_module_' + m));
    tabButtons[m] = btn;
    filterRow.appendChild(btn);
  });
  app.appendChild(filterRow);

  function updateTabs() {
    GRAMMAR_MODULES.forEach((m) => { tabButtons[m].className = m === activeModule ? 'btn' : 'btn btn-secondary'; });
  }
  updateTabs();

  const cardWrap = el('div', { class: 'flashcard' });
  app.appendChild(cardWrap);

  let queue = [];
  let idx = 0;

  async function loadQueue() {
    queue = await api('/grammar/exercises?module=' + activeModule);
    idx = 0;
    drawExercise();
  }

  function showFeedback(result) {
    cardWrap.innerHTML = '';
    cardWrap.appendChild(el('div', { class: result.correct ? 'ok-msg' : 'error-msg', style: 'display:block' }, result.correct ? t('trainer_correct') : t('trainer_wrong')));
    cardWrap.appendChild(el('div', { class: 'flashcard-hint' }, `${t('grammar_expected_result')}: ${formatExpectedText(queue[idx].module, result.expected)}`));
    cardWrap.appendChild(el('button', { class: 'btn', onclick: () => { idx += 1; drawExercise(); } }, t('trainer_next')));
  }

  async function onSubmit(payload) {
    try {
      const result = await api(`/grammar/exercises/${queue[idx].id}/attempt`, { method: 'POST', body: payload });
      showFeedback(result);
    } catch (e) { /* ignore */ }
  }

  function drawExercise() {
    cardWrap.innerHTML = '';
    if (!queue.length) {
      cardWrap.appendChild(el('div', { class: 'empty-state' }, t('grammar_empty')));
      return;
    }
    if (idx >= queue.length) {
      cardWrap.appendChild(el('div', { class: 'empty-state' }, [
        el('p', {}, '✓'),
        el('button', { class: 'btn', onclick: loadQueue }, t('trainer_next')),
      ]));
      return;
    }
    const exercise = queue[idx];
    if (exercise.module === 'infix') drawInfixExercise(cardWrap, exercise, onSubmit);
    else if (exercise.module === 'suffix') drawSuffixExercise(cardWrap, exercise, onSubmit);
    else if (exercise.module === 'lenition') drawLenitionExercise(cardWrap, exercise, onSubmit);
  }

  await loadQueue();
}

// ---------- Grammatik-Baukasten (Creator: Uebungen erstellen) ----------
// Clientseitige Kopien der reinen Server-Regel-Funktionen (lib/grammar/*.js)
// nur fuer die Live-Vorschau beim Erstellen - die tatsaechliche Bewertung
// von Learner-Antworten laeuft ausschliesslich serverseitig.
function clientInsertInfix(word, index, infix) {
  const i = Math.max(0, Math.min(index, word.length));
  return word.slice(0, i) + infix + word.slice(i);
}
const CLIENT_LENITION_RULES = [['kx', 'k'], ['px', 'p'], ['tx', 't'], ['ts', 's'], ['p', 'f'], ['t', 's'], ['k', 'h'], ["'", '']];
function clientLenite(word) {
  for (const [from, to] of CLIENT_LENITION_RULES) {
    if (word.startsWith(from)) return to + word.slice(from.length);
  }
  return word;
}

async function renderGrammatikErstellen(app) {
  app.appendChild(el('h2', { class: 'section-title' }, t('grammar_create_title')));

  // Dauerhafter Hinweis statt Einmal-Popup: transparenter, da er nicht nach
  // dem ersten Wegklicken verschwindet - erklaert, dass Uebungen Community-
  // Inhalt werden und auch nach einer Account-Loeschung erhalten bleiben,
  // inkl. einmaliger Namensnennung in den Danksagungen (siehe dortige
  // Erlaeuterung + Datenschutzerklaerung fuer die rechtliche Begruendung).
  app.appendChild(el('div', { class: 'legal-notice' }, t('grammar_creator_notice')));

  let activeModule = 'infix';
  let editingExercise = null; // gesetzte Uebung wird im Formular vorausgefuellt (Bearbeiten nach Ablehnung)
  const tabButtons = {};
  const filterRow = el('div', { class: 'filters' });
  GRAMMAR_MODULES.forEach((m) => {
    const btn = el('button', {
      class: 'btn btn-secondary',
      onclick: () => { activeModule = m; editingExercise = null; updateTabs(); drawForm(); },
    }, t('grammar_module_' + m));
    tabButtons[m] = btn;
    filterRow.appendChild(btn);
  });
  app.appendChild(filterRow);
  function updateTabs() {
    GRAMMAR_MODULES.forEach((m) => { tabButtons[m].className = m === activeModule ? 'btn' : 'btn btn-secondary'; });
  }
  updateTabs();

  const formCard = el('div', { class: 'card' });
  app.appendChild(formCard);
  const listCard = el('div', { class: 'card' });
  app.appendChild(listCard);

  async function loadMine() {
    const rows = await api('/grammar/mine');
    listCard.innerHTML = '';
    listCard.appendChild(el('h3', { style: 'margin-top:0' }, t('grammar_mine_title')));
    if (!rows.length) {
      listCard.appendChild(el('div', { class: 'empty-state' }, t('grammar_mine_empty')));
      return;
    }
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, t('grammar_module')),
      el('th', {}, t('grammar_status')),
      el('th', {}, ''),
    ])));
    const tbody = el('tbody');
    rows.forEach((row) => {
      const statusTag = el('span', { class: 'tag' }, t('grammar_status_' + row.status));
      const noteEl = row.review_note ? el('div', { style: 'font-size:0.8rem;color:var(--text-dim);margin-top:4px' }, row.review_note) : null;
      const canEdit = row.status === 'pending' || row.status === 'rejected';
      const actions = el('div', { class: 'row-actions' }, [
        canEdit ? el('button', {
          onclick: () => { activeModule = row.module; editingExercise = row; updateTabs(); drawForm(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
        }, t('vocab_edit')) : null,
        el('button', {
          class: 'danger',
          onclick: async () => {
            if (!confirm(t('confirm_delete'))) return;
            await api('/grammar/exercises/' + row.id, { method: 'DELETE' });
            await loadMine();
          },
        }, t('vocab_delete')),
      ]);
      tbody.appendChild(el('tr', {}, [
        el('td', {}, t('grammar_module_' + row.module)),
        el('td', {}, [statusTag, noteEl]),
        el('td', {}, actions),
      ]));
    });
    table.appendChild(tbody);
    listCard.appendChild(table);
  }

  function drawForm() {
    formCard.innerHTML = '';
    if (activeModule === 'infix') drawInfixForm();
    else if (activeModule === 'suffix') drawSuffixForm();
    else drawLenitionForm();
  }

  async function saveExercise(module, data) {
    if (editingExercise && editingExercise.module === module) {
      await api('/grammar/exercises/' + editingExercise.id, { method: 'PATCH', body: { data } });
    } else {
      await api('/grammar/exercises', { method: 'POST', body: { module, data } });
    }
    editingExercise = null;
  }

  function drawInfixForm() {
    const existing = editingExercise && editingExercise.module === 'infix' ? editingExercise.data : null;
    const stammInput = el('input', { placeholder: t('grammar_infix_stammwort_ph'), value: existing ? existing.stammwort : '' });
    const bedeutungInput = el('input', { placeholder: t('grammar_infix_bedeutung_ph'), value: existing ? existing.bedeutung : '' });
    const infixInput = el('input', { placeholder: t('grammar_infix_infix_ph'), value: existing ? existing.infix : '' });
    const pos1Input = el('input', { type: 'number', min: '0', placeholder: 'pos1', value: existing ? existing.gaps.pos1 : '' });
    const pos2Input = el('input', { type: 'number', min: '0', placeholder: 'pos2', value: existing ? existing.gaps.pos2 : '' });
    const correctSelect = el('select', {}, [
      el('option', { value: 'pos1', selected: !existing || existing.correct_gap === 'pos1' ? 'selected' : false }, 'pos1'),
      el('option', { value: 'pos2', selected: existing && existing.correct_gap === 'pos2' ? 'selected' : false }, 'pos2'),
    ]);
    const preview = el('div', { class: 'flashcard-hint' }, '');
    const errBox = el('div', { class: 'error-msg', style: 'display:none' });

    function updatePreview() {
      const word = stammInput.value;
      const pos = Number(correctSelect.value === 'pos1' ? pos1Input.value : pos2Input.value);
      preview.textContent = word && infixInput.value && !Number.isNaN(pos)
        ? `${t('grammar_preview')}: ${clientInsertInfix(word, pos, infixInput.value)}`
        : '';
    }
    [stammInput, infixInput, pos1Input, pos2Input].forEach((elm) => elm.addEventListener('input', updatePreview));
    correctSelect.addEventListener('change', updatePreview);
    updatePreview();

    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        errBox.style.display = 'none';
        try {
          await saveExercise('infix', {
            stammwort: stammInput.value,
            bedeutung: bedeutungInput.value,
            infix: infixInput.value,
            gaps: { pos1: Number(pos1Input.value), pos2: Number(pos2Input.value) },
            correct_gap: correctSelect.value,
          });
          await loadMine();
          drawForm();
        } catch (err) {
          errBox.textContent = t('err_generic');
          errBox.style.display = 'block';
        }
      },
    }, [
      el('label', {}, t('grammar_infix_stammwort')), stammInput,
      el('label', {}, t('grammar_infix_bedeutung')), bedeutungInput,
      el('label', {}, t('grammar_infix_infix')), infixInput,
      el('label', {}, t('grammar_infix_pos1')), pos1Input,
      el('label', {}, t('grammar_infix_pos2')), pos2Input,
      el('label', {}, t('grammar_infix_correct_gap')), correctSelect,
      preview,
      errBox,
      el('button', { class: 'btn', type: 'submit' }, t('grammar_create_submit')),
    ]);
    formCard.appendChild(el('h3', { style: 'margin-top:0' }, t('grammar_module_infix')));
    formCard.appendChild(form);
  }

  function drawSuffixForm() {
    const existing = editingExercise && editingExercise.module === 'suffix' ? editingExercise.data : null;
    const sentenceInput = el('input', { placeholder: t('grammar_suffix_sentence_ph'), value: existing ? existing.full_sentence : '' });
    const translationInput = el('input', { placeholder: t('grammar_suffix_translation_ph'), value: existing ? existing.translation : '' });
    const gapsWrap = el('div');
    let gapRows = [];

    function addGapRow(gap) {
      const stemInput = el('input', { placeholder: t('grammar_suffix_stem_ph'), value: gap ? gap.stem : '' });
      const suffixInput = el('input', { placeholder: t('grammar_suffix_suffix_ph'), value: gap ? gap.correct_suffix : '' });
      const optionsInput = el('input', { placeholder: t('grammar_suffix_options_ph'), value: gap && gap.options ? gap.options.join(', ') : '' });
      gapRows.push({ stemInput, suffixInput, optionsInput });
      gapsWrap.appendChild(el('div', { class: 'row-actions', style: 'margin-bottom:8px' }, [stemInput, suffixInput, optionsInput]));
    }
    if (existing) existing.gaps.forEach((g) => addGapRow(g));
    else addGapRow();

    const addGapBtn = el('button', { type: 'button', class: 'btn btn-secondary', onclick: () => addGapRow() }, t('grammar_suffix_add_gap'));
    const errBox = el('div', { class: 'error-msg', style: 'display:none' });

    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        errBox.style.display = 'none';
        const gaps = gapRows.map((r) => ({
          stem: r.stemInput.value,
          correct_suffix: r.suffixInput.value,
          options: r.optionsInput.value ? r.optionsInput.value.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        }));
        try {
          await saveExercise('suffix', { full_sentence: sentenceInput.value, translation: translationInput.value, gaps });
          await loadMine();
          drawForm();
        } catch (err) {
          errBox.textContent = t('err_generic');
          errBox.style.display = 'block';
        }
      },
    }, [
      el('label', {}, t('grammar_suffix_sentence')), sentenceInput,
      el('label', {}, t('grammar_suffix_translation')), translationInput,
      el('label', {}, t('grammar_suffix_gaps')), gapsWrap, addGapBtn,
      errBox,
      el('button', { class: 'btn', type: 'submit' }, t('grammar_create_submit')),
    ]);
    formCard.appendChild(el('h3', { style: 'margin-top:0' }, t('grammar_module_suffix')));
    formCard.appendChild(el('p', { class: 'hint-text' }, t('grammar_suffix_hint')));
    formCard.appendChild(form);
  }

  function drawLenitionForm() {
    const existing = editingExercise && editingExercise.module === 'lenition' ? editingExercise.data : null;
    const prefixInput = el('input', { placeholder: t('grammar_lenition_prefix_ph'), value: existing ? existing.prefix : '' });
    const realizationInput = el('input', { placeholder: t('grammar_lenition_realization_ph'), value: existing ? existing.prefix_realization : '' });
    const baseInput = el('input', { placeholder: t('grammar_lenition_base_ph'), value: existing ? existing.base_word : '' });
    const resultInput = el('input', { placeholder: t('grammar_lenition_result_ph'), value: existing ? existing.expected_result : '' });
    const preview = el('div', { class: 'flashcard-hint' }, '');
    const errBox = el('div', { class: 'error-msg', style: 'display:none' });

    function updatePreview() {
      if (!baseInput.value) { preview.textContent = ''; return; }
      const computed = (realizationInput.value || prefixInput.value || '') + clientLenite(baseInput.value);
      preview.textContent = `${t('grammar_preview')}: ${computed}`;
      if (!resultInput.value) resultInput.value = computed;
    }
    [prefixInput, realizationInput, baseInput].forEach((elm) => elm.addEventListener('input', updatePreview));

    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        errBox.style.display = 'none';
        try {
          await saveExercise('lenition', {
            prefix: prefixInput.value,
            prefix_realization: realizationInput.value || prefixInput.value,
            base_word: baseInput.value,
            expected_result: resultInput.value,
          });
          await loadMine();
          drawForm();
        } catch (err) {
          errBox.textContent = t('err_generic');
          errBox.style.display = 'block';
        }
      },
    }, [
      el('label', {}, t('grammar_lenition_prefix')), prefixInput,
      el('label', {}, t('grammar_lenition_realization')), realizationInput,
      el('label', {}, t('grammar_lenition_base')), baseInput,
      preview,
      el('label', {}, t('grammar_lenition_result')), resultInput,
      errBox,
      el('button', { class: 'btn', type: 'submit' }, t('grammar_create_submit')),
    ]);
    formCard.appendChild(el('h3', { style: 'margin-top:0' }, t('grammar_module_lenition')));
    formCard.appendChild(el('p', { class: 'hint-text' }, t('grammar_lenition_hint')));
    formCard.appendChild(form);
  }

  drawForm();
  await loadMine();
}

// ---------- Grammatik-Baukasten (Reviewer-Queue) ----------

function grammarPreviewLines(module, data) {
  if (module === 'infix') {
    const computed = clientInsertInfix(data.stammwort, data.gaps[data.correct_gap], data.infix);
    return [
      `${t('grammar_infix_stammwort')}: ${data.stammwort} (${data.bedeutung})`,
      `${t('grammar_infix_infix')}: ${data.infix} -> ${data.correct_gap}`,
      `${t('grammar_preview')}: ${computed}`,
    ];
  }
  if (module === 'suffix') {
    return [
      data.full_sentence,
      data.translation,
      data.gaps.map((g) => `${g.stem}+${g.correct_suffix}`).join(', '),
    ];
  }
  if (module === 'lenition') {
    const computed = (data.prefix_realization || data.prefix) + clientLenite(data.base_word);
    const mismatch = computed !== data.expected_result;
    return [
      `${data.prefix} (${data.prefix_realization}) + ${data.base_word}`,
      `${t('grammar_lenition_result')}: ${data.expected_result}${mismatch ? ' ⚠' : ''}`,
    ];
  }
  return [];
}

async function renderGrammatikReview(app) {
  app.appendChild(el('h2', { class: 'section-title' }, t('grammar_review_title')));
  const listWrap = el('div');
  app.appendChild(listWrap);

  async function loadQueue() {
    const rows = await api('/grammar/review-queue');
    listWrap.innerHTML = '';
    if (!rows.length) {
      listWrap.appendChild(el('div', { class: 'empty-state' }, t('grammar_review_empty')));
      return;
    }
    rows.forEach((row) => {
      const noteInput = el('input', { placeholder: t('grammar_review_note_ph') });
      listWrap.appendChild(el('div', { class: 'card', style: 'margin-bottom:12px' }, [
        el('div', { class: 'tag' }, `${t('grammar_module_' + row.module)} · ${row.creator_name}`),
        ...grammarPreviewLines(row.module, row.data).map((line) => el('p', {}, line)),
        noteInput,
        el('div', { class: 'row-actions', style: 'margin-top:10px' }, [
          el('button', {
            class: 'btn',
            onclick: async () => {
              await api(`/grammar/exercises/${row.id}/review`, { method: 'POST', body: { decision: 'approve' } });
              await loadQueue();
            },
          }, t('grammar_review_approve')),
          el('button', {
            class: 'btn btn-secondary',
            onclick: async () => {
              await api(`/grammar/exercises/${row.id}/review`, { method: 'POST', body: { decision: 'reject', note: noteInput.value } });
              await loadQueue();
            },
          }, t('grammar_review_reject')),
        ]),
      ]));
    });
  }

  await loadQueue();
}

async function renderGrammatikFortschritt(app) {
  app.appendChild(el('h2', { class: 'section-title' }, t('grammar_progress_title')));
  const data = await api('/grammar/progress');
  const { summary, byModule } = data;

  app.appendChild(el('div', { class: 'grid grid-2' }, [
    statTile(t('grammar_progress_total'), summary.total),
    statTile(t('grammar_progress_correct'), summary.correct),
  ]));

  const listCard = el('div', { class: 'card' }, [el('h3', { style: 'margin-top:0' }, t('grammar_progress_by_module'))]);
  GRAMMAR_MODULES.forEach((m) => {
    const stats = byModule[m] || { total: 0, attempted: 0, correct: 0 };
    const pct = stats.total > 0 ? Math.round((100 * stats.correct) / stats.total) : 0;
    listCard.appendChild(el('div', { style: 'margin-top:16px' }, [
      el('div', { style: 'font-weight:600;margin-bottom:8px' }, t('grammar_module_' + m)),
      el('div', { class: 'progress-bar-wrap', style: 'height:16px' }, [
        el('div', { class: 'progress-bar', style: `width:${pct}%` }),
      ]),
      el('span', { style: 'font-size:0.8rem;color:var(--text-dim)' }, tFormat('grammar_progress_module_label', { correct: stats.correct, total: stats.total })),
    ]));
  });
  app.appendChild(listCard);
}

// ---------- Profil ----------

// Kleine wiederverwendbare Fortschrittsbalken-Karte fuers Profil - ein
// Prozentwert, ein Label darunter, ein "Details"-Button zur jeweiligen
// Fortschrittsseite. pct wird vom Aufrufer schon fertig berechnet, damit
// diese Funktion nichts ueber Vokabeln/Grammatik wissen muss.
function progressSummaryCard(title, pct, label, onDetails) {
  return el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, title),
    el('div', { class: 'progress-bar-wrap', style: 'height:18px' }, [
      el('div', { class: 'progress-bar', style: `width:${pct}%` }),
    ]),
    el('div', { style: 'font-size:0.85rem;color:var(--text-dim);margin-top:6px' }, label),
    el('button', { class: 'btn btn-secondary', style: 'margin-top:10px', onclick: onDetails }, t('profile_details')),
  ]);
}

async function renderProfil(app) {
  app.appendChild(el('h2', { class: 'section-title' }, t('profile_title')));

  const infoCard = el('div', { class: 'card' }, [
    el('p', {}, [el('strong', {}, t('field_name') + ': '), CURRENT_USER.name]),
    el('p', {}, [el('strong', {}, t('field_email') + ': '), CURRENT_USER.email || '—']),
  ]);
  app.appendChild(infoCard);

  // Gesamtfortschritt Vokabeln + Grammatik - jeweils ein Balken direkt hier,
  // Detailansicht (bestehende Fortschrittsseite bzw. neue Grammatik-
  // Fortschrittsseite) einen Klick entfernt ueber den "Details"-Button.
  const progressRow = el('div', { class: 'grid grid-2' });
  app.appendChild(progressRow);

  try {
    const vocabProgress = await api('/trainer/progress');
    const { activated, mastered } = vocabProgress.summary;
    const vocabPct = activated > 0 ? Math.round((100 * mastered) / activated) : 0;
    progressRow.appendChild(progressSummaryCard(
      t('profile_progress_vocab'),
      vocabPct,
      tFormat('profile_progress_vocab_label', { mastered, activated }),
      () => navigate('#/progress'),
    ));
  } catch (e) { /* ignore */ }

  try {
    const grammarProgress = await api('/grammar/progress');
    const { total, correct } = grammarProgress.summary;
    const grammarPct = total > 0 ? Math.round((100 * correct) / total) : 0;
    progressRow.appendChild(progressSummaryCard(
      t('profile_progress_grammar'),
      grammarPct,
      tFormat('profile_progress_grammar_label', { correct, total }),
      () => navigate('#/grammatik/fortschritt'),
    ));
  } catch (e) { /* ignore */ }

  // Name aendern
  const nameCard = el('div', { class: 'card' });
  const nameInput = el('input', { value: CURRENT_USER.name });
  const nameMsg = el('div', { class: 'error-msg', style: 'display:none' });
  const nameForm = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      nameMsg.style.display = 'none';
      try {
        await api('/auth/me', { method: 'PATCH', body: { name: nameInput.value } });
        CURRENT_USER.name = nameInput.value;
        updateNav();
        nameMsg.className = 'ok-msg';
        nameMsg.textContent = t('profile_saved');
        nameMsg.style.display = 'block';
      } catch (err) {
        nameMsg.className = 'error-msg';
        nameMsg.textContent = t('err_generic');
        nameMsg.style.display = 'block';
      }
    },
  }, [
    el('label', {}, t('field_name')),
    nameInput,
    nameMsg,
    el('button', { class: 'btn', type: 'submit' }, t('profile_change_name')),
  ]);
  nameCard.appendChild(el('h3', { style: 'margin-top:0' }, t('profile_change_name')));
  nameCard.appendChild(nameForm);

  // Na'vi-Name (optional) + Praeferenz, welche Namensform in den
  // Grammatik-Danksagungen erscheint (siehe routes/grammar.js
  // grammar_credits). Beide Felder gehen in einem Request raus, damit ein
  // Dubletten-Fehler beim Na'vi-Namen nicht die Praeferenz-Aenderung
  // verschluckt.
  const naviCard = el('div', { class: 'card' });
  const naviNameInput = el('input', { value: CURRENT_USER.navi_name || '' });
  const prefOptions = [
    ['both', 'profile_credit_pref_both'],
    ['navi', 'profile_credit_pref_navi'],
    ['real', 'profile_credit_pref_real'],
  ];
  const prefInputs = prefOptions.map(([value, labelKey]) => {
    const input = el('input', {
      type: 'radio',
      name: 'credit_name_pref',
      value,
      checked: (CURRENT_USER.credit_name_pref || 'real') === value,
    });
    return el('label', { class: 'radio-label' }, [input, ' ', t(labelKey)]);
  });
  const naviMsg = el('div', { class: 'error-msg', style: 'display:none' });
  const naviForm = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      naviMsg.style.display = 'none';
      const selectedPref = prefInputs
        .map((label) => label.querySelector('input'))
        .find((input) => input.checked).value;
      try {
        await api('/auth/me', {
          method: 'PATCH',
          body: { navi_name: naviNameInput.value, credit_name_pref: selectedPref },
        });
        CURRENT_USER.navi_name = naviNameInput.value.trim() || null;
        CURRENT_USER.credit_name_pref = selectedPref;
        naviMsg.className = 'ok-msg';
        naviMsg.textContent = t('profile_saved');
        naviMsg.style.display = 'block';
      } catch (err) {
        naviMsg.className = 'error-msg';
        naviMsg.textContent = err.code === 'navi_name_taken' ? t('err_navi_name_taken') : t('err_generic');
        naviMsg.style.display = 'block';
      }
    },
  }, [
    el('label', {}, t('field_navi_name')),
    naviNameInput,
    el('p', { class: 'hint-text' }, t('profile_navi_name_hint')),
    el('p', {}, t('profile_credit_pref_label')),
    el('div', { class: 'radio-group' }, prefInputs),
    naviMsg,
    el('button', { class: 'btn', type: 'submit' }, t('profile_saved_button')),
  ]);
  naviCard.appendChild(el('h3', { style: 'margin-top:0' }, t('profile_navi_name_title')));
  naviCard.appendChild(naviForm);

  // Namen-Karten (Realname + Na'vi-Name) nebeneinander statt gestapelt -
  // gleiches .grid.grid-2-Muster wie die Fortschritts-Karten oben, bricht
  // auf schmalen Viewports per auto-fit automatisch auf eine Spalte um.
  app.appendChild(el('div', { class: 'grid grid-2' }, [nameCard, naviCard]));

  // Passwort aendern
  const passCard = el('div', { class: 'card' });
  const currentPassInput = el('input', { type: 'password', placeholder: t('profile_current_password') });
  const newPassInput = el('input', { type: 'password', placeholder: t('profile_new_password') });
  const passMsg = el('div', { class: 'error-msg', style: 'display:none' });
  const passForm = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      passMsg.style.display = 'none';
      try {
        await api('/auth/me', {
          method: 'PATCH',
          body: { current_password: currentPassInput.value, new_password: newPassInput.value },
        });
        currentPassInput.value = '';
        newPassInput.value = '';
        passMsg.className = 'ok-msg';
        passMsg.textContent = t('profile_saved');
        passMsg.style.display = 'block';
      } catch (err) {
        passMsg.className = 'error-msg';
        passMsg.textContent = err.code === 'wrong_current_password' ? t('err_wrong_current_password') : t('err_generic');
        passMsg.style.display = 'block';
      }
    },
  }, [
    el('label', {}, t('profile_current_password')),
    currentPassInput,
    el('label', {}, t('profile_new_password')),
    newPassInput,
    passMsg,
    el('button', { class: 'btn', type: 'submit' }, t('profile_change_password')),
  ]);
  passCard.appendChild(el('h3', { style: 'margin-top:0' }, t('profile_change_password')));
  passCard.appendChild(passForm);
  app.appendChild(passCard);

  // Welcome-Tour erneut starten - rein clientseitig, kein Backend-Reset des
  // welcome_seen-Flags noetig (der Flag verhindert nur den AUTOMATISCHEN
  // Start beim naechsten Login, manuelles Wiederholen ist davon unabhaengig).
  const tourCard = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, t('profile_restart_tour')),
    el('button', { class: 'btn btn-secondary', onclick: () => startWelcomeTour() }, t('profile_restart_tour')),
  ]);
  app.appendChild(tourCard);

  // Auskunftsrecht (Art. 15 DSGVO): direkter Download, da die Endpunkte per
  // Session-Cookie geschuetzt sind - ein normaler <a href> reicht, der
  // Browser schickt das Cookie bei gleicher Origin automatisch mit.
  const exportCard = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, t('profile_export_title')),
    el('p', { class: 'hint-text' }, t('profile_export_hint')),
    el('div', { class: 'row-actions' }, [
      el('a', { class: 'btn btn-secondary', href: '/api/auth/me/export.json' }, t('profile_export_json')),
      el('a', { class: 'btn btn-secondary', href: '/api/auth/me/export.csv' }, t('profile_export_csv')),
    ]),
  ]);
  app.appendChild(exportCard);

  // Account loeschen (Art. 17 DSGVO): verlangt das aktuelle Passwort als
  // Bestaetigung (gleiches Muster wie Passwort aendern) plus einen
  // zusaetzlichen confirm()-Dialog, da die Aktion endgueltig ist.
  const deleteCard = el('div', { class: 'card' });
  const deletePassInput = el('input', { type: 'password', placeholder: t('profile_current_password') });
  const deleteMsg = el('div', { class: 'error-msg', style: 'display:none' });
  const deleteForm = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      deleteMsg.style.display = 'none';
      if (!confirm(t('profile_delete_confirm'))) return;
      try {
        await api('/auth/me', { method: 'DELETE', body: { password: deletePassInput.value } });
        CURRENT_USER = null;
        updateNav();
        navigate('#/');
      } catch (err) {
        deleteMsg.className = 'error-msg';
        deleteMsg.textContent = err.code === 'cannot_delete_last_admin'
          ? t('admin_cannot_delete_last_admin')
          : (err.code === 'wrong_current_password' ? t('err_wrong_current_password') : t('err_generic'));
        deleteMsg.style.display = 'block';
      }
    },
  }, [
    el('p', { class: 'hint-text' }, t('profile_delete_hint')),
    el('label', {}, t('profile_current_password')),
    deletePassInput,
    deleteMsg,
    el('button', { class: 'btn btn-danger', type: 'submit' }, t('profile_delete_submit')),
  ]);
  deleteCard.appendChild(el('h3', { style: 'margin-top:0' }, t('profile_delete_title')));
  deleteCard.appendChild(deleteForm);
  app.appendChild(deleteCard);
}

// Priorisierung (vocab_priority) - Live-Suche gegen den serverseitigen
// Fwew-Cache (routes/fwew.js), da hier bewusst kein lokaler Wortbestand mehr
// existiert. Gespeichert wird dabei nur die Fwew-ID + das Datum.
async function renderPrioritySection(app) {
  app.appendChild(el('h2', { class: 'section-title' }, t('priority_title')));

  const searchInput = el('input', { placeholder: t('priority_search_ph') });
  const dateInput = el('input', { type: 'date' });
  const resultsBox = el('div', { class: 'card' });
  const searchCard = el('div', { class: 'card' }, [
    el('label', {}, t('priority_search_label')),
    searchInput,
    el('label', {}, t('priority_date_label')),
    dateInput,
    resultsBox,
  ]);
  const listCard = el('div', { class: 'card' });
  app.appendChild(searchCard);
  app.appendChild(listCard);

  let allWords = [];
  try { allWords = await api('/fwew/list'); } catch (e) { /* Fwew evtl. nicht erreichbar */ }

  async function loadPriorities() {
    const rows = await api('/admin/priority');
    listCard.innerHTML = '';
    if (!rows.length) {
      listCard.appendChild(el('div', { class: 'empty-state' }, t('priority_empty')));
      return;
    }
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, t('vocab_navi')),
      el('th', {}, t('priority_date_label')),
      el('th', {}, ''),
    ])));
    const tbody = el('tbody');
    rows.forEach((r) => {
      tbody.appendChild(el('tr', {}, [
        el('td', { html: r.navi ? naviHtml(r.navi) : '' }, r.navi ? [] : `#${r.fwew_id}`),
        el('td', {}, r.priority_date),
        el('td', {}, el('button', {
          class: 'danger',
          onclick: async () => { await api('/admin/priority/' + r.fwew_id, { method: 'DELETE' }); await loadPriorities(); },
        }, t('vocab_delete'))),
      ]));
    });
    table.appendChild(tbody);
    listCard.appendChild(table);
  }

  function renderSearchResults() {
    resultsBox.innerHTML = '';
    const query = searchInput.value.trim().toLowerCase();
    if (query.length < 2) return;
    const matches = allWords
      .filter((w) => w.navi.toLowerCase().includes(query)
        || w.translations.some((tr) => tr.text.toLowerCase().includes(query)))
      .slice(0, 15);
    matches.forEach((w) => {
      const de = w.translations.find((tr) => tr.lang === 'DE');
      resultsBox.appendChild(el('div', { class: 'row-actions' }, [
        el('span', { html: naviHtml(w.navi) }),
        el('span', { style: 'color:var(--text-dim)' }, de ? de.text : (w.translations[0] ? w.translations[0].text : '')),
        el('button', {
          class: 'btn',
          onclick: async () => {
            if (!dateInput.value) { alert(t('priority_date_required')); return; }
            await api('/admin/priority', { method: 'POST', body: { fwew_id: w.id, priority_date: dateInput.value } });
            searchInput.value = '';
            resultsBox.innerHTML = '';
            await loadPriorities();
          },
        }, t('priority_add')),
      ]));
    });
  }

  searchInput.addEventListener('input', renderSearchResults);
  await loadPriorities();
}

// ---------- Rechtliches (Impressum/Datenschutz immer nur Deutsch - siehe
// legal_german_only_notice; Quellen/Danksagung normal uebersetzt) ----------

function germanOnlyNotice() {
  if (currentLang === 'de') return null;
  return el('div', { class: 'legal-notice' }, t('legal_german_only_notice'));
}

function renderImpressum(app) {
  app.appendChild(el('h2', { class: 'section-title' }, 'Impressum'));
  const notice = germanOnlyNotice();
  if (notice) app.appendChild(notice);

  app.appendChild(el('div', { class: 'card legal-text' }, [
    el('p', {}, 'Angaben gemäß § 5 TMG / § 5 DDG'),
    el('p', {}, [
      'Ronny Bäumert', el('br'),
      '[Adresse siehe Impressum auf navi.diy-ehome.de]',
    ]),
    el('h3', {}, 'Kontakt'),
    el('p', {}, ['E-Mail: ', el('a', { href: 'mailto:Webmaster@diy-ehome.de' }, 'Webmaster@diy-ehome.de')]),
    el('h3', {}, 'Hinweis'),
    el('p', {}, 'Dies ist ein privates, nicht-kommerzielles Hobby-Projekt ohne Gewinnerzielungsabsicht.'),
  ]));
}

function renderDatenschutz(app) {
  app.appendChild(el('h2', { class: 'section-title' }, 'Datenschutzerklärung'));
  const notice = germanOnlyNotice();
  if (notice) app.appendChild(notice);

  app.appendChild(el('div', { class: 'card legal-text' }, [
    el('h3', {}, 'Verantwortlicher'),
    el('p', {}, [
      'Ronny Bäumert, [Adresse siehe Impressum auf navi.diy-ehome.de]', el('br'),
      'E-Mail: ', el('a', { href: 'mailto:Webmaster@diy-ehome.de' }, 'Webmaster@diy-ehome.de'),
    ]),
    el('h3', {}, 'Registrierung und Nutzerkonto'),
    el('p', {}, 'Bei der Registrierung werden Name, E-Mail-Adresse und ein Passwort erhoben. Das Passwort wird ausschließlich als kryptographischer Hash (scrypt) gespeichert, nie im Klartext. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Erfüllung des Nutzungsverhältnisses).'),
    el('h3', {}, 'Session-Cookie'),
    el('p', {}, 'Zur Aufrechterhaltung des Login-Status wird ein technisch notwendiges Session-Cookie gesetzt. Ohne dieses Cookie ist ein Login nicht möglich. Es werden keine Tracking-, Analyse- oder Marketing-Cookies verwendet.'),
    el('h3', {}, 'Server-Logs'),
    el('p', {}, 'Beim Zugriff auf diese Seite werden wie bei jedem Webserver technisch bedingt IP-Adresse und Zugriffszeitpunkt kurzzeitig in Server-Logs verarbeitet. Diese dienen ausschließlich der technischen Absicherung des Betriebs und werden nicht mit Nutzerkonten verknüpft ausgewertet.'),
    el('h3', {}, 'Externe Wörterbuch-API'),
    el('p', {}, 'Vokabelabfragen werden serverseitig an die Fwew-API (tirea.learnnavi.org) gestellt. Dabei werden keine personenbezogenen Daten übertragen - lediglich das jeweils abgefragte Na\'vi-Wort verlässt in diesem Zusammenhang den Server.'),
    el('h3', {}, 'Hosting'),
    el('p', {}, 'Diese Seite wird auf selbst betriebener Infrastruktur gehostet, es erfolgt keine Weitergabe von Daten an Drittanbieter.'),

    el('h3', {}, 'Grammatik-Baukasten: erstellte Übungen und Lernfortschritt'),
    el('p', {}, 'Wenn du im Grammatik-Baukasten Übungen erstellst ("Creator"), werden diese zunächst nur für dich und Reviewer sichtbar gespeichert (Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO, Erfüllung des Nutzungsverhältnisses). Nach einer Freigabe durch einen Reviewer werden sie fester Bestandteil der Plattform und für alle Lernenden sichtbar. Dein Lernfortschritt (welche Vokabeln/Übungen du bearbeitet hast, richtig/falsch) wird pro Nutzerkonto gespeichert und dient ausschließlich der Anzeige deines eigenen Fortschritts.'),

    el('h3', {}, 'Namensnennung für Community-Beiträge (Danksagungen)'),
    el('p', {}, 'Sobald eine von dir erstellte Übung freigegeben wurde, wird dein Name zusammen mit der Anzahl und den Modulen deiner freigegebenen Übungen einmalig auf der öffentlichen Danksagungen-Seite genannt - als Ausdruck der Anerkennung für deinen freiwilligen Beitrag zur Community. Dieser minimale Eintrag (Name, Anzahl, Modul-Kategorien - keine Übungsinhalte, keine Kontaktdaten) bleibt bewusst auch nach einer Löschung deines Nutzerkontos bestehen. Rechtsgrundlage hierfür ist unser berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO) an einer fairen, dauerhaften Würdigung freiwilliger Beiträge zu einem gemeinschaftlich getragenen, nicht-kommerziellen Sprachlernprojekt - abgewogen gegen dein Interesse an vollständiger Löschung, wobei die zurückbleibende Datenmenge auf das für diesen Zweck unbedingt erforderliche Minimum beschränkt ist. Du wirst hierauf bereits vor dem Erstellen einer Übung im Interface hingewiesen.'),

    el('h3', {}, 'Recht auf Auskunft (Art. 15 DSGVO)'),
    el('p', {}, [
      'Du kannst jederzeit eine vollständige Übersicht aller über dich gespeicherten Daten in deinem ',
      el('a', { href: '#/profil' }, 'Profil'),
      ' als JSON- oder CSV-Datei herunterladen.',
    ]),

    el('h3', {}, 'Recht auf Löschung (Art. 17 DSGVO)'),
    el('p', {}, [
      'Du kannst dein Nutzerkonto jederzeit selbst in deinem ',
      el('a', { href: '#/profil' }, 'Profil'),
      ' löschen (Bestätigung mit deinem Passwort erforderlich), oder einen Administrator darum bitten. Dabei werden dein Nutzerkonto, dein Vokabel-Lernstand und dein Grammatik-Antwortverlauf vollständig gelöscht. ',
      el('strong', {}, 'Ausnahme: '),
      'von dir erstellte, bereits freigegebene Grammatik-Übungen bleiben als Community-Inhalt erhalten (nur die Verknüpfung zu deinem Konto wird entfernt), ebenso der oben beschriebene minimale Danksagungs-Eintrag. Der letzte verbleibende Administrator-Account kann aus betrieblichen Gründen nicht gelöscht werden, solange kein weiterer Administrator existiert.',
    ]),

    el('h3', {}, 'Weitere Rechte'),
    el('p', {}, 'Du hast außerdem das Recht auf Berichtigung und Einschränkung der Verarbeitung deiner Daten (Art. 16, 18 DSGVO). Wende dich dazu an die oben genannte Kontaktadresse.'),
  ]));
}

async function renderQuellen(app) {
  app.appendChild(el('h2', { class: 'section-title' }, t('quellen_title')));
  app.appendChild(el('p', {}, t('quellen_intro')));
  app.appendChild(el('div', { class: 'card legal-text' }, [
    el('h3', {}, t('quellen_fwew_title')),
    el('p', {}, t('quellen_fwew_text')),
    el('h3', {}, t('quellen_community_title')),
    el('p', {}, t('quellen_community_text')),
    el('h3', {}, t('quellen_avatar_title')),
    el('p', {}, t('quellen_avatar_text')),
  ]));
}

async function renderDanksagung(app) {
  app.appendChild(el('h2', { class: 'section-title' }, t('danksagung_title')));
  app.appendChild(el('div', { class: 'card legal-text' }, [
    el('p', {}, t('danksagung_text')),
  ]));

  // Wer eine Grammatik-Uebung erfolgreich hat freigeben lassen, wird hier
  // einmalig genannt (siehe routes/grammar.js grammar_credits) - bleibt
  // bewusst auch nach einer Account-Loeschung sichtbar, ohne Login
  // abrufbar (gleiche Route wie diese Seite selbst).
  try {
    const credits = await api('/grammar/credits');
    if (credits.length) {
      const listCard = el('div', { class: 'card' }, [
        el('h3', { style: 'margin-top:0' }, t('danksagung_creators_title')),
      ]);
      credits.forEach((c) => {
        const modules = c.modules.map((m) => t('grammar_module_' + m)).join(', ');
        listCard.appendChild(el('p', {}, tFormat('danksagung_creator_line', { name: c.display_name, count: c.exercise_count, modules })));
      });
      app.appendChild(listCard);
    }
  } catch (e) { /* ignore */ }
}

// ---------- Cookie-Banner ----------
// Echtes Opt-in: der einzige gesetzte Cookie ist das technisch notwendige
// Session-Cookie (siehe Datenschutzerklaerung). Ohne Zustimmung wird kein
// Login/Registrierung angeboten - die Zustimmung selbst liegt in
// localStorage, nicht in einem Cookie (kein Henne-Ei-Problem).

function cookieConsent() {
  return localStorage.getItem('cookie_consent');
}

function renderCookieBanner() {
  const banner = document.getElementById('cookieBanner');
  const consent = cookieConsent();
  if (!consent) {
    banner.hidden = false;
    banner.innerHTML = '';
    banner.appendChild(el('div', { class: 'cookie-banner-inner' }, [
      el('p', {}, [
        t('cookie_text'), ' ',
        el('a', { href: '#/datenschutz' }, t('cookie_link')),
      ]),
      el('div', { class: 'cookie-banner-actions' }, [
        el('button', { class: 'btn btn-secondary', onclick: () => setCookieConsent('declined') }, t('cookie_decline')),
        el('button', { class: 'btn', onclick: () => setCookieConsent('accepted') }, t('cookie_accept')),
      ]),
    ]));
  } else if (consent === 'declined') {
    banner.hidden = false;
    banner.innerHTML = '';
    banner.appendChild(el('div', { class: 'cookie-banner-inner' }, [
      el('p', {}, t('cookie_declined_notice')),
      el('div', { class: 'cookie-banner-actions' }, [
        el('button', { class: 'btn btn-secondary', onclick: () => setCookieConsent(null) }, t('cookie_change_choice')),
      ]),
    ]));
  } else {
    banner.hidden = true;
    banner.innerHTML = '';
  }
}

function setCookieConsent(value) {
  if (value === null) {
    localStorage.removeItem('cookie_consent');
  } else {
    localStorage.setItem('cookie_consent', value);
  }
  renderCookieBanner();
  route();
}

// ---------- Welcome-Tour ----------
// Interaktives Tooltip-Overlay, das beim ersten Login automatisch durch die
// wichtigsten Nav-Punkte fuehrt (Aktivieren -> Trainer -> Fortschritt ->
// [Admin] -> Sprachauswahl) und ueber das Profil jederzeit erneut gestartet
// werden kann. Zielelemente werden per echtem DOM-Rect positioniert (kein
// Framework), Schritte ohne targetSelector werden zentriert angezeigt.

function tourSteps() {
  const steps = [
    { key: 'tour_intro', targetSelector: null },
    { key: 'tour_vokabeltrainer', targetSelector: '#navVokabeltrainer' },
    { key: 'tour_grammatik', targetSelector: '#navGrammatikTop' },
  ];
  if (CURRENT_USER && CURRENT_USER.is_admin) {
    steps.push({ key: 'tour_admin', targetSelector: '#navAdmin' });
  }
  // Fortschritt lebt jetzt im Profil (siehe renderProfil), daher zeigt
  // dieser Schritt auf "Profil" statt auf einen eigenen Nav-Punkt.
  steps.push({ key: 'tour_profil', targetSelector: '#navProfil' });
  steps.push({ key: 'tour_lang', targetSelector: '#langSelect' });
  steps.push({ key: 'tour_outro', targetSelector: null });
  return steps;
}

let tourOverlayEl = null;

function teardownTour() {
  if (tourOverlayEl) {
    tourOverlayEl.remove();
    tourOverlayEl = null;
  }
}

function drawTourStep(steps, index) {
  teardownTour();
  const step = steps[index];
  const isLast = index === steps.length - 1;

  const overlay = el('div', { class: 'tour-overlay' });
  const target = step.targetSelector ? document.querySelector(step.targetSelector) : null;

  // Auf schmalen Bildschirmen steckt die Nav im eingeklappten Hamburger-Menue
  // (siehe style.css @media) - ohne dieses Aufklappen waere das Tour-Ziel
  // nicht gerendert und getBoundingClientRect() laege bei 0,0.
  const topnavEl = document.getElementById('topnav');
  if (topnavEl) {
    topnavEl.classList.toggle('nav-open', !!(target && topnavEl.contains(target)));
  }

  if (target) {
    const rect = target.getBoundingClientRect();
    const pad = 6;
    const spot = el('div', {
      class: 'tour-spot',
      style: `left:${rect.left - pad}px;top:${rect.top - pad}px;width:${rect.width + pad * 2}px;height:${rect.height + pad * 2}px;`,
    });
    overlay.appendChild(spot);

    const tooltip = el('div', { class: 'tour-tooltip' }, tourTooltipContent(step, index, steps.length, isLast));
    overlay.appendChild(tooltip);
    // Erst nach dem Einhaengen positionieren, da die Groesse des Tooltips
    // (fuer die Platzierung ueber/unter dem Ziel) erst dann bekannt ist.
    document.body.appendChild(overlay);
    tourOverlayEl = overlay;
    const tipRect = tooltip.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow > tipRect.height + 20
      ? rect.bottom + 12
      : Math.max(12, rect.top - tipRect.height - 12);
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - tipRect.width - 12);
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    return;
  }

  // Zentrierter Schritt (Intro/Outro) ohne Zielelement.
  const tooltip = el('div', { class: 'tour-tooltip tour-tooltip-centered' }, tourTooltipContent(step, index, steps.length, isLast));
  overlay.appendChild(tooltip);
  document.body.appendChild(overlay);
  tourOverlayEl = overlay;
}

function tourTooltipContent(step, index, total, isLast) {
  return [
    el('div', { class: 'tour-step-indicator' }, tFormat('tour_step_indicator', { current: index + 1, total })),
    el('h3', {}, t(step.key + '_title')),
    el('p', {}, t(step.key + '_text')),
    el('div', { class: 'tour-tooltip-actions' }, [
      el('button', { class: 'btn btn-secondary', onclick: finishTour }, t('tour_skip')),
      el('button', { class: 'btn', onclick: () => (isLast ? finishTour() : advanceTour()) }, isLast ? t('tour_finish') : t('tour_next')),
    ]),
  ];
}

let tourState = null;

function advanceTour() {
  if (!tourState) return;
  tourState.index += 1;
  drawTourStep(tourState.steps, tourState.index);
}

async function finishTour() {
  teardownTour();
  const topnavEl = document.getElementById('topnav');
  if (topnavEl) topnavEl.classList.remove('nav-open');
  tourState = null;
  await markWelcomeSeen();
}

function startWelcomeTour() {
  const steps = tourSteps();
  tourState = { steps, index: 0 };
  drawTourStep(steps, 0);
}
