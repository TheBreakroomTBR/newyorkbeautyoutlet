// GET ?since=ms → every scan in the current stream, newest first
const at = require('../lib/airtable');
const shape = require('../lib/shape');
const { json, wrap } = require('../lib/http');

exports.handler = wrap(async (event) => {
  let since = Number(event.queryStringParameters?.since);
  if (!Number.isFinite(since) || since <= 0) since = Date.now() - 14 * 3600e3;
  const rows = await at.list(at.T.auctions, {
    filter: `{Scanned Ms}>=${Math.floor(since)}`,
    sort: [{ field: 'Scanned Ms', direction: 'desc' }],
    max: 1000,
  });
  return json(200, { auctions: rows.map(shape.auction), now: Date.now() });
});
