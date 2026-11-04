// POST {upc}  → logs the item that just went on screen
// DELETE ?id= → undo a mis-scan (only if no order is attached yet)
const at = require('../lib/airtable');
const shape = require('../lib/shape');
const { json, body, wrap } = require('../lib/http');
const { normUpc, streamDate, clockTime } = require('../lib/util');
const { T } = at;

exports.handler = wrap(async (event) => {
  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id;
    if (!id) return json(400, { error: 'id required' });
    const a = await at.get(T.auctions, id);
    if (a.fields['Order ID']) return json(409, { error: 'This scan already has a sale attached — fix it on the Review tab' });
    await at.del(T.auctions, id);
    return json(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'POST or DELETE' });
  const upc = normUpc(body(event).upc);
  if (!upc) return json(400, { error: 'No UPC' });

  const [p] = await at.list(T.products, { filter: `{UPC}="${upc}"`, max: 1 });
  const now = Date.now();
  const name = p ? p.fields.Name || upc : `Unknown UPC ${upc}`;

  const fields = {
    'Auction Key': `${streamDate(now)} ${clockTime(now)} ${name}`.slice(0, 200),
    UPC: upc,
    'Product Name': name,
    Brand: p?.fields.Brand || '',
    'Scanned Ms': now,
    'Scanned At': new Date(now).toISOString(),
    'Stream Date': streamDate(now),
    'Match Status': 'Open',
    Unknown: !p,
  };
  if (p) {
    fields.Product = [p.id];
    if (p.fields.Cost != null) fields.Cost = p.fields.Cost;
    if (p.fields['Image URL']) fields['Image URL'] = p.fields['Image URL'];
  }

  const [rec] = await at.create(T.auctions, [fields]);
  return json(200, { auction: shape.auction(rec), product: p ? shape.product(p) : null, unknown: !p });
});
