// Creates the four tables with the exact fields the app expects.
// Run once:  AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... node scripts/setup-airtable.js
// Token needs scopes: schema.bases:read, schema.bases:write (plus data.records:read/write for the app).
// Tables that already exist are skipped.

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;
const TZ = process.env.STORE_TZ || 'America/New_York';
if (!TOKEN || !BASE) { console.error('Set AIRTABLE_TOKEN and AIRTABLE_BASE_ID'); process.exit(1); }

const META = `https://api.airtable.com/v0/meta/bases/${BASE}/tables`;
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const text = (name) => ({ name, type: 'singleLineText' });
const long = (name) => ({ name, type: 'multilineText' });
const money = (name) => ({ name, type: 'currency', options: { precision: 2, symbol: '$' } });
const int = (name) => ({ name, type: 'number', options: { precision: 0 } });
const url = (name) => ({ name, type: 'url' });
const check = (name) => ({ name, type: 'checkbox', options: { icon: 'check', color: 'yellowBright' } });
const when = (name) => ({ name, type: 'dateTime', options: { dateFormat: { name: 'us' }, timeFormat: { name: '12hour' }, timeZone: TZ } });
const select = (name, choices) => ({ name, type: 'singleSelect', options: { choices: choices.map((c) => ({ name: c })) } });

async function main() {
  const existing = await (await fetch(META, { headers: H })).json();
  if (existing.error) throw new Error(JSON.stringify(existing.error));
  const byName = Object.fromEntries((existing.tables || []).map((t) => [t.name, t]));

  async function make(name, fields) {
    if (byName[name]) { console.log(`✓ ${name} already exists — skipped`); return byName[name]; }
    const res = await fetch(META, { method: 'POST', headers: H, body: JSON.stringify({ name, fields }) });
    const d = await res.json();
    if (!res.ok) throw new Error(`${name}: ${JSON.stringify(d.error || d)}`);
    console.log(`+ created ${name}`);
    return d;
  }

  const products = await make('Products', [
    text('UPC'), text('Name'), text('Brand'), text('Category'), money('Cost'), int('Qty On Hand'), url('Image URL'),
  ]);

  await make('Auctions', [
    text('Auction Key'),
    text('UPC'),
    { name: 'Product', type: 'multipleRecordLinks', options: { linkedTableId: products.id } },
    text('Product Name'), text('Brand'), money('Cost'), url('Image URL'),
    int('Scanned Ms'), when('Scanned At'), text('Stream Date'),
    select('Match Status', ['Open', 'Sold', 'No Sale', 'Canceled']),
    check('Unknown'),
    text('Order ID'), money('Sale Price'), text('Buyer'), text('Order Status'), when('Matched At'),
  ]);

  await make('Orders', [
    text('Order ID'), int('Created Ms'), when('Created At'), money('Price'), text('Order Status'), text('Buyer'), text('Source'),
    select('Match Status', ['Unmatched', 'Matched', 'Review', 'Canceled', 'Ignored']),
    text('Auction Rec'), text('Auction'), long('Note'), long('Raw'),
  ]);

  await make('Settings', [text('Key'), long('Value')]);

  console.log('Done. You can delete the default "Table 1" in Airtable.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
