// Creates the four tables with the exact fields the app expects. Existing tables are skipped.
const TZ = process.env.STORE_TZ || 'America/New_York';

const text = (name) => ({ name, type: 'singleLineText' });
const long = (name) => ({ name, type: 'multilineText' });
const money = (name) => ({ name, type: 'currency', options: { precision: 2, symbol: '$' } });
const int = (name) => ({ name, type: 'number', options: { precision: 0 } });
const url = (name) => ({ name, type: 'url' });
const check = (name) => ({ name, type: 'checkbox', options: { icon: 'check', color: 'yellowBright' } });
const when = (name) => ({ name, type: 'dateTime', options: { dateFormat: { name: 'us' }, timeFormat: { name: '12hour' }, timeZone: TZ } });
const select = (name, choices) => ({ name, type: 'singleSelect', options: { choices: choices.map((c) => ({ name: c })) } });

async function setupTables() {
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;
  if (!token || !base) throw new Error('Add AIRTABLE_TOKEN and AIRTABLE_BASE_ID in Netlify, then redeploy');

  const META = `https://api.airtable.com/v0/meta/bases/${base}/tables`;
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const log = [];

  const res = await fetch(META, { headers: H });
  const existing = await res.json();
  if (!res.ok) {
    throw new Error(`Airtable said ${res.status}: ${existing?.error?.message || existing?.error?.type || 'error'}. ` +
      'Check the token has schema.bases:read + schema.bases:write and this base is added under Access.');
  }
  const byName = Object.fromEntries((existing.tables || []).map((t) => [t.name, t]));

  async function make(name, fields) {
    if (byName[name]) { log.push(`${name}: already exists — skipped`); return byName[name]; }
    const r = await fetch(META, { method: 'POST', headers: H, body: JSON.stringify({ name, fields }) });
    const d = await r.json();
    if (!r.ok) throw new Error(`${name}: ${d?.error?.message || JSON.stringify(d.error || d)}`);
    log.push(`${name}: created`);
    return d;
  }

  const products = await make('Products', [
    text('UPC'), text('Name'), text('Brand'), text('Category'), money('Cost'), int('Qty On Hand'), url('Image URL'),
    text('SKU'), money('Start Price'), check('Is Bundle'), long('Bundle Contents'),
  ]);
  if (!byName.Products) {
    // Bundles link to the products inside them (a self-link, so it's added after the table exists).
    const r = await fetch(`${META}/${products.id}/fields`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Components', type: 'multipleRecordLinks', options: { linkedTableId: products.id } }) });
    if (!r.ok) log.push('Products: could not add Components field — add it by hand (link to Products)');
  }

  await make('Auctions', [
    text('Auction Key'), text('UPC'),
    { name: 'Product', type: 'multipleRecordLinks', options: { linkedTableId: products.id } },
    text('Product Name'), text('Brand'), money('Cost'), url('Image URL'),
    int('Scanned Ms'), when('Scanned At'), text('Stream Date'),
    select('Match Status', ['Open', 'Sold', 'No Sale', 'Canceled']),
    check('Unknown'),
    text('Order ID'), money('Sale Price'), text('Buyer'), text('Order Status'), when('Matched At'),
    int('Units'), long('Bundle Items'), int('Sale Number'), text('Stream ID'),
  ]);

  await make('Orders', [
    text('Order ID'), int('Created Ms'), when('Created At'), money('Price'), text('Order Status'), text('Buyer'), text('Source'),
    select('Match Status', ['Unmatched', 'Matched', 'Review', 'Canceled', 'Ignored']),
    text('Auction Rec'), text('Auction'), long('Note'), long('Raw'),
  ]);

  await make('Settings', [text('Key'), long('Value')]);

  if (byName['Table 1']) log.push('Delete "Table 1" in Airtable — it isn\'t used.');
  return log;
}

module.exports = { setupTables };
