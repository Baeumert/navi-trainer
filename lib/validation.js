'use strict';

// Gemeinsame Validierung fuer alle Stellen, die einen neuen Account/eine
// neue Login-Identitaet anlegen (Selbstregistrierung UND Admin-Panel) -
// vorher hatte nur die Selbstregistrierung diese Pruefungen, das
// Admin-Panel liess triviale Passwoerter/ungueltige E-Mails durch.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 200;
const MIN_PASSWORD_LENGTH = 8;
const CREDIT_NAME_PREFS = ['both', 'navi', 'real'];

function validateAccountFields(name, email, password) {
  if (!name || !email || !password) return 'missing_fields';
  if (String(name).length > MAX_NAME_LENGTH) return 'name_too_long';
  if (String(email).length > MAX_EMAIL_LENGTH) return 'email_too_long';
  if (!EMAIL_RE.test(email)) return 'invalid_email';
  if (String(password).length < MIN_PASSWORD_LENGTH) return 'password_too_short';
  return null;
}

// Na'vi-Name ist optional (leerer String/undefined loescht ihn wieder), wird
// hier also nur validiert, wenn tatsaechlich ein nicht-leerer Wert gesetzt
// werden soll. Der Dubletten-Check selbst laeuft in routes/auth.js gegen
// die DB, nicht hier.
function validateNaviName(naviName) {
  if (String(naviName).length > MAX_NAME_LENGTH) return 'navi_name_too_long';
  return null;
}

module.exports = {
  EMAIL_RE,
  validateAccountFields,
  validateNaviName,
  MIN_PASSWORD_LENGTH,
  CREDIT_NAME_PREFS,
};
