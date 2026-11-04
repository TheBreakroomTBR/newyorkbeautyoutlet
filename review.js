// GET  → open scans + orders that couldn't be matched (last 7 days)
// POST {action:'assign', orderRec, auctionRec}
//      {action:'nosale', ids:[auctionRec...]}
//      {action:'ignore', orderRec}
const at = require('../lib/airtable');
const shape = require('../lib/shape');
const { manualAssign } = require('../lib/match');
const { json, body, wrap } = require('../lib/http');
const { T } = at;

exports.handler = wrap(async (event) => {
  if (event.httpMethod === 'GET') {
    const since = Date.now() - 7 * 86400e3;
    const [open, orders] = await Promise.all([
      at.list(T.auctions, {
        filter: `AND({Match Status}="Open",{Scanned Ms}>=${since})`,
        sort: [{ field: 'Scanned Ms', direction: 'desc' }],
        max: 1000,
      }),
      at.list(T.orders, {
        filter: `AND(OR({Match Status}="Unmatched",{Match Status}="Review"),{Created Ms}>=${since})`,
        sort: [{ field: 'Created Ms', direction: 'desc' }],
        max: 500,
      }),
    ]);
    return json(200, { open: open.map(shape.auction), orders: orders.map(shape.order) });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'GET or POST' });
  const b = body(event);
  if (b.action === 'assign') return json(200, await manualAssign(b.orderRec, b.auctionRec));
  if (b.action === 'nosale') {
    const ids = (b.ids || []).filter(Boolean);
    await at.update(T.auctions, ids.map((id) => ({ id, fields: { 'Match Status': 'No Sale' } })));
    return json(200, { ok: true, updated: ids.length });
  }
  if (b.action === 'ignore') {
    await at.update(T.orders, [{ id: b.orderRec, fields: { 'Match Status': 'Ignored' } }]);
    return json(200, { ok: true });
  }
  return json(400, { error: 'Unknown action' });
});
