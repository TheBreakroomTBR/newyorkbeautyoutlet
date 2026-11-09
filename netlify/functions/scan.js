// POST {upc}  → logs the item that just went on screen
// DELETE ?id= → undo a mis-scan (only if no order is attached yet)
const at = require('../lib/airtable');
const shape = require('../lib/shape');
const { json, body, wrap } = require('../lib/http');
const { normUpc, streamDate, clockTime } = require('../lib/util');
const { bundleCounts } = require('../lib/match');
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
  const raw = String(body(event).upc || '').trim();
  if (!raw) return json(400, { error: 'No UPC' });
  const p = await at.findByCode(raw);
  const upc = p ? p.fields.UPC : normUpc(raw);
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
    'Stream ID': String(body(event).stream || streamDate(now)).slice(0, 60),
  };
  fields.Units = 1;
  if (p && (p.fields.Components || []).length) {
    // Snapshot what's inside so the sale can be split per item later.
    const counts = bundleCounts(p.fields['Bundle Contents']);
    const items = [];
    for (const cid of p.fields.Components) {
      const c = await at.get(T.products, cid);
      items.push({
        upc: c.fields.UPC, sku: c.fields.SKU || '', name: c.fields.Name || '', brand: c.fields.Brand || '',
        cost: c.fields.Cost ?? null, count: counts[c.fields.UPC] || 1,
      });
    }
    fields['Bundle Items'] = JSON.stringify(items);
    fields.Units = items.reduce((n, i) => n + i.count, 0);
    if (items.every((i) => i.cost != null)) fields.Cost = Math.round(items.reduce((a, i) => a + i.cost * i.count, 0) * 100) / 100;
  }
  if (p) {
    fields.Product = [p.id];
    if (p.fields.Cost != null && fields.Cost == null) fields.Cost = p.fields.Cost;
    if (p.fields['Image URL']) fields['Image URL'] = p.fields['Image URL'];
  }

  const [rec] = await at.create(T.auctions, [fields]);
  return json(200, { auction: shape.auction(rec), product: p ? shape.product(p) : null, unknown: !p });
});
