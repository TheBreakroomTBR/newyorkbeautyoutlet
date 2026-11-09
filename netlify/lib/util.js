const TZ = process.env.STORE_TZ || 'America/New_York';

// One canonical UPC form so scans, CSV imports, and manual entry all match.
// EAN-13 with a leading 0 becomes UPC-A; short codes (Excel-stripped zeros) are left-padded.
function normUpc(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 13 && d[0] === '0') d = d.slice(1);
  if (d.length < 12) d = d.padStart(12, '0');
  return d;
}

function streamDate(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

function clockTime(ms) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(ms));
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// SKUs are compared case-insensitively and without leading zeros ("03468" = "3468").
const normSku = (v) => String(v ?? '').trim().toUpperCase().replace(/\.0+$/, '').replace(/^0+(?=.)/, '');

module.exports = { normUpc, normSku, streamDate, clockTime, num, TZ };
