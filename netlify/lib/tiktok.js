// TikTok Shop Partner API helpers.
// Endpoints and signing follow the 202309 API version. Confirm field names against
// your first real order — every webhook order's full JSON is saved in Orders → Raw.

const crypto = require('crypto');
const at = require('./airtable');
const { T } = at;

const HOST = 'https://open-api.tiktokglobalshop.com';
const AUTH_HOST = 'https://auth.tiktok-shops.com';
const APP_KEY = process.env.TIKTOK_APP_KEY || '';
const APP_SECRET = process.env.TIKTOK_APP_SECRET || '';

function requireCreds() {
  if (!APP_KEY || !APP_SECRET) throw new Error('TIKTOK_APP_KEY / TIKTOK_APP_SECRET not set');
}

// sign = HMAC_SHA256(secret, secret + path + sorted(key+value) + body + secret)
function sign(path, params, body) {
  const keys = Object.keys(params).filter((k) => k !== 'sign' && k !== 'access_token').sort();
  let s = path + keys.map((k) => k + params[k]).join('');
  if (body) s += body;
  s = APP_SECRET + s + APP_SECRET;
  return crypto.createHmac('sha256', APP_SECRET).update(s).digest('hex');
}

// ---- token storage in the Settings table (Key / Value) ----
async function readSettings() {
  const rows = await at.list(T.settings, { filter: `FIND("tiktok_",{Key})=1` });
  const s = {};
  rows.forEach((r) => { s[r.fields.Key] = r.fields.Value; });
  return s;
}

async function writeSettings(obj) {
  const recs = Object.entries(obj).map(([Key, Value]) => ({ Key, Value: String(Value ?? '') }));
  await at.upsert(T.settings, recs, ['Key']);
}

async function storeTokens(d) {
  await writeSettings({
    tiktok_access_token: d.access_token,
    tiktok_access_expires: d.access_token_expire_in,
    tiktok_refresh_token: d.refresh_token,
    tiktok_refresh_expires: d.refresh_token_expire_in,
  });
}

async function authCall(path, params) {
  const url = new URL(AUTH_HOST + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url);
  const d = await res.json();
  if (d.code !== 0) throw new Error(`TikTok auth ${path}: ${d.code} ${d.message}`);
  return d.data;
}

async function exchangeCode(code) {
  requireCreds();
  const d = await authCall('/api/v2/token/get', {
    app_key: APP_KEY, app_secret: APP_SECRET, auth_code: code, grant_type: 'authorized_code',
  });
  await storeTokens(d);
  return d;
}

async function refresh(refreshToken) {
  const d = await authCall('/api/v2/token/refresh', {
    app_key: APP_KEY, app_secret: APP_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token',
  });
  await storeTokens(d);
  return d;
}

async function token() {
  requireCreds();
  const s = await readSettings();
  if (!s.tiktok_access_token) throw new Error('TikTok not connected — open /api/tiktok-auth?start=1 first');
  const nowSec = Date.now() / 1000;
  if (Number(s.tiktok_access_expires || 0) - 3600 < nowSec) {
    const d = await refresh(s.tiktok_refresh_token);
    return { accessToken: d.access_token, shopCipher: s.tiktok_shop_cipher };
  }
  return { accessToken: s.tiktok_access_token, shopCipher: s.tiktok_shop_cipher };
}

async function call(method, path, query = {}, bodyObj, tokenOverride) {
  const tk = tokenOverride || (await token());
  const params = { app_key: APP_KEY, timestamp: String(Math.floor(Date.now() / 1000)), ...query };
  if (tk.shopCipher && !path.startsWith('/authorization')) params.shop_cipher = tk.shopCipher;
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  params.sign = sign(path, params, body);
  const url = new URL(HOST + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    method,
    headers: { 'x-tts-access-token': tk.accessToken, 'content-type': 'application/json' },
    body: body || undefined,
  });
  const d = await res.json();
  if (d.code !== 0) throw new Error(`TikTok ${path}: ${d.code} ${d.message}`);
  return d.data;
}

async function fetchAndStoreShop(accessToken) {
  const d = await call('GET', '/authorization/202309/shops', {}, null, { accessToken });
  const shop = (d.shops || [])[0];
  if (!shop) throw new Error('No authorized shop returned');
  await writeSettings({ tiktok_shop_cipher: shop.cipher, tiktok_shop_name: shop.name || '' });
  return shop;
}

async function getOrder(orderId) {
  const d = await call('GET', '/order/202309/orders', { ids: String(orderId) });
  return (d.orders || [])[0];
}

async function recentOrders(n = 5) {
  const d = await call('POST', '/order/202309/orders/search',
    { page_size: String(n), sort_field: 'create_time', sort_order: 'DESC' }, {});
  return d.orders || [];
}

// Optional filter: only orders on your auction listing(s).
function isAuctionOrder(ord) {
  const ids = String(process.env.AUCTION_PRODUCT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return true;
  return (ord.line_items || []).some((li) => ids.includes(String(li.product_id)));
}

function mapOrder(ord) {
  const items = ord.line_items || [];
  // Winning bid = product subtotal (no shipping/tax). Falls back to summing line items.
  let price = Number(ord.payment?.sub_total);
  if (!Number.isFinite(price) || price <= 0) price = items.reduce((s, i) => s + Number(i.sale_price || 0), 0);
  return {
    orderId: String(ord.id),
    createdMs: Number(ord.create_time) * 1000,
    price: Math.round(price * 100) / 100,
    status: ord.status || '',
    // Recipient name matches what's on the shipping label, which makes packing easy.
    buyer: ord.recipient_address?.name || ord.buyer_email || ord.user_id || '',
    source: 'tiktok-webhook',
    raw: JSON.stringify(ord),
  };
}

// Webhook signature: HMAC_SHA256(secret, app_key + raw body), sent in the Authorization header.
function verifyWebhook(rawBody, header) {
  if (process.env.TIKTOK_SKIP_VERIFY === '1') return true;
  if (!APP_KEY || !APP_SECRET || !header) return false;
  const expected = crypto.createHmac('sha256', APP_SECRET).update(APP_KEY + rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { exchangeCode, fetchAndStoreShop, getOrder, recentOrders, mapOrder, isAuctionOrder, verifyWebhook, readSettings, APP_KEY };
