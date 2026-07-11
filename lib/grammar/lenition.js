// Modul C: Lenisierung. Deterministische Konsonanten-Tabelle fuer den
// wortanlautenden Konsonanten - laengster Match zuerst (kx/px/tx vor den
// einzelnen ejektiven Buchstaben, ts vor einzelnem t), sonst wuerde z.B.
// "kx..." faelschlich schon bei der "k"-Regel greifen.
//
// Praefix-Lautformen vor Lenisierung (z.B. "ay+" -> "a+") sind bewusst NICHT
// hier hinterlegt - das ist Creator-Eingabe pro Uebung (siehe routes/grammar.js),
// da es sich um Spezialwissen einzelner Praefixe handelt, nicht um die
// allgemeine Lenisierungsregel selbst.
'use strict';

const RULES = [
  ['kx', 'k'],
  ['px', 'p'],
  ['tx', 't'],
  ['ts', 's'],
  ['p', 'f'],
  ['t', 's'],
  ['k', 'h'],
  ["'", ''],
];

// lenite("palo'a") -> "falo'a"
function lenite(word) {
  for (const [from, to] of RULES) {
    if (word.startsWith(from)) {
      return to + word.slice(from.length);
    }
  }
  return word;
}

// applyPrefix("a", "palo'a") -> "a" + lenite("palo'a") -> "afalo'a"
function applyPrefix(prefixRealization, baseWord) {
  return prefixRealization + lenite(baseWord);
}

module.exports = { lenite, applyPrefix };
