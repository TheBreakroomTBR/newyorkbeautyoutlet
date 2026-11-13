// Matches an "Item on Screen" order to the product that was scanned when it sold.
//
// MATCH_MODE=time (default): the order goes to the most recent scan before the order's
//   created time. Use this if TikTok creates the order the moment the auction ends.
// MATCH_MODE=sequence: orders fill open scans oldest-first. Use this if orders only
//   appear after payment (i.e. after the next item has already been scanned).
//
// Canceled orders still consume their scan (marked Canceled) so sequence mode never drifts.

const at = require('./airtable');
const { T } = at;

const WINDOW_MIN = Number(process.env.MATCH_WINDOW_MIN || 45);
const MODE = String(process.env.MATCH_MODE || 'time').toLowerCase();
// Scans logged after the order's created time never qualify. Raise only if TikTok's clock runs early.
const GRACE_MS = Number(process.env.MATCH_GRACE_SEC || 0) * 1000;

const isCanceled = (s) => /cancel/i.test(String(s || ''));

async function findOrderRow(orderId) {
  const rows = await at.list(T.orders, { filter: `{Order ID}="${at.esc(orderId)}"`, max: 1 });
  return rows[0];
}

// Bundle contents lines look like "814655034682 ×2 — Name". Returns {upc: count}.
function bundleCounts(text) {
  const out = {};
  String(text || '').split(/\n/).forEach((line) => {
    const m = line.match(/^\s*(\d{12})\s*[×xX*]\s*(\d+)/);
    if (m) out[m[1]] = (out[m[1]] || 0) + Number(m[2]);
  });
  return out;
}

// Adjusts stock. A bundle is a permanent label with no stock of its own,
// so only the items inside it move (each by its count in the bundle).
async function adjustProductQty(productId, delta) {
  const p = await at.get(T.products, productId);
  const comps = p.fields.Components || [];
  const updates = [];
  if (comps.length) {
    const counts = bundleCounts(p.fields['Bundle Contents']);
    for (const cid of comps) {
      const c = await at.get(T.products, cid);
      const n = counts[c.fields.UPC] || 1;
      updates.push({ id: c.id, fields: { 'Qty On Hand': Number(c.fields['Qty On Hand'] || 0) + delta * n } });
    }
  } else {
    updates.push({ id: p.id, fields: { 'Qty On Hand': Number(p.fields['Qty On Hand'] || 0) + delta } });
  }
  await at.update(T.products, updates); // negatives allowed: they flag a miscount
}

async function adjustQty(auctionRec, delta) {
  const link = auctionRec.fields.Product;
  if (link && link.length) return adjustProductQty(link[0], delta);
  // Live bundle (built on the Live screen): no catalog record, so move each item in the snapshot.
  let items = null;
  try { items = JSON.parse(auctionRec.fields['Bundle Items'] || 'null'); } catch (e) { items = null; }
  if (!items || !items.length) return; // unknown UPC — nothing to adjust
  const updates = [];
  for (const it of items) {
    if (!it.id) continue;
    const c = await at.get(T.products, it.id).catch(() => null);
    if (!c) continue;
    updates.push({ id: c.id, fields: { 'Qty On Hand': Number(c.fields['Qty On Hand'] || 0) + delta * (it.count || 1) } });
  }
  if (updates.length) await at.update(T.products, updates);
}

// Next sale number in this stream (1, 2, 3…). Printed big on the pick label.
async function nextSaleNumber(streamId) {
  if (!streamId) return null;
  const rows = await at.list(T.auctions, {
    filter: `AND({Stream ID}="${at.esc(streamId)}",{Sale Number}>0)`,
    sort: [{ field: 'Sale Number', direction: 'desc' }],
    max: 1,
  });
  return (rows[0] ? Number(rows[0].fields['Sale Number']) : 0) + 1;
}

async function assign(auctionRec, orderRowId, o) {
  const canceled = isCanceled(o.status);
  const saleNumber = !canceled && !auctionRec.fields['Sale Number']
    ? await nextSaleNumber(auctionRec.fields['Stream ID'] || auctionRec.fields['Stream Date'])
    : null;
  await at.update(T.auctions, [{
    id: auctionRec.id,
    fields: {
      'Order ID': o.orderId,
      'Sale Price': o.price,
      Buyer: o.buyer || '',
      'Order Status': o.status || '',
      'Matched At': new Date().toISOString(),
      'Match Status': canceled ? 'Canceled' : 'Sold',
      ...(saleNumber ? { 'Sale Number': saleNumber } : {}),
    },
  }]);
  await at.update(T.orders, [{
    id: orderRowId,
    fields: {
      'Auction Rec': auctionRec.id,
      Auction: auctionRec.fields['Auction Key'] || '',
      'Match Status': canceled ? 'Canceled' : 'Matched',
      Note: '',
    },
  }]);
  if (!canceled) await adjustQty(auctionRec, -1);
}

