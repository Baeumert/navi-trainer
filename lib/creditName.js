'use strict';

// Baut den in grammar_credits.display_name gespeicherten Anzeige-Namen aus
// Realname, optionalem Na'vi-Name und der Nutzerpraeferenz - gemeinsam
// genutzt von routes/grammar.js (bei Freigabe) und routes/auth.js (beim
// Aktualisieren eines bestehenden Danksagungs-Eintrags nach Profiländerung).
// Faellt auf den Realnamen zurueck, wenn kein Na'vi-Name gepflegt ist, damit
// nie ein leerer/kaputter Danksagungs-Eintrag entsteht.
function buildCreditDisplayName(realName, naviName, pref) {
  const hasNavi = !!(naviName && String(naviName).trim());
  if (pref === 'navi' && hasNavi) return naviName;
  if (pref === 'both' && hasNavi) return `${realName} (${naviName})`;
  return realName;
}

module.exports = { buildCreditDisplayName };
