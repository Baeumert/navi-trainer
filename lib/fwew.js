// Live-Client fuer die Fwew-Na'vi-Woerterbuch-API (https://tirea.learnnavi.org/api).
// Vokabeldaten werden bewusst NICHT in der eigenen DB gespeichert - stattdessen
// haelt dieses Modul das komplette Woerterbuch (inkl. stabiler IDs und ALLER
// verfuegbaren Sprachuebersetzungen) im Prozessspeicher und aktualisiert es
// periodisch neu. DB-Tabellen referenzieren nur noch die hier aufloesbare ID.
//
// Fwew hat keinen "Wort per ID"-Endpunkt - IDs sind nur ueber /list aufloesbar,
// daher der komplette Cache statt Einzel-Lookups pro ID.
'use strict';

const FWEW_API_BASE = process.env.FWEW_API_BASE || 'https://tirea.learnnavi.org/api';
const REFRESH_INTERVAL_MS = Number(process.env.FWEW_REFRESH_INTERVAL_MS) || 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20000;

// Alle von Fwew gelieferten Sprachfelder (siehe fwew-lib Word-Struct), in der
// Reihenfolge, in der sie angezeigt werden sollen.
const LANGUAGE_FIELDS = ['DE', 'EN', 'ES', 'ET', 'FR', 'HU', 'IT', 'KO', 'NL', 'PL', 'PT', 'RU', 'SV', 'TR', 'UK'];

let cache = new Map(); // id (String) -> Word
let lastRefreshAt = null;
let lastRefreshError = null;

// tirea.learnnavi.org sitzt hinter Cloudflare, das Requests ohne (oder mit
// generischem curl/node-)User-Agent per Challenge-Seite blockt. Ein
// selbstidentifizierender UA reicht aus, kein Browser-Spoofing noetig
// (verifiziert: curl/node-fetch ohne UA -> 403, mit UA -> 200).
const USER_AGENT = 'navi-vokabeltrainer/1.0 (+https://navi.diy-ehome.de)';

async function fetchJson(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${FWEW_API_BASE}${path}`, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) {
      throw new Error(`fwew_api_status_${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Baut den Cache aus /list neu auf. Wird beim Serverstart und danach
// periodisch aufgerufen. Bei Fehlern bleibt der bisherige Cache unangetastet
// (ein Fwew-Ausfall soll den Trainer nicht mit einer leeren Wortliste
// lahmlegen) - nur beim allerersten Aufruf ist der Cache dann noch leer.
async function refreshCache() {
  try {
    const words = await fetchJson('/list');
    const next = new Map();
    for (const word of words) {
      if (word && word.ID !== undefined && word.ID !== null) {
        next.set(String(word.ID), word);
      }
    }
    cache = next;
    lastRefreshAt = new Date().toISOString();
    lastRefreshError = null;
    console.log(`fwew: Cache aktualisiert (${cache.size} Woerter).`);
  } catch (err) {
    lastRefreshError = err.message;
    console.error(`fwew: Cache-Refresh fehlgeschlagen (${err.message}), behalte bisherigen Stand (${cache.size} Woerter).`);
  }
}

function startAutoRefresh() {
  refreshCache();
  setInterval(refreshCache, REFRESH_INTERVAL_MS).unref();
}

function getWordById(id) {
  if (id === undefined || id === null) return null;
  return cache.get(String(id)) || null;
}

function getAllWords() {
  return Array.from(cache.values());
}

function isReady() {
  return cache.size > 0;
}

function getStatus() {
  return { size: cache.size, lastRefreshAt, lastRefreshError };
}

// Einzel-Lookup direkt gegen die Live-API (exakter Na'vi-Text, wie im
// bisherigen lokalen vocab-Abgleich) - fuer Faelle, in denen der Cache noch
// nicht (oder nicht mehr) das gesuchte Wort enthaelt.
async function lookupByNavi(navi) {
  const rows = await fetchJson(`/fwew/${encodeURIComponent(navi)}`);
  // /fwew/{nav} liefert ein 2D-Array (pro Wortteil eine Trefferliste).
  return Array.isArray(rows) ? rows.flat() : [];
}

// Alle nicht-leeren Uebersetzungsfelder eines Word-Objekts, in fester
// Sprachreihenfolge - Basis fuer "alle verfuegbaren Uebersetzungen anzeigen".
function translationsOf(word) {
  if (!word) return [];
  return LANGUAGE_FIELDS
    .filter((lang) => word[lang] && String(word[lang]).trim().length > 0)
    .map((lang) => ({ lang, text: word[lang] }));
}

// Fwew liefert fehlende Felder als literalen String "NULL" statt leer/null -
// hier rausfiltern, damit das Frontend nicht "NULL" anzeigt.
function cleanField(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.toUpperCase() === 'NULL') return null;
  return trimmed;
}

// Kleine Zusatzinfos fuers Flashcard-Layout (IPA-Lautschrift, Silbentrennung,
// Infix-Einfuegestellen bei Verben) - jeweils nur wenn Fwew sie liefert.
function metaOf(word) {
  if (!word) return {};
  return {
    ipa: cleanField(word.IPA),
    syllables: cleanField(word.Syllables),
    infixDots: cleanField(word.InfixDots),
  };
}

module.exports = {
  LANGUAGE_FIELDS,
  refreshCache,
  startAutoRefresh,
  getWordById,
  getAllWords,
  isReady,
  getStatus,
  lookupByNavi,
  translationsOf,
  metaOf,
};
