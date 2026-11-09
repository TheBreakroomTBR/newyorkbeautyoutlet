// GET ?fromMs=&toMs= → every scan in range (aggregated in the browser)
const at = require('../lib/airtable');
const shape = require('../lib/shape');
const { json, wrap } = require('../lib/http');

exports.handler = wrap(async (event) => {
  const qs = event.queryStringParameters || {};
  const from = Math.floor(Number(qs.fromMs));
  const to = Math.floor(Number(qs.toMs));
  if (!Number.isFinite(from) || !Number.isFinite(to)) return json(400, { error: 'fromMs and toMs required' });
  const rows = await at.list(at.T.auctions, {
    filter: `AND({Scanned Ms}>=${from},{Scanned Ms}<${to})`,
    sort: [{ field: 'Scanned Ms', direction: 'asc' }],
    fields: ['UPC', 'Product Name', 'Brand', 'Cost', 'Scanned Ms', 'Stream Date', 'Match Status', 'Sale Price', 'Order ID', 'Unknown', 'Units', 'Bundle Items'],
  });
  return json(200, { auctions: rows.map(shape.auction) });
});
