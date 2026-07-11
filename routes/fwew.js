// Duenner Proxy auf den serverseitigen Fwew-Cache (siehe lib/fwew.js) fuers
// Frontend - z.B. fuer die Prioritaets-Suche im Admin-Panel. Das Frontend
// spricht bewusst nie direkt gegen tirea.learnnavi.org (kein CORS-Aerger,
// die API-Base bleibt serverseitig konfigurierbar/austauschbar).
const express = require('express');
const fwew = require('../lib/fwew');
const { requireAuth } = require('../middleware/guards');

const router = express.Router();
router.use(requireAuth);

// Nur die fuers Frontend relevanten Felder - keine vollstaendigen
// Affixe/Source-Metadaten noetig fuer Suche/Anzeige.
function toListEntry(word) {
  return {
    id: word.ID,
    navi: word.Navi,
    partOfSpeech: word.PartOfSpeech,
    translations: fwew.translationsOf(word),
  };
}

router.get('/list', (req, res) => {
  if (!fwew.isReady()) {
    return res.status(503).json({ error: 'fwew_unavailable' });
  }
  res.json(fwew.getAllWords().map(toListEntry));
});

router.get('/status', (req, res) => {
  res.json(fwew.getStatus());
});

module.exports = router;
