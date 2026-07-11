// Modul A: Infix-Platzierung. Reines String-Splicing an einem vom Creator
// definierten Index - keine linguistische Logik, die Korrektheit der
// Position liegt beim Creator (Vier-Augen-Prinzip via Reviewer).
'use strict';

// Fuegt `infix` an Position `index` in `word` ein.
// insertInfix("taron", 1, "am") -> "tamaron"
function insertInfix(word, index, infix) {
  const i = Math.max(0, Math.min(index, word.length));
  return word.slice(0, i) + infix + word.slice(i);
}

module.exports = { insertInfix };
