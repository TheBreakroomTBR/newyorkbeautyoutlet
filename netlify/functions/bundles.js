// GET            → all bundles
// POST {items:[{upc, count}], name?, startPrice?, qty?} → creates a bundle with its own printable barcode
// DELETE ?id=    → removes a bundle (stock of the items inside is untouched)
const at = require('../lib/airtable');
const shape = require('../lib/shape');
const { json, body, wrap } = require('../lib/http');
const { normUpc, num } = require('../lib/util');
const { T } = at;

// UPC-A check digit
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
    const rows = await at.list(T.products, { filter: '{Is Bundle}', sort: [{ field: 'UPC', direction: 'desc' }], max: 500 });
    return json(200, { bundles: rows.map(shape.product) });
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
  const want = {};
  (b.items || []).forEach((it) => {
    const u = normUpc(it.upc);
    if (u) want[u] = (want[u] || 0) + Math.max(1, Math.round(Number(it.count) || 1));
  });
  const upcs = Object.keys(want);
  const total = Object.values(want).reduce((a, c) => a + c, 0);
  if (total < 2) return json(400, { error: 'A bundle needs at least 2 items' });

  const filter = `OR(${upcs.map((u) => `{UPC}="${u}"`).join(',')})`;
  const found = await at.list(T.products, { filter });
  const byUpc = Object.fromEntries(found.map((r) => [r.fields.UPC, r]));
  const missing = upcs.filter((u) => !byUpc[u]);
  if (missing.length) return json(400, { error: `Not in catalog: ${missing.join(', ')} — add them on Products first` });
  if (upcs.some((u) => byUpc[u].fields['Is Bundle'])) return json(400, { error: 'A bundle can’t contain another bundle' });

  let cost = 0, costKnown = true, startSum = 0;
  const lines = upcs.map((u) => {
    const f = byUpc[u].fields;
    if (f.Cost == null) costKnown = false; else cost += Number(f.Cost) * want[u];
    startSum += Number(f['Start Price'] || 0) * want[u];
    return `${u} ×${want[u]} — ${f.Name || ''}`;
  });
  const shortNames = upcs.map((u) => (want[u] > 1 ? `${want[u]}× ` : '') + (byUpc[u].fields.Name || u).split(/ [-–] |,/)[0].trim());

  const code = await newCode();
  const qty = Math.max(1, Math.round(num(b.qty) || 1));
  const fields = {
    UPC: code,
    Name: (String(b.name || '').trim() || (shortNames.length <= 3
      ? `Bundle: ${shortNames.join(' + ')}`
      : `Bundle of ${total}: ${shortNames.slice(0, 2).join(' + ')} + ${shortNames.length - 2} more`)).slice(0, 250),
    Brand: 'Bundle',
    Category: 'Bundle',
    'Is Bundle': true,
    Components: upcs.map((u) => byUpc[u].id),
    'Bundle Contents': lines.join('\n'),
    'Qty On Hand': qty,
  };
  if (costKnown) fields.Cost = Math.round(cost * 100) / 100;
  const sp = num(b.startPrice);
  if (sp != null && String(b.startPrice).trim() !== '') fields['Start Price'] = sp;
  else if (startSum > 0) fields['Start Price'] = startSum;
  const img = upcs.map((u) => byUpc[u].fields['Image URL']).find(Boolean);
  if (img) fields['Image URL'] = img;

  const [rec] = await at.create(T.products, [fields]);
  return json(200, { bundle: shape.product(rec) });
});
