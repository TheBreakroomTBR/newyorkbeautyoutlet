function json(status, data) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(data) };
}

function rawBody(event) {
  if (!event.body) return '';
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}

function body(event) {
  const raw = rawBody(event);
  return raw ? JSON.parse(raw) : {};
}

function authed(event) {
  const pc = process.env.APP_PASSCODE;
  if (!pc) return true;
  const h = event.headers || {};
  return (h['x-passcode'] || h['X-Passcode']) === pc;
}

// Wraps app endpoints: passcode check + consistent error JSON.
function wrap(handler) {
  return async (event, context) => {
    try {
      if (!authed(event)) return json(401, { error: 'Passcode required' });
      return await handler(event, context);
    } catch (e) {
      console.error(e);
      return json(500, { error: e.message });
    }
  };
}

module.exports = { json, body, rawBody, wrap };
