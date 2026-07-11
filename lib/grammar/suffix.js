// Modul B: Ergativ/Akkusativ-Suffix-Luecken. Der Creator gibt einen
// vollstaendigen, korrekten Satz an und markiert pro Luecke Stamm + Suffix
// (z.B. Stamm "Neytiri" + Suffix "l" fuer den Ergativ "Neytiril"). Daraus
// wird der Luecken-Satz fuer den Learner erzeugt, ohne die Suffixe selbst
// zu speichern/zeigen, bis geantwortet wurde.
'use strict';

// Ersetzt jedes stem+correct_suffix-Vorkommen (in Reihenfolge der gaps)
// durch "stem___" - baut so den Luecken-Satz aus dem vollstaendigen Satz.
// Nicht gefundene Kombinationen (Creator-Tippfehler) werden uebersprungen,
// statt den ganzen Satz kaputt zu machen.
function buildTemplate(fullSentence, gaps) {
  let result = '';
  let cursor = 0;
  gaps.forEach((gap, index) => {
    const target = gap.stem + gap.correct_suffix;
    const idx = fullSentence.indexOf(target, cursor);
    if (idx === -1) return;
    result += fullSentence.slice(cursor, idx) + gap.stem + `___${index}___`;
    cursor = idx + target.length;
  });
  result += fullSentence.slice(cursor);
  return result;
}

// Vergleicht eine Learner-Antwort fuer eine einzelne Luecke gegen die
// hinterlegte korrekte Endung. Bewusst exakter String-Vergleich (kein
// Fuzzy-Matching) - Na'vi-Suffixe sind kurz und eindeutig.
function checkAnswer(gap, answer) {
  return String(answer ?? '').trim() === gap.correct_suffix;
}

module.exports = { buildTemplate, checkAnswer };
