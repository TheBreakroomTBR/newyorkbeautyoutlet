// GET ?upc=  → one product
// GET ?q=    → search name / brand / UPC
// GET        → first 300 products
// POST {records:[{upc,name,brand,category,cost,qty,image}]} → upsert by UPC
const at = require('../lib/airtable');
const shape = require('../lib/shape');
const { json, body, wrap } = require('../lib/http');
const { normUpc, num } = require('../lib/util');
const { T } = at;

exports.handler = wrap(async (event) => {
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (qs.code) {
      const p = await at.findByCode(qs.code);
      return json(200, { product: p ? shape.product(p) : null });
    }
    if (qs.upc) {
      const upc = normUpc(qs.upc);
      const [p] = await at.list(T.products, { filter: `{UPC}="${upc}"`, max: 1 });
      return json(200, { product: p ? shape.product(p) : null });
    }
    if (qs.q) {
      const q = at.esc(qs.q.trim().toLowerCase());
      const u = normUpc(qs.q);
      const filter = `OR(FIND("${q}",LOWER({Name}&""))>0,FIND("${q}",LOWER({Brand}&""))>0${u ? `,{UPC}="${u}"` : ''})`;
      const rows = await at.list(T.products, { filter, max: 200, sort: [{ field: 'Name' }] });
      return json(200, { products: rows.map(shape.product) });
    }
    const rows = await at.list(T.products, { max: 300, sort: [{ field: 'Name' }] });
    return json(200, { products: rows.map(shape.product) });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'GET or POST' });
  const input = body(event).records || [];
  if (!input.length) return json(400, { error: 'No records' });
  if (input.length > 50) return json(400, { error: 'Send 50 or fewer per request' });

  const errors = [];
  const recs = [];
  input.forEach((r, i) => {
    const upc = normUpc(r.upc);
    if (!upc) { errors.push(`Row ${i + 1}: missing UPC`); return; }
    const f = { UPC: upc };
    if (r.name) f.Name = String(r.name).trim();
    if (r.brand) f.Brand = String(r.brand).trim();
    if (r.category) f.Category = String(r.category).trim();
    if (r.image) f['Image URL'] = String(r.image).trim();
    const cost = num(String(r.cost ?? '').replace(/[$,]/g, ''));
    if (r.cost !== '' && r.cost != null && cost != null) f.Cost = cost;
    const qty = num(r.qty);
    if (r.qty !== '' && r.qty != null && qty != null) f['Qty On Hand'] = Math.round(qty);
    recs.push(f);
  });

  const saved = recs.length ? await at.upsert(T.products, recs, ['UPC']) : [];
  return json(200, { saved: saved.length, products: saved.map(shape.product), errors });
});
