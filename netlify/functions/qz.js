// Silent label printing through QZ Tray.
// QZ Tray only prints without pop-ups when each request is signed with a key it trusts.
// The certificate + private key (created by QZ Tray's Site Manager) live in the Settings table.
//   GET              → { cert } for QZ Tray
//   POST {request}   → { signature } (SHA512, base64)
//   POST {save:{cert,key}} → stores the pair
const crypto = require('crypto');
const at = require('../lib/airtable');
const { json, body, wrap } = require('../lib/http');
const { T } = at;

async function readPair() {
  const rows = await at.list(T.settings, { filter: 'OR({Key}="qz_cert",{Key}="qz_key")' });
  const s = {};
  rows.forEach((r) => { s[r.fields.Key] = r.fields.Value || ''; });
  return s;
}

exports.handler = wrap(async (event) => {
  if (event.httpMethod === 'GET') {
    const s = await readPair();
    return json(200, { cert: s.qz_cert || '', ready: !!(s.qz_cert && s.qz_key) });
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'GET or POST' });
  const b = body(event);

  if (b.save) {
    const cert = String(b.save.cert || '').trim();
    const key = String(b.save.key || '').trim();
    if (!/BEGIN CERTIFICATE/.test(cert)) return json(400, { error: 'That doesn’t look like digital-certificate.txt' });
    if (!/BEGIN (RSA )?PRIVATE KEY/.test(key)) return json(400, { error: 'That doesn’t look like private-key.pem' });
    await at.upsert(T.settings, [{ Key: 'qz_cert', Value: cert }, { Key: 'qz_key', Value: key }], ['Key']);
    return json(200, { ok: true });
  }

  if (typeof b.request !== 'string') return json(400, { error: 'request required' });
  const s = await readPair();
  if (!s.qz_key) return json(400, { error: 'Silent printing isn’t set up yet' });
  const signature = crypto.createSign('SHA512').update(b.request).sign(s.qz_key, 'base64');
  return json(200, { signature });
});
