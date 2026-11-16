// GET ?since=ms → every scan in the current stream, newest first
const at = require('../lib/airtable');
const shape = require('../lib/shape');
const { json, wrap } = require('../lib/http');

exports.handler = wrap(async (event) => {
  let since = Number(event.queryStringParameters?.since);
  if (!Number.isFinite(since) || since <= 0) since = Date.now() - 14 * 3600e3;
  const [rows, orders] = await Promise.all([
    at.list(at.T.auctions, {
      filter: `{Scanned Ms}>=${Math.floor(since)}`,
      sort: [{ field: 'Scanned Ms', direction: 'desc' }],
      max: 1000,
    }),
    // Orders from this stream that didn't find a scan — shown on Live so they can be fixed on the spot.
    at.list(at.T.orders, {
      filter: `AND(OR({Match Status}="Unmatched",{Match Status}="Review"),{Created Ms}>=${Math.floor(since)})`,
      sort: [{ field: 'Created Ms', direction: 'desc' }],
      max: 50,
    }),
  ]);
  return json(200, { auctions: rows.map(shape.auction), orphans: orders.map(shape.order), now: Date.now() });
});
