// Bundles are permanent labels: reuse the same barcode for every sale.
// GET            → all bundles, with how many more can be made from current stock
// POST {items:[{code, count}], name?, startPrice?} → creates a bundle (code = UPC or SKU)
// DELETE ?id=    → removes a bundle (stock of the items inside is untouched)
const at = require('../lib/airtable');
const shape = require('../lib/shape');
const { bundleCounts } = require('../lib/match');
const { json, body, wrap } = require('../lib/http');
const { num } = require('../lib/util');
const { T } = at;

function check(d11) {
  let s = 0;
  for (let i = 0; i < 11; i++) s += Number(d11[i]) * (i % 2 === 0 ? 3 : 1);
  return String((10 - (s % 10)) % 10);
}

// Bundle codes start with 2 (UPC "in-store use" range), so they never clash with real product UPCs.
async function newCode() {
  for (let i = 0; i < 20; i++) {
    const d11 = '2' + String(Date.now() + i).slice(-10);
    const code = d11 + check(d11);
    const hit = await at.list(T.products, { filter: `{UPC}="${code}"`, max: 1 });
    if (!hit.length) return code;
  }
  throw new Error('Could not generate a unique bundle code');
}

exports.handler = wrap(async (event) => {
  if (event.httpMethod === 'GET') {
    const all = await at.list(T.products, {});
    const byUpc = Object.fromEntries(all.map((r) => [r.fields.UPC, r]));
    const bundles = all.filter((r) => r.fields['Is Bundle']).sort((a, b) => String(b.fields.UPC).localeCompare(String(a.fields.UPC)));
    return json(200, {
      bundles: bundles.map((r) => {
        const b = shape.product(r);
        const counts = bundleCounts(r.fields['Bundle Contents']);
        const avail = Object.entries(counts).map(([u, n]) => Math.floor(Number(byUpc[u]?.fields['Qty On Hand'] || 0) / n));
        b.available = avail.length ? Math.max(0, Math.min(...avail)) : 0;
        b.skus = Object.fromEntries(Object.keys(counts).map((u) => [u, byUpc[u]?.fields.SKU || '']));
        return b;
      }),
    });
  }

  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id;
    if (!id) return json(400, { error: 'id required' });
    const p = await at.get(T.products, id);
    if (!p.fields['Is Bundle']) return json(400, { error: 'Not a bundle' });
    await at.del(T.products, id);
    return json(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'GET, POST or DELETE' });
  const b = body(event);

  // Resolve each code (UPC or SKU) to a product, merging repeats.
  const want = {}; const recs = {}; const notFound = [];
  for (const it of b.items || []) {
    const r = await at.findByCode(it.code ?? it.upc);
    if (!r) { notFound.push(it.code ?? it.upc); continue; }
    if (r.fields['Is Bundle']) return json(400, { error: 'A bundle can’t contain another bundle' });
    const u = r.fields.UPC;
    recs[u] = r;
    want[u] = (want[u] || 0) + Math.max(1, Math.round(Number(it.count) || 1));
  }
  if (notFound.length) return json(400, { error: `Not in catalog: ${notFound.join(', ')}` });
  const upcs = Object.keys(want);
  const total = Object.values(want).reduce((a, c) => a + c, 0);
  if (total < 2) return json(400, { error: 'A bundle needs at least 2 items' });

  let cost = 0, costKnown = true, startSum = 0;
  const lines = upcs.map((u) => {
    const f = recs[u].fields;
    if (f.Cost == null) costKnown = false; else cost += Number(f.Cost) * want[u];
    startSum += Number(f['Start Price'] || 0) * want[u];
    return `${u} ×${want[u]} — ${f.Name || ''}`;
  });
  const shortNames = upcs.map((u) => (want[u] > 1 ? `${want[u]}× ` : '') + (recs[u].fields.Name || u).split(/ [-–] |,/)[0].trim());

  const fields = {
    UPC: await newCode(),
    Name: (String(b.name || '').trim() || (shortNames.length <= 3
      ? `Bundle: ${shortNames.join(' + ')}`
      : `Bundle of ${total}: ${shortNames.slice(0, 2).join(' + ')} + ${shortNames.length - 2} more`)).slice(0, 250),
    Brand: 'Bundle',
    Category: 'Bundle',
    'Is Bundle': true,
    Components: upcs.map((u) => recs[u].id),
    'Bundle Contents': lines.join('\n'),
  };
  if (costKnown) fields.Cost = Math.round(cost * 100) / 100;
  const sp = num(b.startPrice);
  if (sp != null && String(b.startPrice).trim() !== '') fields['Start Price'] = sp;
  else if (startSum > 0) fields['Start Price'] = startSum;
  const img = upcs.map((u) => recs[u].fields['Image URL']).find(Boolean);
  if (img) fields['Image URL'] = img;

  const [rec] = await at.create(T.products, [fields]);
  return json(200, { bundle: shape.product(rec) });
});
