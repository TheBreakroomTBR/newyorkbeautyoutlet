// TikTok Shop order webhook → fetch order → match to the scanned item.
// Not passcode-protected; verified by TikTok's signature instead.
const tiktok = require('../lib/tiktok');
const { processOrder } = require('../lib/match');
const { json, rawBody } = require('../lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(200, { ok: true, hint: 'TikTok webhook endpoint' });
  const raw = rawBody(event);
  const h = event.headers || {};
  if (!tiktok.verifyWebhook(raw, h.authorization || h.Authorization)) {
    console.warn('Webhook signature mismatch');
    return json(401, { error: 'bad signature' });
  }
  let msg;
  try { msg = JSON.parse(raw); } catch { return json(400, { error: 'bad json' }); }

  const orderId = msg?.data?.order_id;
  if (!orderId) return json(200, { ok: true, skipped: 'not an order event' });

  try {
    const ord = await tiktok.getOrder(orderId);
    if (!ord) return json(200, { ok: true, skipped: 'order not found' });
    if (!tiktok.isAuctionOrder(ord)) return json(200, { ok: true, skipped: 'not an auction listing' });
    const result = await processOrder(tiktok.mapOrder(ord));
    console.log('webhook', JSON.stringify(result));
    return json(200, { ok: true, result });
  } catch (e) {
    console.error('webhook error', e);
    return json(500, { error: e.message }); // non-200 lets TikTok retry; processing is idempotent
  }
};
