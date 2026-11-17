// POST → creates the Airtable tables. Safe to run more than once.
const { setupTables } = require('../lib/schema');
const { json, wrap } = require('../lib/http');

exports.handler = wrap(async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const log = await setupTables();
  return json(200, { ok: true, log });
});
