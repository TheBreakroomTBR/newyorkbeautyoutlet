// One-time TikTok Shop connection.
//   /api/tiktok-auth?start=1  → sends you to TikTok's authorize page (TIKTOK_AUTH_URL)
//   /api/tiktok-auth?code=... → TikTok redirects back here; tokens + shop are saved to Settings
const tiktok = require('../lib/tiktok');

const page = (title, msg) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
  body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#120a1c;color:#f3ecfb;font-family:system-ui;padding:40px;max-width:560px"><h1 style="color:#d6b25e">${title}</h1><p>${msg}</p><p><a style="color:#d6b25e" href="/">Back to tracker</a></p></body>`,
});

const clean = (s) => String(s).replace(/[<>&"]/g, '');

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  try {
    if (qs.start) {
      const url = process.env.TIKTOK_AUTH_URL;
      if (!url) return page('Missing setting', 'Set TIKTOK_AUTH_URL to the authorization link from TikTok Shop Partner Center.');
      return { statusCode: 302, headers: { Location: url } };
    }
    if (qs.code) {
      const d = await tiktok.exchangeCode(qs.code);
      const shop = await tiktok.fetchAndStoreShop(d.access_token);
      return page('TikTok Shop connected', `Shop: ${clean(shop.name || shop.id)}. New auction orders will now match automatically.`);
    }
    return page('TikTok connection', 'Open <code>/api/tiktok-auth?start=1</code> to connect your shop.');
  } catch (e) {
    console.error(e);
    return page('Connection failed', clean(e.message));
  }
};
