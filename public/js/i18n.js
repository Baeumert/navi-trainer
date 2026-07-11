// UI-Sprachen entsprechen bewusst genau den von Fwew unterstuetzten
// Vokabel-Uebersetzungssprachen (siehe lib/fwew.js LANGUAGE_FIELDS) - so
// zeigt die globale Sprachauswahl oben rechts nicht nur die Menues/Texte in
// dieser Sprache, sondern steuert (ueber currentLang.toUpperCase() in
// app.js) auch, welche Wort-Uebersetzung angezeigt wird. Jede Sprache hat
// ihre eigene Uebersetzungsdatei unter /i18n/<code>/translation.json - die
// Vokabeln selbst sind davon unberuehrt, die kommen weiterhin live von Fwew.
const LANGUAGES = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'et', label: 'Eesti' },
  { code: 'fr', label: 'Français' },
  { code: 'hu', label: 'Magyar' },
  { code: 'it', label: 'Italiano' },
  { code: 'ko', label: '한국어' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
  { code: 'sv', label: 'Svenska' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'uk', label: 'Українська' },
];
const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);
const FALLBACK_LANG = 'en';

const I18N_CACHE = {};
let currentLang = localStorage.getItem('lang') || 'de';
if (!LANGUAGE_CODES.includes(currentLang)) currentLang = 'de';

async function loadTranslations(lang) {
  if (I18N_CACHE[lang]) return I18N_CACHE[lang];
  const res = await fetch(`/i18n/${lang}/translation.json`);
  const data = await res.json();
  I18N_CACHE[lang] = data;
  return data;
}

function t(key) {
  const current = I18N_CACHE[currentLang] || {};
  const fallback = I18N_CACHE[FALLBACK_LANG] || {};
  return current[key] || fallback[key] || key;
}

// Einfache {platzhalter}-Ersetzung fuer i18n-Strings mit dynamischen Teilen
// (z.B. die aktive Zielsprache im Richtungslabel).
function tFormat(key, vars) {
  let str = t(key);
  Object.entries(vars || {}).forEach(([k, v]) => {
    str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
  });
  return str;
}

function applyStaticTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  const select = document.getElementById('langSelect');
  if (select) select.value = currentLang;
}

async function setLang(lang) {
  currentLang = LANGUAGE_CODES.includes(lang) ? lang : 'de';
  localStorage.setItem('lang', currentLang);
  document.documentElement.lang = currentLang;
  // Zielsprache immer mitladen, da t() bei fehlenden Keys darauf zurueckfaellt.
  await Promise.all([loadTranslations(currentLang), loadTranslations(FALLBACK_LANG)]);
  applyStaticTranslations();
  if (typeof onLangChange === 'function') onLangChange();
}

// Wird von app.js awaited, bevor die erste Seite gerendert wird - verhindert
// einen kurzen Flackerer mit i18n-Keys statt uebersetztem Text beim Laden.
const I18N_READY = (async () => {
  const select = document.getElementById('langSelect');
  if (select) {
    select.addEventListener('change', () => setLang(select.value));
  }
  await setLang(currentLang);
})();
