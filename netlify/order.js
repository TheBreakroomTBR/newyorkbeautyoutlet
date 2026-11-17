// POST {orders:[{orderId, createdMs, price, status, buyer}]} → match each to a scan.
// Used by the CSV import. Send orders oldest-first, a few at a time.
const { processOrder } = require('../lib/match');
const { json, body, wrap } = require('../lib/http');

exports.handler = wrap(async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const orders = body(event).orders || [];
  if (orders.length > 5) return json(400, { error: 'Send 5 or fewer per request' });
  const results = [];
  for (const o of orders) {
    try {
      results.push(await processOrder({
        orderId: String(o.orderId),
        createdMs: Number(o.createdMs),
        price: Number(o.price),
        status: o.status || '',
        buyer: o.buyer || '',
        source: o.source === 'test' ? 'test' : 'csv',
      }));
    } catch (e) {
      results.push({ orderId: o.orderId, result: 'error', note: e.message });
    }
  }
  return json(200, { results });
});
