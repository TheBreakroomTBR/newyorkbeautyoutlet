// GET ?upc= → name/brand/category/image from UPCitemdb (free trial tier, ~100 lookups/day)
const { json, wrap } = require('../lib/http');
const { normUpc } = require('../lib/util');

exports.handler = wrap(async (event) => {
  const upc = normUpc(event.queryStringParameters?.upc);
  if (!upc) return json(400, { error: 'No UPC' });
  const key = process.env.UPCITEMDB_KEY;
  const url = key
    ? `https://api.upcitemdb.com/prod/v1/lookup?upc=${upc}`
    : `https://api.upcitemdb.com/prod/trial/lookup?upc=${upc}`;
  const headers = key ? { user_key: key, key_type: '3scale' } : {};
  const res = await fetch(url, { headers });
  if (res.status === 429) return json(429, { error: 'Daily UPC lookup limit reached — type the details in' });
  const d = await res.json().catch(() => ({}));
  const it = (d.items || [])[0];
  if (!it) return json(200, { found: false });
  return json(200, {
    found: true,
    name: it.title || '',
    brand: it.brand || '',
    category: (it.category || '').split('>').pop().trim(),
    image: (it.images || [])[0] || '',
  });
});
