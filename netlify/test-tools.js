// Testing without going live (passcode-protected).
// GET                          → TikTok connection status + 5 most recent shop orders
// POST {action:'replay', orderId} → pull a real TikTok order and run it through matching (same as the webhook)
// POST {action:'clear'}          → delete simulated test sales and put their stock back
const at = require('../lib/airtable');
const tiktok = require('../lib/tiktok');
const { processOrder, adjustQty } = require('../lib/match');
const { json, body, wrap } = require('../lib/http');
const { T } = at;

exports.handler = wrap(async (event) => {
  if (event.httpMethod === 'GET') {
    const s = await tiktok.readSettings();
    const out = {
      connected: !!s.tiktok_access_token,
      shop: s.tiktok_shop_name || '',
      shopReady: !!s.tiktok_shop_cipher,
      orders: [],
      error: '',
    };
    if (out.connected && out.shopReady) {
      try {
        const orders = await tiktok.recentOrders(5);
        out.orders = orders.map((o) => {
          const m = tiktok.mapOrder(o);
          return { orderId: m.orderId, createdMs: m.createdMs, price: m.price, status: m.status, auction: tiktok.isAuctionOrder(o) };
        });
      } catch (e) { out.error = e.message; }
    }
    return json(200, out);
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'GET or POST' });
  const b = body(event);

  if (b.action === 'replay') {
    const ord = await tiktok.getOrder(String(b.orderId || '').trim());
    if (!ord) return json(404, { error: 'TikTok has no order with that ID' });
    const o = tiktok.mapOrder(ord);
    o.source = 'replay';
    return json(200, { result: await processOrder(o) });
  }

  if (b.action === 'clear') {
    const orders = await at.list(T.orders, { filter: `{Source}="test"` });
    let restocked = 0;
    const auctionIds = [];
    for (const o of orders) {
      const aRec = o.fields['Auction Rec'];
      if (!aRec) continue;
      const a = await at.get(T.auctions, aRec).catch(() => null);
      if (!a) continue;
      auctionIds.push(a.id);
      if (a.fields['Match Status'] === 'Sold') {
        await adjustQty(a, +1);
        restocked++;
      }
    }
    await at.delMany(T.auctions, auctionIds);
    await at.delMany(T.orders, orders.map((o) => o.id));
    return json(200, { ok: true, orders: orders.length, scans: auctionIds.length, restocked });
  }

  return json(400, { error: 'Unknown action' });
});
