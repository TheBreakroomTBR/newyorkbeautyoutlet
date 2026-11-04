// Minimal Airtable REST client with pagination, batching, and 429 retry.
const API = 'https://api.airtable.com/v0';

const T = {
  products: process.env.AT_PRODUCTS_TABLE || 'Products',
  auctions: process.env.AT_AUCTIONS_TABLE || 'Auctions',
  orders: process.env.AT_ORDERS_TABLE || 'Orders',
  settings: process.env.AT_SETTINGS_TABLE || 'Settings',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// Strip characters that could break a double-quoted formula string.
const esc = (s) => String(s ?? '').replace(/["\\]/g, '');

function baseId() {
  const id = process.env.AIRTABLE_BASE_ID;
  if (!id) throw new Error('AIRTABLE_BASE_ID is not set');
  if (!process.env.AIRTABLE_TOKEN) throw new Error('AIRTABLE_TOKEN is not set');
  return id;
}

async function req(method, table, path = '', { query, body } = {}) {
  const url = new URL(`${API}/${baseId()}/${encodeURIComponent(table)}${path}`);
  (query || []).forEach(([k, v]) => url.searchParams.append(k, v));
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || data?.error?.type || JSON.stringify(data);
      throw new Error(`Airtable ${method} ${table}: ${res.status} ${msg}`);
    }
    return data;
  }
  throw new Error('Airtable rate limit — try again in a moment');
}

async function list(table, { filter, sort, max, fields } = {}) {
  const out = [];
  let offset;
  do {
    const q = [['pageSize', '100']];
    if (filter) q.push(['filterByFormula', filter]);
    if (max) q.push(['maxRecords', String(max)]);
    (sort || []).forEach((s, i) => {
      q.push([`sort[${i}][field]`, s.field]);
      q.push([`sort[${i}][direction]`, s.direction || 'asc']);
    });
    (fields || []).forEach((f) => q.push(['fields[]', f]));
    if (offset) q.push(['offset', offset]);
    const d = await req('GET', table, '', { query: q });
    out.push(...(d.records || []));
    offset = d.offset;
  } while (offset && (!max || out.length < max));
  return max ? out.slice(0, max) : out;
}

async function get(table, id) { return req('GET', table, `/${id}`); }
async function del(table, id) { return req('DELETE', table, `/${id}`); }

async function create(table, fieldsList) {
  const out = [];
  for (const c of chunk(fieldsList, 10)) {
    const d = await req('POST', table, '', { body: { records: c.map((fields) => ({ fields })), typecast: true } });
    out.push(...d.records);
  }
  return out;
}

async function update(table, records) {
  const out = [];
  for (const c of chunk(records, 10)) {
    const d = await req('PATCH', table, '', { body: { records: c, typecast: true } });
    out.push(...d.records);
  }
  return out;
}

async function upsert(table, fieldsList, mergeOn) {
  const out = [];
  for (const c of chunk(fieldsList, 10)) {
    const d = await req('PATCH', table, '', {
      body: { performUpsert: { fieldsToMergeOn: mergeOn }, records: c.map((fields) => ({ fields })), typecast: true },
    });
    out.push(...d.records);
  }
  return out;
}

module.exports = { T, esc, list, get, del, create, update, upsert };
