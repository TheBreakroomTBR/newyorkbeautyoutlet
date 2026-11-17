// One-time TikTok Shop connection.
//   /api/tiktok-auth?start=1  → sends you to TikTok's authorize page (TIKTOK_AUTH_URL)
//   /api/tiktok-auth?code=... → TikTok redirects back here; tokens + shop are saved to Settings
//   /api/tiktok-auth?shop=1   → retries just the shop lookup with the saved token
const tiktok = require('../lib/tiktok');

const page = (title, msg, ok) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="background:#fdeded;color:#1c1416;font-family:Inter,system-ui,sans-serif;padding:40px;max-width:600px;line-height:1.5"><h1 style="color:${ok ? '#3d8a68' : '#b8707c'};font-size:26px">${title}</h1><p>${msg}</p><p><a style="color:#b8707c;font-weight:600" href="/">Back to tracker</a></p></body>`,
});

const clean = (s) => String(s).replace(/[<>&"]/g, '');

// Read the auth code from the raw query string. Parsed params can turn "+" into a space,
// which corrupts the code and causes "invalid auth code".
function rawCode(event) {
  const raw = event.rawQuery || (event.rawUrl ? String(event.rawUrl).split('?')[1] : '') || '';
  const m = raw.match(/(?:^|&)code=([^&]*)/);
  if (m) return decodeURIComponent(m[1]);
  return event.queryStringParameters?.code || '';
}

async function finishWithShop(accessToken) {
  const shop = await tiktok.fetchAndStoreShop(accessToken);
  return page('TikTok Shop connected', `Shop: <b>${clean(shop.name || shop.id)}</b>. New auction orders will now match automatically. You can close this tab.`, true);
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  try {
    if (qs.start) {
      const url = process.env.TIKTOK_AUTH_URL;
      if (!url) return page('Missing setting', 'Set TIKTOK_AUTH_URL to the authorization link from TikTok Shop Partner Center.');
      if (url.includes(event.headers?.host || '___')) return page('Wrong setting', 'TIKTOK_AUTH_URL points at this site. It should be the TikTok authorization link from Partner Center.');
      return { statusCode: 302, headers: { Location: url, 'Cache-Control': 'no-store' } };
    }

    if (qs.shop) {
      const s = await tiktok.readSettings();
      if (!s.tiktok_access_token) return page('Not connected yet', 'Open <code>/api/tiktok-auth?start=1</code> to connect your shop.');
      return await finishWithShop(s.tiktok_access_token);
    }

    const code = rawCode(event);
    if (code) {
      let d;
      try {
        d = await tiktok.exchangeCode(code);
      } catch (e) {
        if (/36004004|invalid auth code/i.test(e.message)) {
          return page('That login link was already used',
            'TikTok login codes work once and expire within minutes. Open <a href="/api/tiktok-auth?start=1">/api/tiktok-auth?start=1</a> in a new incognito window, approve once, and don’t refresh this page.');
        }
        throw e;
      }
      return await finishWithShop(d.access_token);
    }

    return page('TikTok connection', 'Open <a href="/api/tiktok-auth?start=1">/api/tiktok-auth?start=1</a> to connect your shop.');
  } catch (e) {
    console.error(e);
    let hint = '';
    if (/105005|scope/i.test(e.message)) hint = '<br><br>Your app is missing a permission, or this login happened before it was added. Turn on <b>Shop Authorized Information</b> and <b>Order Information</b> in Partner Center, then <a href="/api/tiktok-auth?start=1">connect again</a>.';
    return page('Connection failed', clean(e.message) + hint);
  }
};