async function findCandidate(createdMs) {
  const lo = createdMs - WINDOW_MIN * 60000;
  const hi = createdMs + GRACE_MS;
  if (MODE === 'sequence') {
    const rows = await at.list(T.auctions, {
      filter: `AND({Scanned Ms}>=${lo},{Scanned Ms}<=${hi},{Order ID}="",{Match Status}="Open")`,
      sort: [{ field: 'Scanned Ms', direction: 'asc' }],
      max: 1,
    });
    return { cand: rows[0], note: rows[0] ? '' : `No open scan in the ${WINDOW_MIN} min before this order` };
  }
  const rows = await at.list(T.auctions, {
    filter: `AND({Scanned Ms}>=${lo},{Scanned Ms}<=${hi})`,
    sort: [{ field: 'Scanned Ms', direction: 'desc' }],
    max: 1,
  });
  const c = rows[0];
  if (!c) return { cand: null, note: `No scan in the ${WINDOW_MIN} min before this order` };
  if (c.fields['Order ID'] || (c.fields['Match Status'] || 'Open') !== 'Open') {
    return { cand: null, review: true, note: `Latest scan (${c.fields['Product Name'] || c.fields.UPC}) already has an order — two sales on one scan?` };
  }
  return { cand: c, note: '' };
}

// o = { orderId, createdMs, price, status, buyer, source, raw? }
async function processOrder(o) {
  if (!o.orderId) throw new Error('orderId is required');
  if (!Number.isFinite(o.createdMs)) throw new Error(`Order ${o.orderId}: bad created time`);
  const canceled = isCanceled(o.status);

  const fields = {
    'Order ID': String(o.orderId),
    'Created Ms': o.createdMs,
    'Created At': new Date(o.createdMs).toISOString(),
    Price: o.price,
    'Order Status': o.status || '',
    Buyer: o.buyer || '',
    Source: o.source || '',
  };
  if (o.raw) fields.Raw = String(o.raw).slice(0, 90000);

  let row = await findOrderRow(o.orderId);

  if (row) {
    await at.update(T.orders, [{ id: row.id, fields }]);
    const aRec = row.fields['Auction Rec'];
    if (aRec) {
      // Already matched — just keep status/price current.
      const a = await at.get(T.auctions, aRec);
      const was = a.fields['Match Status'];
      const f = { 'Order Status': o.status || '', 'Sale Price': o.price };
      if (canceled && was === 'Sold') {
        f['Match Status'] = 'Canceled';
        await adjustQty(a, +1);
        await at.update(T.orders, [{ id: row.id, fields: { 'Match Status': 'Canceled' } }]);
      }
      await at.update(T.auctions, [{ id: a.id, fields: f }]);
      return { orderId: o.orderId, result: 'updated', auction: a.id };
    }
    if (row.fields['Match Status'] === 'Ignored') return { orderId: o.orderId, result: 'ignored' };
  } else {
    [row] = await at.create(T.orders, [{ ...fields, 'Match Status': 'Unmatched' }]);
  }

  const { cand, note, review } = await findCandidate(o.createdMs);
  if (!cand) {
    await at.update(T.orders, [{ id: row.id, fields: { 'Match Status': review ? 'Review' : 'Unmatched', Note: note } }]);
    return { orderId: o.orderId, result: review ? 'review' : 'unmatched', note };
  }
  await assign(cand, row.id, o);
  return { orderId: o.orderId, result: canceled ? 'matched-canceled' : 'matched', auction: cand.id, product: cand.fields['Product Name'] };
}

// Manual fix from the Review screen.
async function manualAssign(orderRowId, auctionRecId) {
  const row = await at.get(T.orders, orderRowId);
  const a = await at.get(T.auctions, auctionRecId);
  if (a.fields['Order ID']) throw new Error('That scan already has an order');
  if (row.fields['Auction Rec']) throw new Error('That order is already matched');
  const f = row.fields;
  await assign(a, row.id, {
    orderId: f['Order ID'], price: f.Price, status: f['Order Status'], buyer: f.Buyer,
  });
  return { ok: true };
}

module.exports = { processOrder, manualAssign, isCanceled, adjustProductQty, adjustQty, bundleCounts };
